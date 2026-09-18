import { generateAnswersWithCustomApi } from '../../services/apis/custom-api.mjs'
import { isUsingCustomModel } from '../../config/predicates.mjs'
import { resolveL1Credentials } from '../../config/engine-selection.mjs'
import { normalizeCustomChatCompletionsUrl } from '../../services/apis/custom-api-utils.mjs'

export default {
  route: 'custom-api',
  match: (session, config) => isUsingCustomModel(session, config),
  async run({ port, session, config }) {
    const l1 = resolveL1Credentials(session, config)
    const apiUrl = l1?.baseUrl || ''
    const apiKey = l1?.apiKey || ''
    const modelName = l1?.modelId || ''
    await generateAnswersWithCustomApi(
      port,
      session.question,
      session,
      normalizeCustomChatCompletionsUrl(apiUrl) || apiUrl,
      apiKey,
      modelName,
    )
  },
}
