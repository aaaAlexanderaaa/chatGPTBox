// @vitest-environment jsdom
/* eslint-disable react/prop-types -- Controlled child surfaces isolate the real card's transport. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import Browser from 'webextension-polyfill'
const state = vi.hoisted(() => ({
  restore: null,
  config: {
    modelName: 'chatgptweb/one',
    l1Providers: [],
    chatgptWebEnabled: true,
    chatgptWebEnabledModels: ['one'],
  },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value) => value }) }))
vi.mock('../src/hooks/use-config.mjs', () => ({ useConfig: () => state.config }))
vi.mock('../src/services/clients/chatgpt-web/thread-state.mjs', () => ({
  restoreChatgptWebSessionSnapshot: (session) =>
    state.restore ? state.restore(session) : Promise.resolve(session),
  saveChatgptWebSessionSnapshot: async () => {},
  deleteChatgptWebSessionSnapshot: async () => {},
}))
vi.mock('../src/components/ConversationItem', () => ({
  default: ({ content, onRetry }) => (
    <div>
      {content}
      {onRetry && <button onClick={onRetry}>Retry fixture</button>}
    </div>
  ),
}))
vi.mock('../src/components/InputBox', () => ({
  default: ({ enabled, postMessage }) => (
    <button data-ready={String(enabled)} onClick={() => postMessage({ stop: true })}>
      Stop fixture
    </button>
  ),
}))
import ConversationCard from '../src/components/ConversationCard/index.jsx'
let root, posts, inbound, connections, sentByPort
const base = (modelName = 'chatgptweb/one') => ({
  sessionId: 'local',
  modelName,
  question: null,
  conversationRecords: [],
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const emit = (message) => {
  const requestToken = sentByPort.filter((entry) => entry.message.session).at(-1)
    ?.message.requestToken
  inbound.forEach((fn) => fn({ ...message, requestToken }))
}
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  posts = []
  inbound = new Set()
  connections = []
  sentByPort = []
  state.restore = null
  vi.spyOn(Browser.runtime, 'connect').mockImplementation(() => {
    const messages = new Set(),
      disconnects = new Set()
    let closed = false
    inbound = messages
    const connection = {
      postMessage: (message) => {
        if (closed) throw new Error('Attempting to use a disconnected port')
        posts.push(message)
        sentByPort.push({ connection, message })
        if (message.stop) messages.forEach((fn) => fn({ done: true, outcome: 'stopped' }))
        if (message.session)
          queueMicrotask(() =>
            messages.forEach((fn) =>
              fn({ session: message.session, started: true, requestToken: message.requestToken }),
            ),
          )
      },
      disconnect: () => {
        if (closed) return
        closed = true
        ;[...disconnects].forEach((fn) => fn())
      },
      onMessage: {
        addListener: (fn) => messages.add(fn),
        removeListener: (fn) => messages.delete(fn),
      },
      onDisconnect: {
        addListener: (fn) => disconnects.add(fn),
        removeListener: (fn) => disconnects.delete(fn),
      },
    }
    connections.push(connection)
    return connection
  })
  Element.prototype.scrollTo = () => {}
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.restoreAllMocks()
})
it('Stop during the initial asynchronous restore prevents a late first dispatch', async () => {
  let release
  state.restore = (session) =>
    new Promise((resolve) => {
      release = () => resolve(session)
    })
  await act(async () => {
    render(<ConversationCard session={base()} question="initial question" />, root)
    await tick()
  })
  expect(posts).toEqual([])
  await act(async () => {
    root.querySelector('[data-ready]').click()
    await tick()
  })
  await act(async () => {
    release()
    await tick()
  })
  expect(posts).toEqual([{ stop: true }])
})
it('uses the new port exactly once when reconnecting during the first restore', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  state.restore = async (session) => {
    await gate
    return session
  }
  await act(async () => {
    render(<ConversationCard session={base()} question="Initial question" />, root)
    await tick()
  })
  await act(async () => {
    connections[0].disconnect()
    await tick()
    release()
    await tick()
  })
  await act(tick)
  expect(connections).toHaveLength(2)
  expect(posts.filter((message) => message.session)).toHaveLength(1)
  expect(sentByPort.find((entry) => entry.message.session).connection).toBe(connections[1])
})
it('does not automatically resend an initial question that was already submitted before reconnect', async () => {
  await act(async () => {
    render(<ConversationCard session={base()} question="Already submitted question" />, root)
    await tick()
  })
  await act(tick)
  expect(posts.filter((message) => message.session)).toHaveLength(1)
  await act(async () => {
    connections[0].disconnect()
    await tick()
  })
  await act(tick)
  expect(connections).toHaveLength(2)
  expect(posts.filter((message) => message.session)).toHaveLength(1)
})
it('dispatches completion fields even when a DSH status clear shares their message', async () => {
  let updated
  await act(async () => {
    render(
      <ConversationCard
        session={{ ...base('dsh/agent'), dshSessionId: 'remote' }}
        question="task"
        onUpdate={(_port, _session, items) => {
          updated = items
        }}
      />,
      root,
    )
    await tick()
  })
  await act(tick)
  expect(posts.filter((message) => message.session)).toHaveLength(1)
  await act(async () => {
    emit({
      answer: 'Complete answer',
      finalContent: 'Complete answer',
      outcome: 'completed',
      dshStatus: null,
      done: true,
    })
    await tick()
  })
  expect(updated.at(-1)).toMatchObject({
    content: 'Complete answer',
    done: true,
    outcome: 'completed',
  })
  expect(root.querySelector('[data-ready]').dataset.ready).toBe('true')
})

it('allows an explicit retry after its Stop acknowledgement arrives before the new run starts', async () => {
  let updated
  await act(async () => {
    render(
      <ConversationCard
        session={base()}
        question="question"
        onUpdate={(_port, _session, items) => {
          updated = items
        }}
      />,
      root,
    )
    await tick()
  })
  await act(tick)
  await act(async () => {
    emit({ error: 'upstream failed' })
    await tick()
  })
  await act(async () => {
    const retryButton = [...root.querySelectorAll('button')].find(
      (node) => node.textContent === 'Retry fixture',
    )
    retryButton.click()
    await tick()
  })
  expect(posts.some((message) => message.stop)).toBe(true)
  expect(posts.filter((message) => message.session)).toHaveLength(2)
  const retrySession = posts.filter((message) => message.session).at(-1).session
  await act(async () => {
    emit({ session: retrySession, started: true })
    emit({
      answer: 'fresh answer',
      finalContent: 'fresh answer',
      done: true,
      outcome: 'completed',
    })
    await tick()
  })
  expect(updated.at(-1)).toMatchObject({
    content: 'fresh answer',
    finalContent: 'fresh answer',
    done: true,
    outcome: 'completed',
  })
})
it('keeps input busy when Stop acknowledgement and a new start arrive in one UI batch', async () => {
  await act(async () => {
    render(<ConversationCard session={base()} question="question" />, root)
    await tick()
  })
  await act(tick)
  await act(async () => {
    inbound.forEach((fn) => fn({ done: true, outcome: 'stopped' }))
    emit({ started: true, session: { ...base(), question: 'retry' } })
    await tick()
  })
  expect(root.querySelector('[data-ready]').dataset.ready).toBe('false')
  await act(async () => {
    emit({ answer: 'finished retry', done: true, outcome: 'completed' })
    await tick()
  })
  expect(root.querySelector('[data-ready]').dataset.ready).toBe('true')
})
