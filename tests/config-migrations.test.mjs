import { beforeEach, describe, expect, it } from 'vitest'
import Browser from 'webextension-polyfill'
import { getUserConfig } from '../src/config/storage.mjs'

// getUserConfig() runs the full migration pipeline: deep-merge with defaults,
// clamp numerics, migrate legacy ChatGPT-web model keys and removed-provider
// model selections, etc. These tests exercise the migration branches that are
// otherwise invisible (they only fire on persisted legacy data).

// In-memory storage backed by the polyfill stub. Each test seeds `store` with
// a legacy shape, then getUserConfig reads/writes through this shim.
const store = new Map()

function resetStore() {
  store.clear()
}

function installStorageShim() {
  Browser.storage.local.get = async (keysOrDefaults) => {
    // getUserConfig passes either an array of keys or a { key: defaultValue } object.
    if (Array.isArray(keysOrDefaults)) {
      const out = {}
      for (const k of keysOrDefaults) if (store.has(k)) out[k] = store.get(k)
      return out
    }
    if (keysOrDefaults && typeof keysOrDefaults === 'object') {
      const out = {}
      for (const [k, def] of Object.entries(keysOrDefaults))
        out[k] = store.has(k) ? store.get(k) : def
      return out
    }
    return { ...Object.fromEntries(store) }
  }
  Browser.storage.local.set = async (obj) => {
    for (const [k, v] of Object.entries(obj)) store.set(k, v)
  }
  Browser.storage.local.remove = async (keys) => {
    for (const k of [].concat(keys)) store.delete(k)
  }
}

beforeEach(() => {
  resetStore()
  installStorageShim()
})

describe('getUserConfig migrations', () => {
  it('uses the current ChatGPT Web and local gateway defaults', async () => {
    const config = await getUserConfig()
    expect(config).toMatchObject({
      modelName: 'chatgptweb/gpt-5-6-thinking',
      maxResponseTokenLength: 384000,
      maxConversationContextLength: 64,
      l1Providers: expect.arrayContaining([expect.objectContaining({ id: 'tokendance' })]),
      chatgptWebEnabled: true,
      grokWebEnabled: false,
      apiServerEnabled: false,
      apiServerPort: 18080,
      apiServerBridgeToken: '',
      apiServerKeepHistory: false,
      apiServerRequestTimeoutSeconds: 180,
      apiServerThinkingTimeoutSeconds: 2700,
      customChatGptWebApiUrl: 'https://chatgpt.com',
      customChatGptWebApiPath: '/backend-api/f/conversation',
      chatgptWebThinkingEffort: 'max',
      chatgptWebConversationPollTimeoutSeconds: 2700,
      chatgptWebConversationPollIntervalSeconds: 10,
      chatgptWebHistorySyncEnabled: false,
      chatgptWebHistoryAutoSyncMode: 'off',
      chatgptWebHistorySyncRpm: 6,
      chatgptWebHistorySyncIntervalHours: 12,
      chatgptWebHistorySyncArchived: false,
      chatgptWebHistorySyncOnlyWhenIdle: true,
      chatgptWebHistoryHydrateLimit: 0,
      chatgptWebHistoryHydrateOffset: 0,
      chatgptWebHistoryHydrateRetryCount: 1,
      chatgptWebHistoryHydrateOrder: 'updated',
      chatgptWebHistoryHydrateIncludeArchived: false,
      chatgptWebHistoryHydrateRefreshListFirst: false,
      disableWebModeHistory: true,
      debugChatgptWebRequests: false,
    })
  })

  it('migrates a guessed Work GPT-6 key to Chat GPT-6 Pro', async () => {
    store.set('modelName', 'chatgptWeb6Astra')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
    expect(store.get('modelName')).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('migrates a legacy chatgptWeb model key to the current default', async () => {
    store.set('modelName', 'chatgptFree35')
    const config = await getUserConfig()
    // chatgptFree35 is in LegacyChatgptWebModelKeyMap -> current default key.
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
    // migration should have been persisted.
    expect(store.get('modelName')).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('migrates a chatgptWebModelKeys-<legacy-slug> name to the default', async () => {
    store.set('modelName', 'chatgptWebModelKeys-gpt-4o')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('does not import old vendor API provider selections', async () => {
    store.set('modelName', 'chatgptApi5_4')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
    expect(config.l1Providers[0].id).toBe('tokendance')
    expect(config.showLegacyProviderNotice).toBe(true)
  })

  it('drops leftover vendor keys from site engine overrides', async () => {
    store.set('modelName', 'chatgptApi5_4')
    store.set('siteEngineOverrides', {
      github: { modelName: 'claudeApi', apiMode: { groupName: 'claudeApiModelKeys' } },
      gitlab: { modelName: 'chatgptWeb56Thinking' },
    })
    const config = await getUserConfig()
    expect(config.siteEngineOverrides).toEqual({
      gitlab: { modelName: 'chatgptweb/gpt-5-6-thinking', apiMode: null },
    })
    expect(store.get('siteEngineOverrides')).toEqual({
      gitlab: { modelName: 'chatgptweb/gpt-5-6-thinking', apiMode: null },
    })
  })

  it('does not revive disabled ChatGPT Web after an empty selection', async () => {
    store.set('providerSchemaVersion', 2)
    store.set('chatgptWebEnabled', false)
    store.set('modelName', '')
    store.set('l1Providers', [
      {
        id: 'tokendance',
        name: 'TokenDance',
        format: 'openai-compat',
        models: [{ id: 'deepseek-v4.1-flash', enabled: false, source: 'manual' }],
      },
    ])
    const config = await getUserConfig()
    expect(config.modelName).toBe('')
    expect(config.chatgptWebEnabled).toBe(false)
    expect(store.get('modelName')).toBe('')
  })

  it('coerces a legacy vendor modelName imported after schema v2', async () => {
    store.set('providerSchemaVersion', 2)
    store.set('modelName', 'chatgptApi5_4')
    store.set('apiMode', { groupName: 'chatgptApiModelKeys', itemName: 'chatgptApi5_4' })
    store.set('chatgptWebEnabled', true)
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
    expect(config.apiMode).toBeNull()
    expect(store.get('modelName')).toBe('chatgptweb/gpt-5-6-thinking')
    expect(store.get('apiMode')).toBeNull()
  })

  it('clamps a NaN numeric field back to its default', async () => {
    store.set('maxResponseTokenLength', NaN)
    store.set('temperature', 'not-a-number')
    const config = await getUserConfig()
    expect(config.maxResponseTokenLength).toBe(384000) // DEFAULT_MAX_RESPONSE_TOKEN_LENGTH
    expect(config.temperature).toBe(1) // default
  })

  it('clamps an out-of-range numeric field into bounds', async () => {
    store.set('apiServerPort', 999999)
    const config = await getUserConfig()
    expect(config.apiServerPort).toBe(65535) // max port
  })

  it('coerces non-boolean flags to strict booleans', async () => {
    store.set('showDeprecatedModels', 1)
    store.set('apiServerEnabled', 'true')
    store.set('debugChatgptWebRequests', undefined)
    const config = await getUserConfig()
    expect(config.showDeprecatedModels).toBe(false) // only explicit `true` counts
    expect(config.apiServerEnabled).toBe(false)
    expect(config.debugChatgptWebRequests).toBe(false)
  })

  it('rewrites the legacy chat.openai.com web url to chatgpt.com', async () => {
    store.set('customChatGptWebApiUrl', 'https://chat.openai.com')
    const config = await getUserConfig()
    expect(config.customChatGptWebApiUrl).toBe('https://chatgpt.com')
  })

  it('resets a removed-provider model selection to the default', async () => {
    // Poe / Bing / Bard / Claude web providers were removed; a persisted
    // selection must not survive as an unroutable model.
    store.set('modelName', 'bingFreeSydney')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptweb/gpt-5-6-thinking')
    expect(store.get('modelName')).toBe('chatgptweb/gpt-5-6-thinking')
  })

  it('resets a removed-provider apiMode item to the default', async () => {
    store.set('apiMode', { groupName: 'bingWebModelKeys', itemName: 'bingFree4' })
    const config = await getUserConfig()
    expect(config.apiMode).toBeNull()
  })

  it('normalizes the chatgptWebThinkingEffort away from unknown values', async () => {
    store.set('chatgptWebThinkingEffort', 'bogus')
    const config = await getUserConfig()
    // Unknown value falls back to the default ('max').
    expect(config.chatgptWebThinkingEffort).toBe('max')
  })

  it('keeps official ChatGPT Web thinking efforts', async () => {
    store.set('chatgptWebThinkingEffort', 'xhigh')
    const config = await getUserConfig()
    expect(config.chatgptWebThinkingEffort).toBe('xhigh')
    expect(store.get('chatgptWebThinkingEffort')).toBe('xhigh')
  })

  it('runs the one-shot custom-script extractor migration', async () => {
    store.set('customContentExtractors', [
      { method: 'custom', customScript: 'alert(1)', siteRegex: '.*' },
      { method: 'readability', siteRegex: 'foo' },
    ])
    store.set('customScriptMigrationDone', false)
    await getUserConfig()
    // one-shot flag should now be persisted.
    expect(store.get('customScriptMigrationDone')).toBe(true)
    // the custom-script extractor had its method coerced to 'auto' and the
    // customScript field stripped.
    const persistedExtractors = store.get('customContentExtractors')
    expect(persistedExtractors[0].method).toBe('auto')
    expect('customScript' in persistedExtractors[0]).toBe(false)
    // the readability one is untouched.
    expect(persistedExtractors[1].method).toBe('readability')
  })
})
