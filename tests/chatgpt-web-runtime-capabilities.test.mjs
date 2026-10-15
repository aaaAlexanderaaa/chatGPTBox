import { afterEach, describe, expect, it, vi } from 'vitest'
import Browser from 'webextension-polyfill'
import { getChatgptWebPageIntegrityForSender } from '../src/background/chatgpt-page-integrity.mjs'
import { inspectChatgptWebRuntimeInPage } from '../src/services/clients/chatgpt-web/runtime-inspection.mjs'
import {
  hasCompatibleChatgptWebNativeFetch,
  resolveChatgptWebRuntimeCapabilities,
} from '../src/services/clients/chatgpt-web/runtime-capabilities.mjs'
import {
  getChatgptWebFetchWrappers,
  hasCompatibleChatgptWebFetchWrapper,
} from '../src/services/clients/chatgpt-web/runtime-fetch-capabilities.mjs'

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

const tracked = `async function tracked(url, options, attempt) {
  let metadata = { cloudflareJsdStateAtRequestStart: state, requestAttempt: attempt };
  try {
    let response = await fetch(url, options);
    return records.set(response, metadata), response;
  } catch (error) {
    throw null != error && 'object' === typeof error && records.set(error, metadata), error;
  }
}`
const trackingFactory = `function(module, exports, load) {
  let state = 'not_started', records = new WeakMap();
  ${tracked}
  exports.trace = tracked;
}`
const wrappedNative = native.replaceAll(
  'await fetch(url, input)',
  'await (0, transport.trace)(url, input, "initial")',
)
const networkFactory = `function(module, exports, load) {
  const transport = load('tracking');
  ${wrappedNative}
  exports.send = network;
}`
function wrappedFixture() {
  const result = fixture()
  const auth = result.modules.find((module) => module.id === 'account')
  delete auth.functions.isSameBrowserRequestAuthContext
  auth.functions.getBrowserChatGptAuthGeneration = 'function generation() { return generation; }'
  auth.functions.isBrowserWorkspaceSwitchPending = 'function pending() { return false; }'
  const network = result.modules.find((module) => module.id === 'relocated')
  network.source = networkFactory
  network.functions = { send: wrappedNative }
  result.modules.push({ id: 'tracking', source: trackingFactory, functions: { trace: tracked } })
  result.graph.relocated = ['tracking']
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    native.replace('if (response.status', 'await fetch(url, input); if (response.status'),
    native.replace(
      'checkIdentity(headers, options.expectedIdentity);',
      'if (headers.enabled) checkIdentity(headers, options.expectedIdentity);',
    ),
    native.replace('assertCurrent?.();', 'for (const item of []) assertCurrent?.();'),
    native.replace('if (response.status', 'noRetry = false; if (response.status'),
    native.replace('await fetch(url, input)', 'await fetch(url, { method: "POST" })'),
    native.replace('const response =', 'input.signal = undefined; const response ='),
    native.replace('  assertCurrent?.();', 'assertCurrent = () => {}; assertCurrent?.();'),
  ])('rejects changed no-retry, response or identity behavior', (source) => {
    expect(hasCompatibleChatgptWebNativeFetch(source)).toBe(false)
  })
  it('discovers generation auth and a tracked fetch through its actual module import', () => {
    const result = resolveChatgptWebRuntimeCapabilities([wrappedFixture()])
    expect(result).toMatchObject({
      filename: '999999.new-build.js',
      authModule: 'account',
      authContext: 'generation',
      fetchModule: 'relocated',
      fetchExport: 'send',
      capabilityCheck: {
        preflight: true,
        fetchModuleSource: networkFactory,
        fetchWrappers: [
          { module: 'tracking', export: 'trace', source: tracked, moduleSource: trackingFactory },
        ],
        authSources: {
          getBrowserChatGptAuthGeneration: expect.any(String),
          isBrowserWorkspaceSwitchPending: expect.any(String),
        },
      },
    })
    expect(hasCompatibleChatgptWebNativeFetch(wrappedNative)).toBe(false)
    const data = wrappedFixture()
    expect(
      hasCompatibleChatgptWebNativeFetch(
        wrappedNative,
        getChatgptWebFetchWrappers(
          data.modules.find((module) => module.id === 'relocated'),
          data.modules,
        ),
      ),
    ).toBe(true)
  })
  it('ignores exported classes instead of aborting discovery for the entire runtime', () => {
    const data = wrappedFixture()
    data.modules.unshift({
      id: 'unrelated-view',
      source: '',
      functions: {
        View: 'class View { constructor(first, second, third) { this.value = first; } }',
      },
    })
    expect(resolveChatgptWebRuntimeCapabilities([data])).toMatchObject({
      authContext: 'generation',
      fetchModule: 'relocated',
    })
  })
  it('finds the transport even when unrelated UI dependencies exceed the former search budget', () => {
    const data = wrappedFixture()
    data.graph.request = ['unrelated-ui', 'wrapper']
    data.graph['unrelated-ui'] = Array.from({ length: 400 }, (_, index) => `ui-${index}`)
    expect(resolveChatgptWebRuntimeCapabilities([data])).toMatchObject({
      authContext: 'generation',
      fetchModule: 'relocated',
    })
  })
  it('keeps the dependency depth bound for unrelated or distant transport candidates', () => {
    const data = wrappedFixture()
    data.graph = { request: ['step-0'] }
    for (let index = 0; index < 6; index++) {
      data.graph[`step-${index}`] = [index === 5 ? 'relocated' : `step-${index + 1}`]
    }
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })
  it('recognizes renamed wrapper bindings, exports and local names', () => {
    const data = wrappedFixture()
    for (const module of data.modules) {
      module.source = module.source
        .replaceAll('transport', 'renamedImport')
        .replaceAll('trace', 'renamedExport')
        .replaceAll('records', 'renamedStore')
      module.functions = Object.fromEntries(
        Object.entries(module.functions).map(([name, source]) => [
          name === 'trace' ? 'renamedExport' : name,
          source
            .replaceAll('transport', 'renamedImport')
            .replaceAll('trace', 'renamedExport')
            .replaceAll('records', 'renamedStore'),
        ]),
      )
    }
    expect(resolveChatgptWebRuntimeCapabilities([data])).toMatchObject({
      authContext: 'generation',
      fetchModule: 'relocated',
    })
  })
  it.each(['getBrowserChatGptAuthGeneration', 'isBrowserWorkspaceSwitchPending'])(
    'rejects generation authentication without %s',
    (key) => {
      const data = wrappedFixture()
      delete data.modules.find((module) => module.id === 'account').functions[key]
      expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
    },
  )
  it.each([
    tracked.replace('return records.set', 'await fetch(url, options); return records.set'),
    tracked.replace('fetch(url, options)', 'fetch(url, {})'),
    tracked.replace('), response;', '), response.json();'),
    tracked.replace('throw null !=', 'return null !='),
    tracked.replace('), error;', '), new Error("changed");'),
    tracked.replace(
      'cloudflareJsdStateAtRequestStart: state',
      'cloudflareJsdStateAtRequestStart: getState()',
    ),
  ])('rejects wrappers that alter request, retry, response or error behavior', (source) => {
    expect(
      hasCompatibleChatgptWebFetchWrapper(source, trackingFactory.replace(tracked, source)),
    ).toBe(false)
    const data = wrappedFixture()
    const wrapper = data.modules.find((module) => module.id === 'tracking')
    wrapper.source = trackingFactory.replace(tracked, source)
    wrapper.functions.trace = source
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })
  it.each([
    trackingFactory.replace('new WeakMap()', 'new Map()'),
    trackingFactory.replace('exports.trace', 'records = new Map(); exports.trace'),
    trackingFactory.replace('exports.trace', 'records.set = fetch; exports.trace'),
    trackingFactory.replace(tracked, ''),
  ])(
    'requires the exported wrapper to belong to its unchanged private tracking module',
    (source) => {
      expect(hasCompatibleChatgptWebFetchWrapper(tracked, source)).toBe(false)
    },
  )
  it('rejects disconnected, unrecognized or ambiguous wrapped transports', () => {
    const data = wrappedFixture()
    data.modules.find((module) => module.id === 'relocated').source = networkFactory.replace(
      "load('tracking')",
      "load('unrelated')",
    )
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
    const ambiguous = wrappedFixture()
    const network = ambiguous.modules.find((module) => module.id === 'relocated')
    network.functions.anotherSend = network.functions.send
    expect(resolveChatgptWebRuntimeCapabilities([ambiguous])).toBeNull()
  })
  it('inspects a renamed runtime and discovers generation auth plus the fetch wrapper without a release mapping', async () => {
    const data = wrappedFixture()
    const sources = Object.fromEntries(data.modules.map((module) => [module.id, module.source]))
    sources.request = `function(module, exports, load) {
      load('wrapper');
      Object.assign(exports, { Request: {}, getChatGptRequestProfile: () => 'codex_webview' });
    }`
    sources.wrapper = `function(module, exports, load) { load('relocated'); }`
    sources.account = `function(module, exports, load) {
      Object.assign(exports, {loadBrowserChatGptAuth(){}, getBrowserChatGptAuthSnapshot(){},
        getBrowserChatGptAuthGeneration(){}, isBrowserWorkspaceSwitchPending(){}});
    }`
    sources.verification = `function(module, exports, load) {
      const names = ['OpenAI-Sentinel-Chat-Requirements-Token', 'OpenAI-Sentinel-Proof-Token', 'OpenAI-Sentinel-Turnstile-Token'];
    }`
    // Compile synthetic public functions only; no network or account code runs.
    const compile = (source) => Function(`return (${source})`)()
    const factories = Object.fromEntries(
      Object.entries(sources)
        .filter(([, source]) => source)
        .map(([id, source]) => [id, compile(source)]),
    )
    const exports = Object.fromEntries(
      data.modules.map((module) => [
        module.id,
        Object.fromEntries(
          Object.entries(module.functions).map(([key, source]) => [key, compile(source)]),
        ),
      ]),
    )
    exports.request.Request = Object.fromEntries(
      Object.entries(data.modules[0].requestMethods).map(([key, source]) => [key, compile(source)]),
    )
    const require = Object.assign((id) => exports[id], { m: factories })
    const page = {}
    page.top = page
    vi.stubGlobal('window', page)
    vi.stubGlobal('location', { origin: 'https://chatgpt.com' })
    vi.stubGlobal('document', {
      scripts: [{ src: 'https://chatgpt.com/cdn/assets/633146.future-build.js' }],
      querySelectorAll: () => [],
    })
    vi.stubGlobal('performance', { getEntriesByType: () => [] })
    const inspected = await inspectChatgptWebRuntimeInPage(
      [{ filename: '633146.older-build.js' }],
      async () => ({ __webpack_require__: require }),
    )
    expect(inspected[0].modules.map((module) => module.id)).toEqual(
      expect.arrayContaining(['account', 'relocated', 'tracking']),
    )
    expect(resolveChatgptWebRuntimeCapabilities(inspected)).toMatchObject({
      filename: '633146.future-build.js',
      authContext: 'generation',
      fetchModule: 'relocated',
      capabilityCheck: { fetchWrappers: [{ module: 'tracking', export: 'trace' }] },
    })
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
