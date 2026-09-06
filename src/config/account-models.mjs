// Account-available ChatGPT Web models (roadmap D / D-15).
//
// The settings side must never offer a tier the logged-in account cannot
// use (the遗留项 D-15 closes). The runtime client already resolves the
// real slug with fallbacks; these helpers bring the same knowledge to the
// pickers: they map our model keys to account slugs and filter. `null`
// always means "catalog unknown" — filtering is off, nothing is hidden.

import { chatgptWebChatModelKeys, chatgptWebModelKeys, Models } from './models.mjs'

/** @returns {string|undefined} the account slug a model key stands for */
export function slugForChatgptWebModelKey(modelKey) {
  return Models[modelKey]?.value
}

/**
 * Which chatgptWeb model keys the account can actually use.
 *
 * @param {string[]|null|undefined} availableSlugs - slugs from /models
 * @returns {string[]|null} usable keys, or null when the catalog is unknown
 */
export function filterChatgptWebKeysByAccount(availableSlugs) {
  if (!Array.isArray(availableSlugs) || availableSlugs.length === 0) return null
  const slugSet = new Set(availableSlugs)
  const keys = chatgptWebModelKeys.filter((key) => slugSet.has(Models[key]?.value))
  return keys.length > 0 ? keys : null
}

/**
 * Is a specific model key usable with this catalog? Unknown catalogs and
 * the currently selected key are always "usable" (never hide what is in
 * use, never filter blind).
 *
 * @param {string} modelKey
 * @param {string[]|null|undefined} availableSlugs
 * @returns {boolean}
 */
export function isChatgptWebKeyAvailableForAccount(modelKey, availableSlugs) {
  const availableKeys = filterChatgptWebKeysByAccount(availableSlugs)
  if (!availableKeys) return true
  return availableKeys.includes(modelKey)
}

/**
 * The default model key for a fresh install: the newest Chat / Latest tier
 * the account can use (never a Work `*-wm` slug when Chat is available),
 * keeping the current key when it is already usable. Pure best-effort — the
 * runtime client still resolves the final slug with its own fallbacks.
 *
 * @param {{ currentKey?: string, availableSlugs?: string[]|null }} options
 * @returns {string|null} the key to select, or null when nothing is known
 */
export function pickDefaultChatgptWebKey({ currentKey, availableSlugs }) {
  const availableKeys = filterChatgptWebKeysByAccount(availableSlugs)
  if (!availableKeys) return currentKey || null
  if (currentKey && availableKeys.includes(currentKey)) return currentKey
  const chatKeys = availableKeys.filter((key) => chatgptWebChatModelKeys.includes(key))
  return chatKeys[0] || availableKeys[0]
}
