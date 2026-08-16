import { Models } from '../../config/models.mjs'

export async function generateAnswersWithGrokWebApi({ session, config }) {
  const modelSlug = Models[session.modelName]?.value ?? 'grok-chat-fast'

  if (config.grokWebSignedIn !== true) {
    throw new Error('Please login at https://grok.com first')
  }

  void modelSlug
  throw new Error('Grok Web proxy is not wired')
}
