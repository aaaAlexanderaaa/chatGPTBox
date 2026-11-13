import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key) => key,
}))
vi.mock('../src/config/index.mjs', async (original) => ({
  ...(await original()),
  getUserConfig: async () => ({}),
}))
import Browser from 'webextension-polyfill'
import { setAbortController } from '../src/services/apis/shared.mjs'
import { PASTE_REVIEW_PORT } from '../src/native-chatgpt/review-contract.mjs'
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
  it('keeps an old run cancelled when a new run starts before its proxy dispatch is queued', async () => {
    const port = fakePort()
    const guard = createPortRunGuard(port)
    const old = guard.beginSessionRun('old')
    guard.ackStopWithoutSession('old')
    const current = guard.beginSessionRun('current')
    expect(isUiPortStopRequested(old.port)).toBe(true)
    expect(isUiPortStopRequested(current.port)).toBe(false)
    const send = vi.fn()
    const { sendChatgptProxyRequest } = await import('../src/background/chatgpt-proxy-service.mjs')
    await sendChatgptProxyRequest(1, { sessionId: 'cancelled-old' }, old.port, {
      sendMessage: send,
    })
    expect(send).not.toHaveBeenCalled()
  })
  it('acks stop after synchronous finalization and drops later answer/done/error from that run', async () => {
    const port = fakePort()
    const guard = createPortRunGuard(port)
    const { port: runPort } = guard.beginSessionRun()

    runPort.postMessage({ answer: 'partial' })
    guard.ackStopWithoutSession()
    runPort.postMessage({ answer: 'stale' })
    runPort.postMessage({ done: true })
    runPort.postMessage({ error: 'nope' })
    runPort.postMessage({ finalContent: 'stale final' })
    runPort.postMessage({ started: true })
    runPort.postMessage({ session: { id: 'still-ok' }, started: true })
    await Promise.resolve()
    expect(port.posts).toEqual([{ answer: 'partial' }, { done: true, outcome: 'stopped' }])
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
  it('does not let a queued old Stop or its acknowledgement affect a newer run', async () => {
    const port = fakePort()
    const guard = createPortRunGuard(port)
    guard.beginSessionRun('old')
    guard.ackStopWithoutSession('old')
    const current = guard.beginSessionRun('new')
    const stop = vi.fn()
    const { controller } = setAbortController(current.port, stop)
    guard.ackStopWithoutSession('old')
    port.emit({ stop: true, requestToken: 'old' })
    guard.ackStopWithoutSession()
    port.emit({ stop: true })
    await Promise.resolve()
    current.port.postMessage({ answer: 'new answer' })
    expect(controller.signal.aborted).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(port.posts).toEqual([{ answer: 'new answer', requestToken: 'new' }])
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
  it('preserves a proven unsent verification failure and leaves other errors unclassified', () => {
    const port = { postMessage: vi.fn() }
    const error = Object.assign(new Error('Verification failed'), {
      code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
      chatgptWebNotDispatched: true,
    })
    handlePortError({}, port, error)
    expect(port.postMessage).toHaveBeenLastCalledWith({
      error: error.message,
      errorCode: error.code,
      dispatched: false,
    })
    handlePortError({}, port, new Error('Acknowledgement lost'))
    expect(port.postMessage).toHaveBeenLastCalledWith({ error: 'Acknowledgement lost' })
  })
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

  it.each([PASTE_REVIEW_PORT, 'chatgpt-proxy-response:run', 'grok-proxy-response:run'])(
    'does not attach generic logging or model execution to private port %s',
    (name) => {
      let onConnect
      Browser.runtime.onConnect.addListener = (listener) => {
        onConnect = listener
      }
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const execute = vi.fn()
      registerPortListener(execute)
      const port = fakePort()
      port.name = name
      onConnect(port)
      port.emit({ original: 'synthetic-private-text' })
      expect(port.messageListeners).toEqual([])
      expect(execute).not.toHaveBeenCalled()
      expect(debug).not.toHaveBeenCalled()
      debug.mockRestore()
    },
  )

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

    expect(port.posts).toEqual([{ done: true, outcome: 'stopped' }])
    expect(started).toEqual([])
    expect(isUiPortStopRequested(port)).toBe(true)
  })

  it('announces a current new run before any provider answer', async () => {
    let onConnect
    Browser.runtime.onConnect.addListener = (listener) => {
      onConnect = listener
    }
    registerPortListener(async (_session, providerPort) => {
      providerPort.postMessage({ answer: 'provider answer', done: true, outcome: 'completed' })
    })
    const port = fakePort()
    onConnect(port)
    const session = { modelName: 'chatgptweb/test', aiName: 'Controlled engine' }
    await Promise.all(port.messageListeners.map((listener) => listener({ session })))
    expect(port.posts).toEqual([
      { session, started: true },
      { answer: 'provider answer', done: true, outcome: 'completed' },
    ])
  })
  it('keeps a failure after entering a provider unclassified when it emitted no output', async () => {
    let onConnect
    Browser.runtime.onConnect.addListener = (listener) => {
      onConnect = listener
    }
    registerPortListener(async () => {
      throw new Error('Connection lost before first output')
    })
    const port = fakePort()
    onConnect(port)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await Promise.all(
      port.messageListeners.map((listener) =>
        listener({ session: { modelName: 'chatgptweb/test', aiName: 'Synthetic' } }),
      ),
    )
    expect(port.posts).toEqual([{ error: 'Connection lost before first output' }])
    error.mockRestore()
  })
  it('delivers synchronous provider Stop finalization before the fallback acknowledgement', async () => {
    let onConnect
    Browser.runtime.onConnect.addListener = (listener) => {
      onConnect = listener
    }
    registerPortListener(async (_session, providerPort) => {
      setAbortController(providerPort, () => {
        providerPort.postMessage({
          session: { dshSessionId: 'retained-session' },
          dshStatus: null,
          done: true,
          outcome: 'stopped',
        })
      })
    })
    const port = fakePort()
    onConnect(port)
    port.emit({ session: { modelName: 'dsh/test', aiName: 'Synthetic engine' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    port.emit({ stop: true })
    await Promise.resolve()
    expect(port.posts[0]).toMatchObject({
      session: { dshSessionId: 'retained-session' },
      dshStatus: null,
      outcome: 'stopped',
    })
  })
})
