// Message router.
//
// The single runtime.onMessage dispatcher, split out of background/index.mjs
// (step 3 of the architecture plan). Each case delegates to a focused service
// module. The router itself contains no business logic beyond argument
// unpacking and dispatch — keeping the background entry point thin.
//
// Cases that need the sender (tab id / extension-page trust) pass it through;
// the rest read only `message.data`.

import Browser from 'webextension-polyfill'
import { deleteConversation, sendMessageFeedback } from '../services/apis/chatgpt-web'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import { openUrl } from '../utils/open-url'
import { getChatGptAccessToken } from '../services/wrappers.mjs'
import { refreshMenu } from './menus.mjs'
import { isDedicatedChatgptProxyTabUrl } from '../utils/chatgpt-proxy-tab.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'
import {
  refreshChatgptWebConversationWithFallback,
  sendChatgptWebConversationMessageThroughProxy,
  createChatgptWebConversation,
  syncChatgptWebConversationCacheWithFallback,
  stopChatgptWebConversationCacheSyncWithFallback,
  unlockChatgptWebConversationSyncWithFallback,
  listChatgptWebConversationsWithFallback,
  listChatgptWebModelsWithFallback,
  getChatgptWebConversationWithFallback,
} from './chatgpt-proxy-service.mjs'
import { handleFetchMessage } from './fetch-proxy-service.mjs'
import { sidePanelPaths, whitelistSidePanelPath } from './sidepanel-path.mjs'

// Build the case-handler table. Returned as a function so the background
// entry registers it as a single onMessage listener.
//
// The wrapper MUST return undefined (not a promise resolving undefined) for
// messages it does not handle: webextension-polyfill lets every
// thenable-returning listener race for sendResponse, so an always-async
// wrapper here would shadow module-background responders (e.g. the dsh
// settings-card diagnose) with an instant undefined. Membership comes from
// this table, so it cannot drift from the handlers.
export function createMessageRouter() {
  const routedHandlers = {
    [RuntimeMessage.Feedback]: async (message) => {
      const token = await getChatGptAccessToken()
      await sendMessageFeedback(token, message.data)
    },
    [RuntimeMessage.DeleteConversation]: async (message) => {
      const token = await getChatGptAccessToken()
      await deleteConversation(token, message.data.conversationId)
    },
    [RuntimeMessage.NewUrl]: async (message, sender) => {
      await Browser.tabs.create({
        url: message.data.url,
        pinned: message.data.pinned,
      })
      if (message.data.jumpBack) {
        await setUserConfig({
          notificationJumpBackTabId: sender.tab.id,
        })
      }
    },
    [RuntimeMessage.SetChatgptTab]: async (message, sender) => {
      if (!isDedicatedChatgptProxyTabUrl(sender?.tab?.url)) return
      await setUserConfig({
        chatgptTabId: sender.tab.id,
      })
    },
    [RuntimeMessage.ActivateUrl]: async (message) => {
      await Browser.tabs.update(message.data.tabId, { active: true })
    },
    [RuntimeMessage.OpenUrl]: async (message) => {
      openUrl(message.data.url)
    },
    [RuntimeMessage.OpenChatWindow]: async () => {
      const config = await getUserConfig()
      const url = Browser.runtime.getURL('IndependentPanel.html')
      const tabs = await Browser.tabs.query({ url: url, windowType: 'popup' })
      if (!config.alwaysCreateNewConversationWindow && tabs.length > 0)
        await Browser.windows.update(tabs[0].windowId, { focused: true })
      else
        await Browser.windows.create({
          url: url,
          type: 'popup',
          width: 500,
          height: 650,
        })
    },
    [RuntimeMessage.OpenApiServer]: async () => {
      const apiUrl = Browser.runtime.getURL('ApiServer.html')
      const existing = await Browser.tabs.query({ url: apiUrl })
      if (existing.length > 0) {
        await Browser.tabs.update(existing[0].id, { active: true })
      } else {
        await Browser.tabs.create({ url: apiUrl })
      }
    },
    [RuntimeMessage.ApiBridgeDiagnose]: async () => {
      const diagConfig = await getUserConfig()
      let chatgptTabOk = false
      if (diagConfig.chatgptTabId) {
        const tab = await Browser.tabs.get(diagConfig.chatgptTabId).catch(() => null)
        chatgptTabOk = !!(tab && isDedicatedChatgptProxyTabUrl(tab.url))
      }
      let canFetchChatgpt = false
      try {
        const r = await fetch('https://chatgpt.com/api/auth/session', { method: 'HEAD' })
        canFetchChatgpt = r.status !== 0
      } catch {
        canFetchChatgpt = false
      }
      return {
        chatgptTabOk,
        canFetchChatgpt,
        hasAccessToken: !!diagConfig.accessToken,
      }
    },
    [RuntimeMessage.OpenSidePanel]: async (message, sender) => {
      // eslint-disable-next-line no-undef
      if (typeof chrome !== 'undefined' && chrome.sidePanel) {
        // Extension pages (e.g. the dsh cockpit) have no sender.tab — fall
        // back to the tab the user is currently looking at.
        let tabId = message?.data?.tabId || sender?.tab?.id
        let windowId = message?.data?.windowId || sender?.tab?.windowId
        if (!tabId) {
          const [activeTab] = await Browser.tabs.query({ active: true, currentWindow: true })
          tabId = activeTab?.id
          windowId = windowId || activeTab?.windowId
        }
        const requestedPath = message?.data?.path
        // Surfaces may ask for a specific panel page (e.g. the dsh cockpit
        // narrow layout); whitelist extension pages so this can never be
        // pointed outside the extension.
        const path = whitelistSidePanelPath(requestedPath)
        if (tabId) sidePanelPaths.remember(tabId, path)
        if (tabId && windowId) {
          try {
            // eslint-disable-next-line no-undef
            await chrome.sidePanel.setOptions({
              tabId,
              path,
              enabled: true,
            })
            // eslint-disable-next-line no-undef
            await chrome.sidePanel.open({ windowId, tabId })
          } catch (error) {
            console.debug('Failed to open side panel:', error)
          }
        }
      }
    },
    [RuntimeMessage.RefreshMenu]: async () => {
      refreshMenu()
    },
    [RuntimeMessage.PinTab]: async (message, sender) => {
      let tabId
      if (message.data.tabId) tabId = message.data.tabId
      else tabId = sender.tab.id

      await Browser.tabs.update(tabId, { pinned: true })
      if (message.data.saveAsChatgptConfig) {
        await setUserConfig({ chatgptTabId: tabId })
      }
    },
    [RuntimeMessage.Fetch]: (message, sender) => handleFetchMessage(message, sender),
    [RuntimeMessage.ChatgptWebListConversations]: (message) =>
      listChatgptWebConversationsWithFallback(message.data || {}),
    [RuntimeMessage.ChatgptWebGetConversation]: (message) =>
      getChatgptWebConversationWithFallback(message.data || {}),
    [RuntimeMessage.ChatgptWebRefreshConversation]: (message) =>
      refreshChatgptWebConversationWithFallback(message.data || {}),
    [RuntimeMessage.ChatgptWebSendConversationMessage]: (message) =>
      sendChatgptWebConversationMessageThroughProxy(message.data || {}),
    [RuntimeMessage.ChatgptWebCreateConversation]: (message) =>
      createChatgptWebConversation(message.data || {}),
    [RuntimeMessage.ChatgptWebSyncConversations]: (message) =>
      syncChatgptWebConversationCacheWithFallback({
        includeArchived: message?.data?.includeArchived === true,
        mode: message?.data?.mode === 'incremental' ? 'incremental' : 'full',
        automatic: message?.data?.automatic === true,
        reason: message?.data?.reason || 'manual',
        resume: message?.data?.resume === true,
      }),
    [RuntimeMessage.ChatgptWebStopConversationSync]: () =>
      stopChatgptWebConversationCacheSyncWithFallback(),
    [RuntimeMessage.ChatgptWebUnlockConversationSync]: () =>
      unlockChatgptWebConversationSyncWithFallback(),
    [RuntimeMessage.ChatgptWebListModels]: async () => {
      const models = await listChatgptWebModelsWithFallback()
      if (Array.isArray(models) && models.length > 0) {
        // Keep the settings-side account filter (D-15) in sync with
        // whatever the catalog just said.
        await setUserConfig({ chatgptWebAccountModels: models }).catch(() => {})
      }
      return models
    },
  }

  return (message, sender) => {
    const handler = routedHandlers[message?.type]
    if (!handler) return undefined
    return handler(message, sender)
  }
}
