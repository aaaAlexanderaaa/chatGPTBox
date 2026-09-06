import { describe, expect, it } from 'vitest'
import { ModelGroups, Models } from '../src/config/models.mjs'
import { getApiModesFromConfig, getModelNameGroup } from '../src/utils/model-name-convert.mjs'

describe('config model module boundaries', () => {
  it('initializes models and converters without a barrel-import cycle', () => {
    expect(ModelGroups.chatgptWebModelKeys.value).toContain('chatgptWeb6Pro')
    expect(ModelGroups.chatgptWebModelKeys.value).toContain('chatgptWeb6AstraWork')
    expect(Models.chatgptWeb6Pro).toMatchObject({ value: 'gpt-6-pro' })
    expect(Models.chatgptWeb6AstraWork).toMatchObject({ value: 'gpt-6-astra-wm' })
    expect(getModelNameGroup('chatgptWeb6Pro')).toContain('chatgptWebModelKeys')
    expect(
      getApiModesFromConfig(
        {
          customApiModes: [],
          activeApiModes: ['chatgptWeb6Pro'],
        },
        false,
      ),
    ).toMatchObject([
      { groupName: 'chatgptWebModelKeys', itemName: 'chatgptWeb6Pro', isCustom: false },
    ])
  })

  it('no longer exposes the removed web-scraper provider groups', () => {
    expect(ModelGroups.bingWebModelKeys).toBeUndefined()
    expect(ModelGroups.bardWebModelKeys).toBeUndefined()
    expect(ModelGroups.claudeWebModelKeys).toBeUndefined()
    expect(Object.keys(Models).some((key) => key.startsWith('poeAiWeb'))).toBe(false)
  })
})
