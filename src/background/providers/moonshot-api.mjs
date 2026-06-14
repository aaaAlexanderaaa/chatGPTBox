import { generateAnswersWithMoonshotCompletionApi } from '../../services/apis/moonshot-api.mjs'
import { isUsingMoonshotApiModel } from '../../config/predicates.mjs'

export default {
  route: 'moonshot-api',
  match: (session) => isUsingMoonshotApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithMoonshotCompletionApi(
      port,
      session.question,
      session,
      config.moonshotApiKey,
    )
  },
}
