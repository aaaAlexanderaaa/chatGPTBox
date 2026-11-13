import { resolveEngine } from '../../config/engine-selection.mjs'
import { generateAnswersWithGeminiWebApi } from '../../services/apis/gemini-web.mjs'

export default {
  route: 'gemini-web',
  match: (session, config) =>
    config?.geminiWebEnabled === true && resolveEngine(session, config).kind === 'gemini-web',
  async run({ session, port }) {
    await generateAnswersWithGeminiWebApi({ session, port })
  },
}
