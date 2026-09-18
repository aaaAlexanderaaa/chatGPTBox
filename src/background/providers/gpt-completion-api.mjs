import { generateAnswersWithGptCompletionApi } from '../../services/apis/openai-api.mjs'
import { isUsingGptCompletionApiModel } from '../../config/predicates.mjs'
import { resolveL1Credentials, stripTrailingV1 } from '../../config/engine-selection.mjs'

export default {
  route: 'gpt-completion-api',
  match: (session, config) => isUsingGptCompletionApiModel(session, config),
  async run({ port, session, config }) {
    const l1 = resolveL1Credentials(session, config)
    await generateAnswersWithGptCompletionApi(
      port,
      session.question,
      session,
      l1?.apiKey || '',
      stripTrailingV1(l1?.baseUrl || ''),
    )
  },
}
