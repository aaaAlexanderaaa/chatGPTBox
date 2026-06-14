import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { isUsingChatgptWebModel } from '../../config/predicates.mjs'
import { defaultConfig } from '../../config/storage.mjs'
import { getModelValue } from '../../utils/model-name-convert.mjs'
import { isDedicatedChatgptProxyTabUrl } from '../../utils/chatgpt-proxy-tab.mjs'

// The most involved provider: ChatGPT-Web requests are routed through a
// dedicated background chatgpt.com proxy tab, and concurrent requests for the
// same session are serialized via a session lock. The proxy-tab discovery,
// lock acquisition, and debug logging helpers are background-scoped and
// injected via `ctx` to avoid importing background internals directly.
export default {
  route: 'chatgpt-web',
  match: (session) => isUsingChatgptWebModel(session),
  async run({ session, port, config, ctx }) {
    const releaseChatgptWebSessionLock = ctx.acquireChatgptWebSessionLock(session, port, config)
    if (releaseChatgptWebSessionLock === null) return
    try {
      // Agent context is disabled for ChatGPT Web requests; keep user selections intact
      // and only drop page snapshot payload for this request path.
      session.pageContext = null
      void ctx.appendChatgptWebDebugLog(config, 'agent-context-disabled-web', {
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
          await ctx.setUserConfig({ chatgptTabId: 0 })
        }
      }

      if (!tabId) {
        const ensured = await ctx.ensureChatgptProxyTab()
        if (ensured?.id) {
          tabId = ensured.id
          proxyTab = ensured
        }
      }

      if (tabId) {
        void ctx.appendChatgptWebDebugLog(config, 'chatgpt-web-proxy-forced', {
          tabId,
          tabUrl: proxyTab?.url || null,
          route: 'chatgpt-web',
          model: session.chatgptWebModelSlugOverride || getModelValue(session) || null,
          selectedModel: getModelValue(session) || null,
          endpointUrl: config.customChatGptWebApiUrl || defaultConfig.customChatGptWebApiUrl,
        })
        await ctx.sendChatgptProxyRequest(tabId, session, port)
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
