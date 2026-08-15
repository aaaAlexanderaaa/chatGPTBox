// Provider registry: replaces the 17-branch if/else-if chain that used to live
// inline in background/index.mjs's executeApi(). Each provider module exports
// { route, match, run } (and optionally id / supportsTools — see
// ./adapter-contract.mjs). The registry preserves the original branch ordering
// (the isUsing* predicates can overlap on edge-case models, so order matters).
//
// detectExecutionRoute() and executeApi() are now both derived from this single
// ordered list, eliminating the previous two-copies-of-the-same-ordering hazard.

import customApiProvider from './custom-api.mjs'
import dshBridgeProvider from './dsh-bridge.mjs'
import chatgptWebHostProvider from './chatgpt-web.mjs'
import moonshotWebHostProvider from './moonshot-web.mjs'
import chatgptApiProvider from './chatgpt-api.mjs'
import claudeApiProvider from './claude-api.mjs'
import moonshotApiProvider from './moonshot-api.mjs'
import chatglmApiProvider from './chatglm-api.mjs'
import deepseekApiProvider from './deepseek-api.mjs'
import ollamaApiProvider from './ollama-api.mjs'
import openrouterApiProvider from './openrouter-api.mjs'
import aimlApiProvider from './aiml-api.mjs'
import azureOpenaiApiProvider from './azure-openai-api.mjs'
import gptCompletionApiProvider from './gpt-completion-api.mjs'
import { assertProviderAdapter } from './adapter-contract.mjs'

// Order mirrors the original executeApi if/else-if chain exactly, with the
// dsh bridge first (newest engine, most specific match).
// Do NOT reorder without comparing against the pre-refactor chain.
const RAW_PROVIDERS = [
  dshBridgeProvider,
  customApiProvider,
  chatgptWebHostProvider,
  moonshotWebHostProvider,
  chatgptApiProvider,
  claudeApiProvider,
  moonshotApiProvider,
  chatglmApiProvider,
  deepseekApiProvider,
  ollamaApiProvider,
  openrouterApiProvider,
  aimlApiProvider,
  azureOpenaiApiProvider,
  gptCompletionApiProvider,
]

// Validate every provider against the adapter contract at module load, so a
// malformed provider fails loudly at startup (and in tests) rather than
// silently routing wrong. See ./adapter-contract.mjs for the contract.
export const PROVIDERS = RAW_PROVIDERS.map((provider) =>
  assertProviderAdapter(provider, `provider ${provider?.route || '(unknown)'}`),
)

export function detectExecutionRoute(session) {
  for (const provider of PROVIDERS) {
    if (provider.match(session)) return provider.route
  }
  return 'unknown'
}

export async function executeApi(session, port, config, ctx) {
  console.debug('modelName', session.modelName)
  console.debug('apiMode', session.apiMode)
  const executionRoute = detectExecutionRoute(session)
  void ctx.appendChatgptWebDebugLog(config, 'router', {
    route: executionRoute,
    modelName: typeof session.modelName === 'string' ? session.modelName : null,
    apiMode: ctx.summarizeApiMode(session.apiMode),
  })
  for (const provider of PROVIDERS) {
    if (provider.match(session)) {
      await provider.run({ session, port, config, ctx })
      return
    }
  }
}
