import { generateAnswersWithMoonshotWebApi } from '../../services/apis/moonshot-web.mjs'
import { isUsingMoonshotWebModel } from '../../config/predicates.mjs'

export default {
  route: 'moonshot-web',
  match: (session) => isUsingMoonshotWebModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithMoonshotWebApi(port, session.question, session, config)
  },
}
