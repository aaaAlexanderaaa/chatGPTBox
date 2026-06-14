// Provider registry: replaces the 17-branch if/else-if chain that used to live
// inline in background/index.mjs's executeApi(). Each provider module exports
// { route, match, run }. The registry preserves the original branch ordering
// (the isUsing* predicates can overlap on edge-case models, so order matters).
//
// detectExecutionRoute() and executeApi() are now both derived from this single
// ordered list, eliminating the previous two-copies-of-the-same-ordering hazard.

import customApiProvider from './custom-api.mjs'
import chatgptWebHostProvider from './chatgpt-web.mjs'
import claudeWebHostProvider from './claude-web.mjs'
import moonshotWebHostProvider from './moonshot-web.mjs'
import bingWebHostProvider from './bing-web.mjs'
import geminiWebHostProvider from './gemini-web.mjs'
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
import waylaidwandererApiProvider from './waylaidwanderer-api.mjs'

// Order mirrors the original executeApi if/else-if chain exactly.
// Do NOT reorder without comparing against the pre-refactor chain.
export const PROVIDERS = [
  customApiProvider,
  chatgptWebHostProvider,
  claudeWebHostProvider,
  moonshotWebHostProvider,
  bingWebHostProvider,
  geminiWebHostProvider,
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
  waylaidwandererApiProvider,
]

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
