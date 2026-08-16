import { describe, expect, it } from 'vitest'
import {
  buildGrokProbeConfig,
  parseGrokAuthSession,
  parseGrokRateLimits,
} from '../src/services/clients/grok-web/session.mjs'

describe('parseGrokAuthSession', () => {
  it('rejects unauthenticated and blocked', () => {
    expect(
      parseGrokAuthSession({ status: 'unauthenticated', user: { email: 'a@b.c' } }).signedIn,
    ).toBe(false)
    expect(parseGrokAuthSession({ status: 'blocked', user: { id: 'u1' } }).signedIn).toBe(false)
  })

  it('accepts userId or email', () => {
    expect(parseGrokAuthSession({ user: { userId: 'u1' } })).toMatchObject({
      signedIn: true,
      userId: 'u1',
    })
    expect(parseGrokAuthSession({ session: { email: 'a@b.c' } })).toMatchObject({
      signedIn: true,
      email: 'a@b.c',
    })
  })

  it('rejects empty identity', () => {
    expect(parseGrokAuthSession({})).toMatchObject({ signedIn: false })
  })
})

describe('parseGrokRateLimits', () => {
  it('reads an explicit tier', () => {
    expect(parseGrokRateLimits({ tier: 'heavy' })).toBe('heavy')
  })

  it('maps totalQueries Super/Heavy', () => {
    expect(parseGrokRateLimits({ totalQueries: 50 })).toBe('super')
    expect(parseGrokRateLimits({ totalQueries: 150 })).toBe('heavy')
    expect(parseGrokRateLimits({ totalQueries: 7 })).toBe('basic')
  })

  it('falls back to basic when unreadable', () => {
    expect(parseGrokRateLimits(null)).toBe('basic')
  })
})

describe('buildGrokProbeConfig', () => {
  it('signed-out clears models', () => {
    expect(buildGrokProbeConfig({ session: { signedIn: false }, tier: 'super' })).toEqual({
      grokWebSignedIn: false,
      grokWebAccountTier: '',
      grokWebAccountModels: [],
    })
  })

  it('signed-in writes slugs for the tier', () => {
    const cfg = buildGrokProbeConfig({
      session: { signedIn: true, userId: 'u' },
      tier: 'super',
    })
    expect(cfg.grokWebSignedIn).toBe(true)
    expect(cfg.grokWebAccountTier).toBe('super')
    expect(cfg.grokWebAccountModels).toEqual([
      'grok-chat-fast',
      'grok-chat-auto',
      'grok-chat-expert',
    ])
  })
})
