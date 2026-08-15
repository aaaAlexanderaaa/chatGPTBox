// Dependency kit handed to module settings cards (module code may not
// import the core, so the render site injects everything the frozen JSX
// needs — see src/modules/api.mjs). Assembled here so every render site
// hands modules the same kit.
import { SettingRow, SettingSection, ToggleRow, ToggleSwitch, Divider } from './SettingComponents.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import {
  CHATGPT_WEB_DEBUG_LOG_KEY,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
} from '../../config/limits.mjs'
import { CHATGPT_WEB_CONVERSATION_META_KEY } from '../../services/clients/chatgpt-web/conversation-cache.mjs'
import { downloadJsonFile, pickJsonFile } from '../file-transfer.mjs'
import {
  exportChatgptHistoryData,
  importChatgptHistoryData,
} from '../../services/clients/chatgpt-web/history-transfer.mjs'

export function buildModuleKit() {
  return {
    SettingRow,
    SettingSection,
    ToggleRow,
    ToggleSwitch,
    Divider,
    parseIntWithClamp,
    parseFloatWithClamp,
    limits: {
      DEFAULT_CONVERSATION_POLL_INTERVAL_SECONDS: DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      MIN_CONVERSATION_POLL_INTERVAL_SECONDS: MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      MAX_CONVERSATION_POLL_INTERVAL_SECONDS: MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      DEFAULT_CONVERSATION_POLL_TIMEOUT_SECONDS: DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      MIN_CONVERSATION_POLL_TIMEOUT_SECONDS: MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      MAX_CONVERSATION_POLL_TIMEOUT_SECONDS: MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      DEFAULT_HISTORY_SYNC_RPM: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
      MIN_HISTORY_SYNC_RPM: MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
      MAX_HISTORY_SYNC_RPM: MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
      DEFAULT_HISTORY_SYNC_INTERVAL_HOURS: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
      MIN_HISTORY_SYNC_INTERVAL_HOURS: MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
      MAX_HISTORY_SYNC_INTERVAL_HOURS: MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
    },
    storageKeys: {
      debugLog: CHATGPT_WEB_DEBUG_LOG_KEY,
      conversationMeta: CHATGPT_WEB_CONVERSATION_META_KEY,
    },
    exportHistory: async () => {
      const payload = await exportChatgptHistoryData()
      downloadJsonFile(
        payload,
        `chatgptbox-chatgpt-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      )
      return payload.summary
    },
    importHistory: async () => {
      const file = await pickJsonFile()
      if (!file) return null
      const text = await file.text()
      const imported = JSON.parse(text)
      return await importChatgptHistoryData(imported)
    },
  }
}
