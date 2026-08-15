import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  },
}))

const {
  buildDshHeaderRewriteRule,
  isDshFenceRewriteTarget,
  normalizeDshEndpoint,
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
