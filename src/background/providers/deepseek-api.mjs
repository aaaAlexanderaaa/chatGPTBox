import { generateAnswersWithDeepSeekApi } from '../../services/apis/deepseek-api.mjs'
import { isUsingDeepSeekApiModel } from '../../config/predicates.mjs'

export default {
  route: 'deepseek-api',
  match: (session) => isUsingDeepSeekApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithDeepSeekApi(port, session.question, session, config.deepSeekApiKey)
  },
}
