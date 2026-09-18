import {
  isUsingChatgptWebEngine,
  isUsingDshEngine,
  isUsingGrokWebEngine,
  isUsingL1Format,
} from './engine-selection.mjs'

export function isUsingChatgptWebModel(configOrSession) {
  return isUsingChatgptWebEngine(configOrSession)
}

export function isUsingDshHarnessModel(configOrSession) {
  return isUsingDshEngine(configOrSession)
}

export function isUsingGrokWebModel(configOrSession) {
  return isUsingGrokWebEngine(configOrSession)
}

export function isUsingMoonshotWebModel() {
  return false
}

export function isUsingChatgptApiModel() {
  return false
}

export function isUsingGptCompletionApiModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'completions', config)
}

export function isUsingOpenAiApiModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'openai-compat', config)
}

export function isUsingClaudeApiModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'anthropic', config)
}

export function isUsingMoonshotApiModel() {
  return false
}

export function isUsingDeepSeekApiModel() {
  return false
}

export function isUsingOpenRouterApiModel() {
  return false
}

export function isUsingAimlApiModel() {
  return false
}

export function isUsingChatGLMApiModel() {
  return false
}

export function isUsingOllamaApiModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'ollama', config)
}

export function isUsingAzureOpenAiApiModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'azure', config)
}

export function isUsingCustomModel(configOrSession, config) {
  return isUsingL1Format(configOrSession, 'openai-compat', config)
}
