import {
  isInApiModeGroup,
} from '../utils/model-name-convert.mjs'
import {
  aimlApiModelKeys,
  azureOpenAiApiModelKeys,
  chatglmApiModelKeys,
  chatgptApiModelKeys,
  chatgptWebModelKeys,
  claudeApiModelKeys,
  customApiModelKeys,
  deepSeekApiModelKeys,
  dshHarnessModelKeys,
  gptApiModelKeys,
  moonshotApiModelKeys,
  moonshotWebModelKeys,
  ollamaApiModelKeys,
  openRouterApiModelKeys,
} from './models.mjs'

export function isUsingChatgptWebModel(configOrSession) {
  return isInApiModeGroup(chatgptWebModelKeys, configOrSession)
}

export function isUsingDshHarnessModel(configOrSession) {
  return isInApiModeGroup(dshHarnessModelKeys, configOrSession)
}

export function isUsingMoonshotWebModel(configOrSession) {
  return isInApiModeGroup(moonshotWebModelKeys, configOrSession)
}

export function isUsingChatgptApiModel(configOrSession) {
  return isInApiModeGroup(chatgptApiModelKeys, configOrSession)
}

export function isUsingGptCompletionApiModel(configOrSession) {
  return isInApiModeGroup(gptApiModelKeys, configOrSession)
}

export function isUsingOpenAiApiModel(configOrSession) {
  return isUsingChatgptApiModel(configOrSession) || isUsingGptCompletionApiModel(configOrSession)
}

export function isUsingClaudeApiModel(configOrSession) {
  return isInApiModeGroup(claudeApiModelKeys, configOrSession)
}

export function isUsingMoonshotApiModel(configOrSession) {
  return isInApiModeGroup(moonshotApiModelKeys, configOrSession)
}

export function isUsingDeepSeekApiModel(configOrSession) {
  return isInApiModeGroup(deepSeekApiModelKeys, configOrSession)
}

export function isUsingOpenRouterApiModel(configOrSession) {
  return isInApiModeGroup(openRouterApiModelKeys, configOrSession)
}

export function isUsingAimlApiModel(configOrSession) {
  return isInApiModeGroup(aimlApiModelKeys, configOrSession)
}

export function isUsingChatGLMApiModel(configOrSession) {
  return isInApiModeGroup(chatglmApiModelKeys, configOrSession)
}

export function isUsingOllamaApiModel(configOrSession) {
  return isInApiModeGroup(ollamaApiModelKeys, configOrSession)
}

export function isUsingAzureOpenAiApiModel(configOrSession) {
  return isInApiModeGroup(azureOpenAiApiModelKeys, configOrSession)
}

export function isUsingCustomModel(configOrSession) {
  return isInApiModeGroup(customApiModelKeys, configOrSession)
}
