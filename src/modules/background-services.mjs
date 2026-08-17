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
import { applyActionBadge, setDshWaitingCount } from '../background/action-badge.mjs'
import {
  diagnoseDsh,
  endpointForLiveGateway,
  helloForGatewayHold,
  resolveGatewayHoldReason,
  shouldRecreateDshGateway,
  syncDshHeaderRules,
} from './dsh/background/fence.mjs'
import { createDshGateway } from './dsh/background/gateway.mjs'
import {
  getDownlinkBridge,
  stopDownlinkBridge,
  syncDownlinkContentScript,
} from './dsh/background/downlink-bridge.mjs'
import { cockpitUrlForSession } from './dsh/session-pick.mjs'

const DSH_PORT_NAME = 'dsh-gateway'
const DSH_NOTIFICATION_ID = 'dsh-waiting'
let lastWaitingSessionId = null
const heldGatewayPorts = new Set()
let portHoldReason = 'starting'

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
  applyActionBadge(action, setDshWaitingCount(count))
}

function notifyDshWaiting(payload) {
  lastWaitingSessionId = payload?.sessionId || null
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
    // The event downlinks ride the carrier-tab bridge: extension-origin
    // WebSocket handshakes cannot pass the harness trust fence (D-22).
    downlink: getDownlinkBridge(endpoint),
    host: {
      notifyWaiting: notifyDshWaiting,
      clearWaiting: clearDshWaiting,
      setBadge: setDshBadge,
    },
  })
}

function holdGatewayPort(port) {
  heldGatewayPorts.add(port)
  try {
    port.postMessage(helloForGatewayHold(portHoldReason))
    port.postMessage({ type: 'sessions', items: [] })
  } catch {
    heldGatewayPorts.delete(port)
    return
  }
  port.onDisconnect.addListener(() => heldGatewayPorts.delete(port))
}

function drainHeldGatewayPorts() {
  if (!dshGateway) return
  for (const port of [...heldGatewayPorts]) {
    heldGatewayPorts.delete(port)
    dshGateway.attachPort(port)
  }
}

async function applyDshModuleState(config, previousEndpoint) {
  // Off, or a non-loopback URL: no gateway, no rewrite. A remote origin
  // must never replace a live loopback connection (D-13).
  const endpoint = endpointForLiveGateway(config.dshModuleEnabled, config.dshEndpoint)
  if (!endpoint) {
    portHoldReason = resolveGatewayHoldReason({
      enabled: config.dshModuleEnabled,
      endpoint: config.dshEndpoint,
    })
    dshGateway?.stop({ reason: portHoldReason })
    dshGateway = null
    stopDownlinkBridge()
    setDshBadge(0)
    clearDshWaiting()
    await syncDshHeaderRules('')
    await syncDownlinkContentScript('')
    return
  }
  const endpointChanged = shouldRecreateDshGateway(previousEndpoint, endpoint, Boolean(dshGateway))
  if (endpointChanged) {
    dshGateway?.stop()
    dshGateway = createDshGatewayFor(endpoint)
  }
  await syncDshHeaderRules(endpoint)
  await syncDownlinkContentScript(endpoint)
  await dshGateway.start()
  drainHeldGatewayPorts()
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
  // The console (and later popup/sidepanel surfaces) talk to the gateway
  // over a single runtime port; registered before the first (network-bound)
  // apply so a port opened during MV3 worker cold-start is not dropped.
  Browser.runtime.onConnect.addListener((port) => {
    if (port.name !== DSH_PORT_NAME) return
    if (!dshGateway) {
      holdGatewayPort(port)
      return
    }
    dshGateway.attachPort(port)
  })

  // Settings-card diagnose: exercises the real path (RPC over the header
  // rewrite + the mux downlink through the carrier-tab bridge) and reports
  // which stage failed.
  Browser.runtime.onMessage.addListener((message) => {
    if (message?.type === RuntimeMessage.DshModuleDiagnose) {
      return readConfig().then((config) => {
        const bridge = getDownlinkBridge(config.dshEndpoint)
        return diagnoseDsh(config.dshEndpoint, {
          probeDownlink: () =>
            bridge
              ? bridge.probe(5_000)
              : Promise.resolve({ ok: false, detail: 'endpoint is not a loopback origin' }),
        })
      })
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
  let config = await readConfig()
  await applyDshModuleState(config)

  Browser.notifications?.onClicked?.addListener((notificationId) => {
    if (notificationId !== DSH_NOTIFICATION_ID) return
    clearDshWaiting()
    const url = cockpitUrlForSession(Browser.runtime.getURL('dsh.html'), lastWaitingSessionId)
    void Browser.tabs.create({ url }).catch(() => {})
  })

  const storageChanges = Browser.storage?.onChanged || Browser.storage?.local?.onChanged
  storageChanges?.addListener((changes) => {
    if (!changes) return
    const relevant = 'dshModuleEnabled' in changes || 'dshEndpoint' in changes
    if (!relevant) return
    void readConfig().then((next) => {
      const previousEndpoint = config?.dshEndpoint
      config = next
      return applyDshModuleState(next, previousEndpoint)
    })
  })
}
