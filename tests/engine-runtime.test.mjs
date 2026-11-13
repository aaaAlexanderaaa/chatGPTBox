import { describe, expect, it, vi } from 'vitest'
import { createEngineRuntime } from '../src/engines/runtime.mjs'
import { createEngineStore } from '../src/engines/store.mjs'
import { EngineError, EngineOperation as Op } from '../src/engines/contract.mjs'

const api = { kind: 'api', principal: 'gateway-api' }
const internal = { kind: 'extension', principal: 'extension-page', admin: true }
const request = (prompt = 'Exact material') => ({
  contractVersion: 1,
  engineId: 'fourth',
  operation: Op.Generate,
  input: { prompt },
})

function fixture({
  paused = false,
  failure = false,
  delayedAcceptance = false,
  conversationScope = false,
} = {}) {
  let serial = 0,
    writes = 0,
    cancels = 0,
    finish,
    accept
  const data = {}
  const config = { apiServerEnabled: true, fourthEnabled: true }
  const definition = {
    id: 'fourth',
    label: 'Fourth engine',
    enabledKey: 'fourthEnabled',
    defaultEnabled: false,
    operations: { [Op.Generate]: { implemented: true }, [Op.Append]: { implemented: true } },
    legacyExternalOperations: [Op.Generate, Op.Append],
    execution: { concurrencyScope: conversationScope ? 'conversation' : 'engine' },
  }
  let nativeHead = 'head-zero'
  const adapter = {
    describe: () => definition,
    resolveModel: () => 'chosen-model',
    status: async () => ({ state: 'ready' }),
    listModels: async () => ({ items: [{ id: 'chosen-model' }], source: 'synthetic' }),
    prepare: async (value, context) => {
      if (value.operation === Op.Append && context.nativeRef.head !== nativeHead)
        throw new EngineError('BINDING_CHANGED', 'The native head changed')
    },
    generate: async (_value, context) => {
      writes += 1
      if (failure) throw new Error('lost native stream')
      if (delayedAcceptance)
        await new Promise((resolve) => {
          accept = resolve
        })
      context.onCancel(() => {
        cancels += 1
      })
      await context.report({
        type: 'accepted',
        evidence: { kind: 'exact-response' },
        nativeRef: { head: nativeHead },
      })
      await context.report({ type: 'preview', output: { format: 'markdown', content: 'Preview' } })
      if (paused)
        await new Promise((resolve) => {
          finish = resolve
        })
      nativeHead = `head-${writes}`
      return {
        outcome: 'completed',
        submission: 'accepted',
        finalOutput: { format: 'markdown', content: 'Verified final' },
        nativeRef: { head: nativeHead },
      }
    },
  }
  adapter.append = adapter.generate
  const dependencies = {
    storage: {
      get: async (key) => structuredClone({ [key]: data[key] }),
      set: async (value) => Object.assign(data, structuredClone(value)),
    },
    uuid: () => `identity-${++serial}`,
  }
  const store = createEngineStore(dependencies)
  const runtime = createEngineRuntime({
    adapters: [adapter],
    store,
    uuid: dependencies.uuid,
    getConfig: async () => structuredClone(config),
    setConfig: async (patch) => Object.assign(config, structuredClone(patch)),
  })
  return {
    runtime,
    store,
    data,
    config,
    adapter,
    dependencies,
    accept: () => accept(),
    writes: () => writes,
    cancels: () => cancels,
    finish: () => finish(),
    setHead: (head) => {
      nativeHead = head
    },
  }
}

describe('common engine runtime', () => {
  it('reserves the actual native ID before POST even when two refs race and accepted is delayed', async () => {
    const f = fixture({ delayedAcceptance: true, conversationScope: true })
    const [left, right] = await Promise.all(
      ['left', 'right'].map((sessionId) =>
        f.runtime.importBinding(
          'fourth',
          {
            session: {
              conversationId: 'same-native-conversation',
              sessionId,
              modelName: 'fourth/chosen-model',
            },
            head: 'head-zero',
          },
          api,
        ),
      ),
    )
    const append = (conversation) => ({
      ...request('Append exactly once'),
      operation: Op.Append,
      conversation,
    })
    const first = await f.runtime.invoke(append(left), api)
    await vi.waitFor(() => expect(f.writes()).toBe(1))
    await expect(f.runtime.invoke(append(right), api)).rejects.toMatchObject({
      code: 'ENGINE_BUSY',
      dispatched: false,
    })
    f.accept()
    expect(await f.runtime.wait(first.runId, api)).toMatchObject({ outcome: 'completed' })
    expect(f.writes()).toBe(1)
  })
  it('does not send after cancellation while native preparation is still waiting', async () => {
    const f = fixture()
    let release,
      preparing = false
    f.adapter.prepare = async () => {
      preparing = true
      await new Promise((resolve) => {
        release = resolve
      })
    }
    const receipt = await f.runtime.invoke(request(), api)
    await vi.waitFor(() => expect(preparing).toBe(true))
    const execution = f.runtime.active(receipt.runId).execution
    await f.runtime.cancel(receipt.runId, api)
    release()
    await execution
    expect(f.writes()).toBe(0)
    expect(await f.runtime.read(receipt.runId, api)).toMatchObject({
      outcome: 'stopped',
      submission: 'not_attempted',
    })
  })
  it('reports final-body eviction and worker restart without replaying or inventing an answer', async () => {
    const f = fixture()
    let first
    for (let index = 0; index < 31; index++) {
      const receipt = await f.runtime.invoke(request(`Question ${index}`), api)
      first ||= receipt.runId
      await f.runtime.wait(receipt.runId, api)
    }
    expect(await f.runtime.read(first, api)).toMatchObject({
      outcome: 'completed',
      resultAvailability: 'unavailable',
    })
    expect(await f.runtime.read(first, api)).not.toHaveProperty('result')
    const restarted = createEngineRuntime({
      adapters: [f.adapter],
      store: createEngineStore(f.dependencies),
      getConfig: async () => f.config,
      setConfig: async () => {},
    })
    expect(await restarted.read(first, api)).toMatchObject({
      outcome: 'completed',
      resultAvailability: 'unavailable',
    })
    expect(f.writes()).toBe(31)
  })
  it('keeps fresh installations closed even if the transport is later enabled', async () => {
    const f = fixture()
    await f.runtime.initialize({ freshInstall: true })
    expect(f.config.engineExposure.fourth.externalEnabled).toBe(false)
    f.config.apiServerEnabled = true
    await expect(f.runtime.invoke(request(), api)).rejects.toMatchObject({
      code: 'EXTERNAL_ACCESS_DISABLED',
      dispatched: false,
    })
    expect(f.writes()).toBe(0)
  })
  it('runs an unknown fourth adapter through the same operations and exposes no native state', async () => {
    const f = fixture()
    const receipt = await f.runtime.invoke(request(), api)
    expect(receipt.submission).toBe('not_attempted')
    const final = await f.runtime.wait(receipt.runId, api)
    expect(final).toMatchObject({
      phase: 'settled',
      outcome: 'completed',
      submission: 'accepted',
      result: { content: 'Verified final' },
    })
    expect(final.conversationRef).toMatch(/^conversation-/)
    expect(final).not.toHaveProperty('nativeRef')
    expect(JSON.stringify(f.data)).not.toContain('Exact material')
    expect(JSON.stringify(f.data)).not.toContain('Verified final')
    expect(f.writes()).toBe(1)
  })

  it('returns the same protected run for duplicate envelopes without another native call', async () => {
    const f = fixture()
    const epoch = await f.runtime.installation()
    const args = { runId: 'stable-gateway-id', installationId: epoch }
    const [left, right] = await Promise.all([
      f.runtime.invoke(request(), api, args),
      f.runtime.invoke(request(), api, args),
    ])
    expect(left.runId).toBe(right.runId)
    await f.runtime.wait(left.runId, api)
    expect(f.writes()).toBe(1)
    await expect(f.runtime.invoke(request('changed input'), api, args)).rejects.toMatchObject({
      code: 'RUN_CONFLICT',
    })
  })

  it('checks actual native head before append instead of silently starting again', async () => {
    const f = fixture()
    const first = await f.runtime.invoke(request(), api)
    const final = await f.runtime.wait(first.runId, api)
    f.setHead('changed-on-website')
    const next = await f.runtime.invoke(
      {
        ...request('Follow up'),
        operation: Op.Append,
        conversation: { ref: final.conversationRef, expectedRevision: final.conversationRevision },
      },
      api,
    )
    expect(await f.runtime.wait(next.runId, api)).toMatchObject({
      outcome: 'failed',
      submission: 'not_attempted',
      error: { code: 'BINDING_CHANGED' },
    })
    expect(f.writes()).toBe(1)
  })

  it('does not promote a disconnected native stream or replay it', async () => {
    const f = fixture({ failure: true })
    const receipt = await f.runtime.invoke(request(), api)
    expect(await f.runtime.wait(receipt.runId, api)).toMatchObject({
      outcome: 'unknown',
      submission: 'possibly_submitted',
    })
    await expect(f.runtime.invoke(request('another request'), api)).rejects.toMatchObject({
      code: 'ENGINE_BUSY',
    })
    expect(f.writes()).toBe(1)
  })

  it('lets an authorized owner stop an existing run after external access closes, with one cancel', async () => {
    const f = fixture({ paused: true })
    const receipt = await f.runtime.invoke(request(), api)
    await f.runtime.wait(receipt.runId, api, { accepted: true })
    await f.runtime.setExposure('fourth', { externalEnabled: false }, internal)
    await expect(f.runtime.invoke(request('blocked'), api)).rejects.toMatchObject({
      code: 'EXTERNAL_ACCESS_DISABLED',
    })
    const waiting = f.runtime.active(receipt.runId).execution
    await Promise.all([f.runtime.cancel(receipt.runId, api), f.runtime.cancel(receipt.runId, api)])
    f.finish()
    await waiting
    expect(f.cancels()).toBe(1)
    expect(await f.runtime.read(receipt.runId, api)).toMatchObject({ outcome: 'stopped' })
    expect(await f.runtime.read(receipt.runId, api)).not.toHaveProperty('result')
  })

  it('shares external grants with MCP and keeps unrelated callers out of the run', async () => {
    const f = fixture()
    const run = await f.runtime.invoke(request(), { kind: 'mcp', principal: 'gateway-api' })
    await f.runtime.wait(run.runId, api)
    expect(await f.runtime.read(run.runId, api)).toMatchObject({ outcome: 'completed' })
    await expect(
      f.runtime.read(run.runId, { kind: 'extension', principal: 'content:1' }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_EXPOSED' })
    await expect(
      f.runtime.setExposure(
        'fourth',
        { externalEnabled: true },
        { kind: 'extension', principal: 'content-document' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_EXPOSED' })
  })

  it('preserves a newer completed append when recovering an older run', async () => {
    const f = fixture()
    f.adapter.recover = async () => ({
      outcome: 'completed',
      finalOutput: { format: 'markdown', content: 'Recovered first answer' },
    })
    const first = await f.runtime.wait((await f.runtime.invoke(request(), api)).runId, api)
    const append = (previous) => ({
      ...request('Follow up'),
      operation: Op.Append,
      conversation: {
        ref: previous.conversationRef,
        expectedRevision: previous.conversationRevision,
      },
    })
    const second = await f.runtime.wait((await f.runtime.invoke(append(first), api)).runId, api)
    await f.runtime.recover(first.runId, api)
    expect(await f.store.binding(second.conversationRef)).toMatchObject({
      revision: second.conversationRevision,
      nativeRef: { head: 'head-2' },
    })
    const third = await f.runtime.wait((await f.runtime.invoke(append(second), api)).runId, api)
    expect(third).toMatchObject({ outcome: 'completed', conversationRevision: 3 })
    expect(f.writes()).toBe(3)
  })

  it('preserves a newer active append and its revision during older-run recovery', async () => {
    const f = fixture()
    f.adapter.recover = async () => ({
      outcome: 'completed',
      finalOutput: { format: 'markdown', content: 'Recovered first answer' },
    })
    const first = await f.runtime.wait((await f.runtime.invoke(request(), api)).runId, api)
    let release
    f.adapter.append = async (value, context) => {
      await new Promise((resolve) => {
        release = resolve
      })
      return f.adapter.generate(value, context)
    }
    const second = await f.runtime.invoke(
      {
        ...request('Follow up'),
        operation: Op.Append,
        conversation: { ref: first.conversationRef, expectedRevision: first.conversationRevision },
      },
      api,
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.runtime.recover(first.runId, api)
    expect(await f.store.binding(first.conversationRef)).toMatchObject({
      pendingRunId: second.runId,
      revision: 1,
    })
    release()
    expect(await f.runtime.wait(second.runId, api)).toMatchObject({
      outcome: 'completed',
      conversationRevision: 2,
    })
  })

  it('retires the recovered run own binding so an unverified head cannot be appended', async () => {
    const f = fixture()
    f.adapter.recover = async () => ({
      outcome: 'completed',
      finalOutput: { format: 'markdown', content: 'Recovered answer' },
    })
    const first = await f.runtime.wait((await f.runtime.invoke(request(), api)).runId, api)
    const recovered = await f.runtime.recover(first.runId, api)
    expect(recovered.conversationRef).toBeNull()
    expect(await f.store.binding(first.conversationRef)).toBeNull()
  })
})
