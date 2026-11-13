import { ENGINE_RUN_STORAGE_KEY, EngineError } from './contract.mjs'

export const ENGINE_PROTECTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const ENGINE_MAX_PROTECTED_RUNS = 2000
export const ENGINE_MAX_FINISHED_RESULTS = 30
export const ENGINE_MAX_ACTIVE_RUNS = 32

const clone = (value) => structuredClone(value)

function validateState(value) {
  if (!value || value.version !== 1 || typeof value.installationId !== 'string')
    throw new Error('Unsupported engine state')
  for (const key of ['runs', 'protections', 'bindings', 'leases']) {
    if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))
      throw new Error(`Invalid engine ${key}`)
  }
  for (const [id, record] of Object.entries(value.protections)) {
    if (
      record.runId !== id ||
      typeof record.fingerprint !== 'string' ||
      typeof record.engineId !== 'string' ||
      typeof record.principal !== 'string' ||
      !Number.isFinite(record.createdAt) ||
      !Number.isFinite(record.updatedAt) ||
      !['not_attempted', 'possibly_submitted', 'accepted'].includes(record.submission)
    )
      throw new Error('Invalid engine protection record')
  }
  for (const [key, lease] of Object.entries(value.leases)) {
    if (!key || typeof lease?.runId !== 'string' || !value.protections[lease.runId])
      throw new Error('Invalid engine resource lease')
  }
}

// All callers in the sole background owner use this queue, including read,
// claim, lease, binding, recovery and settings disposition. There is no UI writer.
export function createEngineStore({
  storage,
  now = Date.now,
  uuid = () => globalThis.crypto.randomUUID(),
  maxProtected = ENGINE_MAX_PROTECTED_RUNS,
  maxResults = ENGINE_MAX_FINISHED_RESULTS,
  retentionMs = ENGINE_PROTECTION_RETENTION_MS,
} = {}) {
  let state
  let queue = Promise.resolve()
  let unavailable = false

  function storageError(cause) {
    return new EngineError(
      'STORAGE_UNAVAILABLE',
      `Engine protection state is unavailable: ${
        cause?.message || cause
      }. No new execution is allowed.`,
      {
        nextAction:
          'Inspect extension storage and unresolved runs; do not clear protection to retry.',
      },
    )
  }

  async function load() {
    if (unavailable) throw storageError('a previous storage operation failed')
    if (state) return state
    try {
      const stored = await storage.get(ENGINE_RUN_STORAGE_KEY)
      if (!stored || typeof stored !== 'object') throw new Error('Storage returned no state')
      const previous = stored[ENGINE_RUN_STORAGE_KEY]
      const initial =
        previous === undefined
          ? {
              version: 1,
              installationId: uuid(),
              runs: {},
              protections: {},
              bindings: {},
              leases: {},
            }
          : clone(previous)
      validateState(initial)
      // API and MCP share the gateway's authority. Preserve earlier runs and
      // bindings created by the prototype's separate MCP principal.
      for (const key of ['runs', 'protections', 'bindings'])
        for (const record of Object.values(initial[key]))
          if (record.principal === 'gateway-mcp') record.principal = 'gateway-api'
      for (const record of Object.values(initial.protections)) {
        if (record.phase === 'settled') continue
        record.phase = 'settled'
        record.outcome = record.submission === 'not_attempted' ? 'failed' : 'unknown'
        record.revision += 1
        record.updatedAt = now()
        record.error = {
          code: record.submission === 'not_attempted' ? 'ENGINE_INTERRUPTED' : 'RESULT_UNCERTAIN',
          message:
            'The background restarted before this execution was reconciled. It will not be resubmitted.',
          submission: record.submission,
          retryable: false,
        }
        record.resolved = record.submission === 'not_attempted'
        if (initial.runs[record.runId]) initial.runs[record.runId] = clone(record)
        if (record.submission === 'not_attempted') releaseLeases(initial, record.runId)
      }
      await storage.set({ [ENGINE_RUN_STORAGE_KEY]: initial })
      state = initial
      return state
    } catch (error) {
      unavailable = true
      throw storageError(error)
    }
  }

  function serialized(action) {
    const pending = queue.catch(() => {}).then(action)
    queue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }

  function releaseLeases(draft, runId) {
    for (const [key, lease] of Object.entries(draft.leases))
      if (lease.runId === runId) delete draft.leases[key]
    for (const binding of Object.values(draft.bindings))
      if (binding.pendingRunId === runId) binding.pendingRunId = null
  }

  function prune(draft) {
    const cutoff = now() - retentionMs
    for (const [id, record] of Object.entries(draft.protections)) {
      if (record.resolved === true && record.updatedAt < cutoff) {
        delete draft.protections[id]
        delete draft.runs[id]
      }
    }
    const finished = Object.values(draft.runs)
      .filter((run) => run.phase === 'settled')
      .sort((left, right) => right.updatedAt - left.updatedAt)
    for (const run of finished.slice(maxResults)) delete draft.runs[run.runId]
    for (const [ref, binding] of Object.entries(draft.bindings)) {
      if (
        !binding.pendingRunId &&
        binding.updatedAt < cutoff &&
        !Object.values(draft.protections).some((run) => run.conversationRef === ref)
      )
        delete draft.bindings[ref]
    }
  }

  function transaction(change) {
    return serialized(async () => {
      const current = await load()
      const draft = clone(current)
      const result = await change(draft)
      prune(draft)
      try {
        await storage.set({ [ENGINE_RUN_STORAGE_KEY]: draft })
        state = draft
      } catch (error) {
        unavailable = true
        throw storageError(error)
      }
      return clone(result)
    })
  }

  function read(select) {
    return serialized(async () => clone(select(await load())))
  }

  async function claim({
    runId,
    fingerprint,
    engineId,
    modelId,
    operation,
    principal,
    leaseKeys = [],
    installationId,
    conversation,
    parentRunId,
  }) {
    return transaction((draft) => {
      if (installationId && installationId !== draft.installationId)
        throw new EngineError(
          'INSTALLATION_CHANGED',
          'This request belongs to a different extension installation. It will not be dispatched.',
          { status: 409 },
        )
      const previous = draft.protections[runId]
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.principal !== principal)
          throw new EngineError(
            'RUN_CONFLICT',
            'This run ID is already protected for a different request.',
          )
        return { existing: true, record: previous }
      }
      prune(draft)
      if (Object.keys(draft.protections).length >= maxProtected)
        throw new EngineError(
          'ENGINE_CAPACITY',
          'Engine protection capacity is full. Existing runs remain protected.',
          { status: 503 },
        )
      if (
        Object.values(draft.protections).filter((run) => run.phase !== 'settled').length >=
        ENGINE_MAX_ACTIVE_RUNS
      )
        throw new EngineError(
          'ENGINE_BUSY',
          'The engine runtime has reached its active request limit. No request was queued.',
        )
      let binding
      if (conversation) {
        binding = draft.bindings[conversation.ref]
        if (!binding || binding.engineId !== engineId || binding.principal !== principal)
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'This conversation is unavailable to the authenticated caller.',
          )
        if (binding.revision !== conversation.expectedRevision || binding.pendingRunId)
          throw new EngineError(
            'BINDING_CHANGED',
            'The conversation changed or has an unresolved execution. Read it before appending.',
          )
      }
      for (const key of leaseKeys) {
        if (
          Object.entries(draft.leases).some(
            ([held, lease]) =>
              (held === key || held.startsWith(`${key}#`)) && lease.runId !== parentRunId,
          )
        )
          throw new EngineError(
            'ENGINE_BUSY',
            'This engine resource has an active or unresolved write. Inspect the existing execution.',
          )
      }
      const record = {
        runId,
        fingerprint,
        engineId,
        modelId,
        operation,
        principal,
        installationId: draft.installationId,
        phase: 'preparing',
        submission: 'not_attempted',
        outcome: null,
        cancellation: 'none',
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
        resolved: false,
        ...(conversation
          ? { conversationRef: conversation.ref, conversationRevision: binding.revision }
          : {}),
      }
      draft.runs[runId] = record
      draft.protections[runId] = clone(record)
      for (const key of leaseKeys) if (!draft.leases[key]) draft.leases[key] = { runId }
      if (binding) binding.pendingRunId = runId
      return { existing: false, record, binding }
    })
  }

  async function update(
    runId,
    patch,
    { release = false, binding, allowRecovery = false, retireBinding = false } = {},
  ) {
    return transaction((draft) => {
      const previous = draft.protections[runId]
      if (!previous)
        throw new EngineError('RESULT_UNAVAILABLE', 'This execution is no longer retained.')
      if (previous.phase === 'settled' && !allowRecovery) return previous
      const next = {
        ...previous,
        ...patch,
        runId,
        revision: previous.revision + 1,
        updatedAt: now(),
      }
      draft.protections[runId] = next
      draft.runs[runId] = clone(next)
      if (retireBinding && previous.conversationRef) {
        const currentBinding = draft.bindings[previous.conversationRef]
        if (
          currentBinding &&
          (currentBinding.pendingRunId === runId ||
            (!currentBinding.pendingRunId &&
              currentBinding.revision === previous.conversationRevision))
        )
          delete draft.bindings[previous.conversationRef]
      }
      if (binding) {
        const previousBinding = draft.bindings[binding.ref]
        if (previousBinding && binding.revision < previousBinding.revision)
          throw new EngineError(
            'BINDING_CHANGED',
            'A recovery cannot roll back the conversation head.',
          )
        draft.bindings[binding.ref] = clone(binding)
        const nativeId = binding.nativeRef?.session?.conversationId
        if (nativeId) draft.leases[`conversation:${next.engineId}:${nativeId}#${runId}`] = { runId }
      }
      if (release) releaseLeases(draft, runId)
      return next
    })
  }

  return {
    transaction,
    claim,
    update,
    installation: () => read((draft) => draft.installationId),
    get: (runId) => read((draft) => draft.protections[runId] || null),
    binding: (ref) => read((draft) => draft.bindings[ref] || null),
    snapshot: () => read((draft) => draft),
    releaseLeases,
  }
}
