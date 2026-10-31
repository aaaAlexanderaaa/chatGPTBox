// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  controller: { configure: vi.fn(), suspend: vi.fn(), dispose: vi.fn() },
  install: vi.fn(),
  readers: [],
  changed: null,
}))
vi.mock('../src/native-chatgpt/paste-controller.mjs', () => ({
  installNativePaste: () => {
    state.install()
    return state.controller
  },
}))
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: () => new Promise((resolve) => state.readers.push(resolve)) },
      onChanged: {
        addListener: (fn) => {
          state.changed = fn
        },
        removeListener: () => {
          state.changed = null
        },
      },
    },
  },
}))
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  state.readers.length = 0
  vi.clearAllMocks()
  vi.resetModules()
})
describe('early entry configuration order', () => {
  it('installs before async settings and ignores an older response after a policy change', async () => {
    await import('../src/native-chatgpt/early.mjs')
    expect(state.install).toHaveBeenCalledTimes(1)
    expect(state.controller.suspend).toHaveBeenCalledTimes(1)
    expect(state.controller.configure).not.toHaveBeenCalled()
    state.changed({ chatgptNativePasteEnabled: { newValue: true } }, 'local')
    expect(state.readers).toHaveLength(2)
    state.readers[1]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    expect(state.controller.configure).toHaveBeenCalledWith({ chatgptNativePasteEnabled: true })
    state.readers[0]({ chatgptNativePasteEnabled: false })
    await Promise.resolve()
    expect(state.controller.configure).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(state.controller.dispose).toHaveBeenCalled()
    expect(state.changed).toBeNull()
  })
  it('reinstalls after BFCache restore, invalidates frozen reads, and disables immediately', async () => {
    await import('../src/native-chatgpt/early.mjs')
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    state.readers[0]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    expect(state.controller.configure).not.toHaveBeenCalled()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(state.install).toHaveBeenCalledTimes(2)
    expect(state.readers).toHaveLength(2)
    state.changed({ chatgptNativePasteEnabled: { newValue: false } }, 'local')
    expect(state.controller.configure).toHaveBeenCalledWith(
      expect.objectContaining({ chatgptNativePasteEnabled: false }),
    )
    state.readers[1]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    expect(state.controller.configure).toHaveBeenCalledTimes(1)
  })
  it('carries a confirmed off state into a restored document before refreshing settings', async () => {
    await import('../src/native-chatgpt/early.mjs')
    state.readers[0]({ chatgptNativePasteEnabled: false })
    await Promise.resolve()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(state.install).toHaveBeenCalledTimes(2)
    expect(state.controller.configure.mock.calls.at(-1)[0].chatgptNativePasteEnabled).toBe(false)
    state.changed({ preferredLanguage: { newValue: 'zh' } }, 'local')
    state.readers[1]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    expect(state.controller.configure.mock.calls.at(-1)[0].chatgptNativePasteEnabled).toBe(false)
    state.readers[2]({ chatgptNativePasteEnabled: false })
    await Promise.resolve()
    expect(state.controller.configure.mock.calls.at(-1)[0].chatgptNativePasteEnabled).toBe(false)
  })
  it('treats a removed opt-in key as immediate off and rejects an in-flight enabled read', async () => {
    await import('../src/native-chatgpt/early.mjs')
    state.readers[0]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    state.changed({ chatgptNativePasteTerms: { newValue: ['sample'] } }, 'local')
    state.changed({ chatgptNativePasteEnabled: { oldValue: true } }, 'local')
    expect(state.readers).toHaveLength(2)
    expect(state.controller.configure.mock.calls.at(-1)[0].chatgptNativePasteEnabled).toBe(false)
    state.readers[1]({ chatgptNativePasteEnabled: true })
    await Promise.resolve()
    expect(state.controller.configure.mock.calls.at(-1)[0].chatgptNativePasteEnabled).toBe(false)
  })
})
