import { generateAnswersWithBardWebApi } from '../../services/apis/bard-web.mjs'
import { isUsingGeminiWebModel } from '../../config/predicates.mjs'

export default {
  route: 'gemini-web',
  match: (session) => isUsingGeminiWebModel(session),
  async run({ port, session, ctx }) {
    const cookies = await ctx.getBardCookies()
    await generateAnswersWithBardWebApi(port, session.question, session, cookies)
  },
}
