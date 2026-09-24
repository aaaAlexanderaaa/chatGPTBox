import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import Browser from 'webextension-polyfill'
import {
  CHATGPT_WEB_INTEGRITY_RUNTIMES as contracts,
  getChatgptWebPageIntegrityInPage,
  getChatgptWebPageIntegrity,
  buildChatgptWebPageHeaders,
} from '../src/services/clients/chatgpt-web/page-integrity.mjs'
import { getChatgptWebPageIntegrityForSender } from '../src/background/chatgpt-page-integrity.mjs'

const [contract, latestContract] = contracts
const scriptUrl = `https://cdn.oaistatic.com/assets/${contract.filename}`
const baseHeaders = {
  Authorization: 'Bearer live-page-token',
  'OAI-Session-Id': 'live-page-session',
  'OAI-Device-Id': 'live-device',
  'ChatGPT-Account-ID': 'live-workspace',
  'OAI-Client-Version': 'live-build',
}

function nativeRuntime(requirements = {}, selected = contract) {
  const value = {
    token: 'fresh-finalized-token',
    proofofwork: { required: true },
    turnstile: { required: true },
    ...requirements,
  }
  return {
    [selected.finalize]: vi.fn(async () => value),
    [selected.proof]: {
      getEnforcementTokenSync: vi.fn(() => null),
      getEnforcementToken: vi.fn(async () => 'native-proof'),
    },
    [selected.turnstile]: {
      getEnforcementTokenSync: vi.fn(() => null),
      getEnforcementToken: vi.fn(async () => 'native-turnstile'),
    },
    [selected.authHeaders]: vi.fn(() => ({ ...baseHeaders })),
    [selected.integrityHeaders]: vi.fn((req, turnstile, proof) => ({
      'OpenAI-Sentinel-Chat-Requirements-Token': req.token,
      'OpenAI-Sentinel-Turnstile-Token': turnstile,
      'OpenAI-Sentinel-Proof-Token': proof,
    })),
  }
}

beforeEach(() => {
  const win = {}
  win.top = win
  vi.stubGlobal('window', win)
  vi.stubGlobal('location', { origin: 'https://chatgpt.com' })
  vi.stubGlobal('document', { scripts: [{ src: scriptUrl }], querySelectorAll: () => [] })
  vi.stubGlobal('performance', { getEntriesByType: () => [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatGPT native request integrity', () => {
  it('uses finalized native verification and the same page identity, without submitting a question', async () => {
    const runtime = nativeRuntime()
    const load = vi.fn(async () => runtime)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await getChatgptWebPageIntegrityInPage(contracts, load)
    expect(result).toMatchObject({
      ok: true,
      baseHeaders: {
        authorization: 'Bearer live-page-token',
        'oai-session-id': 'live-page-session',
      },
      integrityHeaders: {
        'OpenAI-Sentinel-Chat-Requirements-Token': 'fresh-finalized-token',
        'OpenAI-Sentinel-Turnstile-Token': 'native-turnstile',
        'OpenAI-Sentinel-Proof-Token': 'native-proof',
      },
    })
    expect(load).toHaveBeenCalledWith(scriptUrl)
    expect(runtime[contract.finalize]).toHaveBeenCalledWith(false, 'none')
    expect(runtime[contract.proof].getEnforcementToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fresh-finalized-token' }),
      { forceSync: true },
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['unknown-build', 'untrusted-host', 'different-origin', 'subframe'])(
    'refuses %s before loading or invoking page code',
    async (failure) => {
      if (failure === 'unknown-build')
        document.scripts[0].src = scriptUrl.replace(contract.filename, 'unknown.js')
      if (failure === 'untrusted-host')
        document.scripts[0].src = scriptUrl.replace('cdn.oaistatic.com', 'example.com')
      if (failure === 'different-origin') location.origin = 'https://example.com'
      if (failure === 'subframe') window.top = {}
      const load = vi.fn()
      expect(await getChatgptWebPageIntegrityInPage(contracts, load)).toMatchObject({ ok: false })
      expect(load).not.toHaveBeenCalled()
    },
  )

  it('finds an already-loaded dynamic import through resource timing', async () => {
    document.scripts = []
    performance.getEntriesByType = () => [{ name: scriptUrl }]
    expect(
      await getChatgptWebPageIntegrityInPage(contracts, async () => nativeRuntime()),
    ).toMatchObject({ ok: true })
  })

  it('uses the new auth export only for the newly verified page release', async () => {
    const url = `https://chatgpt.com/cdn/assets/${latestContract.filename}`
    document.scripts[0].src = url
    const runtime = nativeRuntime({}, latestContract)
    const load = vi.fn(async () => runtime)
    expect(await getChatgptWebPageIntegrityInPage(contracts, load)).toMatchObject({ ok: true })
    expect(load).toHaveBeenCalledWith(url)
    expect(runtime[latestContract.authHeaders]).toHaveBeenCalledTimes(2)
  })

  it('reuses the native challenge results finalized for this exact requirements object', async () => {
    const runtime = nativeRuntime()
    runtime[contract.proof].getEnforcementTokenSync.mockReturnValue('finalized-proof')
    runtime[contract.turnstile].getEnforcementTokenSync.mockReturnValue('finalized-turnstile')
    const result = await getChatgptWebPageIntegrityInPage(contracts, async () => runtime)
    expect(result.integrityHeaders).toMatchObject({
      'OpenAI-Sentinel-Proof-Token': 'finalized-proof',
      'OpenAI-Sentinel-Turnstile-Token': 'finalized-turnstile',
    })
    expect(runtime[contract.proof].getEnforcementToken).not.toHaveBeenCalled()
    expect(runtime[contract.turnstile].getEnforcementToken).not.toHaveBeenCalled()
  })

  it('rejects pages with conflicting supported releases rather than mixing identities', async () => {
    document.scripts.push({ src: scriptUrl.replace(contract.filename, latestContract.filename) })
    const load = vi.fn()
    expect(await getChatgptWebPageIntegrityInPage(contracts, load)).toMatchObject({
      ok: false,
      code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
    })
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    { token: undefined, prepare_token: 'prepared-only' },
    { token: '' },
    { force_login: true },
  ])('does not accept an unfinalized or login-required state: %j', async (requirements) => {
    const runtime = nativeRuntime(requirements)
    expect(await getChatgptWebPageIntegrityInPage(contracts, async () => runtime)).toMatchObject({
      ok: false,
    })
    expect(runtime[contract.integrityHeaders]).not.toHaveBeenCalled()
  })

  it.each([
    'missing-proof',
    'missing-turnstile',
    'turnstile-error',
    'account-change',
    'native-error',
  ])('does not return sendable headers after %s', async (failure) => {
    const runtime = nativeRuntime()
    if (failure === 'missing-proof')
      runtime[contract.proof].getEnforcementToken.mockResolvedValue(null)
    if (failure === 'missing-turnstile')
      runtime[contract.turnstile].getEnforcementToken.mockResolvedValue(null)
    if (failure === 'turnstile-error')
      runtime[contract.turnstile].getEnforcementToken.mockResolvedValue(
        '{"Turnstile-Client-Error":"test"}',
      )
    if (failure === 'account-change')
      runtime[contract.authHeaders]
        .mockReturnValueOnce(baseHeaders)
        .mockReturnValue({ ...baseHeaders, 'ChatGPT-Account-ID': 'other-workspace' })
    if (failure === 'native-error')
      runtime[contract.finalize].mockRejectedValue(new Error('secret response token'))
    const result = await getChatgptWebPageIntegrityInPage(contracts, async () => runtime)
    expect(result).toMatchObject({ ok: false })
    expect(result).not.toHaveProperty('integrityHeaders')
    expect(JSON.stringify(result)).not.toContain('secret response token')
  })

  it('times out a native verification that does not finish', async () => {
    vi.useFakeTimers()
    const runtime = nativeRuntime()
    runtime[contract.finalize].mockReturnValue(new Promise(() => {}))
    const pending = getChatgptWebPageIntegrityInPage(contracts, async () => runtime)
    await vi.advanceTimersByTimeAsync(45000)
    expect(await pending).toMatchObject({ ok: false, code: 'CHATGPT_WEB_INTEGRITY_TIMEOUT' })
  })

  it('matches the exact native exports in the checked-in reference release', () => {
    const source = fs.readFileSync(
      new URL(`../resources/chatgpt-web/current/${contract.filename}`, import.meta.url),
      'utf8',
    )
    for (const [local, exported] of [
      ['$Yt', contract.finalize],
      ['s2', contract.proof],
      ['A2', contract.turnstile],
      ['wl', contract.authHeaders],
      ['I2', contract.integrityHeaders],
    ]) {
      expect(source).toContain(`${local} as ${exported}`)
    }
    expect(source).toContain('/sentinel/chat-requirements/prepare')
    expect(source).toContain('/sentinel/chat-requirements/finalize')
  })

  it('matches the new native exports in the browser-observed release', () => {
    const source = fs.readFileSync(
      new URL(`../resources/chatgpt-web/integrity/${latestContract.filename}`, import.meta.url),
      'utf8',
    )
    for (const [local, exported] of [
      ['pXt', latestContract.finalize],
      ['c2', latestContract.proof],
      ['j2', latestContract.turnstile],
      ['bl', latestContract.authHeaders],
      ['L2', latestContract.integrityHeaders],
    ])
      expect(source).toContain(`${local} as ${exported}`)
    expect(source).toContain('/sentinel/chat-requirements/prepare')
    expect(source).toContain('/sentinel/chat-requirements/finalize')
  })
})

describe('ChatGPT integrity bridge boundaries', () => {
  const sender = {
    id: Browser.runtime.id,
    frameId: 0,
    tab: { id: 42 },
    url: 'https://chatgpt.com/?chatgptbox_proxy=1',
    documentId: 'document-1',
  }

  it('targets only the requesting top-level document in MAIN world', async () => {
    const execute = vi
      .spyOn(Browser.scripting, 'executeScript')
      .mockResolvedValue([{ result: { ok: true } }])
    expect(await getChatgptWebPageIntegrityForSender(sender)).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42, documentIds: ['document-1'] },
        world: 'MAIN',
        args: [contracts],
        func: getChatgptWebPageIntegrityInPage,
      }),
    )
  })

  it.each([
    { ...sender, id: 'other-extension' },
    { ...sender, frameId: 1 },
    { ...sender, url: 'https://example.com' },
    { ...sender, tab: undefined },
  ])('denies untrusted senders', async (untrusted) => {
    const execute = vi.spyOn(Browser.scripting, 'executeScript')
    expect(await getChatgptWebPageIntegrityForSender(untrusted)).toMatchObject({ ok: false })
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not send page credentials to a custom endpoint', async () => {
    const send = vi.spyOn(Browser.runtime, 'sendMessage')
    await expect(
      getChatgptWebPageIntegrity({
        apiUrl: 'https://example.com',
        apiPath: '/backend-api/f/conversation',
      }),
    ).rejects.toThrow('official')
    expect(send).not.toHaveBeenCalled()
  })

  it('honors cancellation while the page is still completing verification', async () => {
    vi.spyOn(Browser.runtime, 'sendMessage').mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const pending = getChatgptWebPageIntegrity({
      apiUrl: 'https://chatgpt.com',
      apiPath: '/backend-api/f/conversation',
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uses page identity on all requests and includes integrity only on submission', () => {
    const context = {
      baseHeaders,
      integrityHeaders: { 'OpenAI-Sentinel-Chat-Requirements-Token': 'secret' },
    }
    for (const path of [
      '/backend-api/f/conversation',
      '/backend-api/f/conversation/prepare',
      '/backend-api/f/conversation/resume',
    ]) {
      const submitting = path.endsWith('/f/conversation')
      const headers = new Headers(
        buildChatgptWebPageHeaders(context, {
          apiPath: path,
          integrity: submitting,
          turnTraceId: 'trace',
        }),
      )
      expect(headers.get('oai-session-id')).toBe('live-page-session')
      expect(headers.get('chatgpt-account-id')).toBe('live-workspace')
      expect(headers.get('oai-client-version')).toBe('live-build')
      expect(headers.has('openai-sentinel-chat-requirements-token')).toBe(submitting)
      expect(headers.get('x-openai-target-route')).toBe(path)
    }
  })
})
