// Dependency kit handed to module settings cards (module code may not
// import the core, so the render site injects everything the frozen JSX
// needs — see src/modules/api.mjs). Assembled here so every render site
// hands modules the same kit.
import {
  SettingRow,
  SettingSection,
  ToggleRow,
  ToggleSwitch,
  Divider,
} from './SettingComponents.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import {
  CHATGPT_WEB_DEBUG_LOG_KEY,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MAX_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  MAX_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  MAX_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
  MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MIN_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
  MIN_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
  MIN_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
  MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
  MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
} from '../../config/limits.mjs'
import { CHATGPT_WEB_CONVERSATION_META_KEY } from '../../services/clients/chatgpt-web/conversation-cache.mjs'
import { CHATGPT_WEB_THINKING_EFFORTS } from '../../services/clients/chatgpt-web/thinking.mjs'
import { downloadChatgptHistoryVolumes, pickJsonFiles } from '../file-transfer.mjs'
import {
  exportChatgptHistoryData,
  getChatgptHistoryLibraryStats,
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
      DEFAULT_CONVERSATION_POLL_INTERVAL_SECONDS:
        DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      MIN_CONVERSATION_POLL_INTERVAL_SECONDS: MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      MAX_CONVERSATION_POLL_INTERVAL_SECONDS: MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
      DEFAULT_CONVERSATION_POLL_TIMEOUT_SECONDS:
        DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      MIN_CONVERSATION_POLL_TIMEOUT_SECONDS: MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      MAX_CONVERSATION_POLL_TIMEOUT_SECONDS: MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
      DEFAULT_HISTORY_SYNC_RPM: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_RPM,
      MIN_HISTORY_SYNC_RPM: MIN_CHATGPT_WEB_HISTORY_SYNC_RPM,
      MAX_HISTORY_SYNC_RPM: MAX_CHATGPT_WEB_HISTORY_SYNC_RPM,
      DEFAULT_HISTORY_SYNC_INTERVAL_HOURS: DEFAULT_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
      MIN_HISTORY_SYNC_INTERVAL_HOURS: MIN_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
      MAX_HISTORY_SYNC_INTERVAL_HOURS: MAX_CHATGPT_WEB_HISTORY_SYNC_INTERVAL_HOURS,
      DEFAULT_HISTORY_HYDRATE_LIMIT: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
      MIN_HISTORY_HYDRATE_LIMIT: MIN_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
      MAX_HISTORY_HYDRATE_LIMIT: MAX_CHATGPT_WEB_HISTORY_HYDRATE_LIMIT,
      DEFAULT_HISTORY_HYDRATE_OFFSET: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
      MIN_HISTORY_HYDRATE_OFFSET: MIN_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
      MAX_HISTORY_HYDRATE_OFFSET: MAX_CHATGPT_WEB_HISTORY_HYDRATE_OFFSET,
      DEFAULT_HISTORY_HYDRATE_RETRY_COUNT: DEFAULT_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
      MIN_HISTORY_HYDRATE_RETRY_COUNT: MIN_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
      MAX_HISTORY_HYDRATE_RETRY_COUNT: MAX_CHATGPT_WEB_HISTORY_HYDRATE_RETRY_COUNT,
    },
    thinkingEfforts: CHATGPT_WEB_THINKING_EFFORTS,
    storageKeys: {
      debugLog: CHATGPT_WEB_DEBUG_LOG_KEY,
      conversationMeta: CHATGPT_WEB_CONVERSATION_META_KEY,
    },
    getHistoryLibraryStats: async () => getChatgptHistoryLibraryStats(),
    exportHistory: async () => {
      const result = await exportChatgptHistoryData()
      const downloadResult = await downloadChatgptHistoryVolumes(result)
      if (downloadResult?.cancelled) return null
      return {
        ...result.summary,
        volumeCount: result.volumes.length,
        downloadMethod: downloadResult?.method || 'download',
      }
    },
    importHistory: async () => {
      const files = await pickJsonFiles()
      if (!files || files.length === 0) return null
      const payloads = []
      for (const file of files) {
        const text = await file.text()
        payloads.push(JSON.parse(text))
      }
      return await importChatgptHistoryData(payloads.length === 1 ? payloads[0] : payloads)
    },
  }
}
