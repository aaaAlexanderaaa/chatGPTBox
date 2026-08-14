import { describe, expect, it } from 'vitest'
import { ModelGroups, Models } from '../src/config/models.mjs'
import { getApiModesFromConfig, getModelNameGroup } from '../src/utils/model-name-convert.mjs'

describe('config model module boundaries', () => {
  it('initializes models and converters without a barrel-import cycle', () => {
    expect(ModelGroups.chatgptWebModelKeys.value).toContain('chatgptWeb56Thinking')
    expect(Models.chatgptWeb56Thinking).toMatchObject({ value: 'gpt-5-6-thinking' })
    expect(getModelNameGroup('chatgptWeb56Thinking')).toContain('chatgptWebModelKeys')
    expect(
      getApiModesFromConfig(
        {
          customApiModes: [],
          activeApiModes: ['chatgptWeb56Thinking'],
        },
        false,
      ),
    ).toMatchObject([
      { groupName: 'chatgptWebModelKeys', itemName: 'chatgptWeb56Thinking', isCustom: false },
    ])
  })

  it('no longer exposes the removed web-scraper provider groups', () => {
    expect(ModelGroups.bingWebModelKeys).toBeUndefined()
    expect(ModelGroups.bardWebModelKeys).toBeUndefined()
    expect(ModelGroups.claudeWebModelKeys).toBeUndefined()
    expect(Object.keys(Models).some((key) => key.startsWith('poeAiWeb'))).toBe(false)
  })
})
