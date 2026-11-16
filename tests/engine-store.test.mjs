import { describe, expect, it } from 'vitest'
import { createEngineStore } from '../src/engines/store.mjs'
import { ENGINE_RUN_STORAGE_KEY } from '../src/engines/contract.mjs'

function fixture(options = {}) {
  const persisted = {}
  let fail = false
  let instant = 100
  const storage = {
    get: async (key) => structuredClone({ [key]: persisted[key] }),
    set: async (value) => {
      if (fail) throw new Error('disk unavailable')
      Object.assign(persisted, structuredClone(value))
    },
  }
  const dependencies = { storage, uuid: () => 'installation-one', now: () => instant, ...options }
  return {
    persisted,
    storage,
    dependencies,
    store: createEngineStore(dependencies),
    fail: () => {
      fail = true
    },
    time: (value) => {
      instant = value
    },
  }
}
const args = (runId = 'run-one') => ({
  runId,
  fingerprint: `hash-${runId}`,
  engineId: 'synthetic',
  modelId: 'text',
  operation: 'generation.start',
  principal: 'api',
  leaseKeys: [],
})

describe('single background engine authority', () => {
  it('unions orphan native reservations with protected runs and keeps protection even if its lease is missing', async () => {
    const f = fixture()
    await f.store.claim({ ...args('old'), leaseKeys: ['engine:synthetic'] })
    await f.store.update('old', {
      phase: 'settled',
      submission: 'possibly_submitted',
      outcome: 'unknown',
    })
    await f.store.transaction((draft) => {
      draft.leases = {}
    })
    const capacity = {
      key: 'engine:synthetic',
      limit: 3,
      reservations: ['run:old', 'native:orphan'],
    }
    await f.store.claim({ ...args('new'), capacity })
    await expect(f.store.claim({ ...args('fourth'), capacity })).rejects.toMatchObject({
      code: 'ENGINE_BUSY',
    })
    expect(await f.store.get('old')).toMatchObject({ outcome: 'unknown', resolved: false })
  })

  it('atomically reserves three independent slots and refuses the fourth without a claim', async () => {
    const { store } = fixture()
    const capacity = { key: 'engine:synthetic', limit: 3 }
    const results = await Promise.allSettled(
      ['one', 'two', 'three', 'four'].map((id) => store.claim({ ...args(id), capacity })),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
    expect(results[3].reason).toMatchObject({ code: 'ENGINE_BUSY', dispatched: false })
    expect(await store.get('four')).toBeNull()
    expect((await store.claim({ ...args('one'), capacity })).existing).toBe(true)
    expect(Object.keys((await store.snapshot()).leases)).toHaveLength(3)
  })

  it('counts a legacy root lease as one slot across restart and releases only an exact resolved run', async () => {
    const f = fixture()
    await f.store.claim({ ...args('old'), leaseKeys: ['engine:synthetic'] })
    await f.store.update('old', { submission: 'possibly_submitted' })
    const restarted = createEngineStore(f.dependencies)
    const capacity = { key: 'engine:synthetic', limit: 3 }
    await restarted.claim({ ...args('two'), capacity })
    await restarted.claim({ ...args('three'), capacity })
    await expect(restarted.claim({ ...args('four'), capacity })).rejects.toMatchObject({
      code: 'ENGINE_BUSY',
    })
    expect(await restarted.get('old')).toMatchObject({ outcome: 'unknown', resolved: false })
    await restarted.update('two', { phase: 'settled', outcome: 'unknown' })
    await expect(restarted.claim({ ...args('four'), capacity })).rejects.toMatchObject({
      code: 'ENGINE_BUSY',
    })
    await restarted.update('two', { resolved: true }, { release: true, allowRecovery: true })
    await restarted.claim({ ...args('four'), capacity })
    expect((await restarted.snapshot()).leases['engine:synthetic'].runId).toBe('old')
  })

  it('keeps native conversation exclusion alongside shared engine capacity', async () => {
    const { store } = fixture()
    const capacity = { key: 'engine:synthetic', limit: 3 }
    await store.claim({
      ...args('one'),
      capacity,
      leaseKeys: ['conversation:synthetic:same-native-id'],
    })
    await expect(
      store.claim({
        ...args('alias'),
        capacity,
        leaseKeys: ['conversation:synthetic:same-native-id'],
      }),
    ).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
    await store.claim({
      ...args('different'),
      capacity,
      leaseKeys: ['conversation:synthetic:other-native-id'],
    })
    expect(await store.get('alias')).toBeNull()
  })

  it('retains prototype MCP runs, bindings and protection under the shared gateway principal', async () => {
    const f = fixture()
    await f.store.claim({ ...args(), principal: 'gateway-mcp', leaseKeys: ['engine:synthetic'] })
    await f.store.update(
      'run-one',
      { submission: 'possibly_submitted' },
      {
        binding: {
          ref: 'old-mcp-ref',
          principal: 'gateway-mcp',
          engineId: 'synthetic',
          revision: 0,
          updatedAt: 100,
          pendingRunId: 'run-one',
        },
      },
    )
    const restarted = createEngineStore(f.dependencies)
    expect(await restarted.get('run-one')).toMatchObject({
      principal: 'gateway-api',
      outcome: 'unknown',
      submission: 'possibly_submitted',
    })
    expect(await restarted.binding('old-mcp-ref')).toMatchObject({
      principal: 'gateway-api',
      pendingRunId: 'run-one',
    })
    expect((await restarted.claim({ ...args(), principal: 'gateway-api' })).existing).toBe(true)
    await expect(
      restarted.claim({ ...args('new'), leaseKeys: ['engine:synthetic'] }),
    ).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
  })
  it('holds a learned native conversation across alternative opaque references', async () => {
    const { store } = fixture()
    await store.claim(args())
    await store.update(
      'run-one',
      { submission: 'accepted' },
      {
        binding: {
          ref: 'first-ref',
          engineId: 'synthetic',
          principal: 'api',
          revision: 0,
          updatedAt: 100,
          nativeRef: { session: { conversationId: 'native-conversation' }, head: 'head' },
          pendingRunId: 'run-one',
        },
      },
    )
    await store.update('run-one', { phase: 'settled', outcome: 'unknown' })
    await expect(
      store.claim({
        ...args('another-ref-run'),
        leaseKeys: ['conversation:synthetic:native-conversation'],
      }),
    ).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
  })
  it('serializes duplicate claims, and only the first may execute', async () => {
    const { store } = fixture()
    const results = await Promise.all([store.claim(args()), store.claim(args())])
    expect(results.map((value) => value.existing)).toEqual([false, true])
    await expect(store.claim({ ...args(), fingerprint: 'different' })).rejects.toMatchObject({
      code: 'RUN_CONFLICT',
    })
  })

  it('does not acquire a second resource lease in concurrent requests', async () => {
    const { store } = fixture()
    const results = await Promise.allSettled([
      store.claim({ ...args('one'), leaseKeys: ['engine:synthetic'] }),
      store.claim({ ...args('two'), leaseKeys: ['engine:synthetic'] }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results[1].reason.code).toBe('ENGINE_BUSY')
  })

  it('keeps a tombstone after a result record is evicted', async () => {
    const { store, persisted } = fixture({ maxResults: 1 })
    for (const id of ['one', 'two']) {
      await store.claim(args(id))
      await store.update(
        id,
        { phase: 'settled', outcome: 'completed', submission: 'accepted', resolved: true },
        { release: true },
      )
    }
    expect(Object.keys(persisted[ENGINE_RUN_STORAGE_KEY].runs)).toHaveLength(1)
    expect((await store.claim(args('one'))).existing).toBe(true)
  })

  it('marks a worker orphan unknown and retains its lease across restart', async () => {
    const f = fixture()
    await f.store.claim({ ...args(), leaseKeys: ['engine:synthetic'] })
    await f.store.update('run-one', { submission: 'possibly_submitted' })
    const restarted = createEngineStore(f.dependencies)
    expect(await restarted.get('run-one')).toMatchObject({
      outcome: 'unknown',
      submission: 'possibly_submitted',
    })
    await expect(
      restarted.claim({ ...args('new'), leaseKeys: ['engine:synthetic'] }),
    ).rejects.toMatchObject({ code: 'ENGINE_BUSY' })
    f.time(1000000)
    expect((await restarted.claim(args())).existing).toBe(true)
  })

  it('refuses stale installation envelopes after storage reset', async () => {
    const f = fixture()
    await f.store.installation()
    delete f.persisted[ENGINE_RUN_STORAGE_KEY]
    const reset = createEngineStore({ ...f.dependencies, uuid: () => 'new-installation' })
    await expect(
      reset.claim({ ...args(), installationId: 'installation-one' }),
    ).rejects.toMatchObject({ code: 'INSTALLATION_CHANGED' })
    expect(Object.keys((await reset.snapshot()).protections)).toHaveLength(0)
  })

  it('fails closed when the protection write is not acknowledged', async () => {
    const f = fixture()
    await f.store.installation()
    f.fail()
    await expect(f.store.claim(args())).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(Object.keys(f.persisted[ENGINE_RUN_STORAGE_KEY].protections)).toHaveLength(0)
  })

  it('does not expire unresolved writes or evict protection at capacity', async () => {
    const f = fixture({ retentionMs: 10, maxProtected: 1 })
    await f.store.claim(args())
    await f.store.update('run-one', {
      phase: 'settled',
      submission: 'possibly_submitted',
      outcome: 'unknown',
    })
    f.time(100000)
    await expect(f.store.claim(args('next'))).rejects.toMatchObject({ code: 'ENGINE_CAPACITY' })
    expect((await f.store.claim(args())).existing).toBe(true)
  })
})
