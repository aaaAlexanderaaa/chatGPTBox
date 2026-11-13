import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import { getSelectionString, parseEngineSelection } from '../config/engine-selection.mjs'
import { createEngineRuntime } from './runtime.mjs'
import { createEngineStore } from './store.mjs'
import { createNativeEngineAdapters, nativeSessionReference } from './adapters.mjs'
import {
  ENGINE_BRIDGE_PROTOCOL,
  EngineError,
  EngineMethod,
  EngineOperation as Op,
  serializeEngineError,
} from './contract.mjs'
import { createLegacyEngineControls } from './legacy-controls.mjs'
import { createCompletionCompatibility } from './compat-completions.mjs'

let instance
let nativeAdapters
let legacyControls
let completionCompatibility
let lifetimeTimer
function updateLifetime(active) {
  if (active && !lifetimeTimer) {
    // An open Port alone does not keep an MV3 worker alive. Real extension API
    // activity covers silent native thinking; the journal covers termination.
    lifetimeTimer = setInterval(() => {
      void Browser.runtime.getPlatformInfo().catch(() => {})
    }, 20000)
  } else if (!active && lifetimeTimer) {
    clearInterval(lifetimeTimer)
    lifetimeTimer = null
  }
}
export function engineRuntime() {
  if (!instance) {
    nativeAdapters = createNativeEngineAdapters()
    instance = createEngineRuntime({
      adapters: nativeAdapters,
      store: createEngineStore({ storage: Browser.storage.local }),
      getConfig: getUserConfig,
      setConfig: setUserConfig,
      onActivity: updateLifetime,
    })
    legacyControls = createLegacyEngineControls({
      service: instance,
      adapters: nativeAdapters,
      getConfig: getUserConfig,
    })
    completionCompatibility = createCompletionCompatibility({
      service: instance,
      adapters: nativeAdapters,
      getConfig: getUserConfig,
    })
  }
  return instance
}

export function executeLegacyEngineControl(message, sender, options = {}) {
  engineRuntime()
  return legacyControls(message, options.caller || engineCaller(sender), options)
}

function extensionPage(sender) {
  return (
    sender?.id === Browser.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(Browser.runtime.getURL(''))
  )
}

export function engineCaller(sender, { bridgeRole } = {}) {
  if (sender?.id !== Browser.runtime.id)
    throw new EngineError('OPERATION_NOT_EXPOSED', 'Engine requests require the extension runtime.')
  if (bridgeRole !== undefined) {
    if (
      !extensionPage(sender) ||
      sender.url.split(/[?#]/)[0] !== Browser.runtime.getURL('ApiServer.html') ||
      !['api', 'mcp'].includes(bridgeRole)
    )
      throw new EngineError(
        'OPERATION_NOT_EXPOSED',
        'Only the authenticated API bridge may construct an external caller.',
      )
    return { kind: 'api', principal: 'gateway-api' }
  }
  if (extensionPage(sender)) {
    if (sender.url.split(/[?#]/)[0] === Browser.runtime.getURL('ApiServer.html'))
      return { kind: 'api', principal: 'gateway-api' }
    return { kind: 'extension', principal: 'extension', admin: true }
  }
  if (Number.isInteger(sender.tab?.id))
    return {
      kind: 'extension',
      principal: `content:${sender.tab.id}:${sender.documentId || sender.frameId || 0}`,
      admin: false,
    }
  throw new EngineError(
    'OPERATION_NOT_EXPOSED',
    'The engine caller has no verifiable page identity.',
  )
}

export async function dispatchEngineRequest(data, sender, { bridge = false } = {}) {
  if (bridge && !['api', 'mcp'].includes(data?.role))
    throw new EngineError(
      'OPERATION_NOT_EXPOSED',
      'The authenticated bridge caller role is required.',
    )
  const caller = engineCaller(sender, bridge ? { bridgeRole: data?.role } : {})
  if (bridge && data.protocol !== ENGINE_BRIDGE_PROTOCOL)
    throw new EngineError('INVALID_REQUEST', 'The API bridge engine protocol is incompatible.')
  const service = engineRuntime()
  const payload = data.payload || {}
  switch (data.method) {
    case EngineMethod.List:
      return service.list(caller)
    case EngineMethod.Models:
      return service.models(payload.engineId, caller, payload.query || {})
    case EngineMethod.Invoke:
      if (bridge && (!data.runId || !data.installationId))
        throw new EngineError(
          'INVALID_REQUEST',
          'The bridge must pin a run ID and extension installation before dispatch.',
        )
      return service.invoke(
        payload,
        caller,
        bridge ? { runId: data.runId, installationId: data.installationId } : {},
      )
    case EngineMethod.Read:
      return service.read(payload.runId, caller)
    case EngineMethod.Recover:
      return service.recover(payload.runId, caller)
    case EngineMethod.Cancel:
      return service.cancel(payload.runId, caller)
    case EngineMethod.ReadConversation:
      return service.history(payload.engineId, Op.ReadConversation, payload.query || {}, caller)
    case EngineMethod.ListConversations:
      return service.history(payload.engineId, Op.ListConversations, payload.query || {}, caller)
    case 'exposure.set':
      return service.setExposure(payload.engineId, payload.patch, caller)
    case 'engine.review':
      return service.review(payload.engineId, payload.query || {}, caller)
    case 'engine.installation':
      return { installationId: await service.installation(), protocol: ENGINE_BRIDGE_PROTOCOL }
    case 'compat.control':
      if (bridge && (!data.runId || !data.installationId))
        throw new EngineError(
          'INVALID_REQUEST',
          'The bridge must pin the operation and installation.',
        )
      return legacyControls(payload, caller, {
        runId: data.runId,
        installationId: data.installationId,
      })
    case 'compat.completion':
      if (bridge && (!data.runId || !data.installationId))
        throw new EngineError(
          'INVALID_REQUEST',
          'The bridge must pin the operation and installation.',
        )
      return completionCompatibility(payload, caller, {
        runId: data.runId,
        installationId: data.installationId,
        wait: !bridge,
      })
    default:
      throw new EngineError('OPERATION_NOT_IMPLEMENTED', 'Unknown engine runtime method.')
  }
}

export async function engineRequestReply(data, sender, options) {
  try {
    return { ok: true, value: await dispatchEngineRequest(data, sender, options) }
  } catch (error) {
    return { ok: false, error: serializeEngineError(error) }
  }
}

// This is the compatibility projection for the existing conversation Port. It
// never gives a provider the UI Port, and disconnect only removes observation.
export async function executeWebEngineSession(session, port, config, suppliedCaller) {
  const service = engineRuntime()
  const selected = parseEngineSelection(getSelectionString(session))
  const caller = suppliedCaller || engineCaller(port.sender)
  const adapter = nativeAdapters.find((item) => item.describe().id === selected?.providerId)
  if (!adapter)
    throw new EngineError('ENGINE_NOT_FOUND', 'This selection has no registered engine adapter.')
  const request = adapter.fromLegacy
    ? adapter.fromLegacy(session, config)
    : {
        contractVersion: 1,
        engineId: selected.providerId,
        operation: Op.Generate,
        modelId: selected.modelId,
        input: { prompt: session.question },
      }
  const nativeRef = nativeSessionReference(session)
  if (nativeRef || session.engineConversationRef) {
    let binding = session.engineConversationRef
      ? await service.binding(session.engineConversationRef)
      : null
    if (
      binding &&
      (binding.engineId !== request.engineId ||
        binding.principal !== caller.principal ||
        binding.nativeRef.session?.remoteBindingGeneration !== session.remoteBindingGeneration)
    )
      binding = null
    request.operation = Op.Append
    request.conversation = binding
      ? {
          ref: binding.ref,
          expectedRevision: session.engineConversationRevision ?? binding.revision,
        }
      : nativeRef
      ? await service.importBinding(request.engineId, nativeRef, caller)
      : (() => {
          throw new EngineError(
            'CONTEXT_UNAVAILABLE',
            'The original conversation binding is unavailable.',
          )
        })()
  }
  let latestSession = session,
    detach = () => {},
    started = false,
    finished = false,
    runId
  const send = (packet) => {
    try {
      port.postMessage(packet)
    } catch {
      /* detached view */
    }
  }
  const onStop = (message) => {
    if (message?.stop && runId) void service.cancel(runId, caller).catch(() => {})
  }
  const onDisconnect = () => {
    detach()
  }
  port.onMessage?.addListener(onStop)
  port.onDisconnect?.addListener(onDisconnect)
  try {
    const receipt = await service.invoke(request, caller, {
      legacySession: session,
      onLegacySession: (value) => {
        if (value) latestSession = value
      },
      onLegacyPacket: (packet) => {
        if (!packet) return
        if (packet.session) latestSession = { ...latestSession, ...packet.session }
        const {
          answer: _answer,
          finalContent: _final,
          outcome: _outcome,
          done: _done,
          error: _error,
          accepted: _accepted,
          started: _started,
          ...display
        } = packet
        void _answer
        void _final
        void _outcome
        void _done
        void _error
        void _accepted
        void _started
        if (Object.keys(display).length) send(display)
      },
    })
    runId = receipt.runId
    if (port.__stopRequested) await service.cancel(runId, caller)
    detach = await service.subscribe(runId, caller, (value) => {
      if (finished) return
      const projected = {
        ...latestSession,
        engineRunId: runId,
        ...(value.conversationRef
          ? {
              engineConversationRef: value.conversationRef,
              engineConversationRevision: value.conversationRevision,
            }
          : {}),
      }
      if (!started && value.submission === 'accepted') {
        started = true
        send({ started: true, accepted: true, session: projected })
      }
      if (value.preview && value.phase !== 'settled')
        send({ answer: value.preview.content, session: projected, done: false })
      if (value.phase === 'settled') {
        finished = true
        const success = value.outcome === 'completed' && value.result
        send({
          answer: success ? value.result.content : value.preview?.content || '',
          finalContent: success ? value.result.content : null,
          outcome: value.outcome === 'unknown' ? 'incomplete' : value.outcome,
          done: true,
          session: projected,
          ...(!success && value.outcome !== 'stopped'
            ? {
                error:
                  value.error?.message ||
                  'The engine ended without a verified final result. Inspect its website; this request will not be resubmitted.',
              }
            : {}),
          ...(value.submission === 'not_attempted' ? { dispatched: false } : {}),
        })
      }
    })
    await service.wait(runId, caller)
  } finally {
    detach()
    port.onMessage?.removeListener(onStop)
    port.onDisconnect?.removeListener(onDisconnect)
  }
}
