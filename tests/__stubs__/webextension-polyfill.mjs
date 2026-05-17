// Minimal stub for tests. The real polyfill aborts when loaded outside a
// browser extension; tests don't exercise extension APIs, just need the module
// to resolve.
const noop = () => undefined
const noopAsync = async () => undefined

const Browser = {
  runtime: {
    id: 'test-extension-id',
    getURL: (path) => `chrome-extension://test-extension-id${path || ''}`,
    sendMessage: noopAsync,
    connect: noop,
    onMessage: { addListener: noop, removeListener: noop },
    onConnect: { addListener: noop, removeListener: noop },
    onInstalled: { addListener: noop },
    onStartup: { addListener: noop },
  },
  storage: {
    local: {
      get: noopAsync,
      set: noopAsync,
      remove: noopAsync,
    },
    session: { get: noopAsync, set: noopAsync, remove: noopAsync },
  },
  tabs: { get: noopAsync, query: noopAsync, update: noopAsync, sendMessage: noopAsync },
  cookies: { get: noopAsync, getAll: noopAsync },
  alarms: { create: noop, clear: noopAsync, onAlarm: { addListener: noop } },
  contextMenus: { create: noop, removeAll: noopAsync, onClicked: { addListener: noop } },
  i18n: { getMessage: (k) => k, getUILanguage: () => 'en' },
  scripting: { executeScript: noopAsync },
  webRequest: {
    onBeforeRequest: { addListener: noop },
    onBeforeSendHeaders: { addListener: noop },
  },
  declarativeNetRequest: {
    getDynamicRules: noopAsync,
    updateDynamicRules: noopAsync,
  },
}

export default Browser
