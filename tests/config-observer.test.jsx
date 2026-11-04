// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import Browser from 'webextension-polyfill'
import PropTypes from 'prop-types'
import { useConfig } from '../src/hooks/use-config.mjs'

vi.mock('../src/config/storage.mjs', () => ({
  defaultConfig: { themeMode: 'auto', modelName: 'local/text' },
  getUserConfig: async () => ({ themeMode: 'auto', modelName: 'local/text' }),
}))

let root, listener, renders, latest
function Consumer({ withSessions = false }) {
  latest = useConfig(null, !withSessions)
  renders += 1
  return <span>{latest.themeMode}</span>
}
Consumer.propTypes = { withSessions: PropTypes.bool }
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  renders = 0
  Browser.storage.local.onChanged = {
    addListener: (fn) => {
      listener = fn
    },
    removeListener: vi.fn(),
  }
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
  delete Browser.storage.local.onChanged
})

it('does not retain or rerender for 1200 backup bodies and progress events', async () => {
  await act(async () => render(<Consumer />, root))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const before = renders
  await act(async () => {
    for (let n = 0; n < 1200; n += 1) {
      listener({
        [`chatgptWebConversationSnapshot:chat-${n}`]: {
          newValue: { snapshot: { messages: ['x'.repeat(1000)] } },
        },
        chatgptWebConversationMeta: { newValue: { progress: n } },
      })
    }
  })
  expect(renders).toBe(before)
  expect(Object.keys(latest)).toEqual(['themeMode', 'modelName'])
  await act(async () =>
    listener({
      themeMode: { newValue: 'dark' },
      chatgptWebConversationSnapshot: { newValue: 'body' },
    }),
  )
  expect(latest).toEqual({ themeMode: 'dark', modelName: 'local/text' })
})

it('preserves the independent panel session subscription without retaining backup data', async () => {
  await act(async () => render(<Consumer withSessions />, root))
  await act(async () =>
    listener({
      sessions: { newValue: ['session'] },
      chatgptWebConversationIndex: { newValue: {} },
    }),
  )
  expect(latest.sessions).toEqual(['session'])
  expect(latest).not.toHaveProperty('chatgptWebConversationIndex')
})
