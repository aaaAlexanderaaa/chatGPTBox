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
import { defaultConfig, getUserConfig, setAccessToken, setUserConfig } from '../config/storage.mjs'
import { isUsingChatgptWebModel } from '../config/predicates.mjs'
import { chatgptWebModelKeys } from '../config/models.mjs'
import { pickDefaultChatgptWebKey } from '../config/account-models.mjs'
import { refreshChatGptWebModelList } from '../services/model-lists.mjs'
import '../_locales/i18n'
import { registerPortListener } from '../services/wrappers.mjs'
import { refreshMenu } from './menus.mjs'
import { registerCommands } from './commands.mjs'
import { executeApi as executeApiFromRegistry } from './providers/registry.mjs'
import { appendChatgptWebDebugLog } from './chatgpt-proxy-service.mjs'
import {
  registerExecuteApi,
  hasActiveChatgptWebSessionRequests,
  syncChatgptWebConversationCacheWithFallback,
  stopChatgptWebConversationCacheSyncWithFallback,
  handleProxyResponsePort,
} from './chatgpt-proxy-service.mjs'
import { handleGrokProxyResponsePort } from './grok-proxy-service.mjs'
import { registerGrokProbe } from './grok-probe-service.mjs'
import { getChatgptWebConversationMeta } from '../services/clients/chatgpt-web/conversation-cache.mjs'
import {
  CHATGPT_WEB_HISTORY_SYNC_ALARM,
  getChatgptWebHistoryAutoSyncIntervalHours,
  isChatgptWebHistoryAutoSyncAllowed,
  resolveChatgptWebHistorySyncAlarmAction,
} from '../services/clients/chatgpt-web/conversation-sync-policy.mjs'
import { handleApiBridgeProxyPort } from './api-bridge-proxy-service.mjs'
import { registerWebRequestRules } from './webrequest-rules.mjs'
import { startModuleBackgrounds } from '../modules/background-services.mjs'
import { applyActionBadge, setRateLimitedFlag } from './action-badge.mjs'
import { sidePanelPaths } from './sidepanel-path.mjs'
import { createMessageRouter } from './message-router.mjs'

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
}

async function executeApi(session, port, config) {
  await executeApiFromRegistry(session, port, config, providerCtx)
}

// chatgpt-proxy-service drives executeApi for the conversation create/send
// flows; register the reference once at startup to break the import cycle.
registerExecuteApi(executeApi)

// --- chatgpt-web first-run detection (roadmap D / D-15) --------------------
//
// A fresh install with zero API keys must still reach a first answer inside
// 60s. When the default engine is ChatGPT Web, the worker silently checks
// whether the browser already holds a chatgpt.com session (host permissions
// let the fetch carry cookies); if so the token is saved and the account's
// real model list is fetched BEFORE any default is fixed, so a free account
// never starts pinned to a tier it cannot use. Not logged in → nothing
// happens here; the existing jump-back flow keeps handling login.

async function ensureChatgptWebFirstRun() {
  try {
    const config = await getUserConfig()
    if (!isUsingChatgptWebModel(config) && !config.accessToken) return

    let accessToken = config.accessToken
    if (!accessToken) {
      const resp = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' })
      const data = await resp.json().catch(() => ({}))
      if (!data?.accessToken) return
      await setAccessToken(data.accessToken)
      accessToken = data.accessToken
    }

    const models = await refreshChatGptWebModelList({ accessToken })
    await setUserConfig({ chatgptWebAccountModels: models })

    // Fix the default only while the selection is still an untouched web
    // preset — a user's explicit choice is never second-guessed.
    if (!config.apiMode && chatgptWebModelKeys.includes(config.modelName)) {
      const preferred = pickDefaultChatgptWebKey({
        currentKey: config.modelName,
        availableSlugs: models,
      })
      if (preferred && preferred !== config.modelName) {
        await setUserConfig({ modelName: preferred })
      }
    }
  } catch (error) {
    // Best-effort by design: offline, logged out, or upstream changes just
    // leave the defaults (and the runtime client's own fallbacks) in charge.
    console.debug('chatgpt-web first-run detection skipped:', error?.message || error)
  }
}

// --- conversation sync alarm lifecycle ------------------------------------

async function ensureChatgptWebConversationSyncAlarm({ replaceExisting = false } = {}) {
  if (!Browser.alarms?.create || !Browser.alarms?.clear) return
  const [config, meta] = await Promise.all([
    getUserConfig().catch(() => defaultConfig),
    getChatgptWebConversationMeta().catch(() => ({})),
  ])
  const badgeApi = Browser.action || Browser.browserAction
  applyActionBadge(
    badgeApi,
    setRateLimitedFlag(meta?.safetyLock?.reason === 'rate_limited'),
  )
  const existingAlarm =
    (await Browser.alarms.get?.(CHATGPT_WEB_HISTORY_SYNC_ALARM).catch(() => null)) || null
  const decision = resolveChatgptWebHistorySyncAlarmAction({
    allowed: isChatgptWebHistoryAutoSyncAllowed(config, meta),
    intervalHours: getChatgptWebHistoryAutoSyncIntervalHours(config, meta),
    existingAlarm,
    replaceExisting,
  })
  if (decision.action === 'keep') return
  await Browser.alarms.clear(CHATGPT_WEB_HISTORY_SYNC_ALARM)
  if (decision.action !== 'create') return
  await Browser.alarms.create(CHATGPT_WEB_HISTORY_SYNC_ALARM, {
    delayInMinutes: decision.delayInMinutes,
  })
}

Browser.runtime.onInstalled.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
  void ensureChatgptWebFirstRun()
})

Browser.runtime.onStartup?.addListener(() => {
  void ensureChatgptWebConversationSyncAlarm()
  void ensureChatgptWebFirstRun()
})

Browser.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== CHATGPT_WEB_HISTORY_SYNC_ALARM) return
  void (async () => {
    const config = await getUserConfig().catch(() => defaultConfig)
    if (
      config.chatgptWebHistorySyncOnlyWhenIdle !== false &&
      hasActiveChatgptWebSessionRequests()
    ) {
      await Browser.alarms.create(CHATGPT_WEB_HISTORY_SYNC_ALARM, { delayInMinutes: 30 })
      return
    }
    await syncChatgptWebConversationCacheWithFallback({
      mode: 'incremental',
      automatic: true,
      reason: 'scheduled',
    }).catch(() => {})
    await ensureChatgptWebConversationSyncAlarm({ replaceExisting: true })
  })()
})

const storageChanges = Browser.storage?.onChanged || Browser.storage?.local?.onChanged
storageChanges?.addListener((changes) => {
  if (!changes) return
  const schedulingKeys = [
    'chatgptWebHistorySyncEnabled',
    'chatgptWebHistoryAutoSyncMode',
    'chatgptWebHistorySyncIntervalHours',
  ]
  const safetyLockChanged =
    'chatgptWebConversationMeta' in changes &&
    changes.chatgptWebConversationMeta?.oldValue?.safetyLock?.reason !==
      changes.chatgptWebConversationMeta?.newValue?.safetyLock?.reason
  if (!schedulingKeys.some((key) => key in changes) && !safetyLockChanged) return
  if (changes.chatgptWebHistorySyncEnabled?.newValue !== false) {
    void ensureChatgptWebConversationSyncAlarm({ replaceExisting: true })
    return
  }
  void stopChatgptWebConversationCacheSyncWithFallback()
  void Browser.alarms?.clear?.(CHATGPT_WEB_HISTORY_SYNC_ALARM)
})

void ensureChatgptWebConversationSyncAlarm()

// --- message router -------------------------------------------------------

Browser.runtime.onMessage.addListener(createMessageRouter())

// --- onConnect: proxy response + API bridge -------------------------------

Browser.runtime.onConnect.addListener((port) => {
  if (handleProxyResponsePort(port)) return
  if (handleGrokProxyResponsePort(port)) return
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
          path: sidePanelPaths.pathFor(tabId),
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

// --- Grok Web login probe (GET-only; never opens a tab) -------------------

async function fetchGrokProbeOnTab(tabId) {
  // Page-context GETs so cookies travel with the existing grok.com document.
  // No new protocol types; no tabs.create.
  const results = await Browser.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const getJson = async (url) => {
        try {
          const resp = await fetch(url, { credentials: 'include', method: 'GET' })
          if (!resp.ok) return null
          return await resp.json().catch(() => null)
        } catch {
          return null
        }
      }
      return {
        sessionJson: await getJson('https://grok.com/api/auth/session'),
        rateLimitJson: await getJson('https://grok.com/rest/rate-limits'),
      }
    },
  })
  return results?.[0]?.result ?? { sessionJson: null, rateLimitJson: null }
}

registerGrokProbe({
  cookiesApi: Browser.cookies,
  tabsApi: Browser.tabs,
  fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  fetchOnTab: fetchGrokProbeOnTab,
  setUserConfig,
  getUserConfig,
})

// --- startup --------------------------------------------------------------

// Wire the port-based chat execution path (content scripts open a port and
// stream the conversation through registerPortListener's executor).
registerPortListener(async (session, port, config) => await executeApi(session, port, config))
registerWebRequestRules()
void startModuleBackgrounds()
registerCommands()
refreshMenu()

Browser.tabs?.onRemoved?.addListener((tabId) => {
  sidePanelPaths.forget(tabId)
})
