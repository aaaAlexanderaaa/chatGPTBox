import { generateAnswersWithClaudeWebApi } from '../../services/apis/claude-web.mjs'
import { isUsingClaudeWebModel } from '../../config/predicates.mjs'

export default {
  route: 'claude-web',
  match: (session) => isUsingClaudeWebModel(session),
  async run({ port, session, ctx }) {
    const sessionKey = await ctx.getClaudeSessionKey()
    await generateAnswersWithClaudeWebApi(port, session.question, session, sessionKey)
  },
}
