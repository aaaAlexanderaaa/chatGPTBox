import { describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import { resources } from '../src/_locales/resources.mjs'
import {
  listFunctions,
  localizeFunction,
  FUNCTION_ENTRIES,
} from '../src/browser-assistant/catalog.mjs'
import {
  SCOPE_LABELS,
  OUTPUT_LABELS,
  prepareFunctionRun,
} from '../src/browser-assistant/functions.mjs'
import { FUNCTION_ICONS } from '../src/browser-assistant/icons.mjs'

describe('function terminology and built-in translations', () => {
  it.each(['en', 'zh', 'zhHant'])(
    'covers every shared function name, instruction, scope and entry in %s',
    (language) => {
      const dictionary = resources[language].translation
      const builtins = listFunctions({}, { includeDisabled: true }).filter(
        (item) => item.source === 'builtin',
      )
      const keys = [
        'Functions',
        'Functions…',
        'Show function picker',
        ...FUNCTION_ENTRIES.map((entry) => entry.label),
        ...Object.values(SCOPE_LABELS),
        ...Object.values(OUTPUT_LABELS),
        ...Object.values(FUNCTION_ICONS).map((item) => item.label),
        ...builtins.flatMap((item) => [item.name, item.prompt]),
      ]
      expect(keys.filter((key) => !dictionary[key])).toEqual([])
    },
  )
  it('keeps language placeholders until prompt preparation and always includes translation material', async () => {
    const i18n = createInstance()
    await i18n.init({ resources, lng: 'zh', fallbackLng: 'en' })
    const translate = listFunctions({ activeSelectionTools: ['translate'] }).find(
      (item) => item.id === 'builtin.translate',
    )
    const fn = localizeFunction(translate, i18n.t.bind(i18n))
    expect(fn.prompt).toContain('{{language}}')
    const run = prepareFunctionRun({
      fn,
      context: { selection: 'Original sentence' },
      language: 'Chinese (Simplified)',
      config: {
        modelName: 'local/text',
        l1Providers: [{ id: 'local', models: [{ id: 'text', enabled: true }] }],
      },
    })
    expect(run.prompt).toContain('Original sentence')
    expect(run.prompt).toContain('Chinese (Simplified)')
    expect(run.prompt).not.toContain('{{language}}')
  })
})
