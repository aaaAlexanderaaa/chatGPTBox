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
    if (contract.kind === 'rspack') return await connectNativeTransport(runtime, contract)
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

  // The new frontend owns authentication and integrity-state recovery in its
  // browser transport. Keep credentials in MAIN and relay only response bytes.
  // This function is nested because executeScript serializes its enclosing function.
  async function connectNativeTransport(runtime, contract) {
    const require = runtime.__webpack_require__
    const ids = [
      contract.requestModule,
      contract.authModule,
      contract.integrityModule,
      contract.fetchModule,
    ]
    if (typeof require !== 'function' || ids.some((id) => typeof require.m?.[id] !== 'function')) {
      return failure(
        'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        'The ChatGPT native modules are not ready. Reload the proxy tab.',
      )
    }
    const request = require(contract.requestModule).Request
    const auth = require(contract.authModule)
    const integrity = require(contract.integrityModule)
    const nativeFetch = require(contract.fetchModule).b
    if (
      typeof request?.getRequestTarget !== 'function' ||
      typeof request?.safePost !== 'function' ||
      typeof auth.loadBrowserChatGptAuth !== 'function' ||
      typeof auth.getBrowserChatGptAuthSnapshot !== 'function' ||
      typeof auth.isSameBrowserRequestAuthContext !== 'function' ||
      typeof integrity.f !== 'function' ||
      typeof integrity.b !== 'function' ||
      typeof nativeFetch !== 'function'
    ) {
      return failure(
        'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
        'The ChatGPT native transport API has changed.',
      )
    }
    const identity = await auth.loadBrowserChatGptAuth()
    checkDeadline()
    if (!identity?.accessToken || !identity.userId || !identity.accountId) {
      return failure('UNAUTHORIZED', 'Sign in to ChatGPT in the proxy tab first.')
    }
    const expectedIdentity = { accountId: identity.accountId, userId: identity.userId }
    const assertCurrent = () => {
      const current = auth.getBrowserChatGptAuthSnapshot()
      if (
        !current ||
        auth.isBrowserWorkspaceSwitchPending?.() ||
        current.accountId !== identity.accountId ||
        current.userId !== identity.userId ||
        !auth.isSameBrowserRequestAuthContext(identity.accessToken, current.accessToken)
      ) {
        throw new Error('ChatGPT account or session changed. Retry in the current account.')
      }
    }
    assertCurrent()
    const channel = crypto.randomUUID()
    const active = new Map()
    let submitted = false
    let closed = false
    let idleTimer
    const emit = (id, type, data = {}) =>
      window.postMessage(
        { source: 'chatgptbox-native-response', channel, id, type, ...data },
        location.origin,
      )
    const close = () => {
      closed = true
      clearTimeout(idleTimer)
      window.removeEventListener('message', receive)
      window.removeEventListener('pagehide', close)
      for (const controller of active.values()) controller.abort()
      active.clear()
    }
    const armExpiry = () => {
      clearTimeout(idleTimer)
      if (!closed && active.size === 0) idleTimer = setTimeout(close, 60000)
    }
    async function finalizedHeaders(signal) {
      const options = {
        signal,
        expectedIdentity,
        assertRequestCurrent: assertCurrent,
        retry: 'never',
        additionalHeaders: { 'ChatGPT-Account-ID': identity.accountId },
      }
      const prepared = await integrity.f((p) =>
        request.safePost('/sentinel/chat-requirements/prepare', {
          ...options,
          requestBody: { p },
        }),
      )
      signal.throwIfAborted()
      assertCurrent()
      const req = prepared?.chatRequirements
      const isToken = (value) => typeof value === 'string' && value.trim().length > 0
      if (
        !isToken(req?.prepare_token) ||
        req.force_login ||
        (req.proofofwork?.required && !isToken(prepared.proofToken)) ||
        ((req.turnstile?.required || req.turnstile?.dx) && !isToken(prepared.turnstileToken)) ||
        /Turnstile-(?:Internal|Client)-Error/.test(prepared.turnstileToken || '')
      ) {
        throw new Error('ChatGPT browser verification is incomplete.')
      }
      const finalized = await request.safePost('/sentinel/chat-requirements/finalize', {
        ...options,
        requestBody: {
          prepare_token: req.prepare_token,
          proofofwork: prepared.proofToken ?? undefined,
          turnstile: prepared.turnstileToken ?? undefined,
        },
      })
      signal.throwIfAborted()
      assertCurrent()
      if (!isToken(finalized?.token) || finalized.force_login)
        throw new Error('ChatGPT browser verification was not finalized.')
      return integrity.b({ ...req, ...finalized }, prepared.proofToken, prepared.turnstileToken)
    }
    async function receive(event) {
      const message = event.data
      if (
        closed ||
        event.source !== window ||
        event.origin !== location.origin ||
        message?.source !== 'chatgptbox-native-request' ||
        message.channel !== channel
      )
        return
      if (message.type === 'close') {
        close()
        return
      }
      const { id } = message
      if (typeof id !== 'string' || id.length > 100) return
      if (message.type === 'abort') {
        active.get(id)?.abort()
        return
      }
      if (message.type !== 'fetch' || active.has(id)) return
      const controller = new AbortController()
      active.set(id, controller)
      clearTimeout(idleTimer)
      let reader
      try {
        const target = new URL(message.url)
        const method = message.method || 'GET'
        const path = target.pathname
        const postAllowed = [
          '/backend-api/f/conversation',
          '/backend-api/f/conversation/prepare',
          '/backend-api/f/conversation/resume',
          '/backend-api/conversation/init',
          '/backend-api/stop_conversation',
        ].includes(path)
        const getAllowed =
          /^\/backend-api\/(?:models|tpp\/models\/?|conversations(?:\/[^/]+(?:\/messages)?)?|conversation\/[^/]+|files\/[^/]+\/download)$/.test(
            path,
          )
        if (
          target.origin !== location.origin ||
          target.username ||
          target.password ||
          target.hash ||
          !(
            (method === 'POST' && postAllowed && !target.search) ||
            (method === 'GET' && getAllowed)
          )
        ) {
          throw new Error('Unsupported ChatGPT native request.')
        }
        assertCurrent()
        const additionalHeaders = { 'ChatGPT-Account-ID': identity.accountId }
        const inputHeaders = new Headers(message.headers)
        const conduit = inputHeaders.get('x-conduit-token')
        if (conduit) additionalHeaders['X-Conduit-Token'] = conduit
        if (path === '/backend-api/f/conversation') {
          if (submitted) throw new Error('This ChatGPT request was already dispatched.')
          submitted = true
          Object.assign(additionalHeaders, await finalizedHeaders(controller.signal))
        }
        const nativeTarget = request.getRequestTarget(
          path.slice('/backend-api'.length) + target.search,
          { additionalHeaders },
        )
        const response = await nativeFetch(
          nativeTarget.url,
          {
            method,
            headers: nativeTarget.headers,
            body: method === 'POST' ? message.body : undefined,
            signal: controller.signal,
            expectedIdentity,
            retry: 'never',
          },
          undefined,
          assertCurrent,
          path.startsWith('/backend-api/f/conversation') && !path.endsWith('/prepare')
            ? 'stream'
            : 'request',
        )
        controller.signal.throwIfAborted()
        emit(id, 'headers', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(
            [...response.headers].filter(([key]) =>
              ['content-type', 'x-conduit-token', 'retry-after'].includes(key),
            ),
          ),
        })
        reader = response.body?.getReader()
        if (reader) {
          const cancel = () => {
            void reader.cancel().catch(() => {})
          }
          controller.signal.addEventListener('abort', cancel, { once: true })
          try {
            while (!controller.signal.aborted) {
              const chunk = await reader.read()
              controller.signal.throwIfAborted()
              if (chunk.done) break
              emit(id, 'chunk', { bytes: Array.from(chunk.value) })
            }
            controller.signal.throwIfAborted()
          } finally {
            controller.signal.removeEventListener('abort', cancel)
          }
        }
        emit(id, 'end')
      } catch {
        // Native exceptions may contain credentials or response bodies.
        emit(id, 'error', {
          aborted: controller.signal.aborted,
          message:
            'ChatGPT native request failed. Check the proxy tab login and browser verification.',
        })
      } finally {
        if (reader) {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        active.delete(id)
        armExpiry()
      }
    }
    window.addEventListener('message', receive)
    window.addEventListener('pagehide', close, { once: true })
    armExpiry()
    return {
      ok: true,
      profile: contract.profile,
      transport: 'native',
      channel,
      baseHeaders: {},
      integrityHeaders: {},
    }
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
  if (context.transport === 'native') {
    if (conduitToken) headers.set('X-Conduit-Token', conduitToken)
    return Object.fromEntries(headers)
  }
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
