import { getUserConfig } from '../../config/storage.mjs'
import { generateAnswersWithChatgptApiCompat } from './openai-api.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 */
export async function generateAnswersWithOllamaApi(port, question, session) {
  const config = await getUserConfig()
  const model = getModelValue(session)
  return generateAnswersWithChatgptApiCompat(
    config.ollamaEndpoint + '/v1',
    port,
    question,
    session,
    config.ollamaApiKey,
    {},
    // A local Ollama server needs no credentials, so the key stays optional.
    { requireApiKey: false },
  ).then(() =>
    fetch(config.ollamaEndpoint + '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.ollamaApiKey && { Authorization: `Bearer ${config.ollamaApiKey}` }),
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
