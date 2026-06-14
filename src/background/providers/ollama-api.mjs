import { generateAnswersWithOllamaApi } from '../../services/apis/ollama-api.mjs'
import { isUsingOllamaApiModel } from '../../config/predicates.mjs'

export default {
  route: 'ollama-api',
  match: (session) => isUsingOllamaApiModel(session),
  async run({ port, session }) {
    await generateAnswersWithOllamaApi(port, session.question, session)
  },
}
