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

// Build the case-handler table. Returned as a function so the background
// entry registers it as a single onMessage listener.
export function createMessageRouter() {
  async function route(message, sender) {
    switch (message.type) {
      case RuntimeMessage.Feedback: {
        const token = await getChatGptAccessToken()
        await sendMessageFeedback(token, message.data)
        return
      }
      case RuntimeMessage.DeleteConversation: {
        const token = await getChatGptAccessToken()
        await deleteConversation(token, message.data.conversationId)
        return
      }
      case RuntimeMessage.NewUrl: {
        await Browser.tabs.create({
          url: message.data.url,
          pinned: message.data.pinned,
        })
        if (message.data.jumpBack) {
          await setUserConfig({
            notificationJumpBackTabId: sender.tab.id,
          })
        }
        return
      }
      case RuntimeMessage.SetChatgptTab: {
        if (!isDedicatedChatgptProxyTabUrl(sender?.tab?.url)) return
        await setUserConfig({
          chatgptTabId: sender.tab.id,
        })
        return
      }
      case RuntimeMessage.ActivateUrl:
        await Browser.tabs.update(message.data.tabId, { active: true })
        return
      case RuntimeMessage.OpenUrl:
        openUrl(message.data.url)
        return
      case RuntimeMessage.OpenChatWindow: {
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
        return
      }
      case RuntimeMessage.OpenApiServer: {
        const apiUrl = Browser.runtime.getURL('ApiServer.html')
        const existing = await Browser.tabs.query({ url: apiUrl })
        if (existing.length > 0) {
          await Browser.tabs.update(existing[0].id, { active: true })
        } else {
          await Browser.tabs.create({ url: apiUrl })
        }
        return
      }
      case RuntimeMessage.ApiBridgeDiagnose: {
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
      }
      case RuntimeMessage.OpenSidePanel: {
        // eslint-disable-next-line no-undef
        if (typeof chrome !== 'undefined' && chrome.sidePanel) {
          const tabId = message?.data?.tabId || sender?.tab?.id
          const windowId = message?.data?.windowId || sender?.tab?.windowId
          if (tabId && windowId) {
            try {
              // eslint-disable-next-line no-undef
              await chrome.sidePanel.setOptions({
                tabId,
                path: 'IndependentPanel.html',
                enabled: true,
              })
              // eslint-disable-next-line no-undef
              await chrome.sidePanel.open({ windowId, tabId })
            } catch (error) {
              console.debug('Failed to open side panel:', error)
            }
          }
        }
        return
      }
      case RuntimeMessage.RefreshMenu:
        refreshMenu()
        return
      case RuntimeMessage.PinTab: {
        let tabId
        if (message.data.tabId) tabId = message.data.tabId
        else tabId = sender.tab.id

        await Browser.tabs.update(tabId, { pinned: true })
        if (message.data.saveAsChatgptConfig) {
          await setUserConfig({ chatgptTabId: tabId })
        }
        return
      }
      case RuntimeMessage.Fetch: {
        return handleFetchMessage(message, sender)
      }
      case RuntimeMessage.ChatgptWebListConversations:
        return await listChatgptWebConversationsWithFallback(message.data || {})
      case RuntimeMessage.ChatgptWebGetConversation:
        return await getChatgptWebConversationWithFallback(message.data || {})
      case RuntimeMessage.ChatgptWebRefreshConversation:
        return await refreshChatgptWebConversationWithFallback(message.data || {})
      case RuntimeMessage.ChatgptWebSendConversationMessage:
        return await sendChatgptWebConversationMessageThroughProxy(message.data || {})
      case RuntimeMessage.ChatgptWebCreateConversation:
        return await createChatgptWebConversation(message.data || {})
      case RuntimeMessage.ChatgptWebSyncConversations:
        return await syncChatgptWebConversationCacheWithFallback({
          includeArchived: message?.data?.includeArchived === true,
          mode: message?.data?.mode === 'incremental' ? 'incremental' : 'full',
          automatic: message?.data?.automatic === true,
          reason: message?.data?.reason || 'manual',
          resume: message?.data?.resume === true,
        })
      case RuntimeMessage.ChatgptWebStopConversationSync:
        return await stopChatgptWebConversationCacheSyncWithFallback()
      case RuntimeMessage.ChatgptWebUnlockConversationSync:
        return await unlockChatgptWebConversationSyncWithFallback()
      case RuntimeMessage.ChatgptWebListModels:
        return await listChatgptWebModelsWithFallback()
      default:
        return
    }
  }

  return async (message, sender) => route(message, sender)
}
