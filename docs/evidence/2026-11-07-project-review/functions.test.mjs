/* global vi, it, expect */
/* eslint-env node */
// Dated synthetic defect witness. A fix can make these baseline assertions fail.
import { h, render } from '../../../node_modules/preact/dist/preact.mjs'
import { act } from '../../../node_modules/preact/test-utils/dist/testUtils.mjs'
import Browser from '../../../tests/__stubs__/webextension-polyfill.mjs'
import { useSettingsConfig } from '../../../src/hooks/use-settings-config.mjs'
import { FunctionLibrary } from '../../../src/browser-assistant/FunctionLibrary.jsx'
const fixture = vi.hoisted(() => ({
  saved: [
    {
      id: 'existing-function',
      name: 'Existing',
      prompt: 'Keep me',
      scope: 'selection',
      output: 'chat',
    },
  ],
  writes: [],
  readState: null,
  mode: 'loading',
}))
vi.mock('../../../src/config/storage.mjs', () => ({
  defaultConfig: {
    browserAssistantFunctions: [],
    browserFunctionOverrides: {},
    customSelectionTools: [],
    l1Providers: [],
  },
  getUserConfig: () =>
    fixture.mode === 'error'
      ? Promise.reject(new Error('Settings unavailable'))
      : new Promise(() => {}),
  setUserConfig: async (patch) => {
    fixture.writes.push(patch)
    if (patch.browserAssistantFunctions) fixture.saved = patch.browserAssistantFunctions
  },
}))
function SettingsFunctions() {
  const [config, updateConfig, readState] = useSettingsConfig()
  fixture.readState = readState
  return h(FunctionLibrary, { config, updateConfig })
}
it.each(['loading', 'error'])(
  'can replace stored functions when the initial settings read is %s',
  async (mode) => {
    fixture.mode = mode
    fixture.saved = [
      {
        id: 'existing-function',
        name: 'Existing',
        prompt: 'Keep me',
        scope: 'selection',
        output: 'chat',
      },
    ]
    fixture.writes = []
    Browser.storage.local.onChanged = { addListener() {}, removeListener() {} }
    const root = document.createElement('div')
    document.body.append(root)
    await act(async () => {
      render(h(SettingsFunctions), root)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(fixture.readState).toBe(mode)
    const newButton = [...root.querySelectorAll('button')].find(
      (x) => x.textContent === 'New function',
    )
    expect(newButton.matches(':disabled')).toBe(false)
    act(() => newButton.click())
    await act(async () => {
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.saved.some((x) => x.id === 'existing-function')).toBe(false)
    console.log(
      JSON.stringify({
        readState: fixture.readState,
        saveAllowed: true,
        existingFunctionSurvived: false,
        savedFunctions: fixture.saved.length,
      }),
    )
    act(() => render(null, root))
    root.remove()
    delete Browser.storage.local.onChanged
  },
)
