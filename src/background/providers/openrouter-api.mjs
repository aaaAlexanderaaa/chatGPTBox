import { generateAnswersWithOpenRouterApi } from '../../services/apis/openrouter-api.mjs'
import { isUsingOpenRouterApiModel } from '../../config/predicates.mjs'

export default {
  route: 'openrouter-api',
  match: (session) => isUsingOpenRouterApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithOpenRouterApi(port, session.question, session, config.openRouterApiKey)
  },
}
