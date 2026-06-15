import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { isUsingChatgptWebModel } from '../../config/predicates.mjs'
import { defaultConfig, setUserConfig } from '../../config/storage.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { isDedicatedChatgptProxyTabUrl } from '../../utils/chatgpt-proxy-tab.mjs'
import {
  acquireChatgptWebSessionLock,
  appendChatgptWebDebugLog,
  ensureChatgptProxyTab,
  sendChatgptProxyRequest,
} from '../chatgpt-proxy-service.mjs'

// The most involved provider: ChatGPT-Web requests are routed through a
// dedicated background chatgpt.com proxy tab, and concurrent requests for the
// same session are serialized via a session lock.
//
// The proxy-tab discovery, lock acquisition, and debug logging helpers used to
// be injected via a reverse `ctx` callback into the background entry point,
// which prevented the background from being split. They are now imported
// directly from chatgpt-proxy-service (a forward dependency), so this provider
// no longer reaches back into background internals.
export default {
  route: 'chatgpt-web',
  match: (session) => isUsingChatgptWebModel(session),
  async run({ session, port, config }) {
    const releaseChatgptWebSessionLock = acquireChatgptWebSessionLock(session, port, config)
    if (releaseChatgptWebSessionLock === null) return
    try {
      // Agent context is disabled for ChatGPT Web requests; keep user selections intact
      // and only drop page snapshot payload for this request path.
      session.pageContext = null
      void appendChatgptWebDebugLog(config, 'agent-context-disabled-web', {
        reason: 'chatgpt_web_model',
      })

      let tabId
      let proxyTab
      if (config.chatgptTabId) {
        const tab = await Browser.tabs.get(config.chatgptTabId).catch(() => {})
        if (tab && isDedicatedChatgptProxyTabUrl(tab.url)) {
          tabId = tab.id
          proxyTab = tab
        } else {
          await setUserConfig({ chatgptTabId: 0 })
        }
      }

      if (!tabId) {
        const ensured = await ensureChatgptProxyTab()
        if (ensured?.id) {
          tabId = ensured.id
          proxyTab = ensured
        }
      }

      if (tabId) {
        void appendChatgptWebDebugLog(config, 'chatgpt-web-proxy-forced', {
          tabId,
          tabUrl: proxyTab?.url || null,
          route: 'chatgpt-web',
          model: session.chatgptWebModelSlugOverride || getModelValue(session) || null,
          selectedModel: getModelValue(session) || null,
          endpointUrl: config.customChatGptWebApiUrl || defaultConfig.customChatGptWebApiUrl,
        })
        await sendChatgptProxyRequest(tabId, session, port)
        return
      }

      throw new Error(
        t('Please login at https://chatgpt.com first') +
          '\n\n' +
          t(
            'ChatGPT Web requests in this extension are sent through a dedicated background chatgpt.com proxy tab so they work reliably in Brave and similar browsers.',
          ),
      )
    } finally {
      releaseChatgptWebSessionLock()
    }
  },
}

