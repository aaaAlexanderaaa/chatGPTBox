import { getUserConfig } from '../../config/index.mjs'
import { pushRecord, setAbortController } from './shared.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { isEmpty } from 'lodash-es'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { buildSystemPromptFromContext } from '../agent-context.mjs'
import { runMcpToolLoopForAnthropic, shouldShortCircuitWithToolLoop } from '../mcp/tool-loop.mjs'
import { appendToolEvents } from '../agent/session-state.mjs'

/**
 * @param {Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 */
export async function generateAnswersWithClaudeApi(port, question, session) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const cleanupPortListeners = () => {
    port.onMessage.removeListener(messageListener)
    port.onDisconnect.removeListener(disconnectListener)
  }
  const config = await getUserConfig()
  const apiUrl = String(config.customClaudeApiUrl || '').replace(/\/+$/, '')
  const model = getModelValue(session)
  const systemPrompt = buildSystemPromptFromContext(session, config, question)

  // Claude API uses a top-level `system` field rather than a system-role message
  // in the messages array. Do NOT pass { systemPrompt } to getConversationPairs
  // here -- that would double-inject the prompt.
  const prompt = getConversationPairs(
    session.conversationRecords.slice(-config.maxConversationContextLength),
    false,
  )
  prompt.push({ role: 'user', content: question })

  let answer = ''
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    pushRecord(session, question, answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: null, done: true, session: session })
  }

  try {
    const toolLoop = await runMcpToolLoopForAnthropic({
      baseUrl: `${apiUrl}/v1`,
      apiKey: config.claudeApiKey,
      model,
      messages: prompt,
      systemPrompt: systemPrompt || '',
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

  await fetchSSE(`${apiUrl}/v1/messages`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': config.claudeApiKey,
      'anthropic-dangerous-direct-browser-access': true,
    },
    body: JSON.stringify({
      model,
      system: systemPrompt || undefined,
      messages: prompt,
      stream: true,
      max_tokens: config.maxResponseTokenLength,
      temperature: config.temperature,
    }),
    onMessage(message) {
      console.debug('sse message', message)
      if (finished) return

      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        console.debug('json error', error)
        return
      }
      if (data?.type === 'message_stop') {
        finish()
        return
      }

      const delta = data?.delta?.text
      if (delta) {
        answer += delta
        port.postMessage({ answer: answer, done: false, session: null })
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
