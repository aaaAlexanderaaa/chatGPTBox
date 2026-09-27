import { timingSafeEquals } from './bridge-auth.mjs'
import net from 'node:net'

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[^/]+$/

export function isExtensionOrigin(origin) {
  return typeof origin === 'string' && EXTENSION_ORIGIN.test(origin)
}

export function allowedClientOrigin(origin, pairedOrigin, extraOrigins = []) {
  return Boolean(origin && (origin === pairedOrigin || extraOrigins.includes(origin)))
}

export function isClientAuthorized(req, { apiToken, bridgeToken, pairedOrigin } = {}) {
  const authorization = req?.headers?.authorization
  const token =
    typeof authorization === 'string' && /^Bearer\s+\S+$/i.test(authorization)
      ? authorization.replace(/^Bearer\s+/i, '')
      : ''
  if (!token) return false
  if (apiToken && timingSafeEquals(token, apiToken)) return true
  return Boolean(
    bridgeToken &&
      req?.headers?.origin === pairedOrigin &&
      isExtensionOrigin(pairedOrigin) &&
      timingSafeEquals(token, bridgeToken),
  )
}

export function isAllowedHost(hostHeader, host, port) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false
  const allowed = new Set([`${host}:${port}`])
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
    allowed.add(`127.0.0.1:${port}`)
    allowed.add(`localhost:${port}`)
    allowed.add(`[::1]:${port}`)
  }
  const presented = hostHeader.toLowerCase()
  if (allowed.has(presented)) return true
  if (host === '0.0.0.0' || host === '::') {
    try {
      const parsed = new URL(`http://${presented}`)
      return Number(parsed.port) === port && net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) > 0
    } catch {
      return false
    }
  }
  return false
}
