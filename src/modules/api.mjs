/**
 * The module seam (产品决策 D-10/D-20).
 *
 * ChatGPTBox is being assembled from a platform + optional engine modules.
 * This file is the ONLY surface a module may import from the extension core;
 * conversely, the core reaches into modules only through the aggregation
 * files that re-export from here (`index.mjs`, `background-services.mjs`,
 * `settings-cards.mjs`). The boundary is enforced twice:
 *
 *   - statically, by the eslint `no-restricted-imports` overrides in
 *     .eslintrc.json (modules may only parent-import `../api.mjs`);
 *   - by `tests/module-boundary.test.mjs`, which walks src/modules with the
 *     same rule so CI fails even when eslint is not run.
 *
 * Deliberately near-dependency-free (pure data + registry + the module-facing
 * slice of the runtime message contract) so it can be imported from the
 * background bundle, every UI bundle, and unit tests without pulling in
 * services code.
 *
 * Seam API policy (roadmap Phase A): extract only what the dsh module
 * actually uses. A second module with different needs grows the seam then,
 * not now.
 */

import { RuntimeMessage } from '../protocol/messages.mjs'

/** Message types a module may send over Browser.runtime — never bare literals
 *  (tests/message-contract.test.mjs enforces the single source of truth). */
export const ModuleMessage = {
  DshDiagnose: RuntimeMessage.DshModuleDiagnose,
  ChatgptWebSyncConversations: RuntimeMessage.ChatgptWebSyncConversations,
  ChatgptWebStopConversationSync: RuntimeMessage.ChatgptWebStopConversationSync,
  ChatgptWebUnlockConversationSync: RuntimeMessage.ChatgptWebUnlockConversationSync,
}

/**
 * @typedef {object} ModuleManifest
 * @property {string} id - unique, stable module id (e.g. 'dsh')
 * @property {string} [label] - display name (settings card title)
 * @property {Record<string, unknown>} [configDefaults]
 *   Config keys the module contributes. Merged into the core defaultConfig
 *   by src/config/storage.mjs, so a missing stored value behaves exactly
 *   like a fresh install. Keys should be namespaced by the module id
 *   (dshEndpoint, dshModuleEnabled, ...).
 * @property {boolean} [hasBackground] - the module ships a background
 *   service. The starter lives in src/modules/background-services.mjs
 *   (statically imported there so the MV3 service worker bundle stays
 *   chunk-free); the manifest itself stays data-only so UI bundles that
 *   only need settings cards never pull service code.
 * @property {string} [settingsPlacement='engines'] - render site of the
 *   module's settings card. Grown for the second module (chatgptweb, C1):
 *   its card initially stays inside the Advanced tab it always lived in;
 *   the Engines tab (C2) later becomes the single home for every engine.
 * @property {string} [consolePage] - extension page URL of the module's
 *   full-page surface (e.g. 'dsh.html'), for the settings card link.
 */

/** @type {ModuleManifest[]} */
const registeredModules = []
/** @type {Map<string, unknown>} settings card components by module id */
const settingsCards = new Map()

/**
 * Register a module manifest. Called once per module from
 * src/modules/index.mjs; duplicate ids are a programming error.
 * @param {ModuleManifest} manifest
 */
export function registerModule(manifest) {
  if (!manifest || typeof manifest.id !== 'string' || !manifest.id) {
    throw new Error('modules: registerModule requires an id')
  }
  if (registeredModules.some((m) => m.id === manifest.id)) {
    throw new Error(`modules: duplicate module id "${manifest.id}"`)
  }
  registeredModules.push(manifest)
}

/**
 * Register a settings card component for a module. Called from
 * src/modules/settings-cards.mjs (the UI-side aggregation point) so the
 * component code only lands in bundles that opt in.
 * @param {string} id
 * @param {unknown} Component
 */
export function registerSettingsCard(id, Component) {
  settingsCards.set(id, Component)
}

/**
 * Registered settings cards, optionally filtered by render site.
 * @param {string} [placement] - manifest settingsPlacement to filter by
 *   (default 'engines'). Omit to get every card.
 * @returns {Array<{ id: string, Component: unknown }>}
 */
export function getSettingsCards(placement) {
  return [...settingsCards.entries()]
    .filter(([id]) => {
      if (!placement) return true
      const manifest = registeredModules.find((m) => m.id === id)
      return (manifest?.settingsPlacement || 'engines') === placement
    })
    .map(([id, Component]) => ({ id, Component }))
}

/** @returns {ModuleManifest[]} */
export function getModules() {
  return registeredModules.slice()
}

/** @returns {Record<string, unknown>} merged config defaults of all modules */
export function getModuleConfigDefaults() {
  const defaults = {}
  for (const module of registeredModules) {
    Object.assign(defaults, module.configDefaults || {})
  }
  return defaults
}

/** @param {string} id */
export function getModule(id) {
  return registeredModules.find((m) => m.id === id) || null
}
