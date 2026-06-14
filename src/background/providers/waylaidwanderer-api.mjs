import { generateAnswersWithWaylaidwandererApi } from '../../services/apis/waylaidwanderer-api.mjs'
import { isUsingGithubThirdPartyApiModel } from '../../config/predicates.mjs'

export default {
  route: 'waylaidwanderer-api',
  match: (session) => isUsingGithubThirdPartyApiModel(session),
  async run({ port, session }) {
    await generateAnswersWithWaylaidwandererApi(port, session.question, session)
  },
}
