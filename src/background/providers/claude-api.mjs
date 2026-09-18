import { generateAnswersWithClaudeApi } from '../../services/apis/claude-api.mjs'
import { isUsingClaudeApiModel } from '../../config/predicates.mjs'

export default {
  route: 'claude-api',
  match: (session, config) => isUsingClaudeApiModel(session, config),
  async run({ port, session }) {
    await generateAnswersWithClaudeApi(port, session.question, session)
  },
}
