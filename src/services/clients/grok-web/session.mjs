import { slugsForGrokWebTier } from '../../../config/grok-web.mjs'

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return ''
}

function signedOutSession() {
  return { signedIn: false, userId: '', email: '' }
}

export function parseGrokAuthSession(body) {
  if (!body || typeof body !== 'object') {
    return signedOutSession()
  }

  const status = typeof body.status === 'string' ? body.status.trim() : ''
  if (status.toLowerCase() === 'unauthenticated' || status.toLowerCase() === 'blocked') {
    return signedOutSession()
  }

  const session = body.session && typeof body.session === 'object' ? body.session : {}
  const user = body.user && typeof body.user === 'object' ? body.user : {}

  const userId = firstNonEmpty(
    session.userId,
    user.id,
    user.userId,
    user.sub,
    body.id,
    body.userId,
    body.sub,
  )
  const email = firstNonEmpty(session.email, user.email, body.email)

  if (!userId && !email) {
    return signedOutSession()
  }

  return { signedIn: true, userId, email }
}

export function parseGrokRateLimits(body) {
  if (!body || typeof body !== 'object') {
    return 'basic'
  }

  const { tier } = body
  if (tier === 'basic' || tier === 'super' || tier === 'heavy') {
    return tier
  }

  const totalQueries = body.totalQueries
  if (typeof totalQueries === 'number' && !Number.isNaN(totalQueries)) {
    if (totalQueries >= 150) return 'heavy'
    if (totalQueries >= 50) return 'super'
    return 'basic'
  }

  return 'basic'
}

export function buildGrokProbeConfig({ session, tier }) {
  if (!session?.signedIn) {
    return {
      grokWebSignedIn: false,
      grokWebAccountTier: '',
      grokWebAccountModels: [],
    }
  }

  return {
    grokWebSignedIn: true,
    grokWebAccountTier: tier,
    grokWebAccountModels: slugsForGrokWebTier(tier),
  }
}
