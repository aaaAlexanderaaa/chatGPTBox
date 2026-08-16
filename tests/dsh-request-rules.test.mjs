/* eslint-env node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path) => `chrome-extension://test-extension-id${path || ''}`,
    },
    storage: {
      local: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
    declarativeNetRequest: {
      updateDynamicRules: vi.fn(async () => {}),
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}))

import { readFileSync } from 'node:fs'
import path from 'node:path'

const {
  buildDshHeaderRewriteRule,
  isDshFenceRewriteTarget,
  normalizeDshEndpoint,
  shouldRecreateDshGateway,
  resolveEndpointCommit,
  endpointForLiveGateway,
  resolveGatewayHoldReason,
  helloForGatewayHold,
  webRequestFallbackUrls,
  rewriteFenceHeaders,
  syncDshHeaderRules,
} = await import('../src/modules/dsh/background/fence.mjs')

const Browser = (await import('webextension-polyfill')).default

describe('dsh endpoint normalization', () => {
  it('strips trailing slashes and rejects non-http(s) input', () => {
    expect(normalizeDshEndpoint('http://127.0.0.1:3080/')).toBe('http://127.0.0.1:3080')
    expect(normalizeDshEndpoint('  localhost:3080 ')).toBeNull()
    expect(normalizeDshEndpoint('')).toBeNull()
    expect(normalizeDshEndpoint('ftp://x')).toBeNull()
  })

  it('accepts loopback hosts and rejects remote origins (D-13 fence)', () => {
    expect(normalizeDshEndpoint('http://localhost:3080')).toBe('http://localhost:3080')
    expect(normalizeDshEndpoint('http://[::1]:3080')).toBe('http://[::1]:3080')
    expect(normalizeDshEndpoint('http://example.com')).toBeNull()
    expect(normalizeDshEndpoint('https://evil.example')).toBeNull()
    expect(normalizeDshEndpoint('http://192.168.1.5:3080')).toBeNull()
  })

  it('keeps only the origin — a typed path would make the client hit /api/api', () => {
    expect(normalizeDshEndpoint('http://127.0.0.1:3080/api')).toBe('http://127.0.0.1:3080')
    expect(normalizeDshEndpoint('http://127.0.0.1:3080/foo/bar/')).toBe('http://127.0.0.1:3080')
  })
})

describe('shouldRecreateDshGateway', () => {
  it('recreates when no gateway exists yet', () => {
    expect(shouldRecreateDshGateway(undefined, 'http://127.0.0.1:3080', false)).toBe(true)
  })

  it('does not recreate for trailing-slash-only edits', () => {
    expect(shouldRecreateDshGateway('http://127.0.0.1:3080', 'http://127.0.0.1:3080/', true)).toBe(
      false,
    )
  })

  it('recreates when the origin actually changes', () => {
    expect(shouldRecreateDshGateway('http://127.0.0.1:3080', 'http://127.0.0.1:3081', true)).toBe(
      true,
    )
  })
})

describe('resolveEndpointCommit', () => {
  it('commits a valid typed origin in normalized form', () => {
    expect(resolveEndpointCommit('http://127.0.0.1:3081/', 'http://127.0.0.1:3080')).toBe(
      'http://127.0.0.1:3081',
    )
  })

  it('keeps the current value when the draft is invalid or unchanged', () => {
    expect(resolveEndpointCommit('not a url', 'http://127.0.0.1:3080')).toBe(
      'http://127.0.0.1:3080',
    )
    expect(resolveEndpointCommit('http://127.0.0.1:3080/', 'http://127.0.0.1:3080')).toBe(
      'http://127.0.0.1:3080',
    )
  })
})

describe('endpointForLiveGateway', () => {
  it('is null when the module is off or the URL is not loopback', () => {
    expect(endpointForLiveGateway(false, 'http://127.0.0.1:3080')).toBeNull()
    expect(endpointForLiveGateway(true, 'http://evil.example')).toBeNull()
    expect(endpointForLiveGateway(true, 'http://127.0.0.1:3080/api')).toBe('http://127.0.0.1:3080')
  })
})

describe('gateway hold hello', () => {
  it('does not claim the module is off when the URL is not loopback', () => {
    expect(resolveGatewayHoldReason({ enabled: true, endpoint: 'http://evil.example' })).toBe(
      'invalid-endpoint',
    )
    expect(helloForGatewayHold('invalid-endpoint')).toMatchObject({
      type: 'hello',
      status: 'offline',
      lastError: expect.stringMatching(/loopback/i),
    })
  })

  it('says the module is off only when it is actually off', () => {
    expect(resolveGatewayHoldReason({ enabled: false, endpoint: 'http://127.0.0.1:3080' })).toBe(
      'disabled',
    )
    expect(helloForGatewayHold('disabled')).toMatchObject({
      status: 'disabled',
      lastError: 'DeepSeek Harness module is off',
    })
  })

  it('reports connecting until apply has run', () => {
    expect(
      resolveGatewayHoldReason({
        enabled: true,
        endpoint: 'http://127.0.0.1:3080',
        applied: false,
      }),
    ).toBe('starting')
    expect(helloForGatewayHold('starting')).toMatchObject({
      status: 'connecting',
      lastError: null,
    })
  })
})

describe('webRequestFallbackUrls', () => {
  it('scopes the MV2 listener to the loopback origin and stays empty when disabled', () => {
    expect(webRequestFallbackUrls('')).toEqual([])
    expect(webRequestFallbackUrls('http://example.com')).toEqual([])
    expect(webRequestFallbackUrls('http://127.0.0.1:3080')).toEqual(['http://127.0.0.1:3080/*'])
  })
})

describe('Firefox MV2 fence permissions', () => {
  it('includes webRequestBlocking so the Origin rewrite can install', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/manifest.v2.json'), 'utf8'),
    )
    expect(manifest.permissions).toContain('webRequest')
    expect(manifest.permissions).toContain('webRequestBlocking')
  })
})

describe('dsh header rewrite rule', () => {
  it('removes Origin and neutralizes Sec-Fetch-Site, scoped to /api on the endpoint', () => {
    const rule = buildDshHeaderRewriteRule('http://127.0.0.1:3080', 'ext-id')
    expect(rule).toMatchObject({
      id: 1003,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { operation: 'remove', header: 'origin' },
          { operation: 'set', header: 'sec-fetch-site', value: 'none' },
        ],
      },
      condition: {
        urlFilter: '|http://127.0.0.1:3080/api',
        resourceTypes: ['xmlhttprequest', 'websocket'],
        initiatorDomains: ['ext-id'],
      },
    })
  })

  it('returns null for an invalid endpoint', () => {
    expect(buildDshHeaderRewriteRule('not a url', 'ext-id')).toBeNull()
  })
})

describe('MV2 fence header rewrite', () => {
  it('removes Origin and sets Sec-Fetch-Site to none, matching DNR', () => {
    const rewritten = rewriteFenceHeaders([
      { name: 'Origin', value: 'chrome-extension://test-extension-id' },
      { name: 'Sec-Fetch-Site', value: 'cross-site' },
      { name: 'Content-Type', value: 'application/json' },
    ])
    expect(rewritten.find((header) => header.name.toLowerCase() === 'origin')).toBeUndefined()
    expect(rewritten.find((header) => header.name.toLowerCase() === 'sec-fetch-site')).toEqual({
      name: 'Sec-Fetch-Site',
      value: 'none',
    })
    expect(rewritten.find((header) => header.name === 'Content-Type')).toEqual({
      name: 'Content-Type',
      value: 'application/json',
    })
  })
})

describe('dsh webRequest fallback targeting', () => {
  it('matches only extension-initiated /api requests on the configured origin', () => {
    expect(
      isDshFenceRewriteTarget(
        {
          initiator: 'chrome-extension://test-extension-id',
          url: 'http://127.0.0.1:3080/api/session.prompt',
        },
        'http://127.0.0.1:3080',
      ),
    ).toBe(true)
    expect(
      isDshFenceRewriteTarget(
        {
          initiator: 'chrome-extension://test-extension-id',
          url: 'http://127.0.0.1:3080/api/events.mux',
        },
        'http://127.0.0.1:3080',
      ),
    ).toBe(true)
    // The harness's own web UI (same-origin page) must never be rewritten.
    expect(
      isDshFenceRewriteTarget(
        {
          initiator: 'http://127.0.0.1:3080',
          url: 'http://127.0.0.1:3080/api/session.prompt',
        },
        'http://127.0.0.1:3080',
      ),
    ).toBe(false)
    // Different port / non-api path / foreign initiator are all out of scope.
    expect(
      isDshFenceRewriteTarget(
        { initiator: 'chrome-extension://test-extension-id', url: 'http://127.0.0.1:9999/api/x' },
        'http://127.0.0.1:3080',
      ),
    ).toBe(false)
    expect(
      isDshFenceRewriteTarget(
        {
          initiator: 'chrome-extension://test-extension-id',
          url: 'http://127.0.0.1:3080/plugins/x.js',
        },
        'http://127.0.0.1:3080',
      ),
    ).toBe(false)
    expect(
      isDshFenceRewriteTarget({ url: 'http://127.0.0.1:3080/api/x' }, 'http://127.0.0.1:3080'),
    ).toBe(false)
  })
})

describe('syncDshHeaderRules', () => {
  beforeEach(() => {
    Browser.declarativeNetRequest.updateDynamicRules.mockClear()
  })

  it('installs the dynamic rule when the endpoint is valid', async () => {
    await syncDshHeaderRules('http://localhost:3080')
    expect(Browser.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [1003],
      addRules: [
        expect.objectContaining({
          condition: expect.objectContaining({ urlFilter: '|http://localhost:3080/api' }),
        }),
      ],
    })
  })

  it('removes the rule when the endpoint is invalid', async () => {
    await syncDshHeaderRules('garbage')
    expect(Browser.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [1003],
      addRules: [],
    })
  })
})

describe('MV2 webRequest fallback registration', () => {
  let dnr

  beforeEach(() => {
    dnr = Browser.declarativeNetRequest
    Browser.declarativeNetRequest = undefined
    Browser.webRequest.onBeforeSendHeaders.addListener.mockClear()
    Browser.webRequest.onBeforeSendHeaders.removeListener.mockClear()
  })

  afterEach(async () => {
    await syncDshHeaderRules('')
    Browser.declarativeNetRequest = dnr
  })

  it('does not install a blocking listener when the endpoint is empty', async () => {
    await syncDshHeaderRules('')
    expect(Browser.webRequest.onBeforeSendHeaders.addListener).not.toHaveBeenCalled()
  })

  it('installs an origin-scoped listener and removes it when disabled', async () => {
    await syncDshHeaderRules('http://127.0.0.1:3080')
    expect(Browser.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalledTimes(1)
    expect(Browser.webRequest.onBeforeSendHeaders.addListener.mock.calls[0][1]).toEqual({
      urls: ['http://127.0.0.1:3080/*'],
      types: ['xmlhttprequest', 'websocket'],
    })
    await syncDshHeaderRules('')
    expect(Browser.webRequest.onBeforeSendHeaders.removeListener).toHaveBeenCalled()
  })
})
