import { generateAnswersWithCustomApi } from '../../services/apis/custom-api.mjs'
import { isUsingCustomModel } from '../../config/predicates.mjs'

export default {
  route: 'custom-api',
  match: (session) => isUsingCustomModel(session),
  async run({ port, session, config }) {
    // Two paths: a configured custom-mode session carries its own url/key/name,
    // otherwise fall back to the global customModel* config fields.
    if (!session.apiMode)
      await generateAnswersWithCustomApi(
        port,
        session.question,
        session,
        config.customModelApiUrl.trim() || 'http://localhost:8000/v1/chat/completions',
        config.customApiKey,
        config.customModelName,
      )
    else
      await generateAnswersWithCustomApi(
        port,
        session.question,
        session,
        session.apiMode.customUrl?.trim() ||
          config.customModelApiUrl.trim() ||
          'http://localhost:8000/v1/chat/completions',
        session.apiMode.apiKey?.trim() || config.customApiKey,
        session.apiMode.customName,
      )
  },
}
