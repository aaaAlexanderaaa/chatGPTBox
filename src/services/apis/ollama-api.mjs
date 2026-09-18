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
  return generateAnswersWithChatgptApiCompat(
    endpoint + '/v1',
    port,
    question,
    session,
    apiKey,
    {},
    { requireApiKey: false },
  ).then(() =>
    fetch(endpoint + '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        prompt: 't',
        options: {
          num_predict: 1,
        },
        keep_alive: config.ollamaKeepAliveTime === '-1' ? -1 : config.ollamaKeepAliveTime,
      }),
    }),
  )
}
