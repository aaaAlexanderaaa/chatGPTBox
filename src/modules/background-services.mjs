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
import { RuntimeMessage } from '../protocol/messages.mjs'
import { diagnoseDsh, syncDshHeaderRules } from './dsh/background/fence.mjs'
import { createDshGateway } from './dsh/background/gateway.mjs'

const DSH_PORT_NAME = 'dsh-gateway'
const DSH_NOTIFICATION_ID = 'dsh-waiting'

/** Read the config once, tolerating storage failures at early startup. */
async function readConfig() {
  return (await getUserConfig().catch(() => defaultConfig)) || defaultConfig
}

// --- dsh: OS notifications + action badge (roadmap A4) ---------------------
//
// Contract (生命级): an approval/question that arrives with no UI attached
// MUST reach the user — badge count always, OS notification when nobody is
// looking. Turn completion never notifies (D-6: only "需要你" events speak).

function setDshBadge(count) {
  const action = Browser.action || Browser.browserAction
  if (!action?.setBadgeText) return
  const text = count > 0 ? String(count) : ''
  void action.setBadgeText({ text }).catch(() => {})
  if (count > 0) {
    void action
      .setBadgeBackgroundColor({ color: '#d97706' }) // --dsh-waiting amber
      .catch(() => {})
  }
}

function notifyDshWaiting(payload) {
  if (!Browser.notifications?.create) return
  void Browser.notifications
    .create(DSH_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: Browser.runtime.getURL('logo.png'),
      title: `${payload.title} — waiting for you`,
      message: payload.message,
      priority: 2,
    })
    .catch(() => {})
}

function clearDshWaiting() {
  if (!Browser.notifications?.clear) return
  void Browser.notifications.clear(DSH_NOTIFICATION_ID).catch(() => {})
}

// --- dsh: gateway lifecycle ---------------------------------------------------

/** @type {ReturnType<typeof createDshGateway> | null} */
let dshGateway = null

function createDshGatewayFor(endpoint) {
  return createDshGateway({
    endpoint,
    storage: Browser.storage,
    host: {
      notifyWaiting: notifyDshWaiting,
      clearWaiting: clearDshWaiting,
      setBadge: setDshBadge,
    },
  })
}

async function applyDshModuleState(config, previousEndpoint) {
  if (config.dshModuleEnabled !== true) {
    // Disabled: stop the gateway and remove the fence rewrite so a disabled
    // module leaves zero visible trace (roadmap Phase A acceptance #5).
    dshGateway?.stop()
    dshGateway = null
    setDshBadge(0)
    clearDshWaiting()
    await syncDshHeaderRules('')
    return
  }
  const endpointChanged = previousEndpoint !== undefined && previousEndpoint !== config.dshEndpoint
  if (endpointChanged || !dshGateway) {
    dshGateway?.stop()
    dshGateway = createDshGatewayFor(config.dshEndpoint)
  }
  await syncDshHeaderRules(config.dshEndpoint)
  await dshGateway.start()
}

/**
 * The live dsh gateway, for core consumers that reach modules only through
 * the aggregation files: the dsh bridge provider (background/providers/
 * dsh-bridge.mjs) drives sessions through this handle. Null while the
 * module is disabled or not yet started.
 */
export function getDshGateway() {
  return dshGateway
}

/**
 * Start every registered module's background side. Called once from the
 * background entry point after the message router is wired.
 */
export async function startModuleBackgrounds() {
  let config = await readConfig()
  await applyDshModuleState(config)

  // The console (and later popup/sidepanel surfaces) talk to the gateway
  // over a single runtime port; registered at top level so a revived MV3
  // worker re-arms it even before any config read resolves.
  Browser.runtime.onConnect.addListener((port) => {
    if (port.name !== DSH_PORT_NAME) return
    if (!dshGateway) {
      try {
        port.disconnect()
      } catch {
        // already gone
      }
      return
    }
    dshGateway.attachPort(port)
  })

  // Settings-card diagnose: exercises the real path (RPC + WS through the
  // fence rewrite) and reports which stage failed.
  Browser.runtime.onMessage.addListener((message) => {
    if (message?.type === RuntimeMessage.DshModuleDiagnose) {
      return readConfig().then((config) => diagnoseDsh(config.dshEndpoint))
    }
    if (message?.type === RuntimeMessage.DshModuleRespond) {
      // Approval/question answers from surfaces that are not gateway ports
      // (floating window cards, the popup's pinned waiting cards).
      const data = message.data || {}
      if (!dshGateway || !data.rpcId) return Promise.resolve({ accepted: false })
      const method =
        data.kind === 'question'
          ? 'question.respond'
          : data.kind === 'question-cancel'
            ? 'question.cancel'
            : 'approval.respond'
      return dshGateway
        .rpc(method, data)
        .catch((error) => ({ accepted: false, error: error?.message || String(error) }))
    }
    return undefined
  })

  // Clicking the waiting notification opens the cockpit (≤2 operations to
  // answer: click, decide).
  Browser.notifications?.onClicked?.addListener((notificationId) => {
    if (notificationId !== DSH_NOTIFICATION_ID) return
    clearDshWaiting()
    void Browser.tabs
      .create({ url: Browser.runtime.getURL('dsh.html') })
      .catch(() => {})
  })

  const storageChanges = Browser.storage?.onChanged || Browser.storage?.local?.onChanged
  storageChanges?.addListener((changes) => {
    if (!changes) return
    const relevant =
      'dshModuleEnabled' in changes ||
      'dshEndpoint' in changes ||
      'dshAutoApproveSetting' in changes
    if (!relevant) return
    void readConfig().then((next) => {
      const previousEndpoint = config?.dshEndpoint
      config = next
      return applyDshModuleState(next, previousEndpoint)
    })
  })
}
