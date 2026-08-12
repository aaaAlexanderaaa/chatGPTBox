import { describe, expect, it } from 'vitest'
import { ModelGroups, Models } from '../src/config/models.mjs'
import { getApiModesFromConfig, getModelNameGroup } from '../src/utils/model-name-convert.mjs'

describe('config model module boundaries', () => {
  it('initializes models and converters without a barrel-import cycle', () => {
    expect(ModelGroups.bingWebModelKeys.value).toContain('bingFree4')
    expect(Models['bingFree4-fast']).toMatchObject({ value: 'fast' })
    expect(getModelNameGroup('bingFree4-fast')?.[0]).toBe('bingWebModelKeys')
    expect(
      getApiModesFromConfig(
        {
          customApiModes: [],
          activeApiModes: ['bingFree4-fast'],
        },
        false,
      ),
    ).toMatchObject([{ groupName: 'bingWebModelKeys', itemName: 'bingFree4', isCustom: true }])
  })
})
