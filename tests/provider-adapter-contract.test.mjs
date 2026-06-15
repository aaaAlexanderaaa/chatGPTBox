import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../src/background/providers/registry.mjs'
import {
  assertProviderAdapter,
  adapterSupportsTools,
  providerId,
} from '../src/background/providers/adapter-contract.mjs'

// Provider adapter contract test (architecture plan step 5).
//
// Every provider registered in registry.mjs must implement the ProviderAdapter
// interface. The registry already validates each entry at load via
// assertProviderAdapter; this file pins that contract independently so a
// provider that drops a required member (or adds a malformed optional one like
// supportsTools: 'yes') is caught in CI rather than at runtime.
//
// This complements provider-registry.test.mjs (which pins ORDERING and the
// match/route behavior) by pinning the SHAPE of each adapter.

describe('provider adapter contract', () => {
  it('every registered provider passes assertProviderAdapter', () => {
    for (const provider of PROVIDERS) {
      expect(() => assertProviderAdapter(provider, provider.route)).not.toThrow()
    }
  })

  it('every provider has a non-empty route and the route equals providerId() unless id is set', () => {
    for (const provider of PROVIDERS) {
      expect(typeof provider.route).toBe('string')
      expect(provider.route.length).toBeGreaterThan(0)
      // id defaults to route when not explicitly set
      expect(providerId(provider)).toBe(provider.id || provider.route)
    }
  })

  it('match is a function accepting a session and returning a boolean', () => {
    for (const provider of PROVIDERS) {
      expect(typeof provider.match).toBe('function')
      // Calling match with an unrelated session should not throw and should
      // return a boolean (true or false both acceptable here).
      const result = provider.match({ modelName: '__not-a-real-model__' })
      expect(typeof result).toBe('boolean')
    }
  })

  it('run is an async function (returns a Promise)', () => {
    for (const provider of PROVIDERS) {
      expect(typeof provider.run).toBe('function')
      // We don't invoke run() (it needs a live port + network), but we can
      // confirm invoking it with a throwaway argument yields a thenable —
      // i.e. it is declared async.
      // Use a proxy that throws on any property access so we don't accidentally
      // satisfy a real provider; we only care that run() returns a Promise.
      const throwaway = new Proxy(
        {},
        {
          get() {
            throw new Error('run() should not read from args during construction')
          },
        },
      )
      const result = provider.run(throwaway)
      expect(result, `${provider.route}.run must be async`).toBeInstanceOf(Promise)
      // Swallow the inevitable rejection so vitest doesn't report an unhandled
      // rejection — we never await the real work.
      result.catch(() => {})
    }
  })

  it('supportsTools, when present, is a boolean and adapterSupportsTools() reflects it', () => {
    for (const provider of PROVIDERS) {
      if (provider.supportsTools !== undefined) {
        expect(typeof provider.supportsTools).toBe('boolean')
      }
      expect(adapterSupportsTools(provider)).toBe(provider.supportsTools === true)
    }
  })

  it('assertProviderAdapter rejects malformed adapters with a descriptive error', () => {
    expect(() => assertProviderAdapter(null, 'x')).toThrow(/expected an object/)
    expect(() => assertProviderAdapter({ match() {}, run() {} }, 'x')).toThrow(/route/)
    expect(() => assertProviderAdapter({ route: 'r', run() {} }, 'x')).toThrow(/match/)
    expect(() => assertProviderAdapter({ route: 'r', match() {} }, 'x')).toThrow(/run/)
    expect(() =>
      assertProviderAdapter({ route: 'r', match() {}, run() {}, supportsTools: 'yes' }, 'x'),
    ).toThrow(/supportsTools/)
  })
})
