import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import i18n from 'i18next'
import Browser from 'webextension-polyfill'
import { getChatgptWebPageIntegrityForSender } from '../src/background/chatgpt-page-integrity.mjs'
import { inspectChatgptWebRuntimeInPage } from '../src/services/clients/chatgpt-web/runtime-inspection.mjs'
import {
  hasCompatibleChatgptWebNativeFetch,
  resolveChatgptWebRuntimeCapabilities,
} from '../src/services/clients/chatgpt-web/runtime-capabilities.mjs'
import {
  getChatgptWebFetchWrappers,
  hasCompatibleChatgptWebFetchDelegate,
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
const browserProfile = `function profile(accountId) {
  const headers = getBrowserHeaders();
  return schema.parse({
    kind: isNativeWindow() ? 'chatgpt-native' : 'chatgpt-browser',
    language: headers[languageHeader], deviceId: headers['oai-did'], accountId,
  });
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

function browserFixture() {
  const result = wrappedFixture()
  const request = result.modules.find((module) => module.id === 'request')
  request.source = 'Request: getChatGptRequestProfile chatgpt-browser chatgpt-native'
  request.functions.getChatGptRequestProfile = browserProfile
  return result
}

// Synthetic forms of the October 30 runtime: four-character module IDs,
// identity checks in a for-of initializer, and a read-only 403 response check.
// No captured account, verification implementation or conversation is included.
const octoberNative = wrappedNative
  .replace(
    'checkIdentity(headers, options.expectedIdentity);\n  assertCurrent?.();',
    `for (const [key, value] of (
      options.signal?.throwIfAborted(),
      checkIdentity(headers, options.expectedIdentity),
      assertCurrent?.(),
      Object.entries({})
    )) headers[key] = value;`,
  )
  .replace(
    '  const noRetry =',
    `  if (response.status === 403) {
      const blocked = await readBlockedWorkspace(response.clone());
      if (blocked) return response;
    }
    const noRetry =`,
  )

function octoberFixture() {
  const result = browserFixture()
  const ids = {
    request: 'Kwur',
    wrapper: 'HFSu',
    account: 'QdUF',
    verification: 'lXEa',
    relocated: 'wl0r',
    tracking: 'y3uJ',
    xb: 'old-name',
  }
  for (const module of result.modules) {
    module.id = ids[module.id]
    if (module.id === 'wl0r') {
      module.source = networkFactory.replace(wrappedNative, octoberNative)
      module.functions = { d: octoberNative }
    }
    module.source = module.source.replaceAll("load('tracking')", "load('y3uJ')")
  }
  result.graph = Object.fromEntries(
    Object.entries(result.graph).map(([id, dependencies]) => [
      ids[id],
      dependencies.map((dependency) => ids[dependency]),
    ]),
  )
  result.graph.HFSu = ['GDNt']
  result.graph.GDNt = ['KthI']
  result.graph.KthI = ['wl0r']
  return result
}

const diagnosticDelegate = `async function diagnosticFetch(url, options, send) {
  let response, attempt = arguments.length > 3 ? arguments[3] : 'initial', configuration = state;
  if (!configuration) return send(url, options);
  const diagnostic = function(config, input, init) {
    try {
      if (!enabled(config) || init.method !== 'POST') return;
      const parsed = telemetryUrl(input);
      if (!parsed || parsed.searchParams.has('ces_diag_id')) return;
      return { url: input + '?ces_diag_id=synthetic' };
    } catch { return; }
  }(configuration, url, options);
  if (!diagnostic) return send(url, options);
  const metadata = () => ({ request_attempt: attempt });
  try { response = await send(diagnostic.url, options); }
  catch (error) { throw report(metadata()), error; }
  return report(metadata()), response;
}`
const diagnosticFactory = `function(module, exports, load) {
  let state;
  function telemetryUrl(input) {
    const parsed = new URL(input, window.location.href);
    return parsed.origin === window.location.origin &&
      '/ces/v1/rgstr' === parsed.pathname && '' === parsed.username && '' === parsed.password
      ? parsed : void 0;
  }
  ${diagnosticDelegate}
  exports.send = diagnosticFetch;
}`
const delegatedTracking = tracked.replace(
  'fetch(url, options)',
  '(0, diagnostics.send)(url, options, fetch, attempt)',
)
const delegatedFactory = trackingFactory
  .replace('let state =', "const diagnostics = load('diagnostics'); let state =")
  .replace(tracked, delegatedTracking)

function delegatedFixture() {
  const data = browserFixture()
  const tracking = data.modules.find((module) => module.id === 'tracking')
  tracking.source = delegatedFactory
  tracking.functions.trace = delegatedTracking
  data.modules.push({
    id: 'diagnostics',
    source: diagnosticFactory,
    functions: { send: diagnosticDelegate },
  })
  data.graph.tracking = ['diagnostics']
  return data
}

function inlineDelegatedFixture() {
  const data = delegatedFixture()
  for (const [id, name, declared, local] of [
    ['tracking', 'trace', delegatedTracking, 'tracked'],
    ['diagnostics', 'send', diagnosticDelegate, 'diagnosticFetch'],
  ]) {
    const module = data.modules.find((entry) => entry.id === id)
    const inline = declared.replace(`function ${local}(`, 'function(')
    module.source = module.source
      .replace(declared, '')
      .replace(`exports.${name} = ${local};`, `load.d(exports, {}, { ${name}: ${inline} });`)
    module.functions[name] = inline
  }
  return data
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatGPT capability discovery', () => {
  it('recognizes the October 31 delegated fetch and pins both imported modules', () => {
    expect(resolveChatgptWebRuntimeCapabilities([delegatedFixture()])).toMatchObject({
      fetchModule: 'relocated',
      capabilityCheck: {
        fetchWrappers: [
          {
            module: 'tracking',
            export: 'trace',
            source: delegatedTracking,
            moduleSource: delegatedFactory,
          },
          {
            module: 'diagnostics',
            export: 'send',
            source: diagnosticDelegate,
            moduleSource: diagnosticFactory,
          },
        ],
      },
    })
    expect(hasCompatibleChatgptWebFetchWrapper(delegatedTracking, delegatedFactory)).toBe(false)
  })

  it('recognizes unchanged tracking and diagnostics exported as inline functions', () => {
    const data = inlineDelegatedFixture()
    const tracking = data.modules.find((entry) => entry.id === 'tracking')
    const diagnostics = data.modules.find((entry) => entry.id === 'diagnostics')
    expect(
      hasCompatibleChatgptWebFetchDelegate(diagnostics.functions.send, diagnostics.source),
    ).toBe(true)
    expect(resolveChatgptWebRuntimeCapabilities([data])).toMatchObject({
      fetchModule: 'relocated',
      fetchExport: 'send',
      capabilityCheck: {
        fetchWrappers: [
          { module: 'tracking', export: 'trace', source: tracking.functions.trace },
          { module: 'diagnostics', export: 'send', source: diagnostics.functions.send },
        ],
      },
    })
  })

  it.each([
    ['tracking', 'trace'],
    ['diagnostics', 'send'],
  ])('rejects inline %s source that only appears inside a string', (id, name) => {
    const data = inlineDelegatedFixture()
    const module = data.modules.find((entry) => entry.id === id)
    const source = module.functions[name]
    module.source = module.source
      .replace(source, 'function() {}')
      .replace('{', `{ const decoy = ${JSON.stringify(source)};`)
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })

  it.each([
    ['tracking', 'trace', 'return records.set', 'await fetch(url, options); return records.set'],
    ['diagnostics', 'send', 'send(url, options)', 'send(url, {})'],
  ])('rejects changed request behavior in inline %s exports', (id, name, before, after) => {
    const data = inlineDelegatedFixture()
    const module = data.modules.find((entry) => entry.id === id)
    const source = module.functions[name].replace(before, after)
    module.source = module.source.replace(module.functions[name], source)
    module.functions[name] = source
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })

  it.each([
    diagnosticDelegate.replace('return send(url, options);', 'return send(url, {});'),
    diagnosticDelegate.replace('if (!diagnostic)', 'if (diagnostic)'),
    diagnosticDelegate.replace('telemetryUrl(input)', 'telemetryUrl(url)'),
    diagnosticDelegate.replace('!parsed ||', 'parsed ||'),
    diagnosticDelegate.replace('const metadata =', 'await send(url, options); const metadata ='),
    diagnosticDelegate.replace(
      'await send(diagnostic.url, options)',
      'await send(diagnostic.url, {})',
    ),
    diagnosticDelegate.replace('), response;', '), response.json();'),
    diagnosticDelegate.replace('), error;', '), new Error("changed");'),
    diagnosticDelegate.replace(
      "arguments.length > 3 ? arguments[3] : 'initial'",
      '(options.signal = undefined)',
    ),
    diagnosticDelegate.replace('return { url:', 'fetch(input, init); return { url:'),
    diagnosticDelegate.replace(
      'if (!enabled(config)',
      "if ((options.body = 'changed', !enabled(config))",
    ),
    diagnosticDelegate.replace(
      'if (!enabled(config)',
      'if ((init.signal = undefined, !enabled(config))',
    ),
    diagnosticDelegate.replace('if (!enabled(config)', 'if ((send = otherFetch, !enabled(config))'),
    diagnosticDelegate.replace(
      'return report(metadata()), response;',
      'return report(metadata()), response = other, response;',
    ),
    diagnosticDelegate.replace(
      'throw report(metadata()), error;',
      'throw report(metadata()), error = other, error;',
    ),
  ])(
    'rejects changed delegated request, gate, response, error or cancellation behavior',
    (source) => {
      expect(
        hasCompatibleChatgptWebFetchDelegate(
          source,
          diagnosticFactory.replace(diagnosticDelegate, source),
        ),
      ).toBe(false)
      const data = delegatedFixture()
      const delegate = data.modules.find((module) => module.id === 'diagnostics')
      delegate.source = diagnosticFactory.replace(diagnosticDelegate, source)
      delegate.functions.send = source
      expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
    },
  )

  it.each([
    diagnosticFactory.replace('/ces/v1/rgstr', '/backend-api/f/conversation'),
    diagnosticFactory.replace('parsed.origin === window.location.origin &&', ''),
    diagnosticFactory.replace("'' === parsed.password", 'true'),
    diagnosticFactory.replace('new URL(input, window.location.href)', 'otherParser(input)'),
    diagnosticFactory.replace(diagnosticDelegate, ''),
  ])('requires the owned diagnostics function to be restricted to the telemetry URL', (source) => {
    expect(hasCompatibleChatgptWebFetchDelegate(diagnosticDelegate, source)).toBe(false)
  })

  it.each([
    delegatedTracking.replace('options, fetch, attempt', 'options, otherFetch, attempt'),
    delegatedTracking.replace('options, fetch, attempt', 'options, fetch, "other"'),
    delegatedTracking.replace('diagnostics.send', 'unrelated.send'),
  ])(
    'requires the wrapper to pass the original fetch and attempt to its actual import',
    (source) => {
      const data = delegatedFixture()
      const wrapper = data.modules.find((module) => module.id === 'tracking')
      wrapper.source = delegatedFactory.replace(delegatedTracking, source)
      wrapper.functions.trace = source
      expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
    },
  )

  it('recognizes the October 30 transport shape through its four-hop request path', () => {
    expect(resolveChatgptWebRuntimeCapabilities([octoberFixture()])).toMatchObject({
      requestModule: 'Kwur',
      authModule: 'QdUF',
      authContext: 'generation',
      integrityModule: 'lXEa',
      fetchModule: 'wl0r',
      fetchExport: 'd',
      capabilityCheck: { fetchWrappers: [{ module: 'y3uJ', export: 'trace' }] },
    })
  })

  it.each([
    octoberNative.replace('options.expectedIdentity', 'options.otherIdentity'),
    octoberNative.replace('assertCurrent?.(),', ''),
    octoberNative.replace("'never' === options.retry", "'sometimes' === options.retry"),
    octoberNative.replace('if (blocked) return response;', 'await fetch(url, input);'),
  ])('rejects changes before the October 30 no-retry return', (source) => {
    const data = octoberFixture()
    const network = data.modules.find((module) => module.id === 'wl0r')
    network.source = network.source.replace(octoberNative, source)
    network.functions.d = source
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })

  it('does not combine partial roles from different runtime instances', () => {
    const requestOnly = octoberFixture()
    requestOnly.modules = requestOnly.modules.filter((module) => module.id !== 'QdUF')
    const authOnly = octoberFixture()
    authOnly.url = 'https://chatgpt.com/cdn/assets/999999.another-build.js'
    authOnly.modules = authOnly.modules.filter((module) => module.id !== 'Kwur')
    expect(resolveChatgptWebRuntimeCapabilities([requestOnly, authOnly])).toBeNull()
  })

  it('does not fetch fresh HTML or import a guessed runtime when the document has no candidates', async () => {
    const page = {}
    page.top = page
    vi.stubGlobal('window', page)
    vi.stubGlobal('location', { origin: 'https://chatgpt.com' })
    vi.stubGlobal('document', { scripts: [{ src: '' }], querySelectorAll: () => [] })
    vi.stubGlobal('performance', { getEntriesByType: () => [] })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const load = vi.fn()
    expect(
      await inspectChatgptWebRuntimeInPage([{ filename: '633146.synthetic-build.js' }], load),
    ).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('discovers the account-bound browser/native profile after removal of the codex_webview marker', () => {
    const data = browserFixture()
    const request = data.modules.find((module) => module.id === 'request')
    expect(request.source).not.toContain('codex_webview')
    expect(resolveChatgptWebRuntimeCapabilities([data])).toMatchObject({
      requestModule: 'request',
      authContext: 'generation',
      fetchModule: 'relocated',
      capabilityCheck: {
        requestSources: request.requestMethods,
        requestProfileSource: browserProfile,
        preflight: true,
      },
    })
  })
  it.each([
    undefined,
    `function unrelated() { return 'chatgpt-browser chatgpt-native'; }`,
    browserProfile.replace('accountId,', 'accountId: otherAccount,'),
    browserProfile.replace("headers['oai-did']", "headers['other-device']"),
    browserProfile.replace("'chatgpt-browser'", "'other-client'"),
    browserProfile.replace(
      'language: headers[languageHeader]',
      'language: otherHeaders[languageHeader]',
    ),
    browserProfile.replace('schema.parse', 'schema.send'),
  ])('rejects browser profile labels without the reviewed account/device binding', (source) => {
    const data = browserFixture()
    data.modules.find((module) => module.id === 'request').functions.getChatGptRequestProfile =
      source
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })
  it('keeps rejecting ambiguous request modules with the renamed browser profile', () => {
    const data = browserFixture()
    data.modules.push({ ...data.modules[0], id: 'another-request' })
    expect(resolveChatgptWebRuntimeCapabilities([data])).toBeNull()
  })
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
  it.each(['legacy', 'browser', 'delegated'])(
    'inspects a renamed runtime with the %s profile without a release mapping',
    async (profile) => {
      const data =
        profile === 'delegated'
          ? delegatedFixture()
          : profile === 'browser'
          ? browserFixture()
          : wrappedFixture()
      const sources = Object.fromEntries(data.modules.map((module) => [module.id, module.source]))
      sources.request = `function(module, exports, load) {
      load('wrapper');
      Object.assign(exports, { Request: {}, getChatGptRequestProfile: () => '${
        profile !== 'legacy' ? 'chatgpt-browser' : 'codex_webview'
      }' });
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
        Object.entries(data.modules[0].requestMethods).map(([key, source]) => [
          key,
          compile(source),
        ]),
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
        expect.arrayContaining([
          'account',
          'relocated',
          'tracking',
          ...(profile === 'delegated' ? ['diagnostics'] : []),
        ]),
      )
      expect(resolveChatgptWebRuntimeCapabilities(inspected)).toMatchObject({
        filename: '633146.future-build.js',
        authContext: 'generation',
        fetchModule: 'relocated',
        capabilityCheck: {
          fetchWrappers: [
            { module: 'tracking', export: 'trace' },
            ...(profile === 'delegated' ? [{ module: 'diagnostics', export: 'send' }] : []),
          ],
        },
      })
    },
  )
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

  it.each([
    ['en', 'en', 'This error does not indicate that your account is suspended.'],
    ['zh', 'zh-hans', '这条错误不表示账号被封禁'],
    ['zhHant', 'zh-hant', '這條錯誤不表示帳號被封鎖'],
  ])(
    'explains compatibility failures in %s without implying an account ban',
    async (language, locale, expected) => {
      const en = JSON.parse(
        fs.readFileSync(new URL('../src/_locales/en/main.json', import.meta.url)),
      )
      const translation = JSON.parse(
        fs.readFileSync(new URL(`../src/_locales/${locale}/main.json`, import.meta.url)),
      )
      await i18n.init({
        lng: language,
        fallbackLng: 'en',
        resources: { en: { translation: en }, [language]: { translation } },
      })
      const sender = {
        id: Browser.runtime.id,
        frameId: 0,
        tab: { id: 963 },
        url: 'https://chatgpt.com/?chatgptbox_proxy=1',
      }
      const execute = vi.spyOn(Browser.scripting, 'executeScript')
      for (const inspections of [[], [browserFixture()]]) {
        execute
          .mockResolvedValueOnce([
            { result: { ok: false, code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED' } },
          ])
          .mockResolvedValueOnce([{ result: inspections }])
        if (inspections.length)
          execute.mockResolvedValueOnce([
            {
              result: {
                ok: false,
                code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
                message: 'Native API changed',
              },
            },
          ])
        const result = await getChatgptWebPageIntegrityForSender(sender)
        expect(result).toMatchObject({ ok: false, code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED' })
        expect(result.message).toContain(expected)
        expect(result.message).not.toContain('compatible ChatGPT request, account')
      }
      const signedOut = { ok: false, code: 'UNAUTHORIZED', message: 'Sign in to ChatGPT first.' }
      execute.mockResolvedValueOnce([{ result: signedOut }])
      expect(await getChatgptWebPageIntegrityForSender(sender)).toEqual(signedOut)
      await i18n.changeLanguage('en')
    },
  )
})
