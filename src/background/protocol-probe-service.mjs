// Compare official page JS against the checked-in conversation-protocol
// reference. Never opens a tab. Never POSTs. Fetches script bodies only when
// filenames drifted, we have never scanned, or a daily verify is due.

import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { RuntimeMessage } from '../protocol/messages.mjs'
import {
  PROTOCOL_PROBE_ALARM,
  PROTOCOL_PROBE_ALARM_MINUTES,
  PROTOCOL_PROBE_FETCH_CONCURRENCY,
  PROTOCOL_PROBE_MAX_FETCH,
  PROTOCOL_PROBE_PERIODIC_SCAN_MS,
  PROTOCOL_PROBE_STORAGE_KEY,
  PROTOCOL_PROBE_STORE_VERSION,
  PROTOCOL_PROBE_TAB_SETTLE_MS,
  allRolesIdentified,
  classifyFetchedScripts,
  evaluateProtocolProbe,
  formatProtocolProbeFilenameUpdates,
  getProtocolProbeSpecs,
  selectFetchCandidates,
  shouldDeepScan,
  shouldNotifyProtocolProbe,
  specMatchesHost,
  specMatchesUrl,
  summarizeScripts,
} from '../services/protocol-probe/index.mjs'
import { collectPageScriptSnapshotInPage } from '../services/protocol-probe/collect.mjs'

function emptyStore() {
  return { version: PROTOCOL_PROBE_STORE_VERSION, reports: {} }
}

export async function readProtocolProbeStore(storageApi) {
  if (!storageApi?.get) return emptyStore()
  try {
    const data = await storageApi.get({ [PROTOCOL_PROBE_STORAGE_KEY]: emptyStore() })
    const store = data?.[PROTOCOL_PROBE_STORAGE_KEY]
    if (!store || typeof store !== 'object') return emptyStore()
    const reports = store.reports && typeof store.reports === 'object' ? store.reports : {}
    return { version: PROTOCOL_PROBE_STORE_VERSION, reports }
  } catch {
    return emptyStore()
  }
}

export async function writeProtocolProbeReport(storageApi, report) {
  const store = await readProtocolProbeStore(storageApi)
  if (!report?.specId) return store
  store.reports[report.specId] = report
  await storageApi.set({ [PROTOCOL_PROBE_STORAGE_KEY]: store })
  return store
}

async function fetchScriptText(url, fetchImpl) {
  try {
    if (new URL(url).protocol !== 'https:') return null
  } catch {
    return null
  }
  const response = await fetchImpl(url, { method: 'GET', credentials: 'omit' })
  if (!response?.ok) return null
  const text = await response.text()
  return typeof text === 'string' ? text : null
}

async function fetchCandidates(candidates, fetchImpl, concurrency) {
  const fetched = []
  let index = 0
  const limit = Math.max(1, Math.min(concurrency, candidates.length || 1))

  async function worker() {
    while (index < candidates.length) {
      const current = candidates[index++]
      try {
        const text = await fetchScriptText(current.url, fetchImpl)
        if (text) fetched.push({ url: current.url, filename: current.filename, text })
      } catch {
        // One failed chunk must not abort the rest of the scan.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, candidates.length) }, () => worker()))
  return fetched
}

async function fetchUntilRolesIdentified(candidates, spec, fetchImpl, concurrency) {
  const fetched = []
  const batchSize = Math.max(1, Math.min(concurrency, candidates.length || 1))
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    if (fetched.length > 0 && allRolesIdentified(spec, classifyFetchedScripts(spec, fetched))) {
      break
    }
    const batch = candidates.slice(offset, offset + batchSize)
    fetched.push(...(await fetchCandidates(batch, fetchImpl, batchSize)))
  }
  return fetched
}

/** @type {ReturnType<typeof createProtocolProbeRuntime> | null} */
let runtime = null

function specFromSnapshot(specs, data) {
  if (data?.specId) {
    const byId = specs.find((spec) => spec.id === data.specId)
    if (byId) return byId
  }
  return (
    specs.find((spec) => specMatchesHost(spec, data?.hostname)) ||
    specs.find((spec) => specMatchesUrl(spec, data?.pageUrl)) ||
    null
  )
}

function specForTabUrl(specs, url) {
  return specs.find((spec) => specMatchesUrl(spec, url)) || null
}

function createProtocolProbeRuntime(injected = {}) {
  const deps = {
    tabsApi: injected.tabsApi || Browser.tabs,
    alarmsApi: injected.alarmsApi || Browser.alarms,
    scriptingApi: injected.scriptingApi || Browser.scripting,
    fetchImpl:
      injected.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined),
    storageApi: injected.storageApi || Browser.storage?.local,
    notificationsApi: injected.notificationsApi || Browser.notifications,
    now: injected.now || (() => Date.now()),
    delay: injected.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    specs: injected.specs || getProtocolProbeSpecs(),
    maxFetch: injected.maxFetch || PROTOCOL_PROBE_MAX_FETCH,
    fetchConcurrency: injected.fetchConcurrency || PROTOCOL_PROBE_FETCH_CONCURRENCY,
    periodicMs: injected.periodicMs ?? PROTOCOL_PROBE_PERIODIC_SCAN_MS,
    tabSettleMs: injected.tabSettleMs ?? PROTOCOL_PROBE_TAB_SETTLE_MS,
  }

  const inFlight = new Set()

  async function persistAndNotify(report, previous) {
    await writeProtocolProbeReport(deps.storageApi, report)
    if (!shouldNotifyProtocolProbe(previous, report) || !deps.notificationsApi?.create) {
      return report
    }
    const statusLabel =
      report.status === 'marker_drift'
        ? t('Required protocol markers are missing')
        : t('Script filenames changed')
    const filenameUpdates = formatProtocolProbeFilenameUpdates(report)
    try {
      await deps.notificationsApi.create(`protocol-probe:${report.specId}`, {
        type: 'basic',
        iconUrl: Browser.runtime.getURL('logo.png'),
        title: t('Web protocol fingerprint changed'),
        message: filenameUpdates
          ? `${report.label}: ${filenameUpdates}`
          : `${report.label}: ${statusLabel}`,
        priority: 1,
      })
    } catch {
      // Settings still shows the report if notifications are blocked.
    }
    return report
  }

  async function evaluateSnapshot(data) {
    const spec = specFromSnapshot(deps.specs, data)
    if (!spec) return { ran: false, reason: 'no_spec' }
    if (data?.pageUrl && !specMatchesUrl(spec, data.pageUrl)) {
      return { ran: false, reason: 'mismatch' }
    }

    const store = await readProtocolProbeStore(deps.storageApi)
    const previous = store.reports[spec.id] || null
    const scriptUrls = Array.isArray(data?.scripts) ? data.scripts : []
    const scripts = summarizeScripts(scriptUrls, spec)
    const now = deps.now()
    const scan = shouldDeepScan({
      spec,
      scripts,
      previous,
      now,
      periodicMs: deps.periodicMs,
      trigger: data?.trigger,
    })

    let fetched = []
    let scanned = false
    let error = null
    if (scan && typeof deps.fetchImpl === 'function') {
      const candidates = selectFetchCandidates({
        spec,
        scripts,
        maxFetch: deps.maxFetch,
      })
      try {
        fetched = await fetchUntilRolesIdentified(
          candidates,
          spec,
          deps.fetchImpl,
          deps.fetchConcurrency,
        )
        scanned = fetched.length > 0
        if (!scanned) error = new Error('Failed to fetch script bodies')
      } catch (fetchError) {
        error = fetchError
      }
    }

    const evaluated = evaluateProtocolProbe({
      spec,
      scriptUrls,
      fetched,
      scanned,
      previous,
      trigger: data?.trigger || 'unknown',
      pageUrl: data?.pageUrl || '',
      hostname: data?.hostname || '',
      error,
    })
    const report = {
      ...evaluated,
      checkedAt: new Date(now).toISOString(),
      deepScannedAt:
        scanned && ['ok', 'url_drift', 'marker_drift'].includes(evaluated.status)
          ? new Date(now).toISOString()
          : previous?.deepScannedAt || null,
    }

    return { ran: true, report: await persistAndNotify(report, previous) }
  }

  async function handleSnapshot(data) {
    const spec = specFromSnapshot(deps.specs, data)
    if (!spec) return { ran: false, reason: 'no_spec' }
    if (inFlight.has(spec.id)) return { ran: false, reason: 'busy' }
    inFlight.add(spec.id)
    try {
      return await evaluateSnapshot(data)
    } finally {
      inFlight.delete(spec.id)
    }
  }

  async function collectFromTab(tabId) {
    if (!tabId) return null
    try {
      if (deps.scriptingApi?.executeScript) {
        const results = await deps.scriptingApi.executeScript({
          target: { tabId },
          func: collectPageScriptSnapshotInPage,
        })
        return results?.[0]?.result || null
      }
      if (deps.tabsApi?.executeScript) {
        const results = await deps.tabsApi.executeScript(tabId, {
          code: `(${collectPageScriptSnapshotInPage.toString()})()`,
        })
        return results?.[0] || null
      }
    } catch {
      return null
    }
    return null
  }

  async function requestCollectOnTab(tab, trigger) {
    if (!tab?.id) return { ran: false, reason: 'no_tab' }
    const spec = specForTabUrl(deps.specs, tab.url)
    if (!spec) return { ran: false, reason: 'no_spec' }
    try {
      const response = await deps.tabsApi.sendMessage?.(tab.id, {
        type: RuntimeMessage.ProtocolProbeCollect,
        data: { specId: spec.id, trigger },
      })
      if (response?.ok && response.data) {
        return handleSnapshot({ ...response.data, trigger })
      }
    } catch {
      // Content script may be missing after an extension reload.
    }
    const snapshot = await collectFromTab(tab.id)
    if (!snapshot) return { ran: false, reason: 'collect_failed' }
    return handleSnapshot({
      specId: spec.id,
      trigger,
      pageUrl: snapshot.pageUrl,
      hostname: snapshot.hostname,
      scripts: snapshot.scripts,
    })
  }

  async function runOnOpenTabs({ trigger = 'manual' } = {}) {
    if (!deps.tabsApi?.query) return { ran: false, reason: 'no_tabs_api', count: 0 }
    let tabs = []
    try {
      tabs = (await deps.tabsApi.query({})) || []
    } catch {
      return { ran: false, reason: 'query_failed', count: 0 }
    }
    const matched = tabs.filter((tab) => tab?.id && specForTabUrl(deps.specs, tab.url))
    if (matched.length === 0) return { ran: false, reason: 'no_tab', count: 0 }
    const results = await Promise.all(matched.map((tab) => requestCollectOnTab(tab, trigger)))
    const ran = results.filter((result) => result?.ran === true)
    if (ran.length > 0) return { ran: true, reason: '', count: ran.length }
    if (results.some((result) => result?.reason === 'busy')) {
      return { ran: false, reason: 'busy', count: 0 }
    }
    return { ran: false, reason: 'collect_failed', count: 0 }
  }

  function scheduleTabCollect(tab, trigger) {
    if (!tab?.id || !specForTabUrl(deps.specs, tab.url)) return Promise.resolve()
    return deps.delay(deps.tabSettleMs).then(() => requestCollectOnTab(tab, trigger))
  }

  async function ensureAlarm() {
    if (!deps.alarmsApi?.create) return
    const existing = (await deps.alarmsApi.get?.(PROTOCOL_PROBE_ALARM).catch(() => null)) || null
    if (existing) return
    await deps.alarmsApi.create(PROTOCOL_PROBE_ALARM, {
      periodInMinutes: PROTOCOL_PROBE_ALARM_MINUTES,
    })
  }

  return {
    deps,
    handleSnapshot,
    runOnOpenTabs,
    requestCollectOnTab,
    scheduleTabCollect,
    ensureAlarm,
  }
}

function getRuntime() {
  if (!runtime) runtime = createProtocolProbeRuntime()
  return runtime
}

export async function handleProtocolProbeSnapshot(data) {
  return getRuntime().handleSnapshot(data)
}

export async function runProtocolProbeOnOpenTabs(options) {
  return getRuntime().runOnOpenTabs(options)
}

export function registerProtocolProbe(injected = {}) {
  runtime = createProtocolProbeRuntime(injected)
  const { tabsApi, alarmsApi } = runtime.deps

  tabsApi?.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
    if (changeInfo?.status !== 'complete') return
    return runtime.scheduleTabCollect({ id: tabId, url: tab?.url }, 'tab_complete')
  })

  alarmsApi?.onAlarm?.addListener?.((alarm) => {
    if (alarm?.name !== PROTOCOL_PROBE_ALARM) return
    void runtime.runOnOpenTabs({ trigger: 'alarm' })
  })

  void runtime.ensureAlarm()
  if (injected.autoStart !== false) {
    void runtime.runOnOpenTabs({ trigger: 'startup' })
  }
  return runtime
}
