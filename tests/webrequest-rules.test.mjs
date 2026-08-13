import { beforeEach, describe, expect, it, vi } from 'vitest'

const beforeRequestListeners = []
const beforeSendHeadersListeners = []
const setUserConfig = vi.fn(async () => {})

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path) => `chrome-extension://test-extension-id${path || ''}`,
      getManifest: () => ({ manifest_version: 3 }),
    },
    webRequest: {
      onBeforeRequest: {
        addListener: (listener) => beforeRequestListeners.push(listener),
      },
      onBeforeSendHeaders: {
        addListener: (listener, filter, extraInfoSpec) =>
          beforeSendHeadersListeners.push({ listener, filter, extraInfoSpec }),
      },
    },
    declarativeNetRequest: {
      updateDynamicRules: vi.fn(async () => {}),
    },
  },
}))

const getUserConfig = vi.fn(async () => ({ chatgptAccountId: '' }))

vi.mock('../src/config/storage.mjs', () => ({
  defaultConfig: { chatgptArkoseReqParams: 'cgb=vhwi' },
  setUserConfig,
  getUserConfig,
}))

const { isChatgptWebAccountScopedRequest, registerWebRequestRules } = await import(
  '../src/background/webrequest-rules.mjs'
)

const CHATGPT_PAGE = 'https://chatgpt.com'
const TEAM_CONVERSATION_URL = 'https://chatgpt.com/backend-api/f/conversation'
const TEAM_CONVERSATION_GET_URL = 'https://chatgpt.com/backend-api/conversation/conv-1'
const TEAM_LIST_URL = 'https://chatgpt.com/backend-api/conversations?offset=0&limit=28'
const MODELS_URL = 'https://chatgpt.com/backend-api/models'
const SENTINEL_URL = 'https://chatgpt.com/backend-api/sentinel/chat-requirements'
const ACCOUNTS_URL = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27'

function accountObserver() {
  return beforeSendHeadersListeners.find(({ filter }) =>
    filter.urls.includes('https://*.chatgpt.com/backend-api/*'),
  )
}

function emitPageRequest(observer, { url, accountId, headers } = {}) {
  observer.listener({
    initiator: CHATGPT_PAGE,
    url,
    requestHeaders:
      headers || (accountId ? [{ name: 'ChatGPT-Account-ID', value: accountId }] : []),
  })
}

describe('ChatGPT account-scoped request matching', () => {
  it('treats conversation list, detail, and stream endpoints as workspace-scoped', () => {
    expect(isChatgptWebAccountScopedRequest(TEAM_CONVERSATION_URL)).toBe(true)
    expect(isChatgptWebAccountScopedRequest(TEAM_CONVERSATION_GET_URL)).toBe(true)
    expect(isChatgptWebAccountScopedRequest(TEAM_LIST_URL)).toBe(true)
    expect(
      isChatgptWebAccountScopedRequest('https://chatgpt.com/backend-api/f/conversation/resume'),
    ).toBe(true)
  })

  it('ignores models, sentinel, and other unscoped backend-api calls', () => {
    expect(isChatgptWebAccountScopedRequest(MODELS_URL)).toBe(false)
    expect(isChatgptWebAccountScopedRequest(SENTINEL_URL)).toBe(false)
    expect(isChatgptWebAccountScopedRequest(ACCOUNTS_URL)).toBe(false)
    expect(
      isChatgptWebAccountScopedRequest('https://chatgpt.com/backend-api/conversation_limit'),
    ).toBe(false)
  })
})

describe('ChatGPT account header observation', () => {
  beforeEach(() => {
    beforeRequestListeners.length = 0
    beforeSendHeadersListeners.length = 0
    setUserConfig.mockClear()
  })

  it('persists the Team/Enterprise account selected by a chatgpt.com conversation request', async () => {
    registerWebRequestRules()
    const observer = accountObserver()
    expect(observer).toBeTruthy()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_URL, accountId: ' account-team ' })
    await Promise.resolve()

    expect(setUserConfig).toHaveBeenCalledWith({ chatgptAccountId: 'account-team' })
  })

  it('keeps the Team account id when unscoped backend requests omit the header', async () => {
    registerWebRequestRules()
    const observer = accountObserver()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_URL, accountId: 'account-team' })
    await Promise.resolve()
    setUserConfig.mockClear()

    emitPageRequest(observer, { url: MODELS_URL })
    emitPageRequest(observer, { url: SENTINEL_URL })
    emitPageRequest(observer, { url: ACCOUNTS_URL })
    await Promise.resolve()

    expect(setUserConfig).not.toHaveBeenCalled()
  })

  it('updates immediately when chatgpt.com switches to another Team workspace', async () => {
    registerWebRequestRules()
    const observer = accountObserver()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_URL, accountId: 'account-team-a' })
    await Promise.resolve()
    setUserConfig.mockClear()

    emitPageRequest(observer, { url: TEAM_LIST_URL, accountId: 'account-team-b' })
    await Promise.resolve()

    expect(setUserConfig).toHaveBeenCalledWith({ chatgptAccountId: 'account-team-b' })
  })

  it('clears the Team account id only after a workspace-scoped page request omits the header', async () => {
    registerWebRequestRules()
    const observer = accountObserver()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_URL, accountId: 'account-team' })
    await Promise.resolve()
    setUserConfig.mockClear()

    emitPageRequest(observer, { url: MODELS_URL })
    await Promise.resolve()
    expect(setUserConfig).not.toHaveBeenCalled()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_GET_URL })
    await Promise.resolve()

    expect(setUserConfig).toHaveBeenCalledWith({ chatgptAccountId: '' })
  })

  it('does not clear the observed account from extension-initiated requests', async () => {
    registerWebRequestRules()
    const observer = accountObserver()

    emitPageRequest(observer, { url: TEAM_CONVERSATION_URL, accountId: 'account-team' })
    await Promise.resolve()
    setUserConfig.mockClear()

    observer.listener({
      initiator: 'chrome-extension://test-extension-id',
      url: TEAM_CONVERSATION_URL,
      requestHeaders: [],
    })
    await Promise.resolve()

    expect(setUserConfig).not.toHaveBeenCalled()
  })
})
