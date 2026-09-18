import { getUserConfig } from '../../config/storage.mjs'
import { pushRecord, setAbortController } from './shared.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { isEmpty } from 'lodash-es'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { parseFloatWithClamp } from '../../utils/parse-float-with-clamp.mjs'
import { parseIntWithClamp } from '../../utils/parse-int-with-clamp.mjs'
import { resolveL1Credentials, stripTrailingV1 } from '../../config/engine-selection.mjs'

/** Anthropic Messages API documented max output tokens. Never send 384000. */
export const CLAUDE_MAX_OUTPUT_TOKENS = 64000

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
  const l1 = resolveL1Credentials(session, config)
  const apiUrl = stripTrailingV1(l1?.baseUrl || config.customClaudeApiUrl || '')
  const model = l1?.modelId || getModelValue(session)

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

  await fetchSSE(`${apiUrl}/v1/messages`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': l1?.apiKey || config.claudeApiKey,
      'anthropic-dangerous-direct-browser-access': true,
    },
    body: JSON.stringify({
      model,
      messages: prompt,
      stream: true,
      max_tokens: parseIntWithClamp(
        config.maxResponseTokenLength,
        CLAUDE_MAX_OUTPUT_TOKENS,
        1,
        CLAUDE_MAX_OUTPUT_TOKENS,
      ),
      temperature: parseFloatWithClamp(config.temperature, 1, 0, 1),
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
