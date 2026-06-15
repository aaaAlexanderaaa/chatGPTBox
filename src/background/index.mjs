// Background service worker entry point.
//
// After step 3 of the architecture plan this file is intentionally thin: it
// wires lifecycle listeners (onInstalled/onStartup/alarms/storage/onConnect)
// and registers the message router + provider runtime. All business logic
// lives in focused service modules under src/background/:
//
//   - message-router.mjs          runtime.onMessage dispatch
//   - chatgpt-proxy-service.mjs   proxy tab lifecycle, session lock, debug log
//   - fetch-proxy-service.mjs     FETCH allowlist + handler
//   - api-bridge-proxy-service.mjs  WebSocket bridge onConnect handler
//   - webrequest-rules.mjs        DNR rules + webRequest listeners
//
// The chatgpt-web provider now imports the proxy service directly instead of
// reaching back into this module through a reverse `ctx` callback — see the
// "ctx reverse dependency" note that used to live here.

import Browser from 'webextension-polyfill'
import { DEFAULT_CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES } from '../config/limits.mjs'
import { defaultConfig, getUserConfig, setUserConfig } from '../config/storage.mjs'
import '../_locales/i18n'
import {
  getBardCookies,
  getBingAccessToken,
  getClaudeSessionKey,
  registerPortListener,
} from '../services/wrappers.mjs'
import { refreshMenu } from './menus.mjs'
import { registerCommands } from './commands.mjs'
import { executeApi as executeApiFromRegistry } from './providers/registry.mjs'
import { appendChatgptWebDebugLog } from './chatgpt-proxy-service.mjs'
import {
  registerExecuteApi,
  syncChatgptWebConversationCacheWithFallback,
  handleProxyResponsePort,
} from './chatgpt-proxy-service.mjs'
import { handleApiBridgeProxyPort } from './api-bridge-proxy-service.mjs'
import { registerWebRequestRules } from './webrequest-rules.mjs'
import { createMessageRouter } from './message-router.mjs'

const CHATGPT_WEB_CONVERSATION_SYNC_ALARM = 'chatgpt-web-conversation-sync'

// Pure diagnostic helper surfaced to the provider router via ctx so the router
// can log a normalized apiMode shape without importing config internals.
function summarizeApiMode(apiMode) {
  if (!apiMode || typeof apiMode !== 'object') return null
  return {
    groupName: typeof apiMode.groupName === 'string' ? apiMode.groupName : '',
    itemName: typeof apiMode.itemName === 'string' ? apiMode.itemName : '',
    isCustom: apiMode.isCustom === true,
    customName: typeof apiMode.customName === 'string' ? apiMode.customName : '',
    displayName: typeof apiMode.displayName === 'string' ? apiMode.displayName : '',
  }
}

// Shared context injected into provider.run() calls. After the step-3 split
// this contains ONLY diagnostics + token fetchers + setUserConfig — the
// proxy-tab and session-lock functions are now imported directly by the
// chatgpt-web provider, so `ctx.acquire*` / `ctx.sendChatgptProxyRequest` no
// longer exist (grep for ctx.acquire returns nothing).
const providerCtx = {
  appendChatgptWebDebugLog,
  summarizeApiMode,
  setUserConfig,
  getBingAccessToken,
  getBardCookies,
  getClaudeSessionKey,
}

async function executeApi(session, port, config) {
  await executeApiFromRegistry(session, port, config, providerCtx)
}

// chatgpt-proxy-service drives executeApi for the conversation create/send
// flows; register the reference once at startup to break the import cycle.
registerExecuteApi(executeApi)

// --- conversation sync alarm lifecycle ------------------------------------

async function ensureChatgptWebConversationSyncAlarm() {
  if (!Browser.alarms?.create) return
  const config = await getUserConfig().catch(() => defaultConfig)
  const periodInMinutes = Math.max(
    5,
    Number(config?.chatgptWebConversationSyncIntervalMinutes) ||
      DEFAULT_CHATGPT_WEB_CONVERSATION_SYNC_INTERVAL_MINUTES,
  )
  await Browser.alarms.create(CHATGPT_WEB_CONVERSATION_SYNC_ALARM, {
    periodInMinutes,
    delayInMinutes: 1,
  })
}

Browser.runtime.onInstalled.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
  void syncChatgptWebConversationCacheWithFallback().catch(() => {})
})

Browser.runtime.onStartup?.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
})

Browser.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== CHATGPT_WEB_CONVERSATION_SYNC_ALARM) return
  void syncChatgptWebConversationCacheWithFallback({ force: true }).catch(() => {})
})

Browser.storage?.local?.onChanged?.addListener((changes) => {
  if (!changes || !changes.chatgptWebConversationSyncIntervalMinutes) return
  void ensureChatgptWebConversationSyncAlarm()
})

void ensureChatgptWebConversationSyncAlarm()

// --- message router -------------------------------------------------------

Browser.runtime.onMessage.addListener(createMessageRouter())

// --- onConnect: proxy response + API bridge -------------------------------

Browser.runtime.onConnect.addListener((port) => {
  if (handleProxyResponsePort(port)) return
  if (handleApiBridgeProxyPort(port)) return
})

// --- sidePanel per-tab options -------------------------------------------

try {
  // eslint-disable-next-line no-undef
  if (typeof chrome !== 'undefined' && chrome.sidePanel) {
    Browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
      if (!tab?.url) return
      try {
        // eslint-disable-next-line no-undef
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'IndependentPanel.html',
          enabled: true,
        })
      } catch {
        // sidePanel not supported for this tab type
      }
    })
  }
} catch (error) {
  console.log(error)
}

// --- startup --------------------------------------------------------------

// Wire the port-based chat execution path (content scripts open a port and
// stream the conversation through registerPortListener's executor).
registerPortListener(async (session, port, config) => await executeApi(session, port, config))
registerWebRequestRules()
registerCommands()
refreshMenu()
