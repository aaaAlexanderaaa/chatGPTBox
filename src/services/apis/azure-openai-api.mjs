import { getUserConfig } from '../../config/storage.mjs'
import {
  completionOutcome,
  getRequestConversationRecords,
  pushRecord,
  setAbortController,
} from './shared.mjs'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { isEmpty } from 'lodash-es'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { resolveL1Credentials, stripTrailingSlash } from '../../config/engine-selection.mjs'

/**
 * @param {Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 */
export async function generateAnswersWithAzureOpenaiApi(port, question, session) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const config = await getUserConfig()
  const l1 = resolveL1Credentials(session, config)
  let model = l1?.modelId || getModelValue(session)
  if (!model) model = config.azureDeploymentName
  const endpoint = stripTrailingSlash(l1?.baseUrl || config.azureEndpoint)
  const apiKey = l1?.apiKey || config.azureApiKey

  const prompt = getConversationPairs(
    getRequestConversationRecords(session).slice(-config.maxConversationContextLength),
    false,
  )
  prompt.push({ role: 'user', content: question })

  let answer = ''
  let finished = false
  const finish = (outcome) => {
    if (finished) return
    finished = true
    if (outcome === 'completed') pushRecord(session, question, answer)
    port.postMessage({ finalContent: answer, done: true, outcome, session })
  }
  await fetchSSE(
    `${endpoint}/openai/deployments/${model}/chat/completions?api-version=2024-02-01`,
    {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
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
        if (data.error) throw new Error(data.error.message || 'Azure stream failed')
        // A `content: null` delta means "no text in this chunk" — appending it
        // would render the literal "null" in the answer.
        if (typeof data.choices?.[0]?.delta?.content === 'string') {
          answer += data.choices[0].delta.content
          port.postMessage({ answer: answer, done: false, session: null })
        }

        if (data.choices && data.choices.length > 0 && data.choices[0]?.finish_reason) {
          finish(completionOutcome(data.choices[0].finish_reason))
        }
      },
      async onStart() {},
      async onEnd(result = {}) {
        if (!result.aborted && !finished) finish('incomplete')
        port.onMessage.removeListener(messageListener)
        port.onDisconnect.removeListener(disconnectListener)
      },
      async onError(resp) {
        port.onMessage.removeListener(messageListener)
        port.onDisconnect.removeListener(disconnectListener)
        if (resp instanceof Error) throw resp
        const error = await resp.json().catch(() => ({}))
        throw new Error(
          !isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`,
        )
      },
    },
  )
}
