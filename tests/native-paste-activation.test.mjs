import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNativePasteActivation,
  NATIVE_PASTE_SCRIPT,
} from '../src/background/native-paste-activation.mjs'
const disposers = []
afterEach(() => {
  disposers.splice(0).forEach((fn) => fn())
  vi.restoreAllMocks()
})
const setup = () => {
  const values = { chatgptNativePasteEnabled: false },
    events = [],
    listeners = new Set()
  let scripts = []
  const browser = {
    runtime: {
      id: 'unit',
      getManifest: () => ({ manifest_version: 3 }),
      getURL: (path) => 'chrome-extension://unit/' + path,
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => scripts),
      registerContentScripts: vi.fn(async (next) => {
        events.push('register')
        scripts = next
      }),
      updateContentScripts: vi.fn(async (next) => {
        scripts = next
      }),
      unregisterContentScripts: vi.fn(async () => {
        events.push('unregister')
        scripts = []
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, ...values })),
        set: vi.fn(async (patch) => {
          events.push('store:' + JSON.stringify(patch))
          Object.assign(values, patch)
        }),
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
  }
  const service = createNativePasteActivation(browser)
  const sender = { id: 'unit', url: 'chrome-extension://unit/options.html', frameId: 0 }
  return { service, browser, values, events, sender, scripts: () => scripts }
}
describe('native paste opt-in at the document-start registration boundary', () => {
  it('keeps a default-off profile free of early paste scripts', async () => {
    const s = setup()
    await s.service.sync()
    expect(s.browser.scripting.registerContentScripts).not.toHaveBeenCalled()
    expect(s.scripts()).toEqual([])
  })
  it('verifies registration or removal before publishing either successful state', async () => {
    const s = setup()
    await s.service.setEnabled({ data: { enabled: true } }, s.sender)
    expect(s.scripts()).toEqual([NATIVE_PASTE_SCRIPT])
    expect(s.events[0]).toBe('register')
    expect(s.values.chatgptNativePasteEnabled).toBe(true)
    await s.service.setEnabled({ data: { enabled: false } }, s.sender)
    expect(s.values.chatgptNativePasteEnabled).toBe(false)
    expect(s.scripts()).toEqual([])
    expect(s.events.at(-2)).toBe('unregister')
    expect(s.events.at(-1)).toContain('"chatgptNativePasteEnabled":false')
  })
  it('does not mark checking enabled if browser registration fails', async () => {
    const s = setup()
    s.browser.scripting.registerContentScripts.mockRejectedValue(new Error('unavailable'))
    await expect(s.service.setEnabled({ data: { enabled: true } }, s.sender)).rejects.toThrow(
      'unconfirmed',
    )
    expect(s.values.chatgptNativePasteEnabled).toBe(false)
    expect(s.values.chatgptNativePasteActivationError).toContain('unconfirmed')
  })
  it('revokes a persisted enabled flag when startup registration fails and cleanup is confirmed', async () => {
    const s = setup()
    s.values.chatgptNativePasteEnabled = true
    s.browser.scripting.registerContentScripts.mockRejectedValue(new Error('registration failed'))
    await expect(s.service.sync()).rejects.toThrow('unconfirmed')
    expect(s.values.chatgptNativePasteEnabled).toBe(false)
    expect(s.scripts()).toEqual([])
    await s.service.sync()
    expect(s.values.chatgptNativePasteActivationError).toContain('unconfirmed')
  })
  it('does not publish off when unregister fails, and retains an explicit unconfirmed-state error', async () => {
    const s = setup()
    await s.service.setEnabled({ data: { enabled: true } }, s.sender)
    s.browser.scripting.unregisterContentScripts.mockRejectedValue(new Error('unregister failed'))
    await expect(s.service.setEnabled({ data: { enabled: false } }, s.sender)).rejects.toThrow(
      'unconfirmed',
    )
    expect(s.values.chatgptNativePasteEnabled).toBe(true)
    expect(s.scripts()).toHaveLength(1)
    expect(s.values.chatgptNativePasteActivationError).toContain('Do not rely on it')
  })
  it('rejects a browser mutation that resolves without the required registration effect', async () => {
    const s = setup()
    s.browser.scripting.registerContentScripts.mockResolvedValue(undefined)
    await expect(s.service.setEnabled({ data: { enabled: true } }, s.sender)).rejects.toThrow(
      'unconfirmed',
    )
    expect(s.values.chatgptNativePasteEnabled).toBe(false)
    expect(s.values.chatgptNativePasteActivationError).toContain('unconfirmed')
  })
  it('never clears uncertainty when browser registration state cannot be read', async () => {
    const s = setup()
    s.values.chatgptNativePasteEnabled = true
    s.browser.scripting.getRegisteredContentScripts.mockRejectedValue(new Error('API unavailable'))
    await expect(s.service.sync()).rejects.toThrow('unconfirmed')
    expect(s.values.chatgptNativePasteActivationError).toContain('Do not rely on it')
  })
  it('does not report disabled when unregister resolves without removing the script', async () => {
    const s = setup()
    await s.service.setEnabled({ data: { enabled: true } }, s.sender)
    s.browser.scripting.unregisterContentScripts.mockResolvedValue(undefined)
    await expect(s.service.setEnabled({ data: { enabled: false } }, s.sender)).rejects.toThrow(
      'unconfirmed',
    )
    expect(s.values.chatgptNativePasteEnabled).toBe(true)
    expect(s.scripts()).toHaveLength(1)
    expect(s.values.chatgptNativePasteActivationError).toContain('unconfirmed')
  })
  it('serializes rapid toggles and reconciles persisted/imported settings without duplicate registration', async () => {
    const s = setup()
    await Promise.all([
      s.service.setEnabled({ data: { enabled: true } }, s.sender),
      s.service.setEnabled({ data: { enabled: false } }, s.sender),
    ])
    expect(s.values.chatgptNativePasteEnabled).toBe(false)
    expect(s.scripts()).toEqual([])
    s.values.chatgptNativePasteEnabled = true
    await s.service.sync()
    await s.service.sync()
    expect(s.browser.scripting.registerContentScripts).toHaveBeenCalledTimes(2)
    expect(s.browser.scripting.updateContentScripts).not.toHaveBeenCalled()
  })
  it('rejects settings changes from a website or a subframe, and never registers in Firefox', async () => {
    const s = setup()
    for (const patch of [{ url: 'https://chatgpt.com/' }, { frameId: 1 }, { id: 'other' }])
      await expect(
        s.service.setEnabled({ data: { enabled: true } }, { ...s.sender, ...patch }),
      ).rejects.toThrow()
    s.browser.runtime.getManifest = () => ({ manifest_version: 2 })
    disposers.push(s.service.start())
    await s.service.sync()
    expect(s.browser.scripting.getRegisteredContentScripts).not.toHaveBeenCalled()
  })
})
