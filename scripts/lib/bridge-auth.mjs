// Authentication for the gateway's bridge channel.
//
// The bridge is the extension's private channel into the gateway process:
// whoever holds it receives every prompt and can answer them. Nothing about a
// loopback socket identifies the caller, so the channel is gated on a shared
// token. Kept in its own module so the policy is unit-testable without starting
// a listener — importing scripts/api-server.mjs binds a port.

import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//

export function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

// A browser always labels cross-origin requests with their real Origin, and a web
// page can never forge an extension origin. Requests with no Origin at all come
// from non-browser clients (curl, a script), which the token alone gates.
export function isBridgeOriginAllowed(origin) {
  if (!origin) return true
  return EXTENSION_ORIGIN.test(origin)
}

export function extractBridgeToken(req, url) {
  const header = req?.headers?.['x-bridge-token']
  const auth = req?.headers?.authorization
  const bearer =
    typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : ''
  const query = url ? url.searchParams.get('token') : ''
  return header || bearer || query || ''
}

export function isBridgeRequestAuthorized(req, url, expectedToken) {
  if (!expectedToken) return false
  if (!isBridgeOriginAllowed(req?.headers?.origin)) return false
  const presented = extractBridgeToken(req, url)
  if (!presented) return false
  return timingSafeEquals(presented, expectedToken)
}

/**
 * An explicitly configured token wins; otherwise one is generated once and
 * reused across restarts so the extension page does not need to be re-paired
 * every time.
 *
 * @param {{ tokenFile: string, configuredToken?: string }} params
 */
export function loadOrCreateBridgeToken({ tokenFile, configuredToken }) {
  // Trimmed to match the extension, which trims the pasted token. Without this a
  // configured token with stray whitespace could never be paired, and the startup
  // banner would print something that looks identical to what the user typed.
  const configured = typeof configuredToken === 'string' ? configuredToken.trim() : ''
  if (configured) return { token: configured, generated: false, fromFile: false }

  try {
    const stored = fs.readFileSync(tokenFile, 'utf8').trim()
    if (stored) {
      // A token file left readable by other local accounts defeats the point of
      // having a token, and `mode` on writeFileSync only applies at creation.
      tightenPermissions(tokenFile)
      return { token: stored, generated: false, fromFile: true }
    }
  } catch {
    /* no stored token yet */
  }

  const token = crypto.randomBytes(24).toString('hex')
  try {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 })
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
    tightenPermissions(tokenFile)
    return { token, generated: true, fromFile: true }
  } catch {
    return { token, generated: true, fromFile: false }
  }
}

// `recursive: true` skips `mode` for a directory that already exists, and
// `writeFileSync`'s `mode` is ignored when the file already exists, so both are
// re-applied explicitly. chmod is a no-op-if-unsupported nicety on Windows.
function tightenPermissions(tokenFile) {
  try {
    fs.chmodSync(path.dirname(tokenFile), 0o700)
  } catch {
    /* not fatal */
  }
  try {
    fs.chmodSync(tokenFile, 0o600)
  } catch {
    /* not fatal */
  }
}
