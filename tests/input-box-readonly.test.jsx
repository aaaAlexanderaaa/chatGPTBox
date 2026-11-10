// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import Browser from 'webextension-polyfill'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (value) => value }) }))
vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: async () => ({ focusAfterAnswer: false }),
}))
import InputBox from '../src/components/InputBox/index.jsx'
const root = document.createElement('div')
document.body.append(root)
afterEach(() => {
  act(() => render(null, root))
  root.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('flushes a just-edited draft before reopening and leaves it dirty after a failed save', async () => {
  vi.useFakeTimers()
  vi.spyOn(Browser.storage.local, 'get').mockResolvedValue({})
  const save = vi.spyOn(Browser.storage.local, 'set').mockResolvedValue(undefined)
  const draftFlushRef = { current: null }
  await act(async () => {
    render(
      <InputBox
        enabled
        draftKey="window"
        draftFlushRef={draftFlushRef}
        onSubmit={() => {}}
        postMessage={() => {}}
      />,
      root,
    )
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Latest text before the debounce'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  save.mockRejectedValueOnce(new Error('autosave unavailable'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251)
  })
  save.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(draftFlushRef.current()).rejects.toThrow('storage unavailable')
  expect(root.querySelector('textarea').value).toBe('Latest text before the debounce')
  await draftFlushRef.current()
  expect(save).toHaveBeenLastCalledWith({
    'inputbox-draft:window': 'Latest text before the debounce',
  })
  expect(save).toHaveBeenCalledTimes(3)
})
it('keeps an unsent draft readable while blocked and allows sending after reopening', async () => {
  const submit = vi.fn(),
    post = vi.fn()
  await act(async () => {
    render(<InputBox enabled onSubmit={submit} postMessage={post} />, root)
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Unsent draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    render(<InputBox enabled readOnly onSubmit={submit} postMessage={post} />, root)
  })
  const input = root.querySelector('textarea')
  expect(input.readOnly).toBe(true)
  expect(input.value).toBe('Unsent draft')
  expect(root.querySelector('button').disabled).toBe(true)
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    root.querySelector('button').click()
  })
  expect(submit).not.toHaveBeenCalled()
  expect(post).not.toHaveBeenCalled()
  await act(async () => {
    render(<InputBox enabled onSubmit={submit} postMessage={post} />, root)
    root.querySelector('button').click()
  })
  expect(submit).toHaveBeenCalledExactlyOnceWith('Unsent draft')
})
it('does not let a delayed storage load replace a newer edit', async () => {
  let release
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  vi.spyOn(Browser.storage.local, 'set').mockResolvedValue(undefined)
  await act(async () => {
    render(
      <InputBox enabled draftKey="late-load" onSubmit={() => {}} postMessage={() => {}} />,
      root,
    )
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Newly typed text'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    release({ 'inputbox-draft:late-load': 'Older stored text' })
  })
  expect(root.querySelector('textarea').value).toBe('Newly typed text')
})
it('keeps explicit Stop available when a save conflict blocks further input', async () => {
  const submit = vi.fn(),
    post = vi.fn()
  await act(async () => {
    render(
      <InputBox
        enabled={false}
        readOnly
        stopLabel="Stop agent session"
        stopPlaceholder="Generating... Press Enter to stop the agent session"
        onSubmit={submit}
        postMessage={post}
      />,
      root,
    )
  })
  expect(root.querySelector('textarea').readOnly).toBe(true)
  expect(root.querySelector('textarea').placeholder).toContain('Press Enter to stop')
  const button = root.querySelector('button')
  expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-label')).toBe('Stop agent session')
  await act(async () => button.click())
  expect(post).toHaveBeenCalledExactlyOnceWith({ stop: true })
  expect(submit).not.toHaveBeenCalled()
})
it('does not resurrect a sent draft when its old autosave runs after removal was queued', async () => {
  vi.useFakeTimers()
  const saved = {}
  let autosave
  const taskTimeout = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay === 250) autosave = callback
    return taskTimeout(callback, delay, ...args)
  })
  vi.spyOn(Browser.storage.local, 'get').mockImplementation(async (key) => ({ [key]: saved[key] }))
  vi.spyOn(Browser.storage.local, 'set').mockImplementation(async (patch) =>
    Object.assign(saved, patch),
  )
  vi.spyOn(Browser.storage.local, 'remove').mockImplementation(async (key) => {
    delete saved[key]
    await Promise.resolve()
    autosave()
  })
  await act(async () => {
    render(
      <InputBox
        enabled
        draftKey="accepted-race"
        onSubmit={async () => true}
        postMessage={() => {}}
      />,
      root,
    )
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Sent once'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(autosave).toEqual(expect.any(Function))
  await act(async () => {
    root.querySelector('.submit-button').click()
    await Promise.resolve()
  })
  const { readInputDraft } = await import('../src/services/input-drafts.mjs')
  expect(await readInputDraft('inputbox-draft:accepted-race')).toBe('')
  expect(saved).not.toHaveProperty('inputbox-draft:accepted-race')
  expect(root.querySelector('textarea').value).toBe('')
})
it('flushes an edit when unmounted before its debounce fires', async () => {
  vi.useFakeTimers()
  vi.spyOn(Browser.storage.local, 'get').mockResolvedValue({})
  const save = vi.spyOn(Browser.storage.local, 'set').mockResolvedValue(undefined)
  await act(async () => {
    render(<InputBox enabled draftKey="leave" onSubmit={() => {}} postMessage={() => {}} />, root)
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Keep on leaving'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    render(null, root)
  })
  expect(save).toHaveBeenCalledExactlyOnceWith({ 'inputbox-draft:leave': 'Keep on leaving' })
})
it('keeps an older pending write before a newer flush and waits for the latest edit', async () => {
  vi.useFakeTimers()
  vi.spyOn(Browser.storage.local, 'get').mockResolvedValue({})
  let release, saved
  const save = vi
    .spyOn(Browser.storage.local, 'set')
    .mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          release = () => {
            saved = patch
            resolve()
          }
        }),
    )
    .mockImplementation(async (patch) => {
      saved = patch
    })
  const draftFlushRef = { current: null }
  await act(async () => {
    render(
      <InputBox
        enabled
        draftKey="ordered"
        draftFlushRef={draftFlushRef}
        onSubmit={() => {}}
        postMessage={() => {}}
      />,
      root,
    )
  })
  const type = async (value) =>
    act(async () => {
      const input = root.querySelector('textarea')
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await type('Old edit')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251)
  })
  await type('New edit')
  const flush = draftFlushRef.current()
  expect(save).toHaveBeenCalledTimes(1)
  await type('Latest edit while flushing')
  await act(async () => {
    release()
    await flush
  })
  expect(saved).toEqual({ 'inputbox-draft:ordered': 'Latest edit while flushing' })
})
it('keeps the submitted input when request admission fails', async () => {
  let release
  const submit = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  await act(async () => {
    render(<InputBox enabled onSubmit={submit} postMessage={() => {}} />, root)
  })
  await act(async () => {
    const input = root.querySelector('textarea')
    input.value = 'Not admitted'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    root.querySelector('button').click()
    root.querySelector('button').click()
  })
  expect(submit).toHaveBeenCalledTimes(1)
  await act(async () => {
    release(false)
  })
  expect(root.querySelector('textarea').value).toBe('Not admitted')
})
