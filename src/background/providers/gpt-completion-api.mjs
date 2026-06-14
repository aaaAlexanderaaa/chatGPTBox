import { generateAnswersWithGptCompletionApi } from '../../services/apis/openai-api.mjs'
import { isUsingGptCompletionApiModel } from '../../config/predicates.mjs'

export default {
  route: 'gpt-completion-api',
  match: (session) => isUsingGptCompletionApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithGptCompletionApi(port, session.question, session, config.apiKey)
  },
}
