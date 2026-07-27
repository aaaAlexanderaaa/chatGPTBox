import { describe, expect, it } from 'vitest'
import { isApiBridgeUrlAllowed } from '../src/utils/api-bridge-url.mjs'

describe('isApiBridgeUrlAllowed', () => {
  it('accepts the local gateway bridge endpoint', () => {
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1:18080/bridge')).toBe(true)
    expect(isApiBridgeUrlAllowed('ws://localhost:9090/bridge')).toBe(true)
    expect(isApiBridgeUrlAllowed('ws://[::1]:18080/bridge')).toBe(true)
  })

  it('keeps the token query string out of the path check', () => {
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1:18080/bridge?token=abc123')).toBe(true)
  })

  it('rejects a non-loopback host', () => {
    expect(isApiBridgeUrlAllowed('ws://evil.example/bridge')).toBe(false)
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1.evil.example/bridge')).toBe(false)
    expect(isApiBridgeUrlAllowed('ws://10.0.0.5/bridge')).toBe(false)
  })

  it('rejects a different path on the gateway', () => {
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1:18080/')).toBe(false)
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1:18080/bridge/poll')).toBe(false)
    expect(isApiBridgeUrlAllowed('ws://127.0.0.1:18080/bridgex')).toBe(false)
  })

  it('rejects non-ws protocols', () => {
    expect(isApiBridgeUrlAllowed('wss://127.0.0.1:18080/bridge')).toBe(false)
    expect(isApiBridgeUrlAllowed('http://127.0.0.1:18080/bridge')).toBe(false)
    expect(isApiBridgeUrlAllowed('javascript:alert(1)')).toBe(false)
  })

  it('rejects non-string and unparseable input', () => {
    expect(isApiBridgeUrlAllowed(undefined)).toBe(false)
    expect(isApiBridgeUrlAllowed(null)).toBe(false)
    expect(isApiBridgeUrlAllowed({ toString: () => 'ws://127.0.0.1/bridge' })).toBe(false)
    expect(isApiBridgeUrlAllowed('/bridge')).toBe(false)
    expect(isApiBridgeUrlAllowed('')).toBe(false)
  })
})
