import { describe, expect, it } from 'vitest'
import {
  listFunctions,
  findFunction,
  localizeFunction,
  saveFunctionPatch,
  updateFunctionPatch,
  deleteFunctionPatch,
} from '../src/browser-assistant/catalog.mjs'
import {
  createFunction,
  prepareFunctionRun,
  exportFunctions,
  importFunctions,
} from '../src/browser-assistant/functions.mjs'

const config = () => ({
  activeSelectionTools: ['translate', 'summary'],
  customSelectionTools: [
    {
      name: 'My old function',
      prompt: 'Explain {{selection}} at {{url}}',
      active: true,
      usePageContext: true,
      iconKey: 'star',
    },
  ],
  browserAssistantFunctions: [
    createFunction({ id: 'my.saved', name: 'Saved function', scope: 'url', engine: 'local/text' }),
  ],
  browserFunctionOverrides: {},
  modelName: 'local/text',
  l1Providers: [{ id: 'local', format: 'openai-compat', models: [{ id: 'text', enabled: true }] }],
})

describe('one function catalog for all entries', () => {
  it('keeps old and new user functions in one list without mutating stored configuration', () => {
    const value = config(),
      before = structuredClone(value)
    const functions = listFunctions(value, { includeDisabled: true })
    expect(functions.some((item) => item.id === 'builtin.translate')).toBe(true)
    expect(functions.some((item) => item.id === 'preset.annotations')).toBe(true)
    expect(functions.find((item) => item.id === 'legacy.0').prompt).toBe(
      value.customSelectionTools[0].prompt,
    )
    expect(functions.find((item) => item.id === 'my.saved').engine).toBe('local/text')
    expect(new Set(functions.map((item) => item.id)).size).toBe(functions.length)
    expect(value).toEqual(before)
  })
  it('uses the same enabled IDs in context menu, toolbar, and picker by default', () => {
    const ids = (entry) => listFunctions(config(), { entry }).map((item) => item.id)
    expect(ids('context-menu')).toEqual(ids('selection-toolbar'))
    expect(ids('function-picker')).toEqual(ids('selection-toolbar'))
    expect(ids('context-menu')).not.toContain('builtin.code')
  })
  it('preserves future entries and existing user data through export and import', () => {
    const fn = createFunction({
      entries: ['future-command-palette'],
      template: true,
      selectionOrPage: true,
    })
    expect(importFunctions(exportFunctions([fn]))).toEqual([fn])
  })
  it('maps old menu IDs to the shared catalog', () => {
    expect(findFunction(config(), 'translate').id).toBe('builtin.translate')
    expect(findFunction(config(), 'custom_0').id).toBe('legacy.0')
    expect(findFunction(config(), 'summarizePage').id).toBe('preset.page-overview')
  })
  it('respects entry overrides independently of enablement', () => {
    const value = config(),
      item = findFunction(value, 'preset.annotations')
    Object.assign(value, updateFunctionPatch(value, item, { entries: ['future-command-palette'] }))
    expect(listFunctions(value, { entry: 'context-menu' }).some((fn) => fn.id === item.id)).toBe(
      false,
    )
    expect(
      listFunctions(value, { entry: 'future-command-palette' }).some((fn) => fn.id === item.id),
    ).toBe(true)
    Object.assign(value, updateFunctionPatch(value, item, { enabled: false }))
    expect(listFunctions(value).some((fn) => fn.id === item.id)).toBe(false)
  })
  it('changes an old custom function atomically without losing its template or unrelated entries', () => {
    const value = config(),
      old = findFunction(value, 'custom_0')
    const { item, patch } = saveFunctionPatch(value, { ...old, name: 'Updated' })
    expect(patch.customSelectionTools).toEqual([])
    expect(item.template).toBe(true)
    expect(item.selectionOrPage).toBe(true)
    expect(patch.browserAssistantFunctions).toContainEqual(value.browserAssistantFunctions[0])
    expect(item.prompt).toBe(old.prompt)
  })
  it("keeps another legacy function's entry preferences after deletion shifts indices", () => {
    const value = config()
    value.customSelectionTools.push({ ...value.customSelectionTools[0], name: 'Second' })
    value.browserFunctionOverrides['legacy.1'] = { entries: ['function-picker'] }
    const patch = deleteFunctionPatch(value, findFunction(value, 'custom_0'))
    Object.assign(value, patch)
    expect(findFunction(value, 'custom_0').name).toBe('Second')
    expect(findFunction(value, 'custom_0').entries).toEqual(['function-picker'])
  })
  it('localizes built-ins at read time and leaves user-authored text unchanged', () => {
    const translate = (value) => `中文:${value}`
    const value = config(),
      builtin = findFunction(value, 'preset.annotations')
    expect(localizeFunction(builtin, translate).name).toContain('中文:')
    expect(localizeFunction(value.browserAssistantFunctions[0], translate).name).toBe(
      'Saved function',
    )
    expect(
      localizeFunction({ ...builtin, customized: true, prompt: 'My edited instruction' }, translate)
        .prompt,
    ).toBe('My edited instruction')
  })
  it('uses one runner for legacy templates, material selection and per-function engine', () => {
    const value = config(),
      context = { url: 'https://example.com/', selection: 'Selected passage' }
    const fn = findFunction(value, 'custom_0', context)
    const run = prepareFunctionRun({ fn, context, config: value, language: 'Chinese (Simplified)' })
    expect(run.prompt).toContain('Explain Selected passage at https://example.com/')
    expect(run.prompt).not.toContain('{{selection}}')
    expect(run.engine).toBe('local/text')
    expect(findFunction(value, 'custom_0', { selection: '' }).scope).toBe('page')
  })
})
