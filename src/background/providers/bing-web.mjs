import { generateAnswersWithBingWebApi } from '../../services/apis/bing-web.mjs'
import { isUsingBingWebModel } from '../../config/predicates.mjs'
import { isUsingModelName } from '../../utils/model-name-convert.mjs'

export default {
  route: 'bing-web',
  match: (session) => isUsingBingWebModel(session),
  async run({ port, session, ctx }) {
    const accessToken = await ctx.getBingAccessToken()
    if (isUsingModelName('bingFreeSydney', session))
      await generateAnswersWithBingWebApi(port, session.question, session, accessToken, true)
    else await generateAnswersWithBingWebApi(port, session.question, session, accessToken)
  },
}
