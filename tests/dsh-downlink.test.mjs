/* eslint-env node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

// D-22 downlink bridge tests: the content-script core (against a fake
// WebSocket), the background bridge (against a fake Browser), the diagnose
// probe hook, and one end-to-end pass where the REAL content-script core
// rides the REAL bridge into a real local WebSocket server — the acceptance
// shape for "the mux downlink must not come from the extension origin".

const ENDPOINT = 'http://127.0.0.1:3080'

// --- fake Browser -------------------------------------------------------------

const state = vi.hoisted(() => {
  const s = {
    tabs: new Map(),
    nextTabId: 1,
    /** tab ids whose downlink content script is loaded */
    cs: new Set(),
    /** tab ids that already have some other content-script onMessage listener
     *  (the extension's generic http(s) script). sendMessage succeeds here
     *  even when dsh-downlink.js is not in the tab. */
    receivers: new Set(),
    /** test-controlled content script; (tabId, message) => void */
    csHandler: null,
    onMessageListeners: new Set(),
    onRemovedListeners: new Set(),
    onUpdatedListeners: new Set(),
    registeredScripts: [],
    tabsCreated: [],
    tabsRemoved: [],
    tabsUpdated: [],
    sentToTabs: [],
    unscriptable: new Set(),
  }
  s.reset = () => {
    s.tabs.clear()
    s.nextTabId = 1
    s.cs.clear()
    s.receivers.clear()
    ;(s.csHandler = null), s.onMessageListeners.clear()
    s.onRemovedListeners.clear()
    s.onUpdatedListeners.clear()
    s.registeredScripts = []
    s.tabsCreated = []
    s.tabsRemoved = []
    s.tabsUpdated = []
    s.sentToTabs = []
    s.unscriptable.clear()
  }
  /** a "running content script" sends back through runtime.onMessage */
  s.csSend = (tabId, message) => {
    for (const listener of [...s.onMessageListeners]) {
      listener(message, { tab: { id: tabId }, id: `tab-${tabId}` })
    }
  }
  /** simulate the user (or the browser) closing a tab */
  s.closeTab = (tabId) => {
    s.tabs.delete(tabId)
    s.cs.delete(tabId)
    s.receivers.delete(tabId)
    s.unscriptable.delete(tabId)
    for (const listener of [...s.onRemovedListeners]) listener(tabId)
  }
  /** simulate a navigation / refresh (tabs.onUpdated) */
  s.updateTab = (tabId, changeInfo = {}) => {
    const tab = s.tabs.get(tabId)
    if (changeInfo.url && tab) tab.url = changeInfo.url
    for (const listener of [...s.onUpdatedListeners]) listener(tabId, changeInfo, tab)
  }
  return s
})

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path) => `chrome-extension://test-extension-id${path || ''}`,
      onMessage: {
        addListener: (fn) => state.onMessageListeners.add(fn),
        removeListener: (fn) => state.onMessageListeners.delete(fn),
      },
    },
    tabs: {
      onRemoved: {
        addListener: (fn) => state.onRemovedListeners.add(fn),
        removeListener: (fn) => state.onRemovedListeners.delete(fn),
      },
      onUpdated: {
        addListener: (fn) => state.onUpdatedListeners.add(fn),
        removeListener: (fn) => state.onUpdatedListeners.delete(fn),
      },
      query: async ({ url }) => {
        const pattern = String(url || '')
        const prefix = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern
        return [...state.tabs.values()].filter((tab) => tab.url.startsWith(prefix))
      },
      create: async ({ url, active }) => {
        const id = state.nextTabId++
        state.tabs.set(id, { id, url })
        state.tabsCreated.push({ id, url, active })
        return state.tabs.get(id)
      },
      update: async (id, props) => {
        state.tabsUpdated.push({ id, ...props })
        const tab = state.tabs.get(id)
        if (tab) Object.assign(tab, props)
        return tab
      },
      remove: async (id) => {
        state.tabsRemoved.push(id)
        state.closeTab(id)
      },
      sendMessage: async (tabId, message) => {
        state.sentToTabs.push({ tabId, message })
        if (!state.cs.has(tabId) && !state.receivers.has(tabId)) {
          throw new Error('Could not establish connection. Receiving end does not exist.')
        }
        if (state.cs.has(tabId)) await state.csHandler?.(tabId, message)
      },
      executeScript: async (tabId) => {
        if (state.unscriptable.has(tabId)) throw new Error('tab is not scriptable')
        state.cs.add(tabId)
      },
    },
    scripting: {
      registerContentScripts: async (rules) => {
        state.registeredScripts.push(...rules)
      },
      unregisterContentScripts: async ({ ids }) => {
        state.registeredScripts = state.registeredScripts.filter((rule) => !ids.includes(rule.id))
      },
      executeScript: async ({ target }) => {
        if (state.unscriptable.has(target.tabId)) throw new Error('tab is not scriptable')
        state.cs.add(target.tabId)
      },
    },
    contentScripts: undefined,
    declarativeNetRequest: { updateDynamicRules: async () => {} },
    webRequest: { onBeforeSendHeaders: { addListener: () => {}, removeListener: () => {} } },
  },
}))

const { createDownlinkBridge, getDownlinkBridge, stopDownlinkBridge, syncDownlinkContentScript } =
  await import('../src/modules/dsh/background/downlink-bridge.mjs')
const { createDownlinkScript } = await import('../src/modules/dsh/content/downlink-core.mjs')
const { downlinkPath } = await import('../src/modules/dsh/downlink-protocol.mjs')
const { diagnoseDsh } = await import('../src/modules/dsh/background/fence.mjs')

/** The plain cooperative script most bridge tests want: ping→pong, open→opened. */
function installPlainScript() {
  state.csHandler = (tabId, message) => {
    if (message.type === 'dsh-cs-ping') {
      state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
      return
    }
    if (message.type === 'dsh-cs-open') {
      state.csSend(tabId, { type: 'dsh-cs-opened', sid: message.sid })
    }
  }
}

/** A harness-origin tab whose script is already running (the common case:
 *  the user's own dsh web tab). */
function harnessTab() {
  const id = state.nextTabId++
  state.tabs.set(id, { id, url: `${ENDPOINT}/console` })
  state.cs.add(id)
  state.receivers.add(id)
  return id
}

/** The user's dsh web tab as it exists before the module is enabled: the
 *  generic content script is already a sendMessage receiver, but
 *  dsh-downlink.js has not been injected (registerContentScripts does not
 *  touch already-open tabs). */
function harnessTabGenericOnly() {
  const id = state.nextTabId++
  state.tabs.set(id, { id, url: `${ENDPOINT}/console` })
  state.receivers.add(id)
  return id
}

/** A tab whose URL matches the harness origin but cannot run a content
 *  script (Chrome error page after a refused connection, crashed renderer). */
function deadHarnessTab() {
  const id = state.nextTabId++
  state.tabs.set(id, { id, url: `${ENDPOINT}/` })
  state.unscriptable.add(id)
  return id
}

// --- content-script core ------------------------------------------------------

class FakeWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.handlers = new Map()
    this.closedByClient = false
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type).push(fn)
  }
  emit(type, event) {
    for (const fn of this.handlers.get(type) ?? []) fn(event)
  }
  close() {
    if (this.closedByClient) return
    this.closedByClient = true
  }
  serverOpen() {
    this.emit('open', {})
  }
  serverMessage(data) {
    this.emit('message', { data })
  }
  serverClose(code = 1000, reason = '') {
    this.emit('close', { code, reason })
  }
}

describe('downlink content-script core', () => {
  /** @type {Array<object>} */
  let sent
  /** @type {(message: object) => void} */
  let deliver
  let script
  let clock

  beforeEach(() => {
    FakeWebSocket.instances = []
    sent = []
    clock = { now: 1_000 }
    let handler = null
    deliver = (message) => handler?.(message)
    script = createDownlinkScript({
      getEndpoint: () => ENDPOINT,
      send: (message) => sent.push(message),
      addListener: (fn) => {
        handler = fn
      },
      WebSocketImpl: FakeWebSocket,
      timers: {
        setInterval: () => 'reaper',
        clearInterval: () => {},
        now: () => clock.now,
      },
    })
  })

  afterEach(() => {
    script?.stop()
  })

  it('opens the requested path, reports Opened, and relays server-request envelopes only', () => {
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's1',
      stream: 'mux',
      path: downlinkPath('mux'),
    })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:3080/api/events.mux')
    expect(sent).toEqual([])
    FakeWebSocket.instances[0].serverOpen()
    expect(sent).toEqual([{ type: 'dsh-cs-opened', sid: 's1', stream: 'mux' }])
    FakeWebSocket.instances[0].serverMessage(
      JSON.stringify({ type: 'server-response', result: { ok: true } }),
    )
    FakeWebSocket.instances[0].serverMessage('not json')
    FakeWebSocket.instances[0].serverMessage(
      JSON.stringify({
        type: 'server-request',
        rpcId: 'r1',
        payload: { sessionId: 'x', kind: 'session/queue' },
      }),
    )
    expect(sent.at(-1)).toEqual({
      type: 'dsh-cs-frame',
      sid: 's1',
      stream: 'mux',
      envelope: {
        type: 'server-request',
        rpcId: 'r1',
        payload: { sessionId: 'x', kind: 'session/queue' },
      },
    })
  })

  it('ignores opens for a foreign endpoint (stale script after an endpoint change)', () => {
    deliver({
      type: 'dsh-cs-open',
      endpoint: 'http://127.0.0.1:9999',
      sid: 's1',
      stream: 'mux',
      path: '/api/events.mux',
    })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('answers Ping with Pong carrying its origin', () => {
    deliver({ type: 'dsh-cs-ping' })
    expect(sent).toEqual([{ type: 'dsh-cs-pong', endpoint: ENDPOINT, sids: [] }])
  })

  it('reports a socket close once, with code and reason', () => {
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's2',
      stream: 'host',
      path: downlinkPath('host'),
    })
    const socket = FakeWebSocket.instances[0]
    socket.serverOpen()
    socket.serverClose(1011, 'boom')
    socket.emit('error', {}) // error after close must not double-report
    expect(sent.filter((m) => m.type === 'dsh-cs-closed')).toEqual([
      { type: 'dsh-cs-closed', sid: 's2', stream: 'host', code: 1011, reason: 'boom' },
    ])
  })

  it('closes silently on a Close command and supersedes a same-sid socket on reopen', () => {
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's3',
      stream: 'mux',
      path: downlinkPath('mux'),
    })
    const first = FakeWebSocket.instances[0]
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's3',
      stream: 'mux',
      path: downlinkPath('mux'),
    })
    expect(first.closedByClient).toBe(true)
    expect(sent.some((m) => m.type === 'dsh-cs-closed')).toBe(false)
    deliver({ type: 'dsh-cs-close', sid: 's3' })
    expect(FakeWebSocket.instances[1].closedByClient).toBe(true)
    expect(sent.some((m) => m.type === 'dsh-cs-closed')).toBe(false)
  })

  it('reaps sockets whose sid is absent from a Ping (service-worker restart)', () => {
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's-old',
      stream: 'mux',
      path: downlinkPath('mux'),
    })
    const stale = FakeWebSocket.instances[0]
    deliver({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's-keep',
      stream: 'host',
      path: downlinkPath('host'),
    })
    const keep = FakeWebSocket.instances[1]
    deliver({ type: 'dsh-cs-ping', sids: ['s-keep'] })
    expect(stale.closedByClient).toBe(true)
    expect(keep.closedByClient).toBe(false)
    expect(sent.some((m) => m.type === 'dsh-cs-closed')).toBe(false)
  })

  it('reaps sockets the background stopped pinging (service-worker death)', () => {
    let reap = null
    let handler = null
    const s = []
    const clock2 = { now: 1_000 }
    const core = createDownlinkScript({
      getEndpoint: () => ENDPOINT,
      send: (m) => s.push(m),
      addListener: (fn) => {
        handler = fn
      },
      WebSocketImpl: FakeWebSocket,
      timers: {
        setInterval: (fn) => {
          reap = fn
          return 'reaper'
        },
        clearInterval: () => {},
        now: () => clock2.now,
      },
    })
    handler({
      type: 'dsh-cs-open',
      endpoint: ENDPOINT,
      sid: 's9',
      stream: 'mux',
      path: downlinkPath('mux'),
    })
    const socket = FakeWebSocket.instances.at(-1)
    clock2.now += 61_000
    reap()
    expect(socket.closedByClient).toBe(true)
    expect(s.some((m) => m.type === 'dsh-cs-closed')).toBe(false)
    core.stop()
  })
})

// --- background bridge --------------------------------------------------------

describe('downlink bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.reset()
    stopDownlinkBridge()
  })

  afterEach(() => {
    stopDownlinkBridge()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers the content script scoped to the endpoint, and unregisters when off', async () => {
    await syncDownlinkContentScript(ENDPOINT)
    expect(state.registeredScripts).toHaveLength(1)
    expect(state.registeredScripts[0]).toMatchObject({
      id: 'dsh-downlink',
      js: ['dsh-downlink.js'],
      matches: [`${ENDPOINT}/*`],
    })
    await syncDownlinkContentScript('')
    expect(state.registeredScripts).toHaveLength(0)
  })

  it('prefers an existing harness tab and never creates one behind its back', async () => {
    const userTab = harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const socket = await bridge.openMux({ onFrame: () => {} })
    expect(state.tabsCreated).toEqual([])
    const opens = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-open')
    expect(opens).toHaveLength(1)
    expect(opens[0].tabId).toBe(userTab)
    expect(opens[0].message).toMatchObject({
      endpoint: ENDPOINT,
      stream: 'mux',
      path: '/api/events.mux',
    })
    socket.close()
    bridge.stop()
  })

  it('injects the downlink script when a generic content script already answers sendMessage', async () => {
    const userTab = harnessTabGenericOnly()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const opening = bridge.openMux({ onFrame: () => {} })
    await vi.advanceTimersByTimeAsync(10_000)
    const socket = await opening
    expect(state.cs.has(userTab)).toBe(true)
    expect(state.tabsCreated).toEqual([])
    const opens = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-open')
    expect(opens).toHaveLength(1)
    expect(opens[0].tabId).toBe(userTab)
    socket.close()
    bridge.stop()
  })

  it('skips a dead matching tab and uses the next scriptable one', async () => {
    deadHarnessTab()
    const live = harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const opening = bridge.openMux({ onFrame: () => {} })
    await vi.advanceTimersByTimeAsync(5_000)
    const socket = await opening
    expect(state.tabsCreated).toEqual([])
    const opens = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-open')
    expect(opens).toHaveLength(1)
    expect(opens[0].tabId).toBe(live)
    socket.close()
    bridge.stop()
  })

  it('falls back to a favicon carrier when the only matching tab is not scriptable', async () => {
    deadHarnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const opening = bridge.openMux({ onFrame: () => {} })
    await vi.advanceTimersByTimeAsync(5_000) // one ping against the dead tab
    expect(state.tabsCreated).toEqual([{ id: 2, url: `${ENDPOINT}/favicon.svg`, active: false }])
    const socket = await opening
    const opens = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-open')
    expect(opens).toHaveLength(1)
    expect(opens[0].tabId).toBe(2)
    socket.close()
    bridge.stop()
  })

  it('falls back to a favicon carrier after two unscriptable matching tabs', async () => {
    deadHarnessTab()
    deadHarnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const opening = bridge.openMux({ onFrame: () => {} })
    // Two 5s pings would exhaust the 10s open budget and skip the favicon
    // fallback; the probe of a dead tab must not consume that budget.
    await vi.advanceTimersByTimeAsync(10_000)
    const socket = await opening
    expect(state.tabsCreated).toEqual([{ id: 3, url: `${ENDPOINT}/favicon.svg`, active: false }])
    const opens = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-open')
    expect(opens).toHaveLength(1)
    expect(opens[0].tabId).toBe(3)
    socket.close()
    bridge.stop()
  })

  it('creates a quiet favicon carrier tab, injects the script, and closes the tab on stop', async () => {
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const opening = bridge.openMux({ onFrame: () => {} })
    // first ping round: no receiver → the bridge injects the script
    await vi.advanceTimersByTimeAsync(0)
    expect(state.tabsCreated).toEqual([{ id: 1, url: `${ENDPOINT}/favicon.svg`, active: false }])
    expect(state.tabsUpdated).toContainEqual({ id: 1, autoDiscardable: false })
    await vi.advanceTimersByTimeAsync(5_000) // pong timeout of round 1
    const socket = await opening // round 2 finds the injected script
    expect(state.sentToTabs.some((s) => s.message.type === 'dsh-cs-open')).toBe(true)
    socket.close()
    expect(state.tabsRemoved).toEqual([]) // closing a session keeps the carrier
    bridge.stop()
    expect(state.tabsRemoved).toEqual([1]) // …but module-off closes our tab
  })

  it('closes a leftover favicon carrier tab on stop after a worker restart', async () => {
    installPlainScript()
    // Previous worker created this tab; the new handle has an empty owned set.
    const leftover = state.nextTabId++
    state.tabs.set(leftover, { id: leftover, url: `${ENDPOINT}/favicon.svg` })
    state.cs.add(leftover)
    state.receivers.add(leftover)
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const socket = await bridge.openMux({ onFrame: () => {} })
    expect(state.tabsCreated).toEqual([])
    socket.close()
    expect(state.tabsRemoved).toEqual([])
    bridge.stop()
    expect(state.tabsRemoved).toEqual([leftover])
  })

  it('delivers frames with their envelope and fails the open on closed-before-open', async () => {
    harnessTab()
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
        return
      }
      if (message.type === 'dsh-cs-open') {
        // the harness fence refusing the handshake, script-side
        state.csSend(tabId, {
          type: 'dsh-cs-closed',
          sid: message.sid,
          stream: message.stream,
          code: 1006,
          reason: '',
        })
      }
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    await expect(bridge.openMux({ onFrame: () => {} })).rejects.toThrow(/closed before opening/)
    bridge.stop()
  })

  it('multiplexes concurrent sessions — a probe never steals the gateway stream', async () => {
    harnessTab()
    /** sid → tab, captured at open */
    const opened = new Map()
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
        return
      }
      if (message.type === 'dsh-cs-open') {
        opened.set(message.sid, tabId)
        state.csSend(tabId, { type: 'dsh-cs-opened', sid: message.sid })
      }
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const frames = []
    const gatewayStream = await bridge.openMux({
      onFrame: (frame, envelope) => frames.push([frame, envelope]),
    })
    const probe = await bridge.probe(2_000)
    expect(probe.ok).toBe(true)
    expect(opened.size).toBe(2) // two independent sids
    // a frame for the gateway's sid still lands on the gateway handlers
    const gatewaySid = state.sentToTabs.find(
      (s) => s.message.type === 'dsh-cs-open' && s.message.stream === 'mux',
    ).message.sid
    state.csSend(opened.get(gatewaySid), {
      type: 'dsh-cs-frame',
      sid: gatewaySid,
      stream: 'mux',
      envelope: {
        type: 'server-request',
        rpcId: 'r9',
        payload: { type: 'session/jobs', sessionId: 'a' },
      },
    })
    expect(frames).toHaveLength(1)
    expect(frames[0][0].type).toBe('session/jobs')
    expect(frames[0][1].rpcId).toBe('r9')
    gatewayStream.close()
    bridge.stop()
  })

  it('fails open streams when the carrier tab is closed by the user', async () => {
    const userTab = harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const events = []
    const socket = await bridge.openHost({
      onFrame: () => {},
      onError: (error) => events.push(`error:${error.message}`),
      onClose: () => events.push('closed'),
    })
    expect(events).toEqual([])
    state.closeTab(userTab)
    expect(events).toEqual(['error:the downlink carrier tab went away', 'closed'])
    socket.close()
    bridge.stop()
  })

  it('fails open streams when the carrier tab reloads on the same origin', async () => {
    const userTab = harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const events = []
    const socket = await bridge.openMux({
      onFrame: () => {},
      onError: (error) => events.push(`error:${error.message}`),
      onClose: () => events.push('closed'),
    })
    // Same URL, status:loading — a refresh. Ping would still succeed once
    // the new document's script answers, so onUpdated is the signal.
    state.updateTab(userTab, { status: 'loading' })
    expect(events).toEqual(['error:the downlink carrier tab went away', 'closed'])
    socket.close()
    bridge.stop()
  })

  it('lists live sids on Ping so a restarted worker reaps orphan sockets', async () => {
    harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const socket = await bridge.openMux({ onFrame: () => {} })
    const sid = state.sentToTabs.find((s) => s.message.type === 'dsh-cs-open').message.sid
    const discoveryPings = state.sentToTabs.filter((s) => s.message.type === 'dsh-cs-ping')
    expect(discoveryPings[0].message.sids).toEqual([])
    await vi.advanceTimersByTimeAsync(15_000)
    const heartbeatPing = [...state.sentToTabs]
      .reverse()
      .find((s) => s.message.type === 'dsh-cs-ping')
    expect(heartbeatPing.message.sids).toEqual([sid])
    socket.close()
    bridge.stop()
  })

  it('declares streams lost when Pong reports no live sids (script replaced)', async () => {
    harnessTab()
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT, sids: [] })
        return
      }
      if (message.type === 'dsh-cs-open')
        state.csSend(tabId, { type: 'dsh-cs-opened', sid: message.sid })
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const events = []
    const socket = await bridge.openMux({
      onFrame: () => {},
      onError: () => events.push('error'),
      onClose: () => events.push('closed'),
    })
    // Heartbeat after a same-origin reload that onUpdated missed: the
    // replacement script is empty, so Pong.sids is [] while we still
    // hold the pre-reload session.
    await vi.advanceTimersByTimeAsync(15_000)
    expect(events).toEqual(['error', 'closed'])
    socket.close()
    bridge.stop()
  })

  it('declares the carrier lost when the heartbeat stops hearing Pong', async () => {
    harnessTab()
    let answerPings = true
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        if (answerPings) state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
        return
      }
      if (message.type === 'dsh-cs-open')
        state.csSend(tabId, { type: 'dsh-cs-opened', sid: message.sid })
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const events = []
    const socket = await bridge.openMux({
      onFrame: () => {},
      onError: () => events.push('error'),
      onClose: () => events.push('closed'),
    })
    answerPings = false // page navigated away, script gone silent
    await vi.advanceTimersByTimeAsync(15_000) // heartbeat tick
    await vi.advanceTimersByTimeAsync(5_000) // pong timeout
    expect(events).toEqual(['error', 'closed'])
    expect(state.sentToTabs.some((s) => s.message.type === 'dsh-cs-close')).toBe(true)
    socket.close()
    bridge.stop()
  })

  it('does not kill a replacement carrier when a stale heartbeat ping times out', async () => {
    const userTab = harnessTab()
    let silenceUserTab = false
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        if (silenceUserTab && tabId === userTab) return
        state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
        return
      }
      if (message.type === 'dsh-cs-open') {
        state.csSend(tabId, { type: 'dsh-cs-opened', sid: message.sid })
      }
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const first = await bridge.openMux({
      onFrame: () => {},
      onError: () => {},
      onClose: () => {},
    })
    silenceUserTab = true
    await vi.advanceTimersByTimeAsync(15_000) // heartbeat ping in flight against userTab
    state.closeTab(userTab)
    first.close()

    const replacementEvents = []
    const replacement = await bridge.openMux({
      onFrame: () => {},
      onError: () => replacementEvents.push('error'),
      onClose: () => replacementEvents.push('closed'),
    })
    expect(state.tabsCreated).toEqual([{ id: 2, url: `${ENDPOINT}/favicon.svg`, active: false }])
    await vi.advanceTimersByTimeAsync(5_000) // stale ping timeout
    expect(replacementEvents).toEqual([])
    replacement.close()
    bridge.stop()
  })

  it('sends Close when an open times out so the content-script socket is not leaked', async () => {
    harnessTab()
    state.csHandler = (tabId, message) => {
      if (message.type === 'dsh-cs-ping') {
        state.csSend(tabId, { type: 'dsh-cs-pong', endpoint: ENDPOINT })
      }
    }
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT, openTimeoutMs: 1_000 })
    const opening = bridge.openMux({ onFrame: () => {} })
    const rejected = expect(opening).rejects.toThrow(/did not open/)
    await vi.advanceTimersByTimeAsync(1_000)
    await rejected
    expect(state.sentToTabs.some((s) => s.message.type === 'dsh-cs-close')).toBe(true)
    bridge.stop()
  })

  it('ignores Opened/Frame/Closed from a tab that is not the session carrier', async () => {
    const carrier = harnessTab()
    installPlainScript()
    const bridge = createDownlinkBridge({ endpoint: ENDPOINT })
    const frames = []
    const events = []
    const socket = await bridge.openMux({
      onFrame: (frame) => frames.push(frame),
      onError: () => events.push('error'),
      onClose: () => events.push('closed'),
    })
    const sid = state.sentToTabs.find((s) => s.message.type === 'dsh-cs-open').message.sid
    state.csSend(99, {
      type: 'dsh-cs-frame',
      sid,
      stream: 'mux',
      envelope: { type: 'server-request', payload: { type: 'session/jobs' } },
    })
    state.csSend(99, { type: 'dsh-cs-closed', sid, stream: 'mux', code: 1006 })
    expect(frames).toEqual([])
    expect(events).toEqual([])
    state.csSend(carrier, {
      type: 'dsh-cs-frame',
      sid,
      envelope: { type: 'server-request', payload: { type: 'session/queue' } },
    })
    expect(frames).toEqual([{ type: 'session/queue' }])
    socket.close()
    bridge.stop()
  })

  it('hands out one bridge per endpoint and stops the previous one', async () => {
    const first = getDownlinkBridge(ENDPOINT)
    expect(getDownlinkBridge(`${ENDPOINT}/`)).toBe(first)
    expect(getDownlinkBridge('http://example.com')).toBeNull()
    const second = getDownlinkBridge('http://localhost:3081')
    expect(second).not.toBe(first)
    stopDownlinkBridge()
  })
})

// --- diagnose through the bridge probe ------------------------------------------

describe('diagnoseDsh with a downlink probe', () => {
  beforeEach(() => {
    state.reset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'server-response',
          result: { ok: true, value: { version: '0.1.0-rc.6' } },
        }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports done when the probe opens the mux stream', async () => {
    const result = await diagnoseDsh(ENDPOINT, {
      probeDownlink: async () => ({ ok: true, detail: '' }),
    })
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('done')
    expect(result.wsOk).toBe(true)
    expect(result.version).toBe('0.1.0-rc.6')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('reports the bridge stage with the probe detail on failure', async () => {
    const result = await diagnoseDsh(ENDPOINT, {
      probeDownlink: async () => ({ ok: false, detail: 'the harness carrier page did not answer' }),
    })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('websocket')
    expect(result.wsOk).toBe(false)
    expect(result.message).toContain('mux downlink bridge failed')
    expect(result.message).toContain('the harness carrier page did not answer')
  })
})

// --- end to end: real core + real bridge + real WebSocket server -----------------

describe('downlink bridge end to end against a real WebSocket server', () => {
  beforeEach(() => {
    vi.useRealTimers()
    state.reset()
    stopDownlinkBridge()
  })

  afterEach(() => {
    stopDownlinkBridge()
  })

  it('carries mux frames from the server through the content script into gateway handlers', async () => {
    const muxWss = new WebSocketServer({ noServer: true })
    /** @type {import('ws').WebSocket[]} */
    const clients = []
    const receiver = vi.fn()
    muxWss.on('connection', (ws) => {
      clients.push(ws)
      ws.send(
        JSON.stringify({
          type: 'server-request',
          rpcId: 'live-1',
          payload: { type: 'session/queue', sessionId: 's', items: [] },
        }),
      )
    })

    const { createServer } = await import('node:http')
    const server = createServer()
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/api/events.mux') {
        socket.destroy()
        return
      }
      muxWss.handleUpgrade(req, socket, head, (ws) => muxWss.emit('connection', ws, req))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${server.address().port}`

    // a harness-origin tab whose "page" runs the real content-script core
    const tabId = state.nextTabId++
    state.tabs.set(tabId, { id: tabId, url: `${endpoint}/console` })
    state.cs.add(tabId)
    let pageHandler = null
    const script = createDownlinkScript({
      getEndpoint: () => endpoint,
      send: (message) => state.csSend(tabId, message),
      addListener: (fn) => {
        pageHandler = fn
      },
      WebSocketImpl: WebSocket,
      timers: { setInterval: () => 'reaper', clearInterval: () => {}, now: () => Date.now() },
    })
    state.csHandler = (id, message) => {
      pageHandler?.(message)
    }

    try {
      const bridge = createDownlinkBridge({ endpoint })
      const events = []
      const socket = await bridge.openMux({
        onFrame: (frame, envelope) => {
          receiver(frame, envelope)
          events.push('frame')
        },
        onClose: () => events.push('closed'),
      })
      // the initial broadcast frame crossed server → content script → bridge
      await vi.waitFor(() => expect(events).toContain('frame'))
      expect(receiver).toHaveBeenCalledWith(
        { type: 'session/queue', sessionId: 's', items: [] },
        expect.objectContaining({ rpcId: 'live-1' }),
      )
      // server-side close propagates as a stream loss
      clients[0].close(1000, 'done')
      await vi.waitFor(() => expect(events).toContain('closed'))
      socket.close()
      bridge.stop()
      script.stop()
    } finally {
      await new Promise((resolve) => server.close(resolve))
      muxWss.close()
    }
  })
})
