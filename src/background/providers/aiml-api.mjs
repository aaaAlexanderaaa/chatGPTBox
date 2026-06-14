import { generateAnswersWithAimlApi } from '../../services/apis/aiml-api.mjs'
import { isUsingAimlApiModel } from '../../config/predicates.mjs'

export default {
  route: 'aiml-api',
  match: (session) => isUsingAimlApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithAimlApi(port, session.question, session, config.aimlApiKey)
  },
}
