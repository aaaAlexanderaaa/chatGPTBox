// Provider registry: L1 custom providers plus ChatGPT Web, Grok Web, and DSH.

import customApiProvider from './custom-api.mjs'
import dshBridgeProvider from './dsh-bridge.mjs'
import chatgptWebHostProvider from './chatgpt-web.mjs'
import grokWebHostProvider from './grok-web.mjs'
import claudeApiProvider from './claude-api.mjs'
import ollamaApiProvider from './ollama-api.mjs'
import azureOpenaiApiProvider from './azure-openai-api.mjs'
import gptCompletionApiProvider from './gpt-completion-api.mjs'
import { assertProviderAdapter } from './adapter-contract.mjs'
import { resolveEngine } from '../../config/engine-selection.mjs'

const RAW_PROVIDERS = [
  dshBridgeProvider,
  customApiProvider,
  chatgptWebHostProvider,
  grokWebHostProvider,
  claudeApiProvider,
  ollamaApiProvider,
  azureOpenaiApiProvider,
  gptCompletionApiProvider,
]

export const PROVIDERS = RAW_PROVIDERS.map((provider) =>
  assertProviderAdapter(provider, `provider ${provider?.route || '(unknown)'}`),
)

export function detectExecutionRoute(session, config) {
  for (const provider of PROVIDERS) {
    if (provider.match(session, config)) return provider.route
  }
  return 'unknown'
}

export async function executeApi(session, port, config, ctx) {
  console.debug('modelName', session.modelName)
  console.debug('apiMode', session.apiMode)
  const executionRoute = detectExecutionRoute(session, config)
  void ctx?.appendChatgptWebDebugLog?.(config, 'router', {
    route: executionRoute,
    modelName: typeof session.modelName === 'string' ? session.modelName : null,
    apiMode: ctx?.summarizeApiMode?.(session.apiMode),
  })
  for (const provider of PROVIDERS) {
    if (provider.match(session, config)) {
      await provider.run({ session, port, config, ctx })
      return
    }
  }

  const resolved = resolveEngine(session, config)
  let error =
    'No enabled engine matches this selection. Pick a current engine in Settings → Engines.'
  if (resolved.kind === 'chatgpt-web' && config?.chatgptWebEnabled === false) {
    error = 'ChatGPT Web is disabled. Enable it in Settings → Engines.'
  } else if (resolved.kind === 'grok-web' && config?.grokWebEnabled !== true) {
    error = 'Grok Web is disabled. Enable it in Settings → Engines.'
  }
  try {
    port.postMessage({ error })
    port.postMessage({ done: true })
  } catch {
    /* port already gone */
  }
}
