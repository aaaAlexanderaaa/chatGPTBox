import { getUserConfig } from '../../config/storage.mjs'
import { generateAnswersWithChatgptApiCompat } from './openai-api.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { resolveL1Credentials, stripTrailingV1 } from '../../config/engine-selection.mjs'

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 */
export async function generateAnswersWithOllamaApi(port, question, session) {
  const config = await getUserConfig()
  const l1 = resolveL1Credentials(session, config)
  const endpoint = stripTrailingV1(l1?.baseUrl || config.ollamaEndpoint)
  const apiKey = l1?.apiKey || config.ollamaApiKey
  const model = l1?.modelId || getModelValue(session)
  const controller = new AbortController()
  let completed = false
  const stop = (message) => {
    if (message?.stop) controller.abort()
  }
  const disconnect = () => controller.abort()
  port.onMessage.addListener(stop)
  port.onDisconnect.addListener(disconnect)
  const observedPort = new Proxy(port, {
    get(target, key) {
      if (key === 'postMessage')
        return (message) => {
          if (message.done)
            completed = !message.error && (!message.outcome || message.outcome === 'completed')
          return target.postMessage(message)
        }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  try {
    await generateAnswersWithChatgptApiCompat(
      endpoint + '/v1',
      observedPort,
      question,
      session,
      apiKey,
      {},
      { requireApiKey: false },
    )
    if (!completed || controller.signal.aborted) return
    // Empty prompt loads/retains the model without generating another answer.
    await fetch(endpoint + '/api/generate', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: config.ollamaKeepAliveTime === '-1' ? -1 : config.ollamaKeepAliveTime,
      }),
    }).catch(() => {})
  } finally {
    port.onMessage.removeListener(stop)
    port.onDisconnect.removeListener(disconnect)
  }
}
