import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import {
  GEMINI_NATIVE_CONTRACTS,
  GEMINI_WEB_MAX_CONCURRENT,
  GEMINI_WEB_MAX_TABS,
  GEMINI_WEB_MODEL,
  GEMINI_WEB_SELECTION,
  GEMINI_WEB_TIMEOUT_MS,
} from '../config/gemini-web.mjs'
import { runGeminiNativeOperation } from '../services/clients/gemini-web/native-runtime.mjs'
import { inspectGeminiPublicCompilation } from '../services/clients/gemini-web/runtime-inspection.mjs'
import { resolveAutomaticGeminiContract } from '../services/clients/gemini-web/automatic-contract.mjs'
import { pushRecord } from '../services/apis/shared.mjs'
import { bindingSnapshotKey } from '../services/session-binding.mjs'
import { EngineError } from '../engines/contract.mjs'

export const GEMINI_WEB_RUNTIME_KEY = 'geminiWebRuntimeV1'

function isGeminiPage(raw) {
  try {
    const url = new URL(raw)
    return (
      url.origin === 'https://gemini.google.com' &&
      /^\/app(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

function notSent(message) {
  const error = new Error(message)
  error.dispatched = false
  return error
}

// The background is the only state writer. Short read/modify/write transactions
// serialize its journal; generation runs independently in pinned documents.
// No UI/content context writes the journal and no startup job resubmits it.
export function createGeminiWebService(deps = {}) {
  const browser = deps.browser || Browser
  const getConfig = deps.getConfig || getUserConfig
  const setConfig = deps.setConfig || setUserConfig
  const now = deps.now || Date.now
  const delay = deps.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const uuid = deps.uuid || (() => crypto.randomUUID())
  const resolveAutomatic = deps.resolveAutomatic || resolveAutomaticGeminiContract
  // Volatile and document-scoped: restarting never grants a replay or persists
  // an automatically learned website version as a new trusted reference.
  const automaticContracts = new Map()
  const activeRuns = new Map()
  let maintenance = false
  let reading = false
  let stateQueue = Promise.resolve()
  let submissionQueue = Promise.resolve()
  let observedAccountPause = null
  let storageUnavailable = false

  async function load() {
    if (storageUnavailable)
      throw new Error('Gemini safety storage is unavailable. No new write is allowed.')
    let stored
    try {
      stored = await browser.storage.local.get(GEMINI_WEB_RUNTIME_KEY)
    } catch (error) {
      storageUnavailable = true
      throw error
    }
    if (!stored || typeof stored !== 'object')
      throw notSent(
        'Gemini safety state could not be read. Check extension storage before sending.',
      )
    let value = stored[GEMINI_WEB_RUNTIME_KEY]
    if (value === undefined)
      return {
        version: 2,
        tabs: [],
        holds: {},
        hold: true,
        accountSalt: '',
        accountFingerprint: '',
      }
    if (value && (value.version === undefined || value.version === 1)) {
      const previous = value.hold
      if (previous && (typeof previous !== 'object' || typeof previous.requestId !== 'string'))
        throw new Error('The legacy Gemini hold cannot be identified. Inspect its safety state.')
      const tab = value.tabs?.find((entry) => entry.tabId === previous?.tabId)
      value = {
        ...value,
        version: 2,
        holds: previous
          ? { [previous.requestId]: { ...previous, binding: previous.binding || tab?.binding } }
          : {},
        // Old native owners validate hold as an object. This deliberate v2
        // fence makes them refuse instead of overlooking multiple protections.
        hold: true,
      }
    }
    if (
      !value ||
      value.version !== 2 ||
      value.hold !== true ||
      !Array.isArray(value.tabs) ||
      value.tabs.length > GEMINI_WEB_MAX_TABS ||
      !value.holds ||
      typeof value.holds !== 'object' ||
      Array.isArray(value.holds) ||
      Object.entries(value.holds).some(([id, hold]) => !id || hold?.requestId !== id)
    )
      throw new Error(
        'Gemini safety state is invalid. Inspect the website before repairing local state.',
      )
    if (
      (value.accountSalt &&
        (typeof value.accountSalt !== 'string' || value.accountSalt.length > 128)) ||
      (value.accountFingerprint && !/^[a-f0-9]{64}$/.test(value.accountFingerprint)) ||
      [...value.tabs, ...(value.readTab ? [value.readTab] : [])].some(
        (entry) =>
          !Number.isInteger(entry?.tabId) ||
          typeof entry.ownerId !== 'string' ||
          typeof entry.binding !== 'string' ||
          entry.accountSalt !== value.accountSalt ||
          entry.accountFingerprint !== value.accountFingerprint,
      )
    )
      throw new Error(
        'Gemini account or tab binding state is invalid. Check the website before repairing local state.',
      )
    return structuredClone(value)
  }
  async function save(state) {
    try {
      await browser.storage.local.set({ [GEMINI_WEB_RUNTIME_KEY]: state })
    } catch (error) {
      storageUnavailable = true
      throw error
    }
  }
  function stateAction(change, write = false) {
    const pending = stateQueue
      .catch(() => {})
      .then(async () => {
        const state = await load()
        const result = await change(state)
        if (write) await save(state)
        return structuredClone(result)
      })
    stateQueue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }
  const mutate = (change) => stateAction(change, true)
  function submissionAction(action) {
    const pending = submissionQueue.catch(() => {}).then(action)
    submissionQueue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }
  const holds = (state) => Object.values(state.holds)
  function nativeError(result, unsent = false) {
    return Object.assign(new Error(result.message || 'Gemini could not confirm this operation.'), {
      code: result.code,
      ...(result.accountBlocked === true ? { accountBlocked: true } : {}),
      ...(unsent || result.dispatched === false ? { dispatched: false } : {}),
    })
  }
  async function pauseAccount(error) {
    if (error.accountBlocked !== true) return
    observedAccountPause = { code: error.code, message: error.message, at: now() }
    await submissionAction(() =>
      mutate((state) => {
        state.accountPause = observedAccountPause
      }),
    )
    await setConfig({ geminiWebReady: false })
  }
  function checkedEntry(state, entry) {
    const current = state.tabs.find(
      (item) =>
        item.tabId === entry.tabId &&
        item.ownerId === entry.ownerId &&
        item.binding === entry.binding,
    )
    if (!current)
      throw new Error('The Gemini writer allocation changed. No request will be replayed.')
    return current
  }
  const persistEntry = (entry) =>
    mutate((state) => {
      Object.assign(checkedEntry(state, entry), {
        documentId: entry.documentId,
        writerEpoch: entry.writerEpoch,
      })
    })
  async function updateHold(entry, requestId, change) {
    return mutate((state) => {
      const current = state.holds[requestId]
      if (
        !current ||
        current.ownerId !== entry.ownerId ||
        current.documentId !== entry.documentId ||
        current.writerEpoch !== (entry.writerEpoch || 0)
      )
        throw new Error('The Gemini submission protection changed. Inspect its original execution.')
      return change(state, current)
    })
  }
  const clearHold = (entry, requestId) =>
    updateHold(entry, requestId, (state) => {
      delete state.holds[requestId]
    })
  async function checkAccountPause() {
    const paused = observedAccountPause || (await stateAction((state) => state.accountPause))
    if (paused || observedAccountPause)
      throw new Error(
        (observedAccountPause || paused).message ||
          'Check the paused Gemini account before submitting another request.',
      )
  }
  async function enabled() {
    const config = await getConfig()
    if (config?.geminiWebEnabled !== true)
      throw notSent('Gemini Web is disabled. Enable it in Settings → Engines.')
    if (!browser.scripting?.executeScript)
      throw notSent(
        'Gemini Web currently requires desktop Chromium with MAIN document scripting support.',
      )
    return config
  }
  async function invoke(entry, action, data = {}, discover = true) {
    let automatic
    const dispatch = async () => {
      const tab = await browser.tabs.get(entry.tabId)
      if (!isGeminiPage(tab?.url))
        throw new Error(
          'The dedicated Gemini tab was closed or navigated away. Inspect its existing result; it will not be sent again.',
        )
      const target = entry.documentId
        ? { tabId: entry.tabId, documentIds: [entry.documentId] }
        : { tabId: entry.tabId, frameIds: [0] }
      automatic = automaticContracts.get(entry.documentId)
      // The gate ends at the browser's dispatch boundary, not at its eventual
      // reply. A stalled document must not block either remaining writer.
      if (action === 'send') await checkAccountPause()
      if (action === 'send' && observedAccountPause) throw new Error(observedAccountPause.message)
      return {
        pending: browser.scripting.executeScript({
          target,
          world: 'MAIN',
          func: runGeminiNativeOperation,
          args: [
            {
              action,
              ownerId: entry.ownerId,
              contracts: automatic
                ? [...GEMINI_NATIVE_CONTRACTS, automatic]
                : GEMINI_NATIVE_CONTRACTS,
              accountSalt: entry.accountSalt,
              expectedAccountFingerprint: entry.accountFingerprint,
              ...data,
            },
          ],
        }),
      }
    }
    const dispatched = action === 'send' ? await submissionAction(dispatch) : await dispatch()
    const results = await dispatched.pending
    if (
      !Array.isArray(results) ||
      results.length !== 1 ||
      results[0].frameId !== 0 ||
      typeof results[0].documentId !== 'string' ||
      !results[0].documentId
    )
      throw new Error(
        'Gemini document identity could not be verified. No automatic retry will be made.',
      )
    if (entry.documentId && results[0].documentId !== entry.documentId)
      throw new Error('The Gemini document changed. No automatic retry will be made.')
    entry.documentId = results[0].documentId
    const result = results[0].result
    if (!result || typeof result.ok !== 'boolean')
      throw new Error('The Gemini native operation returned no verifiable result.')
    if (result.accountBlocked === true)
      observedAccountPause = { code: result.code, message: result.message, at: now() }
    if (result.discoveryNeeded === true && !automatic && automaticContracts.has(entry.documentId))
      return invoke(entry, action, data, false)
    if (
      result.ok === false &&
      result.code === 'GEMINI_RUNTIME_UNSUPPORTED' &&
      result.discoveryNeeded === true &&
      result.dispatched === false &&
      discover &&
      !automatic &&
      ['inspect', 'configure', 'connect', 'list', 'read'].includes(action)
    ) {
      const inspection = await browser.scripting.executeScript({
        target: { tabId: entry.tabId, documentIds: [entry.documentId] },
        world: 'MAIN',
        func: inspectGeminiPublicCompilation,
        args: [{ action: 'inspect-public-compilation' }],
      })
      if (
        !Array.isArray(inspection) ||
        inspection.length !== 1 ||
        inspection[0].frameId !== 0 ||
        inspection[0].documentId !== entry.documentId
      )
        return result
      const contract = await resolveAutomatic(inspection[0].result)
      if (!contract)
        return {
          ...result,
          message:
            'The Gemini compilation could not be confirmed as an identifier-only change. Update the adapter before sending.',
        }
      if (automaticContracts.size >= 8)
        automaticContracts.delete(automaticContracts.keys().next().value)
      automaticContracts.set(entry.documentId, contract)
      // The refused preflight performed no native operation. Re-enter once
      // with the proven mapping, in the same exact document, retaining every
      // original account/model/instance/fingerprint and submission guard.
      return invoke(entry, action, data, false)
    }
    if (
      (result.nativeId != null &&
        (typeof result.nativeId !== 'string' || result.nativeId.length > 512)) ||
      (result.conversationId != null &&
        (typeof result.conversationId !== 'string' || result.conversationId.length > 512)) ||
      (result.answer != null &&
        (typeof result.answer !== 'string' || result.answer.length > 1000000)) ||
      ['serverTurnId', 'responseId'].some(
        (key) =>
          result[key] != null && (typeof result[key] !== 'string' || result[key].length > 512),
      ) ||
      (result.accepted === true && !result.nativeId) ||
      (result.accountBlocked !== undefined && typeof result.accountBlocked !== 'boolean') ||
      (result.answer && (!result.nativeId || result.accepted !== true)) ||
      (result.responseTimestamp != null &&
        (typeof result.responseTimestamp !== 'string' ||
          result.responseTimestamp.length > 30 ||
          !Number.isFinite(Date.parse(result.responseTimestamp)) ||
          new Date(result.responseTimestamp).toISOString() !== result.responseTimestamp)) ||
      (result.url != null && !isGeminiPage(result.url))
    )
      throw Object.assign(
        new Error('The Gemini native result has an unsupported identity or output shape.'),
        result.accountBlocked === true ? { accountBlocked: true, code: result.code } : {},
      )
    return result
  }
  async function prune(state) {
    const retained = []
    for (const entry of state.tabs) {
      const tab = await browser.tabs.get(entry.tabId).catch(() => null)
      if (tab && isGeminiPage(tab.url)) retained.push(entry)
    }
    state.tabs = retained
  }
  const reservedWriter = (state, tabId) =>
    holds(state).some((hold) => hold.tabId === tabId) ||
    [...activeRuns.values()].some((run) => run.tabId === tabId)
  async function reclaimFinishedWriter(state) {
    const candidates = state.tabs
      .filter(
        (entry) =>
          entry.completed && entry.conversationId && entry.serverTurnId && entry.responseId,
      )
      .sort((left, right) => left.completedAt - right.completedAt)
    for (const entry of candidates) {
      if (reservedWriter(state, entry.tabId)) continue
      const tab = await browser.tabs.get(entry.tabId).catch(() => null)
      if (!tab || tab.active || !isGeminiPage(tab.url)) continue
      const probe = { ...entry, documentId: undefined }
      const checked = await invoke(probe, 'inspect').catch(() => null)
      if (checked?.accountBlocked) throw nativeError(checked, true)
      if (
        !checked?.ok ||
        !checked.ready ||
        checked.busy ||
        checked.draft ||
        probe.documentId !== entry.documentId ||
        checked.conversationId !== entry.conversationId ||
        checked.serverHead !== entry.serverTurnId ||
        checked.responseHead !== entry.responseId
      )
        continue
      const current = await browser.tabs.get(entry.tabId).catch(() => null)
      if (!current || current.active || current.url !== tab.url) continue
      // Only a hidden, unchanged, verified completed writer is retired. The
      // conversation remains in native history; future append revalidates it.
      await browser.tabs.remove(entry.tabId)
      state.tabs = state.tabs.filter((item) => item.tabId !== entry.tabId)
      return
    }
  }
  async function ensureTab(state, session) {
    await prune(state)
    const binding = bindingSnapshotKey(session)
    if (session.geminiWebTabId) {
      const entry = state.tabs.find(
        (item) =>
          item.tabId === session.geminiWebTabId &&
          item.ownerId === session.geminiWebOwnerId &&
          item.binding === binding,
      )
      if (!entry && !session.conversationId)
        throw notSent(
          'The original Gemini tab is unavailable. Check the website and start a new extension conversation; history will not be replayed.',
        )
      if (entry) return entry
    }
    if (session.conversationId && !/^c_[a-zA-Z0-9_-]{8,100}$/.test(session.conversationId))
      throw notSent(
        'This Gemini conversation has no verified native identity. Open it from history before continuing.',
      )
    if (!session.conversationId) {
      // An explicit new request may reuse an owned, still-empty native document.
      // This never navigates a writer or replays an old prompt. A fresh account,
      // draft, activity and zero-turn check is required before changing its local
      // binding; configure/connect/prepare still verify it again before Send.
      for (const candidate of state.tabs) {
        if (candidate.binding === binding) continue
        if (reservedWriter(state, candidate.tabId)) continue
        const tab = await browser.tabs.get(candidate.tabId).catch(() => null)
        if (tab?.url !== `https://gemini.google.com/app#chatgptbox-gemini-${candidate.ownerId}`)
          continue
        const probe = { ...candidate, documentId: undefined }
        const status = await invoke(probe, 'inspect').catch(() => null)
        if (status?.accountBlocked) throw nativeError(status, true)
        if (
          !status?.ok ||
          status.busy ||
          status.draft ||
          status.conversationId ||
          status.turnCount !== 0
        )
          continue
        candidate.binding = binding
        // Re-run native configuration and advance the writer generation even
        // when the blank document itself did not change.
        delete candidate.documentId
        session.geminiWebTabId = candidate.tabId
        session.geminiWebOwnerId = candidate.ownerId
        return candidate
      }
    }
    if (state.tabs.length >= GEMINI_WEB_MAX_TABS) await reclaimFinishedWriter(state)
    if (state.tabs.length >= GEMINI_WEB_MAX_TABS)
      throw notSent(
        `Close a finished ChatGPTBox Gemini tab before creating another (limit ${GEMINI_WEB_MAX_TABS}). Website history is retained.`,
      )
    const ownerId = uuid()
    const tab = await browser.tabs.create({
      url: `https://gemini.google.com/app${
        session.conversationId ? '/' + session.conversationId.slice(2) : ''
      }#chatgptbox-gemini-${ownerId}`,
      active: false,
    })
    if (!Number.isInteger(tab?.id)) throw notSent('A dedicated Gemini tab could not be created.')
    const entry = {
      tabId: tab.id,
      ownerId,
      binding,
      accountSalt: state.accountSalt,
      accountFingerprint: state.accountFingerprint,
    }
    state.tabs.push(entry)
    session.geminiWebTabId = entry.tabId
    session.geminiWebOwnerId = entry.ownerId
    return entry
  }
  const post = (port, packet) => {
    try {
      port.postMessage(packet)
    } catch {
      /* disconnected observer */
    }
  }

  async function run({ session, port }) {
    const requestId = uuid()
    const control = {
      requestId,
      runId: session.messageId || null,
      binding: bindingSnapshotKey(session),
      conversationId: session.conversationId || '',
      tabId: null,
    }
    let entry,
      journaled = false,
      nativePrepared = false,
      invoked = false
    let stopped = false,
      disconnected = false,
      answer = '',
      accepted = false,
      terminalPosted = false
    const finish = (packet) => {
      if (terminalPosted) return
      terminalPosted = true
      post(port, packet)
    }
    const cancelled = () =>
      stopped ||
      disconnected ||
      port.__stopRequested === true ||
      port.__uiPort?.__stopRequested === true
    const onMessage = (message) => {
      if (!message?.stop || stopped || terminalPosted) return
      stopped = true
      // Finalize synchronously before the shared run guard's fallback Stop ack.
      finish({
        done: true,
        outcome: 'stopped',
        answer: `${
          answer ? answer + '\n\n' : ''
        }Stopped waiting. Gemini may still be working; check its tab before allowing another request.`,
        session,
      })
    }
    const onDisconnect = () => {
      disconnected = true
    }
    port.onMessage?.addListener(onMessage)
    port.onDisconnect?.addListener(onDisconnect)
    try {
      await enabled()
      if (
        session.modelName !== GEMINI_WEB_SELECTION ||
        session.isRetry ||
        session.chatgptWebImagePointers?.length ||
        session.images?.length
      )
        throw notSent(
          'Gemini Web supports 4 Hydrogen / Medium text chat. Regeneration and attachments are not supported.',
        )
      if (
        typeof session.question !== 'string' ||
        !session.question.trim() ||
        session.question.length > 50000
      )
        throw notSent('Gemini Web accepts a nonempty text prompt of at most 50,000 characters.')
      if (cancelled()) return
      entry = await mutate(async (state) => {
        if (maintenance)
          throw notSent('Wait for the Gemini settings check before starting new work.')
        if (state.accountPause || observedAccountPause)
          throw notSent((observedAccountPause || state.accountPause).message)
        const protectedRuns = holds(state).filter((hold) => !activeRuns.has(hold.requestId))
        if (activeRuns.size + protectedRuns.length >= GEMINI_WEB_MAX_CONCURRENT)
          throw notSent(
            `All ${GEMINI_WEB_MAX_CONCURRENT} Gemini slots have active or unresolved requests. No request was queued.`,
          )
        const conflicts = [...activeRuns.values(), ...holds(state)]
        if (
          conflicts.some(
            (other) =>
              other.binding === control.binding ||
              (control.conversationId && other.conversationId === control.conversationId) ||
              (session.geminiWebTabId && other.tabId === session.geminiWebTabId) ||
              (control.conversationId && !other.conversationId && state.holds[other.requestId]),
          )
        )
          throw notSent(
            'This Gemini conversation has an active or unresolved request. Inspect that execution before appending.',
          )
        if (!state.accountSalt || !/^[a-f0-9]{64}$/.test(state.accountFingerprint || ''))
          throw notSent(
            'Check the Gemini page in Settings → Gemini Web first. This binds the selected account without exporting its identity.',
          )
        activeRuns.set(requestId, control)
        const allocated = await ensureTab(state, session)
        control.tabId = allocated.tabId
        return allocated
      })
      const loadingDeadline = now() + 60000
      while ((await browser.tabs.get(entry.tabId)).status !== 'complete') {
        if (now() >= loadingDeadline)
          throw notSent(
            'Gemini did not finish loading. Check its dedicated tab before sending again.',
          )
        await delay(300)
      }
      post(port, { session }) // binding only: not provider acceptance
      if (cancelled()) return
      const continuation = {
        conversationId: session.conversationId || '',
        lastServerTurnId: session.geminiWebServerTurnId || '',
        lastResponseId: session.geminiWebResponseId || '',
      }
      const currentDocument = { ...entry, documentId: undefined }
      const inspected = await invoke(currentDocument, 'inspect')
      if (!inspected.ok) throw nativeError(inspected, true)
      const documentChanged = entry.documentId !== currentDocument.documentId
      if (
        session.conversationId &&
        (inspected.conversationId !== session.conversationId ||
          (session.geminiWebServerTurnId
            ? inspected.serverHead !== session.geminiWebServerTurnId
            : inspected.clientHead !== session.geminiWebLastNativeId))
      )
        throw notSent(
          'The native Gemini conversation head changed. Read its current history before continuing.',
        )
      // Gemini removes the creation fragment when it assigns its canonical
      // conversation URL. A tracked writer can reopen only after this fresh
      // account/conversation/head check; MAIN repeats the same native proof.
      continuation.verifiedReopen = !!(session.conversationId && session.geminiWebServerTurnId)
      if (documentChanged) {
        entry.documentId = currentDocument.documentId
        entry.writerEpoch = (entry.writerEpoch || 0) + 1
        await persistEntry(entry)
        if (cancelled()) return
        const configured = await invoke(entry, 'configure', continuation)
        if (!configured.ok) throw nativeError(configured, true)
        if (cancelled()) return
      }
      const connected = await invoke(entry, 'connect', continuation)
      if (!connected.ok) throw nativeError(connected, true)
      session.geminiWebDocumentId = entry.documentId
      await persistEntry(entry)
      if (cancelled()) return
      await enabled()
      session.geminiWebRequestId = requestId
      // The previous server head is a continuation input, never this run's
      // recovery evidence. Only a newly observed response can create that proof.
      delete session.geminiWebOutputIdentity
      delete session.geminiWebResponseTimestamp
      await mutate((state) => {
        if (state.accountPause || observedAccountPause)
          throw notSent((observedAccountPause || state.accountPause).message)
        checkedEntry(state, entry)
        state.holds[requestId] = {
          requestId,
          runId: control.runId,
          binding: control.binding,
          conversationId: control.conversationId,
          tabId: entry.tabId,
          documentId: entry.documentId,
          ownerId: entry.ownerId,
          writerEpoch: entry.writerEpoch || 0,
          phase: 'possibly-sent',
          at: now(),
        }
      }) // acknowledged BEFORE native draft/submission
      journaled = true
      if (cancelled()) return
      nativePrepared = true
      const prepared = await invoke(entry, 'prepare', {
        requestId,
        question: session.question,
        conversationId: session.conversationId || '',
        lastNativeId: session.geminiWebLastNativeId || '',
        lastServerTurnId: session.geminiWebServerTurnId || '',
        lastResponseId: session.geminiWebResponseId || '',
      })
      if (!prepared.ok) {
        if (prepared.dispatched === false) {
          await clearHold(entry, requestId)
          journaled = false
        }
        throw nativeError(prepared)
      }
      await delay(100) // allow the native control to render; no network polling
      if (cancelled()) return
      await enabled()
      if (cancelled()) return
      await checkAccountPause()
      if (cancelled()) return
      invoked = true // executeScript failure cannot prove the native call was unsent
      let result = await invoke(entry, 'send', { requestId })
      const deadline = now() + (deps.timeoutMs ?? GEMINI_WEB_TIMEOUT_MS)
      while (!cancelled()) {
        if (!result.ok) {
          if (result.dispatched === false) {
            await clearHold(entry, requestId)
            journaled = false
          }
          throw nativeError(result)
        }
        if (result.nativeId) {
          session.geminiWebLastNativeId = result.nativeId
          if (
            control.nativeId !== result.nativeId ||
            (result.conversationId && control.conversationId !== result.conversationId)
          ) {
            await updateHold(entry, requestId, (_state, hold) => {
              hold.nativeId = result.nativeId
              if (result.conversationId) hold.conversationId = result.conversationId
            })
            control.nativeId = result.nativeId
          }
          if (result.conversationId) control.conversationId = result.conversationId
        }
        if (result.serverTurnId && result.accepted && result.nativeId) {
          if (result.serverTurnId === continuation.lastServerTurnId)
            throw new Error('Gemini did not establish a new server turn for this request.')
          session.geminiWebServerTurnId = result.serverTurnId
          session.geminiWebResponseId = result.responseId || null
          session.geminiWebResponseTimestamp = result.responseTimestamp || null
          const outputIdentity = {
            requestId,
            runId: session.messageId || null,
            conversationId: result.conversationId || session.conversationId,
            serverTurnId: result.serverTurnId,
            responseId: result.responseId || null,
          }
          if (
            control.serverTurnId !== result.serverTurnId ||
            control.responseId !== (result.responseId || null)
          ) {
            await updateHold(entry, requestId, (_state, hold) => {
              hold.serverTurnId = result.serverTurnId
              hold.responseId = result.responseId || null
              hold.outputIdentity = outputIdentity
            })
            control.serverTurnId = result.serverTurnId
            control.responseId = result.responseId || null
          }
          session.geminiWebOutputIdentity = outputIdentity
        }
        if (cancelled()) return
        if (result.conversationId) session.conversationId = result.conversationId
        if (result.url) session.geminiWebUrl = result.url
        if (result.accepted && result.nativeId && !accepted) {
          accepted = true
          post(port, { accepted: true, started: true, session })
        }
        if (typeof result.answer === 'string' && result.answer && result.answer !== answer) {
          answer = result.answer
          post(port, { answer, session, done: false })
        }
        if (result.completed === true && accepted && answer) {
          if (!Array.isArray(session.conversationRecords)) session.conversationRecords = []
          pushRecord(session, session.question, answer)
          // Publish the verified terminal result synchronously before async
          // journal cleanup. Stop wins until this point; after it, shared port
          // guards and this owner both suppress another terminal outcome.
          finish({ answer, finalContent: answer, outcome: 'completed', done: true, session })
          await updateHold(entry, requestId, (state) => {
            const current = checkedEntry(state, entry)
            Object.assign(current, {
              completed: true,
              conversationId: session.conversationId || '',
              serverTurnId: session.geminiWebServerTurnId || null,
              responseId: session.geminiWebResponseId || null,
              completedAt: now(),
            })
            delete state.holds[requestId]
          })
          journaled = false
          return
        }
        if (now() >= deadline)
          throw new Error(
            'Gemini did not reach a verified final response before the wait deadline. Inspect its existing turn; no second submission will be made.',
          )
        await delay(1000)
        if (!cancelled()) result = await invoke(entry, 'observe', { requestId })
      }
    } catch (error) {
      try {
        await pauseAccount(error)
      } catch {
        /* storage failure cannot release protection */
      }
      if (!cancelled())
        finish({
          error: error.message || 'Gemini Web could not complete the request.',
          ...(error.dispatched === false || (!journaled && !invoked) ? { dispatched: false } : {}),
          answer,
          session,
          done: true,
          outcome: invoked ? 'incomplete' : 'failed',
        })
    } finally {
      // Stop is explicit. A disconnected UI only detaches; it must not create
      // an unrelated abort write or release an uncertain submission record.
      if (observedAccountPause)
        await pauseAccount({ ...observedAccountPause, accountBlocked: true }).catch(() => {})
      if (stopped && invoked && entry && requestId)
        await invoke(entry, 'stop', { requestId }).catch(() => {})
      if (entry && nativePrepared) await invoke(entry, 'close', { requestId }).catch(() => {})
      port.onMessage?.removeListener(onMessage)
      port.onDisconnect?.removeListener(onDisconnect)
      activeRuns.delete(requestId)
    }
  }

  async function inspectImpl() {
    await enabled()
    let state = await stateAction((value) => value)
    const tabs = await browser.tabs.query({ url: 'https://gemini.google.com/app*' })
    const tab =
      tabs.find((item) => item.active && isGeminiPage(item.url)) ||
      tabs.find((item) => isGeminiPage(item.url))
    if (!tab) {
      await setConfig({ geminiWebReady: false })
      return {
        ok: false,
        ready: false,
        hold: holds(state).length > 0,
        message: 'Open Gemini in this browser, sign in, and select 4 Hydrogen / Medium.',
      }
    }
    if (!state.accountSalt) {
      state = await mutate((value) => {
        value.accountSalt ||= uuid()
        return value
      })
    }
    const owned = state.tabs.find((item) => item.tabId === tab.id)
    const result = await invoke(
      owned
        ? { ...owned, documentId: undefined }
        : {
            tabId: tab.id,
            accountSalt: state.accountSalt,
            accountFingerprint: state.accountFingerprint,
          },
      'inspect',
    )
    if (result.accountBlocked) await pauseAccount(nativeError(result))
    if (result.ok && result.ready && !state.accountFingerprint) {
      if (!/^[a-f0-9]{64}$/.test(result.accountFingerprint || ''))
        throw new Error('The Gemini account check returned no verifiable identity.')
      await mutate((value) => {
        value.accountFingerprint = result.accountFingerprint
      })
    }
    await setConfig({ geminiWebReady: result.ok && result.ready === true })
    const { accountFingerprint: _privateIdentity, ...publicResult } = result
    void _privateIdentity
    return { ...publicResult, hold: holds(state).length > 0 }
  }
  async function inspect() {
    if (maintenance || reading || activeRuns.size)
      return {
        ok: false,
        ready: false,
        active: true,
        message: 'Wait for the active Gemini operation before checking the account.',
      }
    maintenance = true
    try {
      return await inspectImpl()
    } finally {
      maintenance = false
    }
  }
  async function open() {
    await enabled()
    const state = await stateAction((value) => value)
    const entry = holds(state)[0] || state.tabs.at(-1)
    const tab = entry && (await browser.tabs.get(entry.tabId).catch(() => null))
    if (tab && isGeminiPage(tab.url)) {
      await browser.tabs.update(tab.id, { active: true })
      return { ok: true }
    }
    await browser.tabs.create({ url: 'https://gemini.google.com/app', active: true })
    return { ok: true }
  }
  async function review({ acknowledgeUnverified = false, protectedRuns = [] } = {}) {
    if (maintenance || reading || activeRuns.size)
      throw new Error(
        'Wait for the active Gemini operation to finish before allowing new requests.',
      )
    maintenance = true
    try {
      const checked = await inspectImpl()
      if (!checked.ok || !checked.ready)
        throw new Error(
          checked.message ||
            'Check Gemini, its model/Medium setting, draft and active generation before allowing new requests.',
        )
      const state = await stateAction((value) => value)
      const reviewed = []
      const targets = holds(state).map((hold) => ({ hold, native: true }))
      for (const record of protectedRuns) {
        const session = record.nativeRef?.session || {}
        if (
          targets.some(
            ({ hold }) =>
              hold.runId === record.runId ||
              (session.geminiWebRequestId &&
                hold.requestId === session.geminiWebRequestId &&
                (!hold.ownerId || hold.ownerId === session.geminiWebOwnerId) &&
                (!hold.documentId || hold.documentId === session.geminiWebDocumentId)),
          )
        )
          continue
        targets.push({
          native: false,
          hold: {
            requestId: session.geminiWebRequestId || `unconfirmed:${record.runId}`,
            runId: record.runId,
            tabId: session.geminiWebTabId,
            ownerId: session.geminiWebOwnerId,
            documentId: session.geminiWebDocumentId,
          },
        })
      }
      for (const { hold, native } of targets) {
        const tracked = state.tabs.find(
          (item) => item.tabId === hold.tabId && (!hold.ownerId || item.ownerId === hold.ownerId),
        )
        const entry = tracked && {
          ...tracked,
          ...(hold.documentId ? { documentId: hold.documentId } : {}),
        }
        const tab = entry && (await browser.tabs.get(entry.tabId).catch(() => null))
        let unverified = true
        if (tab && isGeminiPage(tab.url)) {
          let result
          try {
            result = await invoke(entry, 'review')
          } catch {
            /* old document may have gone */
          }
          if (result?.ok) unverified = false
          else {
            if (result && !['GEMINI_DOCUMENT_CHANGED', 'GEMINI_TURN_CHANGED'].includes(result.code))
              throw nativeError(result)
            // Read the CURRENT document only; never retarget a writer or Stop.
            // Missing ownership cannot establish the old request's outcome.
            const current = await invoke({ ...entry, documentId: undefined }, 'inspect')
            if (!current.ok || !current.ready) throw nativeError(current)
          }
        }
        if (unverified && acknowledgeUnverified !== true) {
          return {
            ok: false,
            ready: true,
            hold: true,
            needsUnverifiedAcknowledgement: true,
            message:
              'The original Gemini document is unavailable or was reloaded. Inspect the old result on the website, then explicitly acknowledge that its outcome remains unconfirmed.',
          }
        }
        reviewed.push({ hold, unverified, native })
      }
      await submissionAction(async () => {
        await mutate((value) => {
          for (const { hold, unverified, native } of reviewed) {
            const current = value.holds[hold.requestId]
            if (native && (!current || JSON.stringify(current) !== JSON.stringify(hold)))
              throw new Error(
                'A Gemini protection changed during review. Check the original executions again.',
              )
            value.lastReviewed = {
              requestId: hold.requestId,
              at: now(),
              outcome: unverified ? 'unconfirmed-user-reviewed' : 'document-reviewed',
            }
            // Retire the uncertain writer binding, retaining its website page
            // for inspection. A later append must read a fresh verified head.
            value.tabs = value.tabs.filter(
              (item) =>
                item.tabId !== hold.tabId || (hold.ownerId && item.ownerId !== hold.ownerId),
            )
            delete value.holds[hold.requestId]
          }
          value.lastReview = {
            at: now(),
            requests: reviewed.map(({ hold, unverified }) => ({
              requestId: hold.requestId,
              runId: hold.runId || null,
              outcome: unverified ? 'unconfirmed-user-reviewed' : 'document-reviewed',
            })),
          }
          value.accountPause = null
        })
        observedAccountPause = null
      })
      return { ok: true, ready: true, hold: false }
    } catch (error) {
      await pauseAccount(error)
      throw error
    } finally {
      maintenance = false
    }
  }
  async function listModels() {
    const config = await getConfig()
    return config.geminiWebEnabled === true && config.geminiWebReady === true
      ? [GEMINI_WEB_MODEL]
      : []
  }
  async function readImpl(action, query = {}) {
    await enabled()
    const state = await stateAction((value) => value)
    if (!state.accountFingerprint)
      throw notSent('Check the Gemini account in Settings before reading history.')
    let entry
    // A bounded read tab never navigates or refreshes a writer's document.
    for (const candidate of [state.readTab].filter(Boolean)) {
      const tab = await browser.tabs.get(candidate.tabId).catch(() => null)
      if (tab && isGeminiPage(tab.url)) {
        entry = { ...candidate, documentId: undefined }
        break
      }
    }
    if (!entry) {
      const ownerId = uuid()
      const tab = await browser.tabs.create({
        url: `https://gemini.google.com/app#chatgptbox-gemini-read-${ownerId}`,
        active: false,
      })
      entry = {
        tabId: tab.id,
        ownerId,
        binding: 'readonly-history',
        accountSalt: state.accountSalt,
        accountFingerprint: state.accountFingerprint,
      }
      await mutate((value) => {
        value.readTab = entry
      })
      const deadline = now() + 60000
      while ((await browser.tabs.get(tab.id)).status !== 'complete') {
        if (now() >= deadline) throw notSent('Gemini history page did not finish loading.')
        await delay(300)
      }
    }
    const result = await invoke(entry, action, query)
    if (result.accountBlocked) await pauseAccount(nativeError(result))
    if (!result.ok)
      throw new EngineError(
        result.code === 'GEMINI_HISTORY_INVALID'
          ? 'INVALID_REQUEST'
          : /UNSUPPORTED/.test(result.code || '')
          ? 'OPERATION_NOT_IMPLEMENTED'
          : 'ENGINE_NOT_READY',
        result.message,
      )
    const { accountFingerprint: _privateAccount, ok: _ok, ...data } = result
    void _privateAccount
    void _ok
    return {
      ...data,
      source: 'native-history',
      checkedAt: now(),
      completeness: data.nextCursor ? 'partial' : 'complete',
    }
  }
  async function exclusiveRead(action) {
    if (maintenance || reading)
      throw new EngineError(
        'ENGINE_BUSY',
        'Wait for the active Gemini history or settings check before another read.',
      )
    reading = true
    try {
      return await action()
    } finally {
      reading = false
    }
  }
  async function listConversations(query = {}) {
    return exclusiveRead(async () => {
      if (query.conversationId)
        return readImpl('history.list', { conversationId: query.conversationId, limit: 1 })
      let cursor = { pinned: true, token: '' }
      if (query.cursor) {
        if (typeof query.cursor !== 'string' || query.cursor.length > 20000)
          throw notSent('Invalid Gemini history cursor.')
        try {
          cursor = JSON.parse(query.cursor)
        } catch {
          throw notSent('Invalid Gemini history cursor.')
        }
        if (typeof cursor.pinned !== 'boolean' || typeof cursor.token !== 'string')
          throw notSent('Invalid Gemini history cursor.')
      }
      let page = await readImpl('history.list', {
        pinned: cursor.pinned,
        cursor: cursor.token,
        limit: query.limit,
      })
      if (cursor.pinned && !page.items.length && !page.nextCursor) {
        cursor = { pinned: false, token: '' }
        page = await readImpl('history.list', { pinned: false, limit: query.limit })
      }
      const nextCursor = page.nextCursor
        ? JSON.stringify({ pinned: cursor.pinned, token: page.nextCursor })
        : cursor.pinned
        ? JSON.stringify({ pinned: false, token: '' })
        : null
      return { ...page, nextCursor, completeness: nextCursor ? 'partial' : 'complete', total: null }
    })
  }
  const readConversation = (query) => exclusiveRead(() => readImpl('history.read', query))
  async function recover(reference, context = {}) {
    return exclusiveRead(async () => {
      const ids = reference.session || reference
      const produced = ids.geminiWebOutputIdentity
      if (activeRuns.has(ids.geminiWebRequestId)) return { outcome: 'unknown' }
      if (
        !produced?.requestId ||
        produced.requestId !== ids.geminiWebRequestId ||
        produced.conversationId !== ids.conversationId ||
        !produced.serverTurnId ||
        produced.serverTurnId !== ids.geminiWebServerTurnId ||
        produced.responseId !== (ids.geminiWebResponseId || null) ||
        (context.runId && produced.runId !== context.runId)
      )
        return { outcome: 'unknown' }
      let cursor, message
      for (let page = 0; page < 12; page++) {
        const detail = await readImpl('history.read', {
          conversationId: ids.conversationId,
          limit: 100,
          cursor,
        })
        message = detail.messages.find(
          (item) =>
            item.role === 'assistant' &&
            item.nativeTurnId === ids.geminiWebServerTurnId &&
            (!ids.geminiWebResponseId || item.nativeResponseId === ids.geminiWebResponseId),
        )
        if (message || !detail.nextCursor) break
        cursor = detail.nextCursor
      }
      if (!message?.completed || !message.content) return { outcome: 'unknown' }
      await mutate((state) => {
        const hold = state.holds[ids.geminiWebRequestId]
        if (
          hold &&
          hold.serverTurnId === ids.geminiWebServerTurnId &&
          (!hold.runId || hold.runId === produced.runId) &&
          (!hold.conversationId || hold.conversationId === produced.conversationId) &&
          (!hold.ownerId || hold.ownerId === ids.geminiWebOwnerId) &&
          (!hold.documentId || hold.documentId === ids.geminiWebDocumentId) &&
          (!hold.responseId || hold.responseId === message.nativeResponseId)
        ) {
          delete state.holds[ids.geminiWebRequestId]
          const entry = state.tabs.find(
            (item) =>
              item.tabId === ids.geminiWebTabId &&
              item.ownerId === ids.geminiWebOwnerId &&
              item.documentId === ids.geminiWebDocumentId,
          )
          if (entry && !reservedWriter(state, entry.tabId))
            Object.assign(entry, {
              completed: true,
              conversationId: produced.conversationId,
              serverTurnId: produced.serverTurnId,
              responseId: produced.responseId,
              completedAt: now(),
            })
        }
      })
      return {
        outcome: 'completed',
        finalOutput: {
          version: 1,
          format: 'safe-html',
          content: message.content,
          metadata: {
            evidence: 'exact-native-history-turn',
            conversationId: ids.conversationId,
            serverTurnId: ids.geminiWebServerTurnId,
            responseId: produced.responseId,
            responseTimestamp: message.responseTimestamp || null,
            messageId: produced.runId,
          },
        },
      }
    })
  }
  const reservations = () => stateAction((state) => holds(state))
  return {
    run,
    inspect,
    open,
    review,
    listModels,
    listConversations,
    readConversation,
    recover,
    reservations,
  }
}

export const geminiWebService = createGeminiWebService()
