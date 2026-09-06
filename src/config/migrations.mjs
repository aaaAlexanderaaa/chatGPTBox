import Browser from 'webextension-polyfill'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from './limits.mjs'

// Migration primitives and legacy-shape tables consumed by getUserConfig in
// storage.mjs. Kept separate so the migration rules are reviewable on their
// own.

// Model keys whose providers were removed (dead web-scraper endpoints: Poe,
// Bing/Sydney, Bard, Claude web — plus the legacy waylaidwanderer bridge).
// Stored selections are reset to the default model at load so a user
// upgrading never stays pinned to an unroutable model.
const RemovedProviderModelKeySet = new Set([
  'poeAiWebSage',
  'poeAiWebGPT4',
  'poeAiWebGPT4_32k',
  'poeAiWebClaudePlus',
  'poeAiWebClaude',
  'poeAiWebClaude100k',
  'poeAiWebCustom',
  'poeAiWebChatGpt',
  'poeAiWebChatGpt_16k',
  'poeAiWebGooglePaLM',
  'poeAiWeb_Llama_2_7b',
  'poeAiWeb_Llama_2_13b',
  'poeAiWeb_Llama_2_70b',
  'bingFree4',
  'bingFreeSydney',
  'bardWebFree',
  'claude2WebFree',
  'waylaidwandererApi',
])

export function isRemovedProviderModelName(modelName) {
  if (typeof modelName !== 'string') return false
  // Multi-mode variants carry a `-mode` suffix (e.g. `bingFree4-balanced`).
  const base = modelName.includes('-') ? modelName.split('-')[0] : modelName
  return RemovedProviderModelKeySet.has(base)
}

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
  // Guessed Chat GPT-6 keys from an earlier catalog mix-up; default stays 5.6 Thinking.
  chatgptWeb6Astra: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptWeb6Thinking: CHATGPT_WEB_DEFAULT_MODEL_KEY,
  chatgptWeb6: CHATGPT_WEB_DEFAULT_MODEL_KEY,
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

// Single entry point for model-selection migration: legacy ChatGPT Web presets
// plus removed-provider keys.
export function normalizeStoredModelSelection(modelName) {
  if (isRemovedProviderModelName(modelName)) return CHATGPT_WEB_DEFAULT_MODEL_KEY
  return normalizeLegacyChatgptWebModelName(modelName)
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
