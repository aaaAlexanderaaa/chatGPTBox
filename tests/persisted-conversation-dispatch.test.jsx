// @vitest-environment jsdom
/* eslint-disable react/prop-types -- The real card/input/port/owner are exercised with a small display child. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import Browser from 'webextension-polyfill'
const state = vi.hoisted(() => ({
  restore: null,
  configError: null,
  snapshotDeleteError: null,
  config: {
    modelName: 'chatgptweb/one',
    l1Providers: [],
    chatgptWebEnabled: true,
    chatgptWebEnabledModels: ['one'],
    focusAfterAnswer: false,
  },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value) => value }) }))
vi.mock('../src/hooks/use-config.mjs', () => ({ useConfig: () => state.config }))
vi.mock('../src/config/index.mjs', async (original) => ({
  ...(await original()),
  getUserConfig: async () => {
    if (state.configError) throw new Error(state.configError)
    return state.config
  },
}))
vi.mock('../src/services/clients/chatgpt-web/thread-state.mjs', () => ({
  restoreChatgptWebSessionSnapshot: (session) =>
    state.restore ? state.restore(session) : Promise.resolve(session),
  saveChatgptWebSessionSnapshot: async () => {},
  deleteChatgptWebSessionSnapshot: async () => {
    if (state.snapshotDeleteError) throw new Error(state.snapshotDeleteError)
  },
}))
vi.mock('../src/components/ConversationItem', () => ({
  default: ({ content, onRetry }) => (
    <div>
      {content}
      {onRetry && (
        <button className="retry-fixture" onClick={onRetry}>
          Retry fixture
        </button>
      )}
    </div>
  ),
}))
import ConversationCard from '../src/components/ConversationCard/index.jsx'
import { registerPortListener } from '../src/services/wrappers.mjs'
import { switchSessionEngine } from '../src/services/session-binding.mjs'
import { pushRecord } from '../src/services/apis/shared.mjs'
import { applyLocalSessionMutation } from '../src/services/local-session.mjs'
let root, stored, execute, jobs, sent, responses, connected, clientInbound, lastClient
const initial = () => ({
  sessionId: 'local',
  modelName: 'chatgptweb/one',
  aiName: 'Controlled engine',
  conversationId: 'old-thread',
  conversationRecords: [],
})
const event = () => {
  const listeners = new Set()
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    fire: (msg) => [...listeners].forEach((fn) => fn(msg)),
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  stored = { sessions: [initial()] }
  jobs = []
  sent = []
  responses = []
  state.restore = null
  state.configError = null
  state.snapshotDeleteError = null
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (keys) =>
    typeof keys === 'string'
      ? { [keys]: structuredClone(stored[keys]) }
      : { ...keys, ...structuredClone(stored) },
  )
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) => {
    Object.assign(stored, structuredClone(patch))
  })
  vi.spyOn(Browser.storage.local, 'remove').mockImplementation(async (key) => {
    delete stored[key]
  })
  vi.spyOn(Browser.runtime.onConnect, 'addListener').mockImplementation((listener) => {
    connected = listener
  })
  execute = vi.fn(async (session, port) => {
    pushRecord(session, session.question, 'Admitted answer')
    port.postMessage({
      session,
      answer: 'Admitted answer',
      finalContent: 'Admitted answer',
      done: true,
      outcome: 'completed',
    })
  })
  registerPortListener(execute)
  vi.spyOn(Browser.runtime, 'connect').mockImplementation(() => {
    const incoming = event(),
      serverMessages = event(),
      disconnected = event(),
      serverDisconnected = event()
    const server = {
      name: 'controlled-persisted',
      onMessage: {
        addListener: (fn) =>
          serverMessages.addListener((message) => {
            jobs.push(Promise.resolve(fn(message)))
          }),
        removeListener() {},
      },
      onDisconnect: serverDisconnected,
      postMessage: (message) => {
        responses.push(structuredClone(message))
        queueMicrotask(() => incoming.fire(message))
      },
    }
    let closed = false
    const client = {
      onMessage: incoming,
      onDisconnect: disconnected,
      postMessage: (message) => {
        if (closed) throw new Error('Attempting to use a disconnected port')
        sent.push(structuredClone(message))
        queueMicrotask(() => serverMessages.fire(message))
      },
      disconnect: () => {
        if (closed) return
        closed = true
        serverDisconnected.fire()
        disconnected.fire()
      },
    }
    clientInbound = incoming
    lastClient = client
    connected(server)
    return client
  })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Element.prototype.scrollTo = () => {}
})
afterEach(async () => {
  await act(async () => {
    render(null, root)
    await tick()
  })
  root.remove()
  vi.restoreAllMocks()
})
async function mount(
  session = initial(),
  onUpdate,
  question,
  persistedSession = true,
  onSaveError,
) {
  await act(async () => {
    render(
      <ConversationCard
        session={session}
        question={question}
        onUpdate={onUpdate}
        onSaveError={onSaveError}
        persistedSession={persistedSession}
        disconnectOnUnmount
        draftKey="persisted"
      />,
      root,
    )
    await tick()
  })
  await act(tick)
}
async function submit(value = 'User intent') {
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
  await act(async () => {
    root.querySelector('.submit-button').click()
    await tick()
  })
}
async function settle() {
  await act(async () => {
    await tick()
    await Promise.all(jobs)
    await tick()
  })
  await act(tick)
}
it.each(['changed', 'deleted'])(
  'does not execute a %s stored conversation and keeps the input',
  async (reason) => {
    stored.sessions = reason === 'deleted' ? [] : [switchSessionEngine(initial(), 'grokweb/fast')]
    await mount()
    await submit()
    await settle()
    expect(execute).not.toHaveBeenCalled()
    expect(responses.find((message) => message.error)).toMatchObject({
      dispatched: false,
      errorCode: reason === 'deleted' ? 'SESSION_NOT_FOUND' : 'SESSION_BINDING_CHANGED',
    })
    expect(responses.some((message) => message.started)).toBe(false)
    expect(root.querySelector('textarea').value).toBe('User intent')
  },
)
it('clears only after the matching stored request is admitted', async () => {
  await mount()
  await submit()
  await settle()
  expect(execute).toHaveBeenCalledTimes(1)
  const request = sent.find((message) => message.session)
  expect(request.localSession).toBe(true)
  expect(request.requestToken).toEqual(expect.any(String))
  expect(responses[0]).toMatchObject({ started: true, requestToken: request.requestToken })
  expect(root.querySelector('textarea').value).toBe('')
})

it('keeps the input and stored draft when the provider rejects before producing output', async () => {
  execute.mockImplementationOnce(async (_session, port) => {
    port.postMessage({ error: 'Provider is disabled', dispatched: false, done: true })
  })
  await mount()
  await submit('Keep this draft')
  await settle()
  expect(execute).toHaveBeenCalledTimes(1)
  expect(responses.some((message) => message.started)).toBe(false)
  expect(root.querySelector('textarea').value).toBe('Keep this draft')
  expect(root.textContent).toContain('Provider is disabled')
})
it('replaces the first prop-question answer without duplicate history or old-answer context', async () => {
  await mount(initial(), undefined, 'Initial prop question')
  await settle()
  expect(root.querySelectorAll('.retry-fixture')).toHaveLength(1)
  let retryContext
  const { getRequestConversationRecords } = await import('../src/services/apis/shared.mjs')
  execute.mockImplementationOnce(async (session, port) => {
    retryContext = structuredClone(getRequestConversationRecords(session))
    pushRecord(session, session.question, 'Replacement first answer')
    port.postMessage({ session, answer: 'Replacement first answer', done: true })
  })
  await act(async () => {
    root.querySelector('.retry-fixture').click()
    await tick()
  })
  await settle()
  expect(retryContext).toEqual([])
  const replacement = responses.findLast((message) => message.answer === 'Replacement first answer')
  expect(replacement.session.conversationRecords).toEqual([
    { question: 'Initial prop question', answer: 'Replacement first answer' },
  ])
  expect(execute).toHaveBeenCalledTimes(2)
})

it.each([false, true, 'snapshot'])(
  'commits Clear before dropping visible history (storage failure=%s)',
  async (fail) => {
    const switched = switchSessionEngine(
      {
        ...initial(),
        question: 'Old question',
        conversationRecords: [{ question: 'Old question', answer: 'Keep until Clear commits' }],
      },
      'grokweb/fast',
    )
    stored.sessions = [structuredClone(switched)]
    vi.spyOn(Browser.runtime, 'sendMessage').mockImplementation(async (message) => {
      if (message.type !== 'LOCAL_SESSION_MUTATION') return
      try {
        return {
          ok: true,
          value: await applyLocalSessionMutation(message.data.method, message.data.payload),
        }
      } catch (error) {
        return { ok: false, error: { message: error.message, code: error.code } }
      }
    })
    const saveError = vi.fn()
    await mount(switched, undefined, undefined, true, saveError)
    if (fail === true)
      Browser.storage.local.set.mockRejectedValueOnce(new Error('Clear could not be saved'))
    if (fail === 'snapshot') state.snapshotDeleteError = 'Snapshot cleanup failed'
    await act(async () => {
      root.querySelector('[aria-label="Clear Conversation"]').click()
      await tick()
    })
    await act(async () => {
      const confirm = [...root.querySelectorAll('button')].find(
        (button) => button.textContent === 'Confirm',
      )
      confirm.click()
      await tick()
    })
    await settle()
    expect(stored.sessions[0].sessionId).toBe(switched.sessionId)
    if (fail === true) {
      expect(root.textContent).toContain('Keep until Clear commits')
      expect(root.textContent).toContain('Clear could not be saved')
      expect(stored.sessions[0].remoteBindingGeneration).toBe(switched.remoteBindingGeneration)
      expect(saveError).toHaveBeenCalledWith(expect.any(Error), switched)
    } else {
      expect(root.textContent).not.toContain('Keep until Clear commits')
      expect(stored.sessions[0].conversationRecords).toEqual([])
      expect(stored.sessions[0].remoteBindingGeneration).not.toBe(switched.remoteBindingGeneration)
      expect(saveError).not.toHaveBeenCalled()
      if (fail === 'snapshot')
        expect(root.textContent).toContain('saved provider state could not be removed')
    }
    expect(execute).not.toHaveBeenCalled()
  },
)
it('ignores an old queued terminal session after Clear commits a new binding', async () => {
  execute.mockImplementation(async () => {})
  vi.spyOn(Browser.runtime, 'sendMessage').mockImplementation(async (message) => {
    if (message.type !== 'LOCAL_SESSION_MUTATION') return
    return {
      ok: true,
      value: await applyLocalSessionMutation(message.data.method, message.data.payload),
    }
  })
  let visible
  await mount(initial(), (_port, session) => {
    visible = session
  })
  await submit()
  await settle()
  const oldRequest = sent.find((message) => message.session)
  const oldSession = structuredClone(oldRequest.session)
  pushRecord(oldSession, oldSession.question, 'Queued old answer')
  const oldPacket = {
    requestToken: oldRequest.requestToken,
    session: oldSession,
    answer: 'Queued old answer',
    done: true,
    outcome: 'completed',
  }
  await act(async () => {
    root.querySelector('[aria-label="Clear Conversation"]').click()
    await tick()
  })
  await act(async () => {
    const confirm = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === 'Confirm',
    )
    confirm.click()
    await tick()
  })
  await settle()
  const clearedGeneration = visible.remoteBindingGeneration
  expect(visible.conversationRecords).toEqual([])
  await act(async () => {
    clientInbound.fire(structuredClone(oldPacket))
    await tick()
  })
  expect(visible.remoteBindingGeneration).toBe(clearedGeneration)
  expect(visible.conversationRecords).toEqual([])
  expect(root.textContent).not.toContain('Queued old answer')
})
it('Stop during stored-state validation prevents a late executor start', async () => {
  await mount()
  const get = Browser.storage.local.get.getMockImplementation()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  Browser.storage.local.get.mockImplementation(async (key) => {
    if (key === 'sessions') await gate
    return get(key)
  })
  await submit()
  await act(async () => {
    root.querySelector('.submit-button').click()
    await tick()
    release()
  })
  await settle()
  expect(execute).not.toHaveBeenCalled()
  expect(responses.some((message) => message.started)).toBe(false)
  expect(root.querySelector('textarea').value).toBe('User intent')
})
it('publishes token-bearing cancellation for the panel owner', async () => {
  execute.mockImplementation(async () => {})
  let stop
  await mount(initial(), (_port, _session, _items, cancel) => {
    stop = cancel
  })
  await submit()
  await settle()
  const token = sent.find((message) => message.session).requestToken
  await act(async () => {
    await stop()
    await tick()
  })
  await settle()
  expect(sent.findLast((message) => message.stop)).toMatchObject({ requestToken: token })
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Send')
})
it('ignores an older queued start/completion after a new request token is active', async () => {
  const ports = []
  execute.mockImplementation(async (_session, port) => {
    ports.push(port)
  })
  await mount()
  await submit('First intent')
  await settle()
  const oldToken = sent.find((message) => message.session).requestToken
  await act(async () => {
    root.querySelector('.submit-button').click()
    await tick()
  })
  await submit('Second intent')
  await settle()
  const newToken = sent.filter((message) => message.session).at(-1).requestToken
  expect(newToken).not.toBe(oldToken)
  await act(async () => {
    clientInbound.fire({
      requestToken: oldToken,
      started: true,
      answer: 'Queued stale answer',
      done: true,
      outcome: 'completed',
    })
    await tick()
  })
  expect(root.textContent).not.toContain('Queued stale answer')
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Stop')
  await act(async () => {
    ports.at(-1).postMessage({
      answer: 'Current final',
      finalContent: 'Current final',
      done: true,
      outcome: 'completed',
    })
    await tick()
  })
  expect(root.textContent).toContain('Current final')
})
it('does not begin provider execution after disconnection during validation', async () => {
  await mount()
  const get = Browser.storage.local.get.getMockImplementation()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  Browser.storage.local.get.mockImplementation(async (key) => {
    if (key === 'sessions') await gate
    return get(key)
  })
  await submit()
  await act(async () => {
    lastClient.disconnect()
    await tick()
    release()
  })
  await settle()
  expect(execute).not.toHaveBeenCalled()
  expect(responses.some((message) => message.started)).toBe(false)
  expect(root.querySelector('textarea').value).toBe('User intent')
})
it('keeps partial content terminal and does not resend after an unexpected disconnect', async () => {
  execute.mockImplementation(async (_session, port) => {
    port.postMessage({ answer: 'Partial content' })
  })
  await mount()
  await submit()
  await settle()
  await act(async () => {
    lastClient.disconnect()
    await tick()
  })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(root.textContent).toContain('Partial content')
  expect(root.textContent).toContain('The connection closed before completion could be confirmed')
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Send')
})
it('retries through the replacement port after a completed conversation disconnects', async () => {
  await mount()
  await submit('Question to retry')
  await settle()
  const oldClient = lastClient
  await act(async () => {
    oldClient.disconnect()
    await tick()
  })
  expect(lastClient).not.toBe(oldClient)
  expect(execute).toHaveBeenCalledTimes(1)
  await act(async () => {
    root.querySelector('.retry-fixture').click()
    await tick()
  })
  await settle()
  expect(execute).toHaveBeenCalledTimes(2)
  expect(sent.filter((message) => message.session)).toHaveLength(2)
  expect(root.textContent).not.toContain('Attempting to use a disconnected port')
})
it('regenerates a selected model through the replacement port after reconnect', async () => {
  const previousConfig = state.config
  state.config = {
    ...previousConfig,
    autoRegenAfterSwitchModel: true,
    chatgptWebEnabledModels: ['one', 'two'],
  }
  try {
    await mount()
    await submit('Question on another model')
    await settle()
    await act(async () => {
      lastClient.disconnect()
      await tick()
    })
    await act(async () => {
      root.querySelector('button.normal-button').click()
      await tick()
    })
    await act(async () => {
      const option = [...root.querySelectorAll('button')].find((button) =>
        button.textContent.includes('two'),
      )
      expect(option).toBeTruthy()
      option.click()
      await tick()
    })
    await settle()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(sent.filter((message) => message.session).at(-1).session.modelName).toBe(
      'chatgptweb/two',
    )
    expect(root.textContent).not.toContain('Attempting to use a disconnected port')
  } finally {
    state.config = previousConfig
  }
})
it.each(['failed', 'stopped', 'incomplete', 'rejected'])(
  'keeps the original completed record through a %s retry and reopening',
  async (outcome) => {
    const seed = {
      ...initial(),
      question: 'Question to retry',
      conversationRecords: [{ question: 'Question to retry', answer: 'Original completed answer' }],
    }
    stored.sessions = [structuredClone(seed)]
    let lastSaved
    const persist = (_port, snapshot) => {
      if (lastSaved === snapshot) return
      lastSaved = snapshot
      jobs.push(applyLocalSessionMutation('update', { session: snapshot }).catch(() => {}))
    }
    execute.mockImplementation(async (session, port) => {
      if (outcome === 'failed') throw new Error('Controlled provider failure')
      port.postMessage({ session, answer: 'Partial retry', done: true, outcome })
    })
    await mount(seed, persist)
    await settle()
    if (outcome === 'rejected')
      stored.sessions = [switchSessionEngine(stored.sessions[0], 'grokweb/fast')]
    await act(async () => {
      root.querySelector('.retry-fixture').click()
      await tick()
    })
    await settle()
    expect(execute).toHaveBeenCalledTimes(outcome === 'rejected' ? 0 : 1)
    expect(sent.find((message) => message.session).session.conversationRecords).toEqual(
      seed.conversationRecords,
    )
    expect(stored.sessions[0].conversationRecords).toEqual(seed.conversationRecords)
    await act(async () => {
      render(null, root)
      await tick()
    })
    await mount(structuredClone(stored.sessions[0]))
    expect(root.textContent).toContain('Original completed answer')
  },
)
it('keeps the original durable record until a successful retry replaces only its target', async () => {
  const seed = {
    ...initial(),
    question: 'repeat',
    conversationRecords: [
      { question: 'repeat', answer: 'First answer' },
      { question: 'repeat', answer: 'Second answer' },
    ],
  }
  stored.sessions = [structuredClone(seed)]
  let atDispatch, lastSaved
  const persist = (_port, snapshot) => {
    if (lastSaved === snapshot) return
    lastSaved = snapshot
    jobs.push(applyLocalSessionMutation('update', { session: snapshot }))
  }
  execute.mockImplementation(async (session, port) => {
    atDispatch = structuredClone(stored.sessions[0].conversationRecords)
    pushRecord(session, session.question, 'Replacement answer')
    port.postMessage({ session, answer: 'Replacement answer', done: true, outcome: 'completed' })
  })
  await mount(seed, persist)
  await settle()
  await act(async () => {
    root.querySelector('.retry-fixture').click()
    await tick()
  })
  await settle()
  expect(atDispatch).toEqual(seed.conversationRecords)
  expect(stored.sessions[0].conversationRecords).toEqual([
    { question: 'repeat', answer: 'First answer' },
    { question: 'repeat', answer: 'Replacement answer' },
  ])
})
it('keeps retry admission busy through an old Stop ACK and shows its actual pre-start rejection', async () => {
  const seed = {
    ...initial(),
    question: 'repeat',
    conversationRecords: [{ question: 'repeat', answer: 'Original answer' }],
  }
  stored.sessions = [structuredClone(seed)]
  await mount(seed)
  stored.sessions = [switchSessionEngine(seed, 'grokweb/fast')]
  const get = Browser.storage.local.get.getMockImplementation()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  Browser.storage.local.get.mockImplementation(async (key) => {
    if (key === 'sessions') await gate
    return get(key)
  })
  await act(async () => {
    root.querySelector('.retry-fixture').click()
    await tick()
  })
  const during = root.querySelector('.submit-button').getAttribute('aria-label')
  release()
  await settle()
  expect(during).toBe('Stop')
  expect(execute).not.toHaveBeenCalled()
  expect(root.textContent).toContain('changed connection in another window')
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Send')
  const request = sent.find((message) => message.session)
  expect(responses.find((message) => message.error)?.requestToken).toBe(request.requestToken)
  expect(request.session.conversationRecords).toEqual(seed.conversationRecords)
  expect(stored.sessions[0].conversationRecords).toEqual(seed.conversationRecords)
})
it('ends a reconnected initial request with its actual admission rejection and retained identity', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  state.restore = async (session) => {
    await gate
    return session
  }
  await mount(initial(), undefined, 'Initial pending question')
  await act(async () => {
    lastClient.disconnect()
    await tick()
  })
  stored.sessions = [switchSessionEngine(stored.sessions[0], 'grokweb/fast')]
  release()
  await settle()
  expect(execute).not.toHaveBeenCalled()
  const requests = sent.filter((message) => message.session)
  expect(requests).toHaveLength(1)
  expect(requests[0].session.question).toBe('Initial pending question')
  expect(responses.find((message) => message.error)?.requestToken).toBe(requests[0].requestToken)
  expect(root.textContent).toContain('changed connection in another window')
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Send')
  expect(stored.sessions[0].conversationRecords).toEqual([])
})
it('also shows a pre-start configuration rejection for an unpersisted retry', async () => {
  const seed = {
    ...initial(),
    question: 'repeat',
    conversationRecords: [{ question: 'repeat', answer: 'Original answer' }],
  }
  await mount(seed, undefined, undefined, false)
  state.configError = 'Controlled configuration failure'
  await act(async () => {
    root.querySelector('.retry-fixture').click()
    await tick()
  })
  await settle()
  expect(execute).not.toHaveBeenCalled()
  expect(root.textContent).toContain('Controlled configuration failure')
  expect(root.querySelector('.submit-button').getAttribute('aria-label')).toBe('Send')
  const request = sent.find((message) => message.session)
  expect(request.localSession).toBeUndefined()
  expect(responses.find((message) => message.error)?.requestToken).toBe(request.requestToken)
  expect(request.session.conversationRecords).toEqual(seed.conversationRecords)
})
