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
      modelName: 'chatgptWeb56Thinking',
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
      disableWebModeHistory: true,
      debugChatgptWebRequests: false,
    })
  })

  it('migrates a legacy chatgptWeb model key to the current default', async () => {
    store.set('modelName', 'chatgptFree35')
    const config = await getUserConfig()
    // chatgptFree35 is in LegacyChatgptWebModelKeyMap -> current default key.
    expect(config.modelName).toBe('chatgptWeb56Thinking')
    // migration should have been persisted.
    expect(store.get('modelName')).toBe('chatgptWeb56Thinking')
  })

  it('migrates a chatgptWebModelKeys-<legacy-slug> name to the default', async () => {
    store.set('modelName', 'chatgptWebModelKeys-gpt-4o')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptWeb56Thinking')
  })

  it('leaves a non-legacy model key untouched', async () => {
    store.set('modelName', 'chatgptApi5_4')
    const config = await getUserConfig()
    expect(config.modelName).toBe('chatgptApi5_4')
  })

  it('clamps a NaN numeric field back to its default', async () => {
    store.set('maxResponseTokenLength', NaN)
    store.set('temperature', 'not-a-number')
    const config = await getUserConfig()
    expect(config.maxResponseTokenLength).toBe(2000) // DEFAULT_MAX_RESPONSE_TOKEN_LENGTH
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
    expect(config.modelName).toBe('chatgptWeb56Thinking')
    expect(store.get('modelName')).toBe('chatgptWeb56Thinking')
  })

  it('resets a removed-provider apiMode item to the default', async () => {
    store.set('apiMode', { groupName: 'bingWebModelKeys', itemName: 'bingFree4' })
    const config = await getUserConfig()
    expect(config.apiMode.itemName).toBe('chatgptWeb56Thinking')
  })

  it('normalizes the chatgptWebThinkingEffort away from unknown values', async () => {
    store.set('chatgptWebThinkingEffort', 'bogus')
    const config = await getUserConfig()
    // Unknown value falls back to the default ('max').
    expect(config.chatgptWebThinkingEffort).toBe('max')
  })

  it('migrates the previous extended effort default to max', async () => {
    store.set('chatgptWebThinkingEffort', 'extended')
    const config = await getUserConfig()
    expect(config.chatgptWebThinkingEffort).toBe('max')
    expect(store.get('chatgptWebThinkingEffort')).toBe('max')
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
