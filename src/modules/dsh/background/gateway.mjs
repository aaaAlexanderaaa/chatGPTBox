// Persistent DeepSeek Harness gateway (roadmap A2).
//
// ONE mux downlink + ONE host downlink, held for the service-worker
// lifetime while the module is enabled. Everything the cockpit renders is
// derived from this single connection pair. In a browser the pair rides the
// carrier-tab bridge (D-22: extension-origin WebSocket handshakes cannot
// pass the harness trust fence); the sockets themselves are opened by the
// downlink content script on the harness origin, so they even survive
// service-worker restarts until the next worker Pings (empty sid list
// reaps the orphaned sockets) and Opens a new pair:
//
//   - session registry: summary (session.list + host frames) × ledger fold
//     (mux session events + history salvage) × projections (high-seq-wins)
//     × queue/jobs snapshots;
//   - pending approvals/questions are indexed by the harness rpcId (stable
//     across mux reopens — the harness replays them with the same rpcId),
//     answered exclusively through POST /api/respond;
//   - reconnect: exponential backoff 500ms × 2 capped at 10s; after every
//     reopen the gateway re-pulls session.list and the history tail of every
//     known session — the fold's seq gate makes the replay idempotent, so
//     content is neither duplicated nor lost (the `since` cursor is not
//     implemented upstream; reopen + re-pull is the official client
//     strategy too);
//   - auto-approve (D-8) is answered by the gateway itself: the harness has
//     no auto-approve RPC, and its only policy knob ('never') auto-REJECTS —
//     so a per-session explicit switch here is the only faithful shape;
//   - keepalive: host.describe every 25s but only while some session is
//     running, which is exactly when silent tool work would otherwise let
//     the MV3 worker idle out and kill the sockets.
//
// Boundary: no extension imports. The host object (storage, notifications,
// badge, logging) and the client factory are injected; timers/backoff are
// injectable for tests.

import { createDshClient } from '../client.mjs'
import { createDshLedgerFold } from '../turn-fold.mjs'
import { diagnoseDsh, helloForGatewayHold } from './fence.mjs'
import { waitingNotificationAction } from './waiting-inbox.mjs'

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const KEEPALIVE_INTERVAL_MS = 25_000
const LEDGER_DEBOUNCE_MS = 50
const HISTORY_PAGE_DEFAULT = 50

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

/**
 * @param {object} options
 * @param {string} options.endpoint - harness origin (http://127.0.0.1:3080)
 * @param {{ local: { get: Function, set: Function } }} options.storage
 * @param {object} [options.host] - injected platform surface
 * @param {(payload: {title: string, message: string, sessionId: string, kind: 'approval'|'question'}) => void} [options.host.notifyWaiting]
 * @param {() => void} [options.host.clearWaiting]
 * @param {(count: number) => void} [options.host.setBadge]
 * @param {(...args: unknown[]) => void} [options.host.log]
 * @param {ReturnType<typeof createDshClient>} [options.client]
 * @param {{ openMux: Function, openHost: Function }} [options.downlink] - the
 *   event-stream transport. Defaults to the client's own sockets (the direct
 *   path, valid for Node smoke tests); the browser wiring passes the
 *   carrier-tab bridge because extension-origin WebSocket handshakes cannot
 *   pass the harness trust fence (D-22).
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [options.timers]
 */
export function createDshGateway({ endpoint, storage, host = {}, client, downlink, timers }) {
  const t = {
    setTimeout: timers?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimeout: timers?.clearTimeout ?? ((id) => clearTimeout(id)),
    setInterval: timers?.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
    clearInterval: timers?.clearInterval ?? ((id) => clearInterval(id)),
  }
  const log = host.log ?? ((...args) => console.log('DSH gateway:', ...args))

  /** @type {ReturnType<typeof createDshClient>} */
  let api = client ?? createDshClient({ baseUrl: endpoint })
  // The downlink transport for the two event streams: the injected bridge in
  // a browser, the client's direct sockets otherwise (tests, Node smoke).
  const streams = downlink ?? api

  // --- registry -----------------------------------------------------------

  /**
   * @typedef {object} GwSession
   * @property {object} summary - session.list row (+host frame updates)
   * @property {ReturnType<typeof createDshLedgerFold>} fold
   * @property {Map<string, {seq: number, value: unknown}>} projections
   * @property {Array<object>} queue
   * @property {Array<object>} jobs
   * @property {boolean} loaded - history pulled at least once
   * @property {boolean} autoApprove
   */
  /** @type {Map<string, GwSession>} */
  const sessions = new Map()

  const state = {
    endpoint,
    status: 'offline', // offline | connecting | online
    lastError: null,
    version: null,
    startedAt: null,
  }

  // --- ports (UI fan-out) --------------------------------------------------

  /** @type {Set<{postMessage: Function, disconnect?: Function}>} */
  const ports = new Set()
  /** @type {Map<object, Set<string>>} port -> subscribed sessionIds */
  const ledgerSubscriptions = new Map()
  /** @type {Map<string, Set<(message: object) => void>>} */
  const ledgerWatchers = new Map()
  const pendingLedgerPushes = new Map() // sessionId -> timer

  function broadcast(message) {
    for (const port of ports) {
      try {
        port.postMessage(message)
      } catch {
        // port died; onDisconnect cleanup will drop it
      }
    }
  }

  function broadcastSession(sessionId) {
    const session = sessions.get(sessionId)
    if (!session) return
    broadcast({ type: 'session', summary: summarize(session) })
  }

  function scheduleLedgerPush(sessionId) {
    if (pendingLedgerPushes.has(sessionId)) return
    const timer = t.setTimeout(() => {
      pendingLedgerPushes.delete(sessionId)
      pushLedger(sessionId)
    }, LEDGER_DEBOUNCE_MS)
    pendingLedgerPushes.set(sessionId, timer)
  }

  function summarize(session) {
    return {
      ...session.summary,
      title: projectionValue(session, 'title') ?? session.summary.title ?? null,
      loaded: session.loaded,
      autoApprove: session.autoApprove,
      queueCount: session.queue.filter((item) => item?.placement === 'queued').length,
      queueItems: session.queue
        .filter((item) => item?.placement === 'queued')
        .map((item) => ({
          id: item.id,
          text: (item.message?.content || [])
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join(' '),
        })),
      jobs: session.jobs,
      waiting: session.fold.getPendingDecisions().length,
      // Compact pending-decision payloads so waiting surfaces that are not
      // subscribed to the ledger (popup pinned cards, notification jumps)
      // can render the actual ask, not just a count. Approval arguments
      // live on the tool block (keyed by callId) — resolve them here.
      pendingDecisions: (() => {
        const toolBlocks = new Map()
        for (const block of session.fold.getBlocks()) {
          if (block.kind === 'tool' && block.callId) toolBlocks.set(block.callId, block)
        }
        return session.fold.getPendingDecisions().map(({ type, rpcId, block }) => ({
          kind: type,
          rpcId,
          approvalId: block.approvalId,
          toolName: block.toolName,
          args: block.callId ? toolBlocks.get(block.callId)?.args ?? null : null,
          questions: type === 'question' ? block.questions ?? null : null,
          sessionId: session.summary.sessionId,
        }))
      })(),
    }
  }

  function projectionValue(session, key) {
    return session.projections.get(key)?.value ?? null
  }

  function sessionListMessage() {
    return {
      type: 'sessions',
      items: [...sessions.values()]
        .map(summarize)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    }
  }

  function broadcastSessionList() {
    broadcast(sessionListMessage())
  }

  function ensureSession(summary) {
    const sessionId = summary.sessionId
    let session = sessions.get(sessionId)
    if (!session) {
      session = {
        summary: { ...summary },
        fold: createDshLedgerFold(),
        projections: new Map(),
        queue: [],
        jobs: [],
        loaded: false,
        autoApprove: false,
      }
      sessions.set(sessionId, session)
      void loadAutoApprove(sessionId)
    } else {
      Object.assign(session.summary, summary)
    }
    return session
  }

  // --- auto-approve persistence (D-8: per-session, default off) ------------

  async function loadAutoApprove(sessionId) {
    try {
      const stored = await storage.local.get({ dshModuleAutoApprove: {} })
      const session = sessions.get(sessionId)
      if (session && stored.dshModuleAutoApprove?.[sessionId] === true) {
        session.autoApprove = true
        broadcastSession(sessionId)
        await flushAutoApprove(sessionId)
      }
    } catch {
      // storage read failure leaves the switch off — the safe direction
    }
  }

  async function persistAutoApprove(sessionId, value) {
    const session = sessions.get(sessionId)
    if (session) session.autoApprove = value === true
    try {
      const stored = await storage.local.get({ dshModuleAutoApprove: {} })
      const map = { ...(stored.dshModuleAutoApprove || {}) }
      if (value === true) map[sessionId] = true
      else delete map[sessionId]
      await storage.local.set({ dshModuleAutoApprove: map })
    } catch (error) {
      log('cannot persist auto-approve', error)
    }
    broadcastSession(sessionId)
    if (value === true) await flushAutoApprove(sessionId)
  }

  async function flushAutoApprove(sessionId) {
    const session = sessions.get(sessionId)
    if (!session?.autoApprove) return
    for (const pending of session.fold.getPendingDecisions()) {
      if (pending.type !== 'approval' || !pending.rpcId) continue
      await answerApproval(
        pending.rpcId,
        sessionId,
        pending.block.approvalId,
        'allowed-once',
      ).catch((error) => log('auto-approve respond failed', error))
    }
  }

  // --- waiting inbox (approvals + questions) → badge + OS notification ------

  function totalPending() {
    let count = 0
    for (const session of sessions.values()) count += session.fold.getPendingDecisions().length
    return count
  }

  function sessionIsAttached(sessionId) {
    if ([...ledgerSubscriptions.values()].some((ids) => ids.has(sessionId))) return true
    return (ledgerWatchers.get(sessionId)?.size || 0) > 0
  }

  function emitWaitingNotification(session) {
    const latest = session.fold.getPendingDecisions().at(-1)
    if (!latest) return
    host.notifyWaiting?.({
      sessionId: session.summary.sessionId,
      kind: latest.type,
      title: summarize(session).title || 'DeepSeek Harness',
      message:
        latest.type === 'approval'
          ? `Waiting for approval: ${latest.block.toolName}`
          : `Waiting for an answer: ${latest.block.questions?.[0]?.question || ''}`,
    })
  }

  function findOtherWaitingSession(exceptId) {
    for (const session of sessions.values()) {
      if (session.summary.sessionId === exceptId) continue
      if (session.fold.getPendingDecisions().length > 0) return session
    }
    return null
  }

  function refreshWaiting(sessionId) {
    const session = sessions.get(sessionId)
    if (!session) return
    const pending = session.fold.getPendingDecisions()
    host.setBadge?.(totalPending())
    broadcastSession(sessionId)
    const action = waitingNotificationAction({
      sessionPending: pending.length,
      totalPending: totalPending(),
      attached: sessionIsAttached(sessionId),
    })
    if (action === 'clear') {
      host.clearWaiting?.()
      return
    }
    if (action === 'none') return
    if (action === 'notify') {
      emitWaitingNotification(session)
      return
    }
    const other = findOtherWaitingSession(sessionId)
    if (!other || sessionIsAttached(other.summary.sessionId)) return
    emitWaitingNotification(other)
  }

  // --- approvals / questions ----------------------------------------------

  async function answerApproval(rpcId, sessionId, approvalId, outcome) {
    const receipt = await api.respond(rpcId, {
      ok: true,
      value: { sessionId, approvalId, outcome },
    })
    if (receipt?.accepted) {
      const session = sessions.get(sessionId)
      session?.fold.markApprovalOutcome(approvalId, outcome)
      refreshWaiting(sessionId)
      scheduleLedgerPush(sessionId)
    }
    return receipt
  }

  async function answerQuestion(rpcId, sessionId, answers) {
    const receipt = await api.respond(rpcId, {
      ok: true,
      value: { sessionId, answer: { answers } },
    })
    if (receipt?.accepted) {
      const session = sessions.get(sessionId)
      session?.fold.markQuestionOutcome(rpcId, 'answered')
      refreshWaiting(sessionId)
      scheduleLedgerPush(sessionId)
    }
    return receipt
  }

  async function cancelQuestion(rpcId, sessionId) {
    const receipt = await api.respond(rpcId, {
      ok: false,
      error: { code: 'cancelled', message: 'dismissed by the user' },
    })
    if (receipt?.accepted) {
      const session = sessions.get(sessionId)
      session?.fold.markQuestionOutcome(rpcId, 'cancelled')
      refreshWaiting(sessionId)
      scheduleLedgerPush(sessionId)
    }
    return receipt
  }

  // --- mux frame handling ---------------------------------------------------

  function handleMuxFrame(frame, envelope) {
    const sessionId = frame?.sessionId
    if (typeof sessionId !== 'string') return
    switch (frame.type) {
      case 'session/event': {
        const session = sessions.get(sessionId)
        if (!session) break // event for a session we have not adopted yet
        session.fold.pushEvent(frame.event)
        scheduleLedgerPush(sessionId)
        break
      }
      case 'approval/requested': {
        const session = ensureSession({ sessionId })
        session.fold.pushFrame(frame, envelope)
        if (session.autoApprove && envelope.rpcId) {
          void answerApproval(envelope.rpcId, sessionId, frame.approvalId, 'allowed-once').catch(
            (error) => log('auto-approve respond failed', error),
          )
        }
        refreshWaiting(sessionId)
        scheduleLedgerPush(sessionId)
        break
      }
      case 'question/requested': {
        const session = ensureSession({ sessionId })
        session.fold.pushFrame(frame, envelope)
        refreshWaiting(sessionId)
        scheduleLedgerPush(sessionId)
        break
      }
      case 'approval/resolved':
      case 'question/resolved': {
        const session = sessions.get(sessionId)
        if (!session) break
        session.fold.pushFrame(frame, envelope)
        refreshWaiting(sessionId)
        scheduleLedgerPush(sessionId)
        break
      }
      case 'session/subscribed': {
        // The harness replays pending decisions + snapshots right after this
        // baseline; nothing to do — ensure the row exists.
        ensureSession({ sessionId })
        break
      }
      case 'session/queue': {
        const session = ensureSession({ sessionId })
        session.queue = Array.isArray(frame.items) ? frame.items : []
        broadcastSession(sessionId)
        break
      }
      case 'session/jobs': {
        const session = ensureSession({ sessionId })
        session.jobs = Array.isArray(frame.jobs) ? frame.jobs : []
        broadcastSession(sessionId)
        syncKeepalive()
        break
      }
      case 'session/projection': {
        const session = ensureSession({ sessionId })
        const key = String(frame.key ?? '')
        if (!key) break
        const seq = typeof frame.seq === 'number' ? frame.seq : -1
        const existing = session.projections.get(key)
        if (existing && existing.seq > seq) break // higher-seq-wins
        session.projections.set(key, { seq, value: frame.value })
        broadcastSession(sessionId) // title/todos land in the sidebar here
        break
      }
      case 'stream/error': {
        state.lastError = frame.error?.message || `stream error (${frame.error?.code || 'unknown'})`
        broadcast({ type: 'connection', ...connectionMessage() })
        break
      }
      default:
        break
    }
  }

  function handleHostFrame(frame) {
    switch (frame?.type) {
      case 'host/session-added':
        ensureSession({
          sessionId: frame.sessionId,
          blank: frame.blank === true,
          parentSessionId: frame.parentSessionId,
          origin: frame.origin,
          cwd: frame.cwd,
          updatedAt: Date.now(),
          running: false,
        })
        broadcastSessionList()
        break
      case 'host/session-removed':
        sessions.delete(frame.sessionId)
        broadcastSessionList()
        {
          const leftover = [...sessions.values()].find(
            (item) => item.fold.getPendingDecisions().length > 0,
          )
          if (leftover) refreshWaiting(leftover.summary.sessionId)
          else {
            host.setBadge?.(0)
            host.clearWaiting?.()
          }
        }
        break
      case 'host/session-status': {
        const session = sessions.get(frame.sessionId)
        if (session) {
          session.summary.running = frame.running === true
          session.summary.updatedAt = Date.now()
          broadcastSession(frame.sessionId)
        }
        syncKeepalive()
        break
      }
      case 'host/agent-error': {
        state.lastError = frame.message
        broadcast({ type: 'connection', ...connectionMessage() })
        break
      }
      default:
        // workspace frames are v1 cut lines
        break
    }
  }

  // --- connection lifecycle ---------------------------------------------------

  let mux = null
  let hostStream = null
  let stopped = true
  let reconnectTimer = null
  let reconnectAttempt = 0
  let keepaliveTimer = null
  let connectGeneration = 0

  function closeStreams() {
    try {
      mux?.close()
    } catch {
      // already closed
    }
    try {
      hostStream?.close()
    } catch {
      // already closed
    }
    mux = null
    hostStream = null
  }

  function connectionMessage() {
    return {
      status: state.status,
      endpoint: state.endpoint,
      version: state.version,
      lastError: state.lastError,
    }
  }

  function syncKeepalive() {
    const anyRunning = [...sessions.values()].some((s) => s.summary.running === true)
    if (anyRunning && keepaliveTimer == null) {
      keepaliveTimer = t.setInterval(() => {
        void api
          .rpc('host.describe', {})
          .then((value) => {
            state.version = value?.version ?? state.version
          })
          .catch(() => {})
      }, KEEPALIVE_INTERVAL_MS)
    } else if (!anyRunning && keepaliveTimer != null) {
      t.clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
  }

  function backoffMs() {
    return Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS)
  }

  function scheduleReconnect() {
    if (stopped) return
    if (reconnectTimer != null) return
    const delay = backoffMs()
    reconnectAttempt = Math.min(reconnectAttempt + 1, 10)
    reconnectTimer = t.setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function refreshVersion() {
    try {
      const value = await api.rpc('host.describe', {})
      state.version = value?.version ?? null
    } catch {
      // version is best-effort decoration
    }
  }

  /** session.list + history tails: the full (re)connect compensation pass. */
  async function syncRegistry() {
    const value = await api.rpc('session.list', {})
    const items = Array.isArray(value?.items) ? value.items : []
    for (const item of items) {
      ensureSession(item)
      // History pull adopts the session on the gateway (the mux baseline then
      // replays its pending approvals with stable rpcIds), backfills the
      // ledger, and — on a reconnect — compensates whatever the lost socket
      // missed; the fold's seq gate keeps the replay idempotent. Blank
      // sessions have nothing to pull. Pulled on EVERY connect: `since`-style
      // incremental resume is not implemented upstream.
      if (item.blank === true) continue
      await pullHistory(item.sessionId).catch((error) =>
        log('history pull failed', item.sessionId, error?.message || error),
      )
    }
    // Sessions that vanished upstream
    const listed = new Set(items.map((item) => item.sessionId))
    for (const sessionId of [...sessions.keys()]) {
      if (!listed.has(sessionId)) sessions.delete(sessionId)
    }
    broadcastSessionList()
  }

  async function pullHistory(sessionId, { beforeSeq } = {}) {
    const session = sessions.get(sessionId)
    if (!session) return null
    const payload = { sessionId }
    if (typeof beforeSeq === 'number') payload.beforeSeq = beforeSeq
    else payload.maxMessages = HISTORY_PAGE_DEFAULT
    const value = await api.rpc('session.history', payload)
    session.loaded = true
    const entries = Array.isArray(value?.events) ? value.events : []
    for (const entry of entries) {
      session.fold.pushEvent(entry?.event ?? entry)
    }
    const projections = value?.projections
    if (projections && projections.values && typeof projections.values === 'object') {
      for (const [key, value2] of Object.entries(projections.values)) {
        const seq = typeof projections.asOfSeq === 'number' ? projections.asOfSeq : -1
        const existing = session.projections.get(key)
        if (!existing || existing.seq <= seq) session.projections.set(key, { seq, value: value2 })
      }
    }
    pushLedger(sessionId)
    return {
      hasMore: value?.hasMore === true,
      firstSeq: entries.length ? entries[0]?.event?.seq ?? null : null,
    }
  }

  async function connect() {
    if (stopped) return
    const generation = ++connectGeneration
    closeStreams()
    state.status = 'connecting'
    broadcast({ type: 'connection', ...connectionMessage() })
    let nextMux = null
    let nextHost = null
    try {
      nextMux = await streams.openMux({
        onFrame: handleMuxFrame,
        onClose: () => {
          if (generation !== connectGeneration) return
          onStreamLost('mux')
        },
        onError: () => {
          if (generation !== connectGeneration) return
          onStreamLost('mux')
        },
      })
      if (stopped || generation !== connectGeneration) {
        try {
          nextMux?.close()
        } catch {
          // superseded
        }
        return
      }
      mux = nextMux
      nextHost = await streams.openHost({
        onFrame: handleHostFrame,
        onClose: () => {
          if (generation !== connectGeneration) return
          onStreamLost('host')
        },
        onError: () => {
          if (generation !== connectGeneration) return
          onStreamLost('host')
        },
      })
      if (stopped || generation !== connectGeneration) {
        try {
          nextMux?.close()
        } catch {
          // superseded
        }
        try {
          nextHost?.close()
        } catch {
          // mux died while host was still opening
        }
        mux = null
        return
      }
      hostStream = nextHost
    } catch (error) {
      try {
        nextMux?.close()
      } catch {
        // openMux succeeded, openHost failed
      }
      try {
        nextHost?.close()
      } catch {
        // neither stream finished opening
      }
      if (generation !== connectGeneration) return
      mux = null
      hostStream = null
      state.lastError = error?.message || String(error)
      state.status = 'offline'
      broadcast({ type: 'connection', ...connectionMessage() })
      scheduleReconnect()
      return
    }
    if (stopped || generation !== connectGeneration) {
      closeStreams()
      try {
        nextHost?.close()
      } catch {
        // already closed in the generation check above
      }
      return
    }
    reconnectAttempt = 0
    state.status = 'online'
    state.lastError = null
    state.startedAt = Date.now()
    broadcast({ type: 'connection', ...connectionMessage() })
    await refreshVersion()
    if (stopped || generation !== connectGeneration) return
    await syncRegistry().catch((error) => {
      state.lastError = error?.message || String(error)
      broadcast({ type: 'connection', ...connectionMessage() })
    })
    if (stopped || generation !== connectGeneration) return
    syncKeepalive()
  }

  function onStreamLost(which) {
    if (stopped) return
    log(`${which} stream lost; reconnecting`)
    connectGeneration += 1
    closeStreams()
    state.status = 'connecting'
    broadcast({ type: 'connection', ...connectionMessage() })
    scheduleReconnect()
  }

  // --- RPC surface (UI requests, correlated by id) ---------------------------

  /** In-process RPC: same handler table the port surface uses. Consumers
   *  that are not runtime ports (the dsh bridge provider, respond messages
   *  from popup/floating approval cards) call this directly. */
  async function callRpc(method, args = {}) {
    const handler = rpcHandlers[method]
    if (!handler) throw new Error(`unknown method "${method}"`)
    return handler(args)
  }

  const rpcHandlers = {
    'session.list': () => api.rpc('session.list', {}),
    'session.search': ({ query }) => api.rpc('session.search', { query }),
    'session.history-older': ({ sessionId, beforeSeq }) => pullHistory(sessionId, { beforeSeq }),
    'session.create': async () => {
      const sessionId = newId()
      const value = await api.rpc('session.create', { sessionId })
      ensureSession({
        sessionId: value.sessionId,
        blank: true,
        running: false,
        updatedAt: Date.now(),
        origin: 'local-new',
      })
      broadcastSessionList()
      return value
    },
    'session.prompt': ({ sessionId, mode, content, clientTimeZone }) =>
      api.rpc('session.prompt', {
        sessionId,
        mode: mode === 'steer' ? 'steer' : 'queue',
        content,
        ...(clientTimeZone ? { clientTimeZone } : {}),
      }),
    'session.cancel': ({ sessionId }) => api.rpc('session.cancel', { sessionId }),
    'session.rename': ({ sessionId, title }) => api.rpc('session.rename', { sessionId, title }),
    'session.fork': async ({ sessionId, atSeq }) => {
      const value = await api.rpc('session.fork', {
        sessionId,
        ...(typeof atSeq === 'number' ? { atSeq } : {}),
      })
      if (value?.sessionId) {
        ensureSession({
          sessionId: value.sessionId,
          blank: false,
          running: false,
          updatedAt: Date.now(),
          origin: 'fork',
          parentSessionId: sessionId,
        })
        broadcastSessionList()
      }
      return value
    },
    'session.models': ({ sessionId }) => api.rpc('session.models', { sessionId }),
    'session.selectModel': ({ sessionId, provider, model, reasoningEffort }) =>
      api.rpc('session.selectModel', {
        sessionId,
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }),
    'session.queue-remove': ({ sessionId, itemId }) =>
      api.rpc('session.updateQueue', { sessionId, itemId, action: { kind: 'remove' } }),
    'approval.respond': ({ rpcId, sessionId, approvalId, outcome }) =>
      answerApproval(
        rpcId,
        sessionId,
        approvalId,
        outcome === 'rejected' ? 'rejected' : 'allowed-once',
      ),
    'question.respond': ({ rpcId, sessionId, answers }) =>
      answerQuestion(rpcId, sessionId, answers),
    'question.cancel': ({ rpcId, sessionId }) => cancelQuestion(rpcId, sessionId),
    'autoApprove.set': ({ sessionId, value }) => persistAutoApprove(sessionId, value),
    'gateway.diagnose': () => ({ ...connectionMessage(), sessions: sessions.size }),
    'gateway.diagnoseFull': () =>
      diagnoseDsh(endpoint, {
        probeDownlink:
          typeof downlink?.probe === 'function' ? () => downlink.probe(5_000) : undefined,
      }),
  }

  async function handleRequest(port, message) {
    const { id, method, args = {} } = message
    const handler = rpcHandlers[method]
    if (!handler) {
      port.postMessage({ type: 'res', id, ok: false, error: `unknown method "${method}"` })
      return
    }
    try {
      const value = await handler(args)
      port.postMessage({ type: 'res', id, ok: true, value })
    } catch (error) {
      port.postMessage({ type: 'res', id, ok: false, error: error?.message || String(error) })
    }
  }

  function handlePortMessage(port, message) {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'req':
        void handleRequest(port, message)
        break
      case 'subscribe-ledger': {
        const ids = ledgerSubscriptions.get(port) ?? new Set()
        ids.add(message.sessionId)
        ledgerSubscriptions.set(port, ids)
        pushLedger(message.sessionId)
        break
      }
      case 'unsubscribe-ledger': {
        ledgerSubscriptions.get(port)?.delete(message.sessionId)
        if (message.sessionId) refreshWaiting(message.sessionId)
        break
      }
      default:
        break
    }
  }

  /** @param {{ postMessage: Function, onMessage: object, onDisconnect: object }} port */
  function attachPort(port) {
    ports.add(port)
    ledgerSubscriptions.set(port, new Set())
    port.onMessage.addListener((message) => handlePortMessage(port, message))
    port.onDisconnect.addListener(() => {
      const ids = [...(ledgerSubscriptions.get(port) || [])]
      ports.delete(port)
      ledgerSubscriptions.delete(port)
      if (ids.length === 0) {
        host.setBadge?.(totalPending())
        return
      }
      for (const sessionId of ids) refreshWaiting(sessionId)
    })
    port.postMessage({ type: 'hello', ...connectionMessage() })
    port.postMessage(sessionListMessage())
    for (const sessionId of sessions.keys()) broadcastSession(sessionId)
  }

  // --- in-process ledger watches (the bridge provider translates ledger
  //     blocks into floating-window port messages through this) ---------------

  /**
   * Subscribe to a session's ledger pushes without a runtime port.
   * Immediately replays the current ledger snapshot, then follows debounced
   * pushes — the same stream ports receive.
   * @param {string} sessionId
   * @param {(message: { sessionId: string, blocks: object[], lastSeq: number }) => void} listener
   * @returns {() => void} unwatch
   */
  function watchLedger(sessionId, listener) {
    let watchers = ledgerWatchers.get(sessionId)
    if (!watchers) {
      watchers = new Set()
      ledgerWatchers.set(sessionId, watchers)
    }
    watchers.add(listener)
    const session = sessions.get(sessionId)
    if (session) {
      listener({
        sessionId,
        blocks: session.fold.getBlocks(),
        lastSeq: session.fold.getLastSeq(),
      })
    }
    return () => {
      watchers.delete(listener)
      if (watchers.size === 0) ledgerWatchers.delete(sessionId)
      refreshWaiting(sessionId)
    }
  }

  function pushLedger(sessionId) {
    const session = sessions.get(sessionId)
    if (!session) return
    const message = {
      type: 'ledger',
      sessionId,
      blocks: session.fold.getBlocks(),
      lastSeq: session.fold.getLastSeq(),
    }
    for (const watcher of ledgerWatchers.get(sessionId) || []) {
      try {
        watcher(message)
      } catch {
        // a broken watcher must not break the push path
      }
    }
    for (const [port, ids] of ledgerSubscriptions) {
      if (!ids.has(sessionId)) continue
      try {
        port.postMessage(message)
      } catch {
        // dead port
      }
    }
  }

  // --- lifecycle ---------------------------------------------------------------

  async function start() {
    if (!stopped) return
    stopped = false
    reconnectAttempt = 0
    api = client ?? createDshClient({ baseUrl: endpoint })
    await connect()
  }

  function stop({ reason } = {}) {
    stopped = true
    connectGeneration += 1
    if (reconnectTimer != null) {
      t.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (keepaliveTimer != null) {
      t.clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
    for (const timer of pendingLedgerPushes.values()) t.clearTimeout(timer)
    pendingLedgerPushes.clear()
    ledgerWatchers.clear()
    closeStreams()
    if (reason === 'disabled' || reason === 'invalid-endpoint') {
      const hold = helloForGatewayHold(reason)
      state.status = hold.status
      state.lastError = hold.lastError
    } else {
      state.status = 'offline'
    }
    broadcast({ type: 'connection', ...connectionMessage() })
    for (const port of [...ports]) {
      try {
        port.disconnect?.()
      } catch {
        // test doubles may not implement disconnect
      }
    }
    ports.clear()
    ledgerSubscriptions.clear()
    sessions.clear()
    host.setBadge?.(0)
    host.clearWaiting?.()
  }

  return {
    start,
    stop,
    attachPort,
    rpc: callRpc,
    watchLedger,
    getState: () => ({ ...state, sessions: sessions.size }),
    getSessionSummaries: () => [...sessions.values()].map(summarize),
    // test/inspection seams
    _internals: { sessions, handleMuxFrame, handleHostFrame, pullHistory, syncRegistry },
  }
}
