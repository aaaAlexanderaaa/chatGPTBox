import { geminiWebService } from '../../background/gemini-web-service.mjs'

export async function generateAnswersWithGeminiWebApi({ session, port }) {
  await geminiWebService.run({ session, port })
}
