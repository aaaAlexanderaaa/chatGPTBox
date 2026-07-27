/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  extractBridgeToken,
  isBridgeOriginAllowed,
  isBridgeRequestAuthorized,
  loadOrCreateBridgeToken,
} from '../scripts/lib/bridge-auth.mjs'

const TOKEN = 'a'.repeat(48)

function req(headers = {}) {
  return { headers }
}

function url(search = '') {
  return new URL(`http://127.0.0.1:18080/bridge${search}`)
}

describe('isBridgeOriginAllowed', () => {
  it('allows extension origins', () => {
    expect(isBridgeOriginAllowed('chrome-extension://abcdefghijklmnop')).toBe(true)
    expect(isBridgeOriginAllowed('moz-extension://abcdefghijklmnop')).toBe(true)
    expect(isBridgeOriginAllowed('safari-web-extension://abcdefghijklmnop')).toBe(true)
  })

  it('allows a missing Origin, which only non-browser clients omit', () => {
    expect(isBridgeOriginAllowed(undefined)).toBe(true)
    expect(isBridgeOriginAllowed('')).toBe(true)
  })

  it('rejects web page origins, including lookalikes', () => {
    expect(isBridgeOriginAllowed('https://evil.example')).toBe(false)
    expect(isBridgeOriginAllowed('http://127.0.0.1:18080')).toBe(false)
    expect(isBridgeOriginAllowed('https://chrome-extension://x')).toBe(false)
    expect(isBridgeOriginAllowed('null')).toBe(false)
  })
})

describe('extractBridgeToken', () => {
  it('reads the X-Bridge-Token header', () => {
    expect(extractBridgeToken(req({ 'x-bridge-token': TOKEN }), url())).toBe(TOKEN)
  })

  it('reads an Authorization: Bearer header case-insensitively', () => {
    expect(extractBridgeToken(req({ authorization: `bearer ${TOKEN}` }), url())).toBe(TOKEN)
  })

  it('reads the token query parameter', () => {
    expect(extractBridgeToken(req(), url(`?token=${TOKEN}`))).toBe(TOKEN)
  })

  it('returns an empty string when nothing is presented', () => {
    expect(extractBridgeToken(req(), url())).toBe('')
    expect(extractBridgeToken(req({ authorization: 'Basic abc' }), url())).toBe('')
    expect(extractBridgeToken(req(), null)).toBe('')
  })
})

describe('isBridgeRequestAuthorized', () => {
  it('accepts a matching token by any of the three carriers', () => {
    expect(isBridgeRequestAuthorized(req({ 'x-bridge-token': TOKEN }), url(), TOKEN)).toBe(true)
    expect(isBridgeRequestAuthorized(req({ authorization: `Bearer ${TOKEN}` }), url(), TOKEN)).toBe(
      true,
    )
    expect(isBridgeRequestAuthorized(req(), url(`?token=${TOKEN}`), TOKEN)).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(isBridgeRequestAuthorized(req({ 'x-bridge-token': 'b'.repeat(48) }), url(), TOKEN)).toBe(
      false,
    )
  })

  it('rejects a token of a different length without throwing', () => {
    expect(isBridgeRequestAuthorized(req({ 'x-bridge-token': 'short' }), url(), TOKEN)).toBe(false)
    expect(
      isBridgeRequestAuthorized(req({ 'x-bridge-token': TOKEN + 'extra' }), url(), TOKEN),
    ).toBe(false)
  })

  it('rejects a correct token presented from a web page origin', () => {
    const headers = { 'x-bridge-token': TOKEN, origin: 'https://evil.example' }
    expect(isBridgeRequestAuthorized(req(headers), url(), TOKEN)).toBe(false)
  })

  it('accepts a correct token from an extension origin', () => {
    const headers = { 'x-bridge-token': TOKEN, origin: 'chrome-extension://abcdef' }
    expect(isBridgeRequestAuthorized(req(headers), url(), TOKEN)).toBe(true)
  })

  it('rejects when no token is presented', () => {
    expect(isBridgeRequestAuthorized(req(), url(), TOKEN)).toBe(false)
  })

  it('never authorizes against an empty expected token', () => {
    expect(isBridgeRequestAuthorized(req({ 'x-bridge-token': '' }), url(), '')).toBe(false)
    expect(isBridgeRequestAuthorized(req(), url('?token='), '')).toBe(false)
  })
})

describe('loadOrCreateBridgeToken', () => {
  const tempDirs = []

  function tempTokenFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-bridge-'))
    tempDirs.push(dir)
    return path.join(dir, '.chatgptbox', 'gateway-bridge-token')
  }

  afterEach(() => {
    while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  })

  it('prefers an explicitly configured token and writes nothing', () => {
    const tokenFile = tempTokenFile()
    const result = loadOrCreateBridgeToken({ tokenFile, configuredToken: 'configured' })
    expect(result).toEqual({ token: 'configured', generated: false, fromFile: false })
    expect(fs.existsSync(tokenFile)).toBe(false)
  })

  it('generates and persists a token on first run', () => {
    const tokenFile = tempTokenFile()
    const result = loadOrCreateBridgeToken({ tokenFile })
    expect(result.generated).toBe(true)
    expect(result.fromFile).toBe(true)
    expect(result.token).toMatch(/^[0-9a-f]{48}$/)
    expect(fs.readFileSync(tokenFile, 'utf8').trim()).toBe(result.token)
  })

  it('reuses the stored token across runs', () => {
    const tokenFile = tempTokenFile()
    const first = loadOrCreateBridgeToken({ tokenFile })
    const second = loadOrCreateBridgeToken({ tokenFile })
    expect(second.token).toBe(first.token)
    expect(second.generated).toBe(false)
    expect(second.fromFile).toBe(true)
  })

  it.runIf(process.platform !== 'win32')(
    'tightens permissions on a pre-existing token file',
    () => {
      const tokenFile = tempTokenFile()
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
      fs.writeFileSync(tokenFile, 'preexisting\n')
      fs.chmodSync(tokenFile, 0o644)
      fs.chmodSync(path.dirname(tokenFile), 0o755)

      const result = loadOrCreateBridgeToken({ tokenFile })

      expect(result.token).toBe('preexisting')
      expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.dirname(tokenFile)).mode & 0o777).toBe(0o700)
    },
  )

  it.runIf(process.platform !== 'win32')('creates the token file unreadable by others', () => {
    const tokenFile = tempTokenFile()
    loadOrCreateBridgeToken({ tokenFile })
    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.dirname(tokenFile)).mode & 0o777).toBe(0o700)
  })

  it('falls back to an in-memory token when the file cannot be written', () => {
    const tokenFile = path.join(os.devNull, 'nope', 'gateway-bridge-token')
    const result = loadOrCreateBridgeToken({ tokenFile })
    expect(result.generated).toBe(true)
    expect(result.fromFile).toBe(false)
    expect(result.token).toMatch(/^[0-9a-f]{48}$/)
  })
})
