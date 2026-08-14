import { v4 as uuidv4 } from 'uuid'
import { apiModeToModelName, modelNameToDesc } from '../utils/model-name-convert.mjs'
import { t } from 'i18next'

/**
 * @typedef {object} Session
 * @property {string|null} question
 * @property {Object[]|null} conversationRecords
 * @property {string|null} sessionName
 * @property {string|null} sessionId
 * @property {string|null} createdAt
 * @property {string|null} updatedAt
 * @property {string|null} aiName
 * @property {string|null} modelName
 * @property {boolean|null} autoClean
 * @property {boolean} isRetry
 * @property {string|null} conversationId - chatGPT web mode
 * @property {string|null} messageId - chatGPT web mode
 * @property {string|null} parentMessageId - chatGPT web mode
 * @property {string|null} wsRequestId - chatGPT web mode
 * @property {object|null} moonshot_conversation
 * @property {boolean|null} chatgptWebHistoryDisabledOverride
 * @property {boolean|null} chatgptWebIncrementalOutput
 * @property {string|null} chatgptWebThinkingEffortOverride
 */
/**
 * @param {string|null} question
 * @param {Object[]|null} conversationRecords
 * @param {string|null} sessionName
 * @param {string|null} modelName
 * @param {boolean|null} autoClean
 * @param {Object|null} apiMode
 * @param {string} extraCustomModelName
 * @param {boolean|null} chatgptWebHistoryDisabledOverride
 * @param {boolean|null} chatgptWebIncrementalOutput
 * @param {string|null} chatgptWebThinkingEffortOverride
 * @returns {Session}
 */
export function initSession({
  question = null,
  conversationRecords = [],
  sessionName = null,
  modelName = null,
  autoClean = false,
  apiMode = null,
  extraCustomModelName = '',
  chatgptWebHistoryDisabledOverride = null,
  chatgptWebIncrementalOutput = null,
  chatgptWebThinkingEffortOverride = null,
} = {}) {
  return {
    // common
    question,
    conversationRecords,

    sessionName,
    sessionId: uuidv4(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    aiName:
      modelName || apiMode
        ? apiMode?.displayName?.trim()
          ? apiMode.displayName.trim()
          : modelNameToDesc(
              apiMode ? apiModeToModelName(apiMode) : modelName,
              t,
              extraCustomModelName,
            )
        : null,
    modelName,
    apiMode,
    chatgptWebHistoryDisabledOverride:
      typeof chatgptWebHistoryDisabledOverride === 'boolean'
        ? chatgptWebHistoryDisabledOverride
        : null,
    chatgptWebIncrementalOutput:
      typeof chatgptWebIncrementalOutput === 'boolean' ? chatgptWebIncrementalOutput : null,
    chatgptWebThinkingEffortOverride:
      typeof chatgptWebThinkingEffortOverride === 'string'
        ? chatgptWebThinkingEffortOverride
        : null,

    autoClean,
    isRetry: false,

    // chatgpt-web
    conversationId: null,
    messageId: null,
    parentMessageId: null,
    wsRequestId: null,

    // kimi.com
    moonshot_conversation: null,
  }
}
