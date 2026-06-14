import { generateAnswersWithAzureOpenaiApi } from '../../services/apis/azure-openai-api.mjs'
import { isUsingAzureOpenAiApiModel } from '../../config/predicates.mjs'

export default {
  route: 'azure-openai-api',
  match: (session) => isUsingAzureOpenAiApiModel(session),
  async run({ port, session }) {
    await generateAnswersWithAzureOpenaiApi(port, session.question, session)
  },
}
