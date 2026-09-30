import { afterEach, describe, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { getChatgptWebPageIntegrityForSender } from '../src/background/chatgpt-page-integrity.mjs'
import { inspectChatgptWebRuntimeInPage } from '../src/services/clients/chatgpt-web/runtime-inspection.mjs'
import {
  hasCompatibleChatgptWebNativeFetch,
  resolveChatgptWebRuntimeCapabilities,
} from '../src/services/clients/chatgpt-web/runtime-capabilities.mjs'

// Public-code shapes with synthetic names. These functions are inspected, never
// executed; no real auth, challenge implementation, or account data is included.
const native = `async function network(url, options, transform, assertCurrent) {
  const headers = { ...options.headers };
  checkIdentity(headers, options.expectedIdentity);
  assertCurrent?.();
  const input = { method: options.method, headers, body: options.body, signal: options.signal };
  const response = await fetch(url, input);
  const noRetry = 'never' === options.retry || options.method === 'POST';
  if (response.status !== 401 || noRetry) return response;
  const retry = await fetch(url, input);
  return retry;
}`
const prepare = `async function prepare(callback) {
  const chatRequirements = await callback('synthetic');
  return { chatRequirements, proofToken: null, turnstileToken: null };
}`
const headers = `function headers(req, proof, turnstile) {
  const result = {};
  result[names.chatRequirementsToken] = req.token;
  result[names.proofToken] = proof;
  result[names.turnstileToken] = turnstile;
  return result;
}`
const fixture = (url = 'https://chatgpt.com/cdn/assets/999999.new-build.js') => ({
  url,
  graph: { request: ['wrapper'], wrapper: ['relocated'] },
  modules: [
    {
      id: 'request',
      source: 'codex_webview',
      requestMethods: { getRequestTarget: 'function target() {}', safePost: 'function post() {}' },
      functions: {},
    },
    {
      id: 'account',
      source: '',
      functions: Object.fromEntries(
        [
          'loadBrowserChatGptAuth',
          'getBrowserChatGptAuthSnapshot',
          'isSameBrowserRequestAuthContext',
        ].map((key) => [key, 'function account() {}']),
      ),
    },
    {
      id: 'verification',
      source: '',
      functions: { renamedPrepare: prepare, renamedHeaders: headers },
    },
    { id: 'relocated', source: '', functions: { renamedFetch: native } },
    {
      id: 'xb',
      source: '',
      functions: { c: 'async function announcement(scope) { return scope.markViewed(); }' },
    },
  ],
})

afterEach(() => vi.restoreAllMocks())

describe('ChatGPT capability discovery', () => {
  it('accepts an unknown file and relocated exports while rejecting the reused announcement name', () => {
    expect(resolveChatgptWebRuntimeCapabilities([fixture()])).toMatchObject({
      filename: '999999.new-build.js',
      requestModule: 'request',
      authModule: 'account',
      fetchModule: 'relocated',
      fetchExport: 'renamedFetch',
      integrityPrepareExport: 'renamedPrepare',
      integrityHeadersExport: 'renamedHeaders',
    })
  })
  it('accepts compatible optional parameters and changes after the no-retry return', () => {
    expect(
      hasCompatibleChatgptWebNativeFetch(
        native
          .replace('assertCurrent)', 'assertCurrent, mode = "request", rebuild = null)')
          .replace('const retry =', 'await rebuild?.(); const retry ='),
      ),
    ).toBe(true)
  })
  it.each([
    native.replace("'never' === options.retry", "'sometimes' === options.retry"),
    native.replace(' || noRetry', ' && noRetry'),
    native.replace('return response;', 'return response.json();'),
    native.replace('  assertCurrent?.();', ''),
    native.replace('options.expectedIdentity', 'options.otherIdentity'),
    native.replace(
      'if (response.status',
      'const extra = await fetch(url, input); if (response.status',
    ),
  ])('rejects changed no-retry, response or identity behavior', (source) => {
    expect(hasCompatibleChatgptWebNativeFetch(source)).toBe(false)
  })
  it('rejects an unrelated native-looking function and ambiguous complete runtimes', () => {
    const disconnected = fixture()
    disconnected.graph = {}
    expect(resolveChatgptWebRuntimeCapabilities([disconnected])).toBeNull()
    expect(
      resolveChatgptWebRuntimeCapabilities([
        fixture(),
        fixture('https://chatgpt.com/cdn/assets/other.js'),
      ]),
    ).toBeNull()
  })
  it('rejects missing roles and untrusted script origins', () => {
    const missing = fixture()
    missing.modules = missing.modules.filter((x) => x.id !== 'account')
    expect(resolveChatgptWebRuntimeCapabilities([missing])).toBeNull()
    expect(
      resolveChatgptWebRuntimeCapabilities([fixture('https://example.com/assets/test.js')]),
    ).toBeNull()
  })
  it('discovers an unknown runtime once, verifies it in MAIN and caches only the public mapping', async () => {
    const sender = {
      id: Browser.runtime.id,
      frameId: 0,
      tab: { id: 954 },
      documentId: 'new-runtime',
      url: 'https://chatgpt.com/?chatgptbox_proxy=1',
    }
    const execute = vi
      .spyOn(Browser.scripting, 'executeScript')
      .mockResolvedValueOnce([{ result: { ok: false, code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED' } }])
      .mockResolvedValueOnce([{ result: [fixture()] }])
      .mockResolvedValueOnce([{ result: { ok: true, transport: 'native', channel: 'synthetic' } }])
      .mockResolvedValueOnce([{ result: { ok: true, transport: 'native', channel: 'next' } }])
    expect(await getChatgptWebPageIntegrityForSender(sender)).toMatchObject({ ok: true })
    expect(execute.mock.calls[1][0]).toMatchObject({
      func: inspectChatgptWebRuntimeInPage,
      target: { tabId: 954, documentIds: ['new-runtime'] },
      world: 'MAIN',
    })
    expect(execute.mock.calls[2][0].args[0][0].capabilityCheck.preflight).toBe(true)
    expect(await getChatgptWebPageIntegrityForSender(sender)).toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledTimes(4)
    expect(execute.mock.calls[3][0].args[0][0]).toMatchObject({
      filename: '999999.new-build.js',
      capabilityCheck: { preflight: false },
    })
  })
})
