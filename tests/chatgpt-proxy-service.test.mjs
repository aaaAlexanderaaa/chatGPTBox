import { describe, expect, it } from 'vitest'

// Unit tests for chatgpt-proxy-service (architecture plan step 3).
//
// Focus: the session lock (acquireChatgptWebSessionLock) is the most regression-
// prone piece of the proxy flow — it serializes concurrent requests for the
// same session and must (a) reject a second concurrent caller, (b) dedupe an
// identical retry from the same port, and (c) release on teardown so a
// subsequent request can proceed.
//
// We import the real module. The lock helper touches only the module-private
// activeChatgptWebSessionRequests Map; the only browser API it can reach is
// appendChatgptWebDebugLog (storage.local write), which short-circuits for the
// empty-config {} we pass in, so no storage call fires. vitest's
// webextension-polyfill alias (tests/__stubs__) covers the rest of the import
// graph. The Map is module-scoped, so test isolation relies on each test using
// a unique sessionId.

import {
  acquireChatgptWebSessionLock,
  handleProxyResponsePort,
  sendChatgptProxyRequest,
} from '../src/background/chatgpt-proxy-service.mjs'

let counter = 0
function uniqueSession(question = 'hi') {
  counter += 1
  return { sessionId: `s-${counter}`, question, modelName: 'x' }
}

describe('acquireChatgptWebSessionLock', () => {
  it('returns a release function for a fresh session', () => {
    const release = acquireChatgptWebSessionLock(uniqueSession(), { _id: 'p1' }, {})
    expect(typeof release).toBe('function')
    release()
  })

  it('returns null for a no-op when the same port asks the same question again (retry dedupe)', () => {
    const port = { _id: 'p1' }
    const session = uniqueSession('q')
    const release = acquireChatgptWebSessionLock(session, port, {})
    expect(typeof release).toBe('function')
    // identical retry from the same port should NOT throw, should NOT get a
    // second release — it returns null so the caller no-ops.
    const second = acquireChatgptWebSessionLock(session, port, {})
    expect(second).toBeNull()
    release()
  })

  it('throws when a different concurrent request tries to grab a held session', () => {
    const portA = { _id: 'pA' }
    const session = uniqueSession()
    const release = acquireChatgptWebSessionLock({ ...session, question: 'qA' }, portA, {})
    expect(() =>
      acquireChatgptWebSessionLock({ ...session, question: 'qB' }, { _id: 'pB' }, {}),
    ).toThrowError(/already in progress/)
    release()
  })

  it('allows the session to be reused after the previous release runs', () => {
    const session = uniqueSession()
    const release = acquireChatgptWebSessionLock({ ...session, question: 'q1' }, { _id: 'p1' }, {})
    release()
    // Now a different port/question should succeed again.
    const release2 = acquireChatgptWebSessionLock({ ...session, question: 'q2' }, { _id: 'p2' }, {})
    expect(typeof release2).toBe('function')
    release2()
  })

  it('ignores a stale release from a port that no longer owns the session', () => {
    const session = uniqueSession()
    const portA = { _id: 'pA' }
    const releaseA = acquireChatgptWebSessionLock({ ...session, question: 'qA' }, portA, {})
    releaseA()
    // A new owner takes the lock.
    const releaseB = acquireChatgptWebSessionLock({ ...session, question: 'qB' }, { _id: 'pB' }, {})
    releaseA() // stale release — must NOT release B's hold
    // B should still hold: a different concurrent caller must still be blocked.
    expect(() =>
      acquireChatgptWebSessionLock({ ...session, question: 'qC' }, { _id: 'pC' }, {}),
    ).toThrowError(/already in progress/)
    releaseB()
  })

  it('returns an immediate no-op release when the session has no sessionId', () => {
    const release = acquireChatgptWebSessionLock({}, { _id: 'p1' }, {})
    expect(typeof release).toBe('function')
    // no-op release should not throw
    expect(() => release()).not.toThrow()
  })
})

function fakeUiPort() {
  const messageListeners = []
  const disconnectListeners = []
  return {
    postMessage() {},
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener)
      },
      removeListener(listener) {
        const index = messageListeners.indexOf(listener)
        if (index >= 0) messageListeners.splice(index, 1)
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener)
      },
      removeListener(listener) {
        const index = disconnectListeners.indexOf(listener)
        if (index >= 0) disconnectListeners.splice(index, 1)
      },
    },
    emit(message) {
      for (const listener of [...messageListeners]) listener(message)
    },
  }
}

describe('sendChatgptProxyRequest pending stop', () => {
  it('resolves without sending when the UI port is already stopped', async () => {
    let sends = 0
    const uiPort = fakeUiPort()
    uiPort.__stopRequested = true
    await sendChatgptProxyRequest(1, { sessionId: 'stopped' }, uiPort, {
      sendMessage: async () => {
        sends += 1
      },
    })
    expect(sends).toBe(0)
  })

  it('resolves on UI stop before the proxy response port connects', async () => {
    const uiPort = fakeUiPort()
    const pending = sendChatgptProxyRequest(1, { sessionId: 's' }, uiPort, {
      sendMessage: () => new Promise(() => {}),
    })
    uiPort.emit({ stop: true })
    await pending
  })

  it('forwards stop if the response port connects after cancel', async () => {
    const uiPort = fakeUiPort()
    let requestId
    const pending = sendChatgptProxyRequest(1, { sessionId: 's' }, uiPort, {
      sendMessage: async (_id, message) => {
        requestId = message.data.requestId
      },
    })
    await Promise.resolve()
    uiPort.emit({ stop: true })
    await pending
    expect(requestId).toBeTruthy()

    const stops = []
    let disconnected = 0
    const proxyPort = {
      name: `chatgpt-proxy-response:${requestId}`,
      postMessage(msg) {
        stops.push(msg)
      },
      disconnect() {
        disconnected += 1
      },
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
    }
    expect(handleProxyResponsePort(proxyPort)).toBe(true)
    expect(stops.some((msg) => msg?.stop)).toBe(true)
    expect(disconnected).toBe(1)
  })
})
