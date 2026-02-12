// custom api version

// There is a lot of duplicated code here, but it is very easy to refactor.
// The current state is mainly convenient for making targeted changes at any time,
// and it has not yet had a negative impact on maintenance.
// If necessary, I will refactor.

import { getUserConfig } from '../../config/index.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { isEmpty } from 'lodash-es'
import { pushRecord, setAbortController } from './shared.mjs'
import { buildSystemPromptFromContext } from '../agent-context.mjs'
import { runMcpToolLoopForOpenAiCompat, shouldShortCircuitWithToolLoop } from '../mcp/tool-loop.mjs'
import { appendToolEvents } from '../agent/session-state.mjs'
import { AgentProtocol, resolveOpenAiCompatibleProtocol } from '../agent/protocols.mjs'
import {
  convertMessagesToResponsesInput,
  extractResponsesOutputText,
  postOpenAiResponses,
} from './openai-responses-shared.mjs'

function deriveOpenAiBaseUrl(apiUrl) {
  const url = String(apiUrl || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (url.endsWith('/chat/completions')) return url.slice(0, -'/chat/completions'.length)
  if (url.endsWith('/responses')) return url.slice(0, -'/responses'.length)
  return url
}

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 * @param {string} apiUrl
 * @param {string} apiKey
 * @param {string} modelName
 */
export async function generateAnswersWithCustomApi(
  port,
  question,
  session,
  apiUrl,
  apiKey,
  modelName,
) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const cleanupPortListeners = () => {
    port.onMessage.removeListener(messageListener)
    port.onDisconnect.removeListener(disconnectListener)
  }

  const config = await getUserConfig()
  const protocol = resolveOpenAiCompatibleProtocol(apiUrl, config?.agentProtocol)
  const systemPrompt = buildSystemPromptFromContext(session, config, question)
  const prompt = getConversationPairs(
    session.conversationRecords.slice(-config.maxConversationContextLength),
    false,
    { systemPrompt },
  )
  prompt.push({ role: 'user', content: question })

  let answer = ''
  let finished = false
  const finish = () => {
    finished = true
    pushRecord(session, question, answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: null, done: true, session: session })
  }

  const derivedBaseUrl = deriveOpenAiBaseUrl(apiUrl)
  if (derivedBaseUrl) {
    try {
      const toolLoop = await runMcpToolLoopForOpenAiCompat({
        protocol,
        baseUrl: derivedBaseUrl,
        apiKey,
        model: modelName,
        messages: prompt,
        config,
        session,
        maxResponseTokenLength: config.maxResponseTokenLength,
        temperature: config.temperature,
        signal: controller.signal,
      })
      if (toolLoop) {
        appendToolEvents(session, toolLoop.events, { limit: config?.agentToolEventLimit })
        if (shouldShortCircuitWithToolLoop(toolLoop)) {
          answer = toolLoop.answer || ''
          if (answer) port.postMessage({ answer, done: false, session: null })
          finish()
          cleanupPortListeners()
          return
        }
      }
    } catch (error) {
      appendToolEvents(
        session,
        [
          {
            type: 'mcp_tool_loop',
            status: 'failed',
            reason: error?.message || String(error),
            createdAt: new Date().toISOString(),
          },
        ],
        { limit: config?.agentToolEventLimit },
      )
    }
  }

  if (protocol === AgentProtocol.openAiResponsesV1 && derivedBaseUrl) {
    try {
      const converted = convertMessagesToResponsesInput(prompt)
      const requestBody = {
        model: modelName,
        input: converted.input,
        max_output_tokens: config.maxResponseTokenLength,
        temperature: config.temperature,
        store: false,
      }
      if (converted.instructions) requestBody.instructions = converted.instructions
      const payload = await postOpenAiResponses(
        derivedBaseUrl,
        apiKey,
        requestBody,
        controller.signal,
      )
      answer = extractResponsesOutputText(payload)
      if (answer) port.postMessage({ answer, done: false, session: null })
      finish()
      return
    } finally {
      cleanupPortListeners()
    }
  }

  await fetchSSE(apiUrl, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: prompt,
      model: modelName,
      stream: true,
      max_tokens: config.maxResponseTokenLength,
      temperature: config.temperature,
    }),
    onMessage(message) {
      console.debug('sse message', message)
      if (finished) return
      if (message.trim() === '[DONE]') {
        finish()
        return
      }
      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        console.debug('json error', error)
        return
      }

      if (data.response) answer = data.response
      else {
        const delta = data.choices[0]?.delta?.content
        const content = data.choices[0]?.message?.content
        const text = data.choices[0]?.text
        if (delta !== undefined) {
          answer += delta
        } else if (content) {
          answer = content
        } else if (text) {
          answer += text
        }
      }
      port.postMessage({ answer: answer, done: false, session: null })

      if (data.choices[0]?.finish_reason) {
        finish()
        return
      }
    },
    async onStart() {},
    async onEnd() {
      port.postMessage({ done: true })
      cleanupPortListeners()
    },
    async onError(resp) {
      cleanupPortListeners()
      if (resp instanceof Error) throw resp
      const error = await resp.json().catch(() => ({}))
      throw new Error(!isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`)
    },
  })
}
