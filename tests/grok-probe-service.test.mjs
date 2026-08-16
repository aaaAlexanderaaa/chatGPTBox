import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  applyGrokProbeFromParts,
  registerGrokProbe,
} from '../src/background/grok-probe-service.mjs'

describe('applyGrokProbeFromParts', () => {
  it('clears state when cookies are missing', () => {
    expect(applyGrokProbeFromParts({ cookies: [] })).toMatchObject({
      grokWebSignedIn: false,
      grokWebAccountModels: [],
    })
  })

  it('hard-confirms from session + rate limit JSON', () => {
    const cfg = applyGrokProbeFromParts({
      cookies: [{ name: 'sso', value: 'x' }],
      sessionJson: { user: { userId: 'u1' } },
      rateLimitJson: { tier: 'heavy' },
    })
    expect(cfg.grokWebSignedIn).toBe(true)
    expect(cfg.grokWebAccountTier).toBe('heavy')
    expect(cfg.grokWebAccountModels).toContain('grok-chat-heavy')
  })

  it('cookies without session JSON stay optimistic without inventing tier', () => {
    expect(
      applyGrokProbeFromParts({
        cookies: [{ name: 'sso', value: 'x' }],
      }),
    ).toEqual({
      grokWebSignedIn: true,
      grokWebAccountTier: '',
      grokWebAccountModels: [],
    })
  })

  it('signed-out session clears config even when cookies exist', () => {
    expect(
      applyGrokProbeFromParts({
        cookies: [{ name: 'sso', value: 'x' }],
        sessionJson: { status: 'unauthenticated' },
        rateLimitJson: { tier: 'heavy' },
      }),
    ).toMatchObject({
      grokWebSignedIn: false,
      grokWebAccountTier: '',
      grokWebAccountModels: [],
    })
  })
})

describe('probe source safety', () => {
  it('does not create tabs', () => {
    const src = readFileSync(
      new URL('../src/background/grok-probe-service.mjs', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/tabs\.create/)
    expect(src).not.toMatch(/conversations\/new/)
  })
})

function createProbeHarness({ cookies = [], tabs = [], fetchOnTab } = {}) {
  const setUserConfig = vi.fn(async () => {})
  const getUserConfig = vi.fn(async () => ({}))
  const cookieListeners = []
  const tabListeners = []
  const cookiesApi = {
    getAll: vi.fn(async () => cookies),
    onChanged: {
      addListener: (fn) => cookieListeners.push(fn),
    },
  }
  const tabsApi = {
    query: vi.fn(async () => tabs),
    onUpdated: {
      addListener: (fn) => tabListeners.push(fn),
    },
  }
  const fetchImpl = vi.fn()
  registerGrokProbe({
    cookiesApi,
    tabsApi,
    fetchImpl,
    fetchOnTab:
      fetchOnTab ||
      (async () => ({
        sessionJson: { user: { userId: 'u1' } },
        rateLimitJson: { tier: 'basic' },
      })),
    setUserConfig,
    getUserConfig,
  })
  return {
    setUserConfig,
    getUserConfig,
    cookiesApi,
    tabsApi,
    fetchImpl,
    cookieListeners,
    tabListeners,
  }
}

describe('registerGrokProbe', () => {
  it('writes signed-out config when cookies are missing', async () => {
    const { setUserConfig } = createProbeHarness({ cookies: [] })
    await vi.waitFor(() => expect(setUserConfig).toHaveBeenCalled())
    expect(setUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        grokWebSignedIn: false,
        grokWebAccountModels: [],
      }),
    )
  })

  it('hard-confirms via fetchOnTab when a grok.com tab exists', async () => {
    const fetchOnTab = vi.fn(async () => ({
      sessionJson: { user: { userId: 'u1' } },
      rateLimitJson: { tier: 'super' },
    }))
    const { setUserConfig } = createProbeHarness({
      cookies: [{ name: 'sso', value: 'x' }],
      tabs: [{ id: 7, url: 'https://grok.com/chat' }],
      fetchOnTab,
    })
    await vi.waitFor(() => expect(setUserConfig).toHaveBeenCalled())
    expect(fetchOnTab).toHaveBeenCalledWith(7)
    expect(setUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        grokWebSignedIn: true,
        grokWebAccountTier: 'super',
      }),
    )
  })

  it('stays optimistic without inventing tier when cookies exist but no grok tab', async () => {
    const fetchOnTab = vi.fn()
    const { setUserConfig } = createProbeHarness({
      cookies: [{ name: 'sso', value: 'x' }],
      tabs: [{ id: 1, url: 'https://example.com/' }],
      fetchOnTab,
    })
    await vi.waitFor(() => expect(setUserConfig).toHaveBeenCalled())
    expect(fetchOnTab).not.toHaveBeenCalled()
    expect(setUserConfig).toHaveBeenCalledWith({ grokWebSignedIn: true })
  })
})
