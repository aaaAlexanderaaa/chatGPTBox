import Browser from 'webextension-polyfill'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from './limits.mjs'

// Migration primitives and legacy-shape tables consumed by getUserConfig in
// storage.mjs. Kept separate so the migration rules are reviewable on their
// own.

const AgentDefaultsMigrationVersion = {
  clearLegacyDesignDefaults: 1,
}

// Exposed for storage.mjs to gate one-shot legacy-defaults cleanup.
export { AgentDefaultsMigrationVersion }

const LegacyChatgptWebModelKeyMap = {
  chatgptFree35: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree4o: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree4oMini: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4Browsing: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptFree35Mobile: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptPlus4Mobile: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  // Migrate the legacy 5.1 Thinking default to the current ChatGPT Web default.
  chatgptWeb51Thinking: CHATGPT_WEB_DEFAULT_MODEL_KEY,
}

const LegacyChatgptWebModelSlugSet = new Set([
  'auto',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'text-davinci-002-render-sha-mobile',
  'gpt-4-mobile',
])

export function normalizeLegacyChatgptWebModelName(modelName) {
  if (typeof modelName !== 'string' || !modelName) return modelName
  if (Object.prototype.hasOwnProperty.call(LegacyChatgptWebModelKeyMap, modelName)) {
    return LegacyChatgptWebModelKeyMap[modelName]
  }
  if (!modelName.startsWith('chatgptWebModelKeys-')) return modelName
  const slug = modelName.replace('chatgptWebModelKeys-', '').trim()
  if (LegacyChatgptWebModelSlugSet.has(slug)) return CHATGPT_WEB_DEFAULT_MODEL_KEY
  return modelName
}

/**
 * Walk an array field on the config, replace items via `mapFn`, and persist if anything changed.
 * Returning the same reference from `mapFn` is treated as "no change". Non-array fields are skipped.
 * @returns {Promise<boolean>} whether anything changed and was written back.
 */
export async function migrateArrayField(config, key, mapFn) {
  const current = config[key]
  if (!Array.isArray(current)) return false
  let dirty = false
  const next = current.map((item) => {
    const result = mapFn(item)
    if (result !== item) dirty = true
    return result
  })
  if (!dirty) return false
  config[key] = next
  await Browser.storage.local.set({ [key]: next })
  return true
}
