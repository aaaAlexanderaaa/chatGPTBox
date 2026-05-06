// custom api version

// There is a lot of duplicated code here, but it is very easy to refactor.
// The current state is mainly convenient for making targeted changes at any time,
// and it has not yet had a negative impact on maintenance.
// If necessary, I will refactor.

import { getUserConfig } from '../../config/index.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
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
import {
  buildCustomApiHeaders,
  createCustomApiHttpError,
  createCustomApiNetworkError,
  createUnexpectedCustomApiPayloadError,
  extractCustomApiChunkText,
  formatCustomApiDisplayAnswer,
  formatCustomApiErrorPayload,
  normalizeCustomChatCompletionsUrl,
} from './custom-api-utils.mjs'

function deriveOpenAiBaseUrl(apiUrl) {
  const url = normalizeCustomChatCompletionsUrl(apiUrl)
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
  const failRequest = (error) => {
    cleanupPortListeners()
    throw error
  }

  const config = await getUserConfig()
  const requestUrl = normalizeCustomChatCompletionsUrl(apiUrl)
  if (!requestUrl) throw new Error('Missing Custom API URL')
  const model = typeof modelName === 'string' ? modelName.trim() : ''
  if (!model) throw new Error('Missing Custom Model Name')

  const protocol = resolveOpenAiCompatibleProtocol(requestUrl, config?.agentProtocol)
  const systemPrompt = await buildSystemPromptFromContext(session, config, question)
  const prompt = getConversationPairs(
    session.conversationRecords.slice(-config.maxConversationContextLength),
    false,
    { systemPrompt },
  )
  prompt.push({ role: 'user', content: question })

  let answer = ''
  let reasoning = ''
  let finalContent = ''
  let finished = false
  const updateDisplayedAnswer = () => {
    answer = formatCustomApiDisplayAnswer(reasoning, finalContent)
    if (answer) port.postMessage({ answer, done: false, session: null })
  }
  const finish = () => {
    if (finished) return
    finished = true
    pushRecord(session, question, finalContent || answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: null, done: true, session: session })
  }

  const derivedBaseUrl = deriveOpenAiBaseUrl(requestUrl)
  if (derivedBaseUrl) {
    try {
      const toolLoop = await runMcpToolLoopForOpenAiCompat({
        protocol,
        baseUrl: derivedBaseUrl,
        apiKey,
        model,
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
        model,
        input: converted.input,
        max_output_tokens: config.maxResponseTokenLength,
        temperature: config.temperature,
        store: false,
      }
      if (converted.instructions) requestBody.instructions = converted.instructions
      const payload = await postOpenAiResponses(
        derivedBaseUrl,
        typeof apiKey === 'string' ? apiKey.trim() : '',
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

  await fetchSSE(requestUrl, {
    method: 'POST',
    signal: controller.signal,
    headers: buildCustomApiHeaders(apiKey),
    body: JSON.stringify({
      messages: prompt,
      model,
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

      if (data.error) failRequest(new Error(formatCustomApiErrorPayload(data.error)))

      const chunk = extractCustomApiChunkText(data)
      if (!chunk.recognized) failRequest(createUnexpectedCustomApiPayloadError(data))
      if (chunk.hasContent) {
        if (chunk.reasoning) reasoning += chunk.reasoning
        if (chunk.content) {
          if (chunk.replace) finalContent = chunk.content
          else finalContent += chunk.content
        }
        updateDisplayedAnswer()
      }

      if (data.choices?.[0]?.finish_reason) {
        finish()
        return
      }
    },
    async onStart() {},
    async onEnd(result = {}) {
      cleanupPortListeners()
      if (result.aborted) return
      if (!finished) {
        if (answer.trim()) {
          finish()
          return
        }
        throw new Error('Custom API response ended without answer content')
      }
      port.postMessage({ done: true })
    },
    async onError(resp) {
      cleanupPortListeners()
      if (resp instanceof Error) throw createCustomApiNetworkError(resp, requestUrl)
      throw await createCustomApiHttpError(resp)
    },
  })
}
