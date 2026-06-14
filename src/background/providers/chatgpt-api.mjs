import { generateAnswersWithChatgptApi } from '../../services/apis/openai-api.mjs'
import { isUsingChatgptApiModel } from '../../config/predicates.mjs'

export default {
  route: 'chatgpt-api',
  match: (session) => isUsingChatgptApiModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithChatgptApi(port, session.question, session, config.apiKey)
  },
}
