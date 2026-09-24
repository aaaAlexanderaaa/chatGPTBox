import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../../protocol/messages.mjs'
import runtimeContracts from '../../../../resources/chatgpt-web/integrity/runtime-contracts.json'

// These exports belong to this exact reference bundle. Do not apply minified
// export names to an unknown release, or download a stale bundle into the page.
export const CHATGPT_WEB_INTEGRITY_RUNTIMES = Object.freeze(
  runtimeContracts.map((contract) => Object.freeze(contract)),
)

// Executed in the page's MAIN world. Keep it self-contained for executeScript.
// Only the already-loaded official runtime generates challenge results; this
// extension neither implements challenges nor copies previously captured tokens.
export async function getChatgptWebPageIntegrityInPage(
  contracts,
  loadModule = (url) => import(/* webpackIgnore: true */ url),
) {
  const failure = (code, message) => ({ ok: false, code, message })
  if (location.origin !== 'https://chatgpt.com' || window.top !== window) {
    return failure('CHATGPT_WEB_PAGE_REQUIRED', 'Open the ChatGPT proxy tab and sign in first.')
  }
  let timer
  let expired = false
  const checkDeadline = () => {
    if (expired) throw new Error('ChatGPT page integrity check timed out.')
  }
  const work = async () => {
    const urls = [
      ...[...document.scripts].map((node) => node.src),
      ...[...document.querySelectorAll('link[rel="modulepreload"]')].map((node) => node.href),
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ]
    const candidates = [...new Set(urls)].flatMap((raw) => {
      try {
        const url = new URL(raw)
        if (
          !(
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            ['chatgpt.com', 'cdn.oaistatic.com'].includes(url.hostname)
          )
        )
          return []
        const contract = contracts.find((entry) =>
          url.pathname.endsWith(`/assets/${entry.filename}`),
        )
        return contract ? [{ url: raw, contract }] : []
      } catch {
        return []
      }
    })
    if (candidates.length !== 1) {
      return failure(
        'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        'The loaded ChatGPT page runtime is not supported. Refresh the proxy tab and check for a ChatGPTBox protocol update.',
      )
    }
    const { url, contract } = candidates[0]
    const runtime = await loadModule(url)
    checkDeadline()
    const finalize = runtime[contract.finalize]
    const proof = runtime[contract.proof]
    const turnstile = runtime[contract.turnstile]
    const authHeaders = runtime[contract.authHeaders]
    const integrityHeaders = runtime[contract.integrityHeaders]
    if (
      typeof finalize !== 'function' ||
      typeof authHeaders !== 'function' ||
      typeof integrityHeaders !== 'function' ||
      typeof proof?.getEnforcementTokenSync !== 'function' ||
      typeof proof?.getEnforcementToken !== 'function' ||
      typeof turnstile?.getEnforcementTokenSync !== 'function' ||
      typeof turnstile?.getEnforcementToken !== 'function'
    ) {
      return failure(
        'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        'The ChatGPT page integrity API has changed.',
      )
    }
    const before = new Headers(authHeaders())
    // The native function consumes a valid prefetch or performs prepare,
    // the required challenges, and finalize. Never accept prepared-only here.
    const requirements = await finalize(false, 'none')
    checkDeadline()
    if (requirements?.force_login) {
      return failure('UNAUTHORIZED', 'ChatGPT requires you to sign in again in the proxy tab.')
    }
    if (typeof requirements?.token !== 'string' || !requirements.token.trim()) {
      return failure(
        'CHATGPT_WEB_INTEGRITY_INCOMPLETE',
        'ChatGPT did not finalize request integrity. No question was submitted.',
      )
    }
    const [proofToken, turnstileToken] = await Promise.all([
      proof.getEnforcementTokenSync(requirements) ??
        proof.getEnforcementToken(requirements, { forceSync: true }),
      turnstile.getEnforcementTokenSync(requirements) ??
        turnstile.getEnforcementToken(requirements),
    ])
    checkDeadline()
    const isToken = (value) => typeof value === 'string' && value.trim().length > 0
    if (
      (requirements.proofofwork?.required && !isToken(proofToken)) ||
      ((requirements.turnstile?.required || requirements.turnstile?.dx) && !isToken(turnstileToken))
    ) {
      return failure(
        'CHATGPT_WEB_INTEGRITY_INCOMPLETE',
        'ChatGPT has not completed the required browser verification. Open the proxy tab before retrying.',
      )
    }
    // The native Turnstile implementation can return a serialized error.
    if (
      typeof turnstileToken === 'string' &&
      /Turnstile-(?:Internal|Client)-Error/.test(turnstileToken)
    ) {
      return failure(
        'CHATGPT_WEB_INTEGRITY_INCOMPLETE',
        'ChatGPT browser verification failed. No question was submitted.',
      )
    }
    const after = new Headers(authHeaders())
    for (const key of ['authorization', 'chatgpt-account-id', 'oai-session-id', 'oai-device-id']) {
      if (before.get(key) !== after.get(key)) {
        return failure(
          'CHATGPT_WEB_AUTH_CHANGED',
          'The ChatGPT account or session changed during verification. Retry in the current account.',
        )
      }
    }
    if (!after.get('authorization')) return failure('UNAUTHORIZED', 'Sign in to ChatGPT first.')
    // Obtain telemetry from the real page if its SDK is already initialized.
    // Do not manufacture editor activity or telemetry for an automated request.
    const sdk = window.SentinelSDK
    if (typeof sdk?.token === 'function') {
      Promise.resolve(sdk.token('conversation')).catch(() => {})
    }
    const timing = typeof sdk?.timing === 'function' ? sdk.timing() : null
    const headers = integrityHeaders(requirements, turnstileToken, proofToken, null, null, timing)
    return { ok: true, baseHeaders: Object.fromEntries(after), integrityHeaders: headers }
  }
  try {
    return await Promise.race([
      work(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          expired = true
          resolve(
            failure(
              'CHATGPT_WEB_INTEGRITY_TIMEOUT',
              'ChatGPT browser verification timed out. No question was submitted.',
            ),
          )
        }, 45000)
      }),
    ])
  } catch {
    // Exceptions from page code may include response bodies or tokens.
    return failure(
      'CHATGPT_WEB_INTEGRITY_FAILED',
      'ChatGPT browser verification failed. Open the proxy tab, complete any required sign-in or verification, then retry.',
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function getChatgptWebPageIntegrity({ signal, apiUrl, apiPath }) {
  if (
    apiUrl?.replace(/\/$/, '') !== 'https://chatgpt.com' ||
    !['/backend-api/f/conversation', '/backend-api/conversation'].includes(
      apiPath?.replace(/\/$/, ''),
    )
  ) {
    throw new Error(
      'ChatGPT Web page verification requires the official https://chatgpt.com conversation endpoint.',
    )
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let abort
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    const result = await Promise.race([
      Browser.runtime.sendMessage({ type: RuntimeMessage.ChatgptWebPageIntegrity }),
      cancelled,
    ])
    if (!result?.ok || !result.baseHeaders || !result.integrityHeaders) {
      const error = new Error(
        result?.message ||
          'ChatGPT page verification is unavailable. Reload the extension and proxy tab.',
      )
      error.code = result?.code || 'CHATGPT_WEB_INTEGRITY_UNAVAILABLE'
      throw error
    }
    return result
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export function buildChatgptWebPageHeaders(
  context,
  { apiPath, turnTraceId, conduitToken, integrity = false, accept = 'text/event-stream' } = {},
) {
  const headers = new Headers(context.baseHeaders)
  if (integrity) {
    for (const [name, value] of Object.entries(context.integrityHeaders)) headers.set(name, value)
  }
  headers.set('Accept', accept)
  headers.set('Content-Type', 'application/json')
  headers.set('X-Openai-Target-Path', apiPath)
  headers.set('X-Openai-Target-Route', apiPath)
  if (turnTraceId) headers.set('X-Oai-Turn-Trace-Id', turnTraceId)
  if (conduitToken) headers.set('X-Conduit-Token', conduitToken)
  return Object.fromEntries(headers)
}
