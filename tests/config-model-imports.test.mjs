import { describe, expect, it } from 'vitest'
import { chatgptWebChatModelKeys, ModelGroups, Models } from '../src/config/models.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_SLUG } from '../src/config/limits.mjs'
import { getApiModesFromConfig, getModelNameGroup } from '../src/utils/model-name-convert.mjs'

describe('config model module boundaries', () => {
  it('lists the configured default in the ChatGPT Web model picker', () => {
    expect(chatgptWebChatModelKeys.map((key) => Models[key]?.value)).toContain(
      CHATGPT_WEB_DEFAULT_MODEL_SLUG,
    )
  })

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
