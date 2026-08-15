// Module background starters — the ONLY core-side file allowed to statically
// import module service code (together with index.mjs and settings-cards.mjs).
//
// MV3 service workers cannot load webpack chunks, so module background
// services must be statically importable from the background bundle. This
// file is that single import point; everything else goes through api.mjs.
//
// The host contract: module services never import extension core code.
// Whatever they need (config values, storage areas, notifications) is passed
// in as an explicit host object, which keeps them unit-testable and keeps
// the dependency arrows pointing one way (core -> module).

import Browser from 'webextension-polyfill'
import { defaultConfig, getUserConfig } from '../config/storage.mjs'
import { syncDshHeaderRules } from './dsh/background/fence.mjs'

/** Read the config once, tolerating storage failures at early startup. */
async function readConfig() {
  return (await getUserConfig().catch(() => defaultConfig)) || defaultConfig
}

async function applyDshModuleState(config) {
  if (config.dshModuleEnabled !== true) {
    // Disabled: remove the fence rewrite so a disabled module leaves zero
    // visible trace (roadmap Phase A acceptance #5).
    await syncDshHeaderRules('')
    return
  }
  await syncDshHeaderRules(config.dshEndpoint)
}

/**
 * Start every registered module's background side. Called once from the
 * background entry point after the message router is wired.
 */
export async function startModuleBackgrounds() {
  const config = await readConfig()
  await applyDshModuleState(config)

  const storageChanges = Browser.storage?.onChanged || Browser.storage?.local?.onChanged
  storageChanges?.addListener((changes) => {
    if (!changes) return
    if (!('dshModuleEnabled' in changes) && !('dshEndpoint' in changes)) return
    void readConfig().then(applyDshModuleState)
  })
}
