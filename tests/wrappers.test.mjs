import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key) => key,
}))
import Browser from 'webextension-polyfill'
import {
  createPendingProxyCancellation,
  createPortRunGuard,
  handlePortError,
  isUiPortStopRequested,
  registerPortListener,
} from '../src/services/wrappers.mjs'

function fakePort() {
  const messageListeners = []
  const disconnectListeners = []
  const posts = []
  return {
    name: 'test-port',
    posts,
    messageListeners,
    postMessage(message) {
      posts.push(message)
    },
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

describe('createPortRunGuard', () => {
  it('acks stop without a session and drops later answer/done/error from that run', () => {
    const port = fakePort()
    const guard = createPortRunGuard(port)
    const { port: runPort } = guard.beginSessionRun()

    runPort.postMessage({ answer: 'partial' })
    guard.ackStopWithoutSession()
    runPort.postMessage({ answer: 'stale' })
    runPort.postMessage({ done: true })
    runPort.postMessage({ error: 'nope' })
    runPort.postMessage({ session: { id: 'still-ok' } })

    expect(port.posts).toEqual([
      { answer: 'partial' },
      { done: true },
      { session: { id: 'still-ok' } },
    ])
    expect(isUiPortStopRequested(port)).toBe(true)
  })

  it('lets a later session run post after stop or retry', () => {
    const port = fakePort()
    const guard = createPortRunGuard(port)
    const first = guard.beginSessionRun()
    first.port.postMessage({ answer: 'one' })
    const second = guard.beginSessionRun()
    first.port.postMessage({ answer: 'stale-retry' })
    first.port.postMessage({ done: true })
    second.port.postMessage({ answer: 'two' })
    second.port.postMessage({ done: true })

    expect(port.posts).toEqual([{ answer: 'one' }, { answer: 'two' }, { done: true }])
    expect(guard.isCurrent(first.runId)).toBe(false)
    expect(guard.isCurrent(second.runId)).toBe(true)
  })
})

describe('createPendingProxyCancellation', () => {
  it('fires onCancel once for a UI stop and can be disposed', () => {
    const port = fakePort()
    const cancel = createPendingProxyCancellation(port)
    let hits = 0
    cancel.onCancel(() => {
      hits += 1
    })
    port.emit({ stop: true })
    port.emit({ stop: true })
    expect(hits).toBe(1)
    expect(cancel.cancelled).toBe(true)
    cancel.dispose()
    expect(port.messageListeners).toHaveLength(0)
  })
})

describe('handlePortError', () => {
  it('maps captcha failures to a Bing-free key', () => {
    const port = fakePort()
    handlePortError({}, port, new Error('CaptchaChallenge from provider'))
    expect(port.posts).toHaveLength(1)
    expect(port.posts[0].error).toMatch(/^Captcha challenge/)
    expect(port.posts[0].error).not.toMatch(/Bing/)
  })

  it('does not post an error for aborted requests', () => {
    const port = fakePort()
    handlePortError({}, port, new Error('The operation was aborted'))
    expect(port.posts).toEqual([])
  })
})

describe('registerPortListener', () => {
  const originalAddListener = Browser.runtime.onConnect.addListener

  afterEach(() => {
    Browser.runtime.onConnect.addListener = originalAddListener
  })

  it('acks {stop:true} without a session so the UI can leave Generating', async () => {
    let onConnect
    Browser.runtime.onConnect.addListener = (listener) => {
      onConnect = listener
    }
    const started = []
    registerPortListener(async (session) => {
      started.push(session)
    })

    const port = fakePort()
    onConnect(port)
    await Promise.all(port.messageListeners.map((listener) => listener({ stop: true })))

    expect(port.posts).toEqual([{ done: true }])
    expect(started).toEqual([])
    expect(isUiPortStopRequested(port)).toBe(true)
  })
})
