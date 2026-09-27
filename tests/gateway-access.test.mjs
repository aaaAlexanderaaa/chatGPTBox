/* eslint-env node */
import { describe, expect, it } from 'vitest'
import {
  allowedClientOrigin,
  isAllowedHost,
  isClientAuthorized,
  isExtensionOrigin,
} from '../scripts/lib/gateway-access.mjs'

const pairedOrigin = 'chrome-extension://paired-extension'

describe('API client access', () => {
  it('requires a bearer token and limits bridge-token use to its paired extension', () => {
    const req = (authorization, origin) => ({ headers: { authorization, origin } })
    const config = { apiToken: 'api-secret', bridgeToken: 'bridge-secret', pairedOrigin }
    expect(isClientAuthorized(req('Bearer api-secret'), config)).toBe(true)
    expect(isClientAuthorized(req('Bearer bridge-secret', pairedOrigin), config)).toBe(true)
    expect(isClientAuthorized(req('Bearer bridge-secret', 'https://evil.example'), config)).toBe(
      false,
    )
    expect(isClientAuthorized(req('Bearer bridge-secret'), config)).toBe(false)
    expect(isClientAuthorized(req('Basic api-secret'), config)).toBe(false)
  })

  it('reflects only paired or explicitly configured origins', () => {
    expect(isExtensionOrigin(pairedOrigin)).toBe(true)
    expect(isExtensionOrigin('https://paired-extension')).toBe(false)
    expect(allowedClientOrigin(pairedOrigin, pairedOrigin)).toBe(true)
    expect(
      allowedClientOrigin('https://client.example', pairedOrigin, ['https://client.example']),
    ).toBe(true)
    expect(allowedClientOrigin('https://evil.example', pairedOrigin)).toBe(false)
  })

  it('rejects DNS names when bound to loopback and permits IP hosts on wildcard binds', () => {
    expect(isAllowedHost('127.0.0.1:18080', '127.0.0.1', 18080)).toBe(true)
    expect(isAllowedHost('evil.example:18080', '127.0.0.1', 18080)).toBe(false)
    expect(isAllowedHost('192.168.1.5:18080', '0.0.0.0', 18080)).toBe(true)
    expect(isAllowedHost('evil.example:18080', '0.0.0.0', 18080)).toBe(false)
  })
})
