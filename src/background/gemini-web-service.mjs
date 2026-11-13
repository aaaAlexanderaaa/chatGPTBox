import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import {
  GEMINI_NATIVE_CONTRACTS,
  GEMINI_WEB_MAX_TABS,
  GEMINI_WEB_MODEL,
  GEMINI_WEB_SELECTION,
  GEMINI_WEB_TIMEOUT_MS,
} from '../config/gemini-web.mjs'
import { runGeminiNativeOperation } from '../services/clients/gemini-web/native-runtime.mjs'
import { pushRecord } from '../services/apis/shared.mjs'
import { bindingSnapshotKey } from '../services/session-binding.mjs'

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

// The background is the only state owner. This synchronous claim covers all
// callers in this worker; acknowledged storage covers the next worker lifetime.
// No UI/content context writes the journal and no startup job resubmits it.
export function createGeminiWebService(deps = {}) {
  const browser = deps.browser || Browser
  const getConfig = deps.getConfig || getUserConfig
  const setConfig = deps.setConfig || setUserConfig
  const now = deps.now || Date.now
  const delay = deps.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const uuid = deps.uuid || (() => crypto.randomUUID())
  let active = false

  async function load() {
    const stored = await browser.storage.local.get(GEMINI_WEB_RUNTIME_KEY)
    if (!stored || typeof stored !== 'object')
      throw notSent(
        'Gemini safety state could not be read. Check extension storage before sending.',
      )
    const value = stored[GEMINI_WEB_RUNTIME_KEY]
    if (value === undefined)
      return { tabs: [], hold: null, accountSalt: '', accountFingerprint: '' }
    if (
      !value ||
      !Array.isArray(value.tabs) ||
      value.tabs.length > GEMINI_WEB_MAX_TABS ||
      (value.hold && typeof value.hold !== 'object')
    )
      throw notSent(
        'Gemini safety state is invalid. Inspect the website before repairing local state.',
      )
    if (
      (value.accountSalt &&
        (typeof value.accountSalt !== 'string' || value.accountSalt.length > 128)) ||
      (value.accountFingerprint && !/^[a-f0-9]{64}$/.test(value.accountFingerprint)) ||
      value.tabs.some(
        (entry) =>
          !Number.isInteger(entry?.tabId) ||
          typeof entry.ownerId !== 'string' ||
          typeof entry.binding !== 'string' ||
          entry.accountSalt !== value.accountSalt ||
          entry.accountFingerprint !== value.accountFingerprint,
      )
    )
      throw notSent(
        'Gemini account or tab binding state is invalid. Check the website before repairing local state.',
      )
    return structuredClone(value)
  }
  async function save(state) {
    await browser.storage.local.set({ [GEMINI_WEB_RUNTIME_KEY]: state })
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
  async function invoke(entry, action, data = {}) {
    const tab = await browser.tabs.get(entry.tabId)
    if (!isGeminiPage(tab?.url))
      throw new Error(
        'The dedicated Gemini tab was closed or navigated away. Inspect its existing result; it will not be sent again.',
      )
    const target = entry.documentId
      ? { tabId: entry.tabId, documentIds: [entry.documentId] }
      : { tabId: entry.tabId, frameIds: [0] }
    const results = await browser.scripting.executeScript({
      target,
      world: 'MAIN',
      func: runGeminiNativeOperation,
      args: [
        {
          action,
          ownerId: entry.ownerId,
          contracts: GEMINI_NATIVE_CONTRACTS,
          accountSalt: entry.accountSalt,
          expectedAccountFingerprint: entry.accountFingerprint,
          ...data,
        },
      ],
    })
    if (
      !Array.isArray(results) ||
      results.length !== 1 ||
      results[0].frameId !== 0 ||
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
    if (
      (result.nativeId != null &&
        (typeof result.nativeId !== 'string' || result.nativeId.length > 512)) ||
      (result.conversationId != null &&
        (typeof result.conversationId !== 'string' || result.conversationId.length > 512)) ||
      (result.answer != null &&
        (typeof result.answer !== 'string' || result.answer.length > 1000000)) ||
      (result.accepted === true && !result.nativeId) ||
      (result.answer && (!result.nativeId || result.accepted !== true)) ||
      (result.url != null && !isGeminiPage(result.url))
    )
      throw new Error('The Gemini native result has an unsupported identity or output shape.')
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
      if (!entry)
        throw notSent(
          'The original Gemini tab is unavailable. Check the website and start a new extension conversation; history will not be replayed.',
        )
      return entry
    }
    if (session.conversationId)
      throw notSent(
        'This Gemini conversation has no live native document. Start a new conversation instead of replaying it.',
      )
    if (state.tabs.length >= GEMINI_WEB_MAX_TABS)
      throw notSent(
        `Close a finished ChatGPTBox Gemini tab before creating another (limit ${GEMINI_WEB_MAX_TABS}). Website history is retained.`,
      )
    const ownerId = uuid()
    const tab = await browser.tabs.create({
      url: `https://gemini.google.com/app#chatgptbox-gemini-${ownerId}`,
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
    await save(state)
    session.geminiWebTabId = entry.tabId
    session.geminiWebOwnerId = entry.ownerId
    const deadline = now() + 60000
    while (now() < deadline) {
      const current = await browser.tabs.get(tab.id)
      if (current.status === 'complete') return entry
      await delay(300)
    }
    throw notSent(
      'Gemini did not finish loading. Open its dedicated tab and check it before sending again.',
    )
  }
  const post = (port, packet) => {
    try {
      port.postMessage(packet)
    } catch {
      /* disconnected observer */
    }
  }

  async function run({ session, port }) {
    if (active) {
      post(port, {
        error: 'Gemini Web already has an active operation. Requests are not queued.',
        dispatched: false,
        done: true,
        outcome: 'failed',
      })
      return
    }
    active = true
    let state,
      entry,
      requestId,
      journaled = false,
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
          'Gemini Web supports 4 Argon / High text chat. Regeneration and attachments are not supported.',
        )
      if (
        typeof session.question !== 'string' ||
        !session.question.trim() ||
        session.question.length > 50000
      )
        throw notSent('Gemini Web accepts a nonempty text prompt of at most 50,000 characters.')
      state = await load()
      if (state.hold)
        throw notSent(
          'Gemini Web is paused after an uncertain or interrupted operation. Inspect Gemini, then use “Allow new requests after checking Gemini” in Settings → Gemini Web. The old request will not be resubmitted.',
        )
      if (!state.accountSalt || !/^[a-f0-9]{64}$/.test(state.accountFingerprint || ''))
        throw notSent(
          'Check the Gemini page in Settings → Gemini Web first. This binds the selected account without exporting its identity.',
        )
      if (cancelled()) return
      entry = await ensureTab(state, session)
      post(port, { session }) // binding only: not provider acceptance
      if (cancelled()) return
      if (!entry.documentId) {
        const inspected = await invoke(entry, 'inspect') // bind document before any preference write
        if (!inspected.ok) throw notSent(inspected.message)
        await save(state)
        if (cancelled()) return
        const configured = await invoke(entry, 'configure')
        if (!configured.ok) throw notSent(configured.message)
        await save(state)
        if (cancelled()) return
      }
      const connected = await invoke(entry, 'connect')
      if (!connected.ok) throw notSent(connected.message)
      session.geminiWebDocumentId = entry.documentId
      await save(state)
      if (cancelled()) return
      await enabled()
      requestId = uuid()
      state.hold = {
        requestId,
        tabId: entry.tabId,
        documentId: entry.documentId,
        ownerId: entry.ownerId,
        phase: 'possibly-sent',
        at: now(),
      }
      await save(state) // must be acknowledged BEFORE native draft/submission
      journaled = true
      if (cancelled()) return
      const prepared = await invoke(entry, 'prepare', {
        requestId,
        question: session.question,
        conversationId: session.conversationId || '',
        lastNativeId: session.geminiWebLastNativeId || '',
      })
      if (!prepared.ok) {
        if (prepared.dispatched === false) {
          state.hold = null
          await save(state)
          journaled = false
        }
        throw Object.assign(
          new Error(prepared.message),
          prepared.dispatched === false ? { dispatched: false } : {},
        )
      }
      await delay(100) // allow the native control to render; no network polling
      if (cancelled()) return
      await enabled()
      if (cancelled()) return
      invoked = true // executeScript failure cannot prove the native call was unsent
      let result = await invoke(entry, 'send', { requestId })
      const deadline = now() + (deps.timeoutMs ?? GEMINI_WEB_TIMEOUT_MS)
      while (!cancelled()) {
        if (!result.ok) {
          if (result.dispatched === false) {
            state.hold = null
            await save(state)
            journaled = false
          }
          throw Object.assign(
            new Error(result.message),
            result.dispatched === false ? { dispatched: false } : {},
          )
        }
        if (result.nativeId) {
          session.geminiWebLastNativeId = result.nativeId
          if (state.hold && state.hold.nativeId !== result.nativeId) {
            state.hold.nativeId = result.nativeId
            state.hold.conversationId = result.conversationId || ''
            await save(state)
          }
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
          state.hold = null
          await save(state)
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
      if (stopped && invoked && entry && requestId)
        await invoke(entry, 'stop', { requestId }).catch(() => {})
      if (entry && requestId) await invoke(entry, 'close', { requestId }).catch(() => {})
      port.onMessage?.removeListener(onMessage)
      port.onDisconnect?.removeListener(onDisconnect)
      active = false
    }
  }

  async function inspectImpl() {
    await enabled()
    const state = await load()
    const tabs = await browser.tabs.query({ url: 'https://gemini.google.com/app*' })
    const tab =
      tabs.find((item) => item.active && isGeminiPage(item.url)) ||
      tabs.find((item) => isGeminiPage(item.url))
    if (!tab) {
      await setConfig({ geminiWebReady: false })
      return {
        ok: false,
        ready: false,
        hold: !!state.hold,
        message: 'Open Gemini in this browser, sign in, and select 4 Argon / High.',
      }
    }
    if (!state.accountSalt) {
      state.accountSalt = uuid()
      await save(state)
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
    if (result.ok && result.ready && !state.accountFingerprint) {
      if (!/^[a-f0-9]{64}$/.test(result.accountFingerprint || ''))
        throw new Error('The Gemini account check returned no verifiable identity.')
      state.accountFingerprint = result.accountFingerprint
      await save(state)
    }
    await setConfig({ geminiWebReady: result.ok && result.ready === true })
    const { accountFingerprint: _privateIdentity, ...publicResult } = result
    void _privateIdentity
    return { ...publicResult, hold: !!state.hold }
  }
  async function inspect() {
    if (active)
      return {
        ok: false,
        ready: false,
        active: true,
        message: 'Wait for the active Gemini operation before checking the account.',
      }
    active = true
    try {
      return await inspectImpl()
    } finally {
      active = false
    }
  }
  async function open() {
    await enabled()
    const state = await load()
    const entry = state.hold || state.tabs.at(-1)
    const tab = entry && (await browser.tabs.get(entry.tabId).catch(() => null))
    if (tab && isGeminiPage(tab.url)) {
      await browser.tabs.update(tab.id, { active: true })
      return { ok: true }
    }
    await browser.tabs.create({ url: 'https://gemini.google.com/app', active: true })
    return { ok: true }
  }
  async function review({ acknowledgeUnverified = false } = {}) {
    if (active)
      throw new Error(
        'Wait for the active Gemini operation to finish before allowing new requests.',
      )
    active = true
    try {
      const checked = await inspectImpl()
      if (!checked.ok || !checked.ready)
        throw new Error(
          checked.message ||
            'Check Gemini, its model/High setting, draft and active generation before allowing new requests.',
        )
      const state = await load()
      if (state.hold) {
        const entry = state.tabs.find((item) => item.tabId === state.hold.tabId)
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
              throw new Error(result.message)
            // Read the CURRENT document only; never retarget a writer or Stop.
            // Missing ownership cannot establish the old request's outcome.
            const current = await invoke({ ...entry, documentId: undefined }, 'inspect')
            if (!current.ok || !current.ready)
              throw new Error(
                current.message ||
                  'Finish the active Gemini turn and inspect its draft before allowing new work.',
              )
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
        state.lastReviewed = {
          requestId: state.hold.requestId,
          at: now(),
          outcome: unverified ? 'unconfirmed-user-reviewed' : 'document-reviewed',
        }
        if (unverified) state.tabs = state.tabs.filter((item) => item.tabId !== state.hold.tabId)
        state.hold = null
        await save(state)
      }
      return { ok: true, ready: true, hold: false }
    } finally {
      active = false
    }
  }
  async function listModels() {
    const config = await getConfig()
    return config.geminiWebEnabled === true && config.geminiWebReady === true
      ? [GEMINI_WEB_MODEL]
      : []
  }
  return { run, inspect, open, review, listModels }
}

export const geminiWebService = createGeminiWebService()
