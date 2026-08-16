import { isUsingGrokWebModel } from '../../config/predicates.mjs'
import { generateAnswersWithGrokWebApi } from '../../services/apis/grok-web.mjs'

export default {
  route: 'grok-web',
  match: (session) => isUsingGrokWebModel(session),
  async run({ port, session, config }) {
    await generateAnswersWithGrokWebApi({ port, session, config })
  },
}
