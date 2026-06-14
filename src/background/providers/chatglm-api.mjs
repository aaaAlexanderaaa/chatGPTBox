import { generateAnswersWithChatGLMApi } from '../../services/apis/chatglm-api.mjs'
import { isUsingChatGLMApiModel } from '../../config/predicates.mjs'

export default {
  route: 'chatglm-api',
  match: (session) => isUsingChatGLMApiModel(session),
  async run({ port, session }) {
    await generateAnswersWithChatGLMApi(port, session.question, session)
  },
}
