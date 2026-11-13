import {
  ENGINE_CONTRACT_VERSION,
  EngineError,
  EngineOperation as Op,
  fingerprintEngineRequest,
  serializeEngineError,
  validateEngineRequest,
} from './contract.mjs'
import { engineIsEnabled, operationIsImplemented } from './catalog.mjs'
import {
  ENGINE_EXPOSURE_VERSION,
  assertEngineAdmission,
  assertRunAccess,
  migrateEngineExposure,
  normalizeEngineExposure,
  effectiveEngineOperations,
} from './policy.mjs'
import { ENGINE_MAX_FINISHED_RESULTS } from './store.mjs'

const copy = (value) => structuredClone(value)
const content = (value) =>
  value &&
  ['text', 'markdown', 'safe-html'].includes(value.format) &&
  typeof value.content === 'string' &&
  value.content.trim()
const readMethods = {
  [Op.ReadConversation]: 'readConversation',
  [Op.ListConversations]: 'listConversations',
}

export function createEngineRuntime({
  adapters,
  store,
  getConfig,
  setConfig,
  now = Date.now,
  uuid = () => globalThis.crypto.randomUUID(),
  maxResults = ENGINE_MAX_FINISHED_RESULTS,
  onActivity = () => {},
} = {}) {
  const registry = new Map()
  const active = new Map()
  const output = new Map()
  const subscriptions = new Map()
  const lastPublished = new Map()
  const sequences = new Map()
  const recoveries = new Map()
  const degradedRuns = new Map()
  let configQueue = Promise.resolve()

  for (const adapter of adapters) {
    const definition = adapter.describe()
    if (!definition?.id || registry.has(definition.id) || typeof adapter.generate !== 'function')
      throw new Error('Engine adapters require unique IDs and generate methods')
    for (const [operation, method] of Object.entries({
      [Op.Append]: 'append',
      ...readMethods,
      [Op.RecoverRun]: 'recover',
    })) {
      if (definition.operations?.[operation]?.implemented && typeof adapter[method] !== 'function')
        throw new Error(`${definition.id} declares ${operation} without ${method}`)
    }
    registry.set(definition.id, { adapter, definition })
  }

  function serialConfig(action) {
    const task = configQueue.catch(() => {}).then(action)
    configQueue = task.then(
      () => {},
      () => {},
    )
    return task
  }

  async function config({ freshInstall = false } = {}) {
    return serialConfig(async () => {
      const value = await getConfig()
      if (value.engineExposureVersion === ENGINE_EXPOSURE_VERSION) return value
      const patch = migrateEngineExposure(
        freshInstall ? { ...value, apiServerEnabled: false } : value,
        [...registry.values()].map((entry) => entry.definition),
      )
      await setConfig(patch)
      return { ...value, ...patch }
    })
  }

  function entry(id) {
    const value = registry.get(id)
    if (!value) throw new EngineError('ENGINE_NOT_FOUND', `Unknown engine: ${id}.`)
    return value
  }

  function trimOutput() {
    const finished = [...output.entries()].filter(([id]) => !active.has(id))
    for (const [id] of finished.slice(0, Math.max(0, finished.length - maxResults)))
      output.delete(id)
  }

  function snapshot(record) {
    const saved = output.get(record.runId)
    const value = {
      contractVersion: ENGINE_CONTRACT_VERSION,
      runId: record.runId,
      engineId: record.engineId,
      modelId: record.modelId,
      operation: record.operation,
      revision: record.revision,
      sequence: sequences.get(record.runId) || 0,
      phase: record.phase,
      submission: record.submission,
      outcome: record.outcome,
      cancellation: record.cancellation,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      resultAvailability:
        record.outcome === 'completed' && saved?.result
          ? 'available'
          : registry.get(record.engineId)?.adapter.recover && record.nativeRef
          ? 'recoverable'
          : 'unavailable',
    }
    for (const key of ['conversationRef', 'conversationRevision', 'error', 'recovery'])
      if (record[key] !== undefined) value[key] = copy(record[key])
    if (saved?.preview) value.preview = copy(saved.preview)
    if (record.outcome === 'completed' && saved?.result) value.result = copy(saved.result)
    return value
  }

  function publish(record, preview = false) {
    if (!preview && lastPublished.get(record.runId) === record.revision) return
    lastPublished.set(record.runId, record.revision)
    sequences.set(record.runId, (sequences.get(record.runId) || 0) + 1)
    const value = snapshot(record)
    for (const listener of subscriptions.get(record.runId) || []) {
      try {
        listener(copy(value))
      } catch {
        /* an observer cannot stop execution */
      }
    }
  }

  async function ownedRun(runId, caller) {
    const record = await store.get(runId)
    if (!record)
      throw new EngineError(
        'RESULT_UNAVAILABLE',
        'This run is unknown or its protection has expired.',
      )
    assertRunAccess(record, caller)
    return record
  }

  async function bindReference(record, nativeRef, { completed = false } = {}) {
    if (!nativeRef) return {}
    const reference = record.conversationRef || `conversation-${uuid()}`
    const previous = await store.binding(reference)
    const revision = completed ? (previous?.revision || 0) + 1 : previous?.revision || 0
    return {
      patch: {
        nativeRef: copy(nativeRef),
        conversationRef: reference,
        conversationRevision: revision,
      },
      binding: {
        ref: reference,
        engineId: record.engineId,
        modelId: record.modelId,
        principal: record.principal,
        revision,
        nativeRef: copy(nativeRef),
        updatedAt: now(),
        pendingRunId: completed ? null : record.runId,
      },
    }
  }

  async function report(control, event) {
    if (control.finalized || control.cancelled) return
    let record = await store.get(control.runId)
    if (!record || record.phase === 'settled') return
    if (event.type === 'preview') {
      if (!content(event.output)) return
      output.set(record.runId, { ...output.get(record.runId), preview: copy(event.output) })
      // Preview text is ephemeral; a token stream must not rewrite the entire
      // protection journal for every delta.
      publish(record, true)
      return
    } else if (event.type === 'accepted') {
      if (!event.evidence)
        throw new EngineError(
          'RESULT_UNCERTAIN',
          'Provider acceptance had no correlated evidence.',
          { submission: record.submission },
        )
      const binding = await bindReference(record, event.nativeRef)
      record = await store.update(
        record.runId,
        { ...binding.patch, submission: 'accepted', phase: 'running' },
        { binding: binding.binding },
      )
    } else if (event.type === 'reference') {
      if (!event.nativeRef) return
      const binding = await bindReference(record, event.nativeRef)
      record = await store.update(record.runId, binding.patch, { binding: binding.binding })
    } else if (event.type === 'progress') {
      // Local legacy presentation is never serialized into public API state.
      control.options.onLegacyPacket?.(event.packet)
      return
    } else throw new Error('Unknown adapter event')
    publish(record)
  }

  async function settle(control, result) {
    await control.reports
    let record = await store.get(control.runId)
    if (!record || record.phase === 'settled') return record
    let outcome = control.cancelled ? 'stopped' : result.outcome
    const submission =
      record.submission === 'accepted' ? 'accepted' : result.submission || record.submission
    if (outcome === 'completed' && (!content(result.finalOutput) || submission !== 'accepted'))
      outcome = 'unknown'
    const resolved =
      outcome === 'completed' || submission === 'not_attempted' || result.definitive === true
    const binding = result.nativeRef
      ? await bindReference(record, result.nativeRef, { completed: outcome === 'completed' })
      : {}
    const patch = {
      ...binding.patch,
      phase: 'settled',
      submission,
      outcome,
      resolved,
      ...(result.error ? { error: result.error } : {}),
    }
    record = await store.update(record.runId, patch, {
      release: resolved,
      binding: binding.binding,
    })
    if (record.outcome === 'completed' && outcome === 'completed')
      output.set(record.runId, { ...output.get(record.runId), result: copy(result.finalOutput) })
    else if (result.partialOutput)
      output.set(record.runId, { ...output.get(record.runId), preview: copy(result.partialOutput) })
    publish(record)
    return record
  }

  async function execute(control, request, claimed) {
    let result
    try {
      const current = await config()
      assertEngineAdmission(current, control.definition, request.operation, control.caller)
      const context = {
        runId: control.runId,
        config: current,
        nativeRef: claimed.binding?.nativeRef,
        legacySession: control.options.legacySession,
        callExtension: (operation, query) =>
          extension(request.engineId, operation, query, control.caller, {
            runId: `${control.runId}:${operation}`,
            parentRunId: control.runId,
            installationId: claimed.record.installationId,
          }),
        isCancelled: () => control.cancelled,
        onCancel: (listener) => {
          control.cancelListeners.add(listener)
          return () => control.cancelListeners.delete(listener)
        },
        report: (event) => {
          control.reports = control.reports.then(() => report(control, event))
          return control.reports
        },
      }
      if (control.adapter.prepare) await control.adapter.prepare(request, context)
      if (control.cancelled) return
      assertEngineAdmission(await config(), control.definition, request.operation, control.caller)
      await store.update(control.runId, { submission: 'possibly_submitted' })
      if (control.cancelled) return
      const method = request.operation === Op.Generate ? 'generate' : 'append'
      result = await control.adapter[method](request, context)
      control.options.onLegacySession?.(context.legacySessionResult)
    } catch (error) {
      const record = await store.get(control.runId).catch(() => null)
      const unsent =
        error?.dispatched === false ||
        error?.chatgptWebNotDispatched === true ||
        record?.submission === 'not_attempted'
      const submission = unsent ? 'not_attempted' : record?.submission || 'possibly_submitted'
      result = {
        outcome: unsent ? 'failed' : 'unknown',
        submission,
        error: serializeEngineError(error, { submission, runId: control.runId }),
      }
    } finally {
      try {
        if (result) await settle(control, result)
      } catch (error) {
        // Native execution may have happened. Do not retry a failed journal.
        control.failure = serializeEngineError(error, {
          submission: 'possibly_submitted',
          runId: control.runId,
        })
        const degraded = {
          ...claimed.record,
          phase: 'settled',
          outcome: 'unknown',
          submission: 'possibly_submitted',
          error: control.failure,
          revision: Number.MAX_SAFE_INTEGER,
          updatedAt: now(),
        }
        degradedRuns.set(control.runId, degraded)
        publish(degraded)
      }
      control.finalized = true
      active.delete(control.runId)
      onActivity(active.size)
      trimOutput()
    }
  }

  async function invoke(request, caller, options = {}) {
    validateEngineRequest(request)
    const { adapter, definition } = entry(request.engineId)
    const current = await config()
    assertEngineAdmission(current, definition, request.operation, caller)
    if (!operationIsImplemented(definition, request.operation))
      throw new EngineError(
        'OPERATION_NOT_IMPLEMENTED',
        `${request.operation} is not implemented by ${definition.label}.`,
      )
    const normalized = copy(request)
    const originalBinding = request.conversation
      ? await store.binding(request.conversation.ref)
      : null
    normalized.modelId =
      request.modelId ||
      originalBinding?.modelId ||
      (await adapter.resolveModel?.(request, current))
    if (!normalized.modelId) throw new EngineError('MODEL_UNAVAILABLE', 'No model is selected.')
    await adapter.validate?.(normalized, current)
    const runId = options.runId || `run-${uuid()}`
    const leaseKeys =
      definition.execution?.concurrencyScope === 'engine'
        ? [`engine:${definition.id}`]
        : request.conversation
        ? [
            `conversation:${definition.id}:${
              originalBinding?.nativeRef?.session?.conversationId || request.conversation.ref
            }`,
          ]
        : []
    if (request.input.attachments?.length) leaseKeys.push(`resource:${definition.id}:upload`)
    const claimed = await store.claim({
      runId,
      fingerprint: await fingerprintEngineRequest(request),
      engineId: request.engineId,
      modelId: normalized.modelId,
      operation: request.operation,
      principal: caller.principal,
      leaseKeys,
      installationId: options.installationId,
      conversation: request.conversation,
    })
    if (claimed.existing) return snapshot(claimed.record)
    const control = {
      runId,
      adapter,
      definition,
      operation: request.operation,
      caller: copy(caller),
      options,
      reports: Promise.resolve(),
      cancelListeners: new Set(),
      cancelled: false,
      finalized: false,
    }
    active.set(runId, control)
    onActivity(active.size)
    control.execution = Promise.resolve().then(() => execute(control, normalized, claimed))
    return snapshot(claimed.record)
  }

  async function read(runId, caller) {
    if (degradedRuns.has(runId)) {
      const record = degradedRuns.get(runId)
      assertRunAccess(record, caller)
      return snapshot(record)
    }
    const record = await ownedRun(runId, caller)
    const failure = active.get(runId)?.failure
    if (failure) throw new EngineError(failure.code, failure.message, failure)
    return snapshot(record)
  }

  async function subscribe(runId, caller, listener) {
    await read(runId, caller)
    let listeners = subscriptions.get(runId)
    if (!listeners) subscriptions.set(runId, (listeners = new Set()))
    let lastRevision = -1,
      lastSequence = -1
    const deliver = (value) => {
      if (
        value.revision < lastRevision ||
        (value.revision === lastRevision && value.sequence <= lastSequence)
      )
        return
      lastRevision = value.revision
      lastSequence = value.sequence
      listener(value)
    }
    listeners.add(deliver)
    deliver(await read(runId, caller))
    return () => {
      listeners.delete(deliver)
      if (!listeners.size) subscriptions.delete(runId)
    }
  }

  async function wait(runId, caller, { accepted = false, timeoutMs = 2700000, signal } = {}) {
    if (signal?.aborted) throw signal.reason || new Error('Observation cancelled')
    return new Promise((resolve, reject) => {
      let unsubscribe,
        finished = false
      const finish = (action, value) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        unsubscribe?.()
        action(value)
      }
      const aborted = () => finish(reject, signal.reason || new Error('Observation cancelled'))
      const timer = setTimeout(
        () =>
          finish(
            reject,
            new EngineError(
              'RESULT_UNCERTAIN',
              'Waiting ended before a verified final result. Inspect this run; it will not be resubmitted.',
              { runId, submission: 'possibly_submitted' },
            ),
          ),
        timeoutMs,
      )
      signal?.addEventListener('abort', aborted, { once: true })
      void subscribe(runId, caller, (value) => {
        if ((accepted && value.submission === 'accepted') || value.phase === 'settled')
          finish(resolve, value)
      }).then(
        (stop) => {
          unsubscribe = stop
          if (finished) stop()
        },
        (error) => finish(reject, error),
      )
    })
  }

  async function cancel(runId, caller) {
    let record = await ownedRun(runId, caller)
    if (record.phase === 'settled') return snapshot(record)
    const control = active.get(runId)
    if (control?.cancelled) return snapshot(await store.get(runId))
    if (control) control.cancelled = true
    record = await store.update(
      runId,
      {
        phase: 'settled',
        outcome: 'stopped',
        cancellation: record.submission === 'not_attempted' ? 'none' : 'requested',
        resolved: record.submission === 'not_attempted',
      },
      { release: record.submission === 'not_attempted' },
    )
    publish(record)
    if (control) {
      for (const listener of control.cancelListeners) {
        try {
          listener()
        } catch {
          /* cancellation evidence remains unknown */
        }
      }
    }
    return snapshot(record)
  }

  async function recover(runId, caller) {
    const record = await ownedRun(runId, caller)
    const { adapter } = entry(record.engineId)
    if (!adapter.recover)
      throw new EngineError(
        'OPERATION_NOT_IMPLEMENTED',
        'This engine cannot recover a lost execution. Inspect its original website result.',
        { runId, submission: record.submission },
      )
    if (!record.nativeRef)
      throw new EngineError(
        'RESULT_UNCERTAIN',
        'No exact native turn reference was recorded for recovery.',
        { runId, submission: record.submission },
      )
    const existing = recoveries.get(runId)
    if (existing && now() - existing.at < 60000) return existing.promise
    const promise = (async () => {
      const evidence = await adapter.recover(copy(record.nativeRef), {
        runId,
        config: await config(),
      })
      if (evidence?.outcome !== 'completed' || !content(evidence.finalOutput))
        return read(runId, caller)
      output.set(runId, { result: copy(evidence.finalOutput) })
      // Exact-turn recovery does not verify a writable head. Retire this run's
      // binding atomically, preserving any newer append's binding and lease.
      const updated = await store.update(
        runId,
        {
          phase: 'settled',
          outcome: 'completed',
          submission: 'accepted',
          resolved: true,
          error: null,
          conversationRef: null,
          conversationRevision: null,
          recovery: { kind: 'exact-native-read', checkedAt: now() },
        },
        { release: true, allowRecovery: true, retireBinding: true },
      )
      publish(updated)
      trimOutput()
      return snapshot(updated)
    })()
    recoveries.set(runId, { at: now(), promise })
    return promise
  }

  async function list(caller) {
    const current = await config()
    const state = await store.snapshot()
    const result = []
    for (const { adapter, definition } of registry.values()) {
      const access = normalizeEngineExposure(current.engineExposure?.[definition.id])
      if (caller.kind !== 'extension' && !access.externalEnabled) continue
      result.push({
        ...copy(definition),
        contractVersion: 1,
        runtimeOperations: [Op.ReadRun, Op.CancelRun],
        retention: {
          finishedResults: maxResults,
          resultStorage: 'memory',
          protectedRuns: 2000,
          protectionMilliseconds: 604800000,
          unresolvedExpiry: null,
        },
        enabled: engineIsEnabled(current, definition),
        exposure: access,
        effectiveOperations: effectiveEngineOperations(current, definition, caller),
        readiness: (await adapter.status?.(current)) || { state: 'unknown' },
        unresolvedRuns: Object.values(state.protections)
          .filter(
            (run) =>
              run.engineId === definition.id &&
              !run.resolved &&
              run.phase === 'settled' &&
              ((caller.kind === 'extension' && caller.admin === true) ||
                run.principal === caller.principal),
          )
          .map((run) => ({ runId: run.runId, outcome: run.outcome, updatedAt: run.updatedAt })),
      })
    }
    return result
  }

  async function models(engineId, caller, query = {}) {
    const { adapter, definition } = entry(engineId)
    assertEngineAdmission(await config(), definition, Op.Generate, caller)
    return adapter.listModels(query, { config: await config() })
  }

  async function history(engineId, operation, query, caller) {
    const { adapter, definition } = entry(engineId)
    assertEngineAdmission(await config(), definition, operation, caller)
    const method = readMethods[operation]
    if (!method || !adapter[method])
      throw new EngineError(
        'OPERATION_NOT_IMPLEMENTED',
        `${operation} is not implemented by ${definition.label}.`,
      )
    if (!query.publicProfile) return adapter[method](query, { config: await config() })
    const nativeQuery = { ...query }
    delete nativeQuery.publicProfile
    if (operation === Op.ReadConversation) {
      const binding = await store.binding(query.ref)
      if (!binding || binding.engineId !== engineId || binding.principal !== caller.principal)
        throw new EngineError(
          'CONTEXT_UNAVAILABLE',
          'This history reference is unavailable to the caller.',
        )
      if (binding.pendingRunId)
        throw new EngineError('ENGINE_BUSY', 'The original conversation has an unresolved run.')
      delete nativeQuery.ref
      nativeQuery.conversationId = binding.nativeRef.session?.conversationId
      nativeQuery.forceRefresh = true
    }
    const native = await adapter[method](nativeQuery, { config: await config() })
    if (operation === Op.ListConversations) {
      const items = []
      for (const item of native.items || []) {
        const id = item.id || item.conversationId
        if (!id) continue
        const reference = await importBinding(
          engineId,
          { session: { conversationId: id }, head: null },
          caller,
        )
        items.push({ ...item, conversationRef: reference.ref })
      }
      return { ...native, items }
    }
    const reference = adapter.referenceFromHistory(native)
    if (!reference?.head)
      throw new EngineError('CONTEXT_UNAVAILABLE', 'The current native head could not be verified.')
    const imported = await importBinding(engineId, reference, caller)
    return {
      ...native,
      conversationRef: imported.ref,
      conversationRevision: imported.expectedRevision,
    }
  }

  async function extension(engineId, operation, query, caller, options = {}) {
    const { adapter, definition } = entry(engineId)
    const current = await config()
    const handler = adapter.extensionOperations?.[operation]
    if (!handler || !['read', 'write'].includes(handler.effect))
      throw new EngineError(
        'OPERATION_NOT_IMPLEMENTED',
        'This registered extension operation is unavailable.',
      )
    const parent = options.parentRunId ? active.get(options.parentRunId) : null
    const delegated =
      parent &&
      parent.definition.id === engineId &&
      parent.caller.principal === caller.principal &&
      handler.parentOperations?.includes(parent.operation)
    if (options.parentRunId && !delegated)
      throw new EngineError(
        'OPERATION_NOT_EXPOSED',
        'The resource operation has no active authorized parent.',
      )
    const admissionOperation = delegated ? parent.operation : operation
    assertEngineAdmission(current, definition, admissionOperation, caller)
    await handler.validate?.(query)
    if (handler.effect === 'read') return handler.run(query, { config: current })
    const runId = options.runId || `run-${uuid()}`
    const claimed = await store.claim({
      runId,
      fingerprint: await fingerprintEngineRequest({ engineId, operation, query }),
      engineId,
      modelId: 'resource-operation',
      operation,
      principal: caller.principal,
      installationId: options.installationId,
      parentRunId: options.parentRunId,
      leaseKeys: [handler.resourceKey?.(query) || `resource:${engineId}:${operation}`],
    })
    if (claimed.existing) {
      const saved = output.get(runId)?.resource ?? claimed.record.resourceResult
      if (claimed.record.outcome === 'completed' && saved !== undefined) return copy(saved)
      throw new EngineError(
        'RESULT_UNCERTAIN',
        'This resource write is already protected and will not run again.',
        { runId, submission: claimed.record.submission },
      )
    }
    try {
      assertEngineAdmission(await config(), definition, admissionOperation, caller)
      await store.update(runId, { submission: 'possibly_submitted' })
      const value = await handler.run(query, { config: current })
      if (handler.verify && !handler.verify(value, query))
        throw new Error('The native resource operation returned no verified result.')
      const record = await store.update(
        runId,
        {
          phase: 'settled',
          outcome: 'completed',
          submission: 'accepted',
          resolved: true,
          ...(handler.persistResult ? { resourceResult: handler.persistResult(value) } : {}),
        },
        { release: true },
      )
      output.set(runId, { resource: copy(value) })
      publish(record)
      trimOutput()
      return value
    } catch (error) {
      const previous = await store.get(runId)
      const unsent = previous.submission === 'not_attempted'
      const submission = unsent ? 'not_attempted' : 'possibly_submitted'
      await store.update(
        runId,
        {
          phase: 'settled',
          outcome: unsent ? 'failed' : 'unknown',
          submission,
          resolved: unsent,
          error: serializeEngineError(error, { submission, runId }),
        },
        { release: unsent },
      )
      throw new EngineError(
        unsent ? error.code || 'UPSTREAM_REJECTED' : 'RESULT_UNCERTAIN',
        error.message,
        { submission, runId },
      )
    }
  }

  async function review(engineId, query, caller) {
    if (caller.kind !== 'extension' || caller.admin !== true)
      throw new EngineError(
        'OPERATION_NOT_EXPOSED',
        'Uncertain execution review requires extension settings.',
      )
    const { adapter } = entry(engineId)
    if ([...active.values()].some((control) => control.definition.id === engineId))
      throw new EngineError(
        'ENGINE_BUSY',
        'Wait for active observation to end before allowing new work.',
      )
    if (!adapter.review)
      throw new EngineError(
        'OPERATION_NOT_IMPLEMENTED',
        'Check the native engine before allowing new work.',
      )
    const checked = await adapter.review(query, { config: await config() })
    if (!checked?.ok) return checked
    await store.transaction((draft) => {
      for (const record of Object.values(draft.protections)) {
        if (record.engineId !== engineId || record.resolved || record.phase !== 'settled') continue
        record.resolved = true
        record.disposition = { at: now(), kind: 'user-reviewed-outcome-unconfirmed' }
        record.updatedAt = now()
        record.revision += 1
        if (draft.runs[record.runId]) draft.runs[record.runId] = copy(record)
        // A manually reviewed uncertain conversation cannot resume from a
        // guessed parent. New work receives a fresh binding.
        if (record.conversationRef) delete draft.bindings[record.conversationRef]
        store.releaseLeases(draft, record.runId)
      }
    })
    return checked
  }

  async function setExposure(engineId, patch, caller) {
    if (caller.kind !== 'extension' || caller.admin !== true)
      throw new EngineError(
        'OPERATION_NOT_EXPOSED',
        'Engine access can only be changed in extension settings.',
      )
    entry(engineId)
    await config()
    return serialConfig(async () => {
      const current = await getConfig()
      const previous = normalizeEngineExposure(current.engineExposure?.[engineId])
      const next = normalizeEngineExposure({ ...previous, ...patch })
      const value = { ...current.engineExposure, [engineId]: next }
      await setConfig({ engineExposure: value, engineExposureVersion: 1 })
      return next
    })
  }

  async function importBinding(engineId, nativeRef, caller) {
    entry(engineId)
    const ref = `conversation-${uuid()}`
    return store.transaction((draft) => {
      const existing = Object.values(draft.bindings).find(
        (binding) =>
          binding.engineId === engineId &&
          binding.principal === caller.principal &&
          !binding.pendingRunId &&
          JSON.stringify(binding.nativeRef) === JSON.stringify(nativeRef),
      )
      if (existing) return { ref: existing.ref, expectedRevision: existing.revision }
      if (Object.keys(draft.bindings).length >= 2000)
        throw new EngineError(
          'ENGINE_CAPACITY',
          'Conversation binding capacity is full; existing references remain protected.',
        )
      draft.bindings[ref] = {
        ref,
        engineId,
        principal: caller.principal,
        revision: 0,
        modelId:
          nativeRef.session?.chatgptWebModelSlugOverride ||
          nativeRef.session?.modelName?.split('/').slice(1).join('/'),
        nativeRef: copy(nativeRef),
        updatedAt: now(),
        pendingRunId: null,
      }
      return { ref, expectedRevision: 0 }
    })
  }

  return {
    invoke,
    initialize: (options) => config(options).then(() => undefined),
    read,
    wait,
    subscribe,
    cancel,
    recover,
    list,
    models,
    history,
    extension,
    review,
    setExposure,
    importBinding,
    installation: () => store.installation(),
    has: (engineId) => registry.has(engineId),
    privateRecord: async (runId, caller) => {
      await ownedRun(runId, caller)
      return store.get(runId)
    },
    binding: (ref) => store.binding(ref),
    privateBindings: async (engineId, caller) =>
      Object.values((await store.snapshot()).bindings).filter(
        (binding) => binding.engineId === engineId && binding.principal === caller.principal,
      ),
    active: (runId) => active.get(runId),
  }
}
