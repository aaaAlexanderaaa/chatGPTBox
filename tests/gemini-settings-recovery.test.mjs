import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/config/storage.mjs'
import { RuntimeMessage } from '../src/protocol/messages.mjs'

let Browser, service, runtime, router, stored, review, run
const api = { kind: 'api', principal: 'gateway-api' }
const request = {
  contractVersion: 1,
  engineId: 'geminiweb',
  operation: 'generation.start',
  input: { prompt: 'A new controlled question' },
}
const record = (engineId) => ({
  runId: `${engineId}-old`,
  fingerprint: `protected-${engineId}`,
  engineId,
  modelId: 'original-model',
  principal: 'gateway-api',
  operation: 'generation.start',
  phase: 'settled',
  submission: 'possibly_submitted',
  outcome: 'unknown',
  cancellation: 'none',
  revision: 3,
  resolved: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  conversationRef: `${engineId}-binding`,
  conversationRevision: 0,
})
const settingsSender = () => ({
  id: Browser.runtime.id,
  url: Browser.runtime.getURL('/options.html'),
})
const allow = (acknowledgeUnverified = false, sender = settingsSender()) =>
  router({ type: RuntimeMessage.GeminiWebReview, data: { acknowledgeUnverified } }, sender)

beforeEach(async () => {
  vi.resetModules()
  Browser = (await import('webextension-polyfill')).default
  service = (await import('../src/background/gemini-web-service.mjs')).geminiWebService
  const records = ['geminiweb', 'grokweb'].map(record)
  for (const suffix of ['two', 'three'])
    records.push({
      ...record('geminiweb'),
      runId: `geminiweb-${suffix}`,
      conversationRef: `binding-${suffix}`,
    })
  stored = {
    ...structuredClone(defaultConfig),
    providerSchemaVersion: 2,
    apiServerEnabled: true,
    geminiWebEnabled: true,
    geminiWebReady: true,
    engineExposureVersion: 1,
    engineExposure: {
      geminiweb: { externalEnabled: true, operations: ['generation.start'] },
    },
    engineRuntimeV1: {
      version: 1,
      installationId: 'original-installation',
      runs: Object.fromEntries(records.map((value) => [value.runId, value])),
      protections: Object.fromEntries(records.map((value) => [value.runId, value])),
      bindings: Object.fromEntries(
        records.map((value) => [
          value.conversationRef,
          { ref: value.conversationRef, pendingRunId: value.runId },
        ]),
      ),
      leases: Object.fromEntries(
        records.map((value) => [
          value.engineId === 'geminiweb' && value.runId !== 'geminiweb-old'
            ? `engine:geminiweb#${value.runId}`
            : `engine:${value.engineId}`,
          { runId: value.runId },
        ]),
      ),
    },
  }
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (query) => {
    if (typeof query === 'string') return { [query]: structuredClone(stored[query]) }
    const keys = Array.isArray(query) ? query : Object.keys(query)
    return {
      ...(Array.isArray(query) ? {} : query),
      ...Object.fromEntries(
        keys.filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])]),
      ),
    }
  })
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) => {
    Object.assign(stored, structuredClone(patch))
  })
  Browser.runtime.getPlatformInfo = vi.fn(async () => ({ os: 'controlled' }))
  review = vi.spyOn(service, 'review').mockResolvedValue({ ok: true, ready: true, hold: false })
  run = vi.spyOn(service, 'run').mockImplementation(async ({ session, port }) => {
    port.postMessage({ accepted: true, started: true, session })
    port.postMessage({
      done: true,
      outcome: 'completed',
      answer: '<p>Controlled final answer</p>',
      finalContent: '<p>Controlled final answer</p>',
      session,
    })
  })
  runtime = (await import('../src/engines/browser-runtime.mjs')).engineRuntime()
  router = (await import('../src/background/message-router.mjs')).createMessageRouter()
})
afterEach(() => vi.restoreAllMocks())

it('releases the common Gemini lease from its settings button without replaying or resolving the old outcome', async () => {
  await expect(runtime.invoke(request, api)).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
  expect(await allow()).toEqual({ ok: true, ready: true, hold: false })
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ acknowledgeUnverified: false }))
  expect(run).not.toHaveBeenCalled()
  expect(stored.engineRuntimeV1.protections['geminiweb-old']).toMatchObject({
    outcome: 'unknown',
    submission: 'possibly_submitted',
    resolved: true,
    disposition: { kind: 'user-reviewed-outcome-unconfirmed' },
  })
  expect(stored.engineRuntimeV1.leases).toEqual({
    'engine:grokweb': { runId: 'grokweb-old' },
  })
  expect(stored.engineRuntimeV1.bindings).not.toHaveProperty('geminiweb-binding')
  expect(stored.engineRuntimeV1.protections['grokweb-old'].resolved).toBe(false)
  const receipt = await runtime.invoke(request, api)
  expect(await runtime.wait(receipt.runId, api)).toMatchObject({ outcome: 'completed' })
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0][0].session.question).toBe(request.input.prompt)
})

it('retains the common lease until the native review and required acknowledgement succeed', async () => {
  const acknowledgement = {
    ok: false,
    ready: true,
    hold: true,
    needsUnverifiedAcknowledgement: true,
  }
  review.mockResolvedValueOnce(acknowledgement)
  expect(await allow()).toEqual(acknowledgement)
  await expect(runtime.invoke(request, api)).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
  expect(stored.engineRuntimeV1.protections['geminiweb-old'].resolved).toBe(false)
  expect(await allow(true)).toMatchObject({ ok: true, hold: false })
  expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ acknowledgeUnverified: true }))
  expect(stored.engineRuntimeV1.leases).not.toHaveProperty('engine:geminiweb')
  expect(run).not.toHaveBeenCalled()
})

it('keeps both the old outcome and its lease when the native page refuses review', async () => {
  review.mockRejectedValue(new Error('Finish the active Gemini turn first.'))
  expect(await allow()).toEqual({
    ok: false,
    ready: false,
    message: 'Finish the active Gemini turn first.',
  })
  await expect(runtime.invoke(request, api)).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
  expect(stored.engineRuntimeV1.protections['geminiweb-old'].resolved).toBe(false)
  expect(run).not.toHaveBeenCalled()
})

it('refuses review while the common owner is still observing a new execution', async () => {
  await allow()
  review.mockClear()
  let release
  const finishedRun = run.getMockImplementation()
  run.mockImplementation(async (args) => {
    await new Promise((resolve) => {
      release = resolve
    })
    await finishedRun(args)
  })
  const receipt = await runtime.invoke(request, api)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  try {
    expect(await allow()).toMatchObject({
      ok: false,
      ready: false,
      message: expect.stringContaining('active observation'),
    })
    expect(review).not.toHaveBeenCalled()
    expect(stored.engineRuntimeV1.leases[`engine:geminiweb#${receipt.runId}`].runId).toBe(
      receipt.runId,
    )
  } finally {
    release()
    await runtime.wait(receipt.runId, api)
  }
})

it('does not let the API bridge or an ordinary website release the engine protection', async () => {
  expect(
    await allow(true, { ...settingsSender(), url: Browser.runtime.getURL('ApiServer.html') }),
  ).toMatchObject({ ok: false, ready: false, message: expect.stringContaining('settings') })
  expect(review).not.toHaveBeenCalled()
  expect(() => allow(true, { ...settingsSender(), url: 'https://gemini.google.com/app' })).toThrow(
    'extension settings page',
  )
  await expect(runtime.invoke(request, api)).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
})
