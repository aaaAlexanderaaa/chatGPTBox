import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import chatgptWebCurrent from '../src/services/protocol-probe/chatgpt-web-current.mjs'
import {
  CHATGPT_WEB_SPEC_TEMPLATE,
  PROTOCOL_PROBE_SPECS,
} from '../src/services/protocol-probe/specs.mjs'
import { resolveChatgptWebCurrentReference } from '../src/services/protocol-probe/resolve-chatgpt-web-reference.mjs'
import {
  classifyFetchedScripts,
  collectScriptUrls,
  evaluateProtocolProbe,
  formatProtocolProbeFilenameUpdates,
  findProtocolProbeSpecForHost,
  findProtocolProbeSpecForUrl,
  listKnownFilenames,
  selectFetchCandidates,
  shouldDeepScan,
  shouldNotifyProtocolProbe,
  summarizeScripts,
} from '../src/services/protocol-probe/index.mjs'
import {
  handleProtocolProbeSnapshot,
  registerProtocolProbe,
  runProtocolProbeOnOpenTabs,
} from '../src/background/protocol-probe-service.mjs'

const chatgptSpec = PROTOCOL_PROBE_SPECS.find((spec) => spec.id === 'chatgpt-web')

const transportBody = ['No done event received', 'resume_token_ttl_ms'].join(' ')

const orchestratorBody = [
  '/f/conversation/resume',
  'subscribe_ws_topic',
  'stream_handoff',
  'resume_conversation_token',
].join(' ')

const websocketBody = 'includeAllHistory last_offset delta_encoding resume_conversation_token'

function scriptUrl(filename, host = 'cdn.oaistatic.com') {
  return `https://${host}/assets/${filename}`
}

const knownUrls = chatgptSpec.knownFilenames.map((name) => scriptUrl(name))

describe('protocol probe specs', () => {
  it('matches ChatGPT hosts and skips the login page', () => {
    expect(findProtocolProbeSpecForHost('chatgpt.com')?.id).toBe('chatgpt-web')
    expect(findProtocolProbeSpecForHost('www.chatgpt.com')?.id).toBe('chatgpt-web')
    expect(findProtocolProbeSpecForUrl('https://chatgpt.com/c/abc')?.id).toBe('chatgpt-web')
    expect(findProtocolProbeSpecForUrl('https://chatgpt.com/auth/login')).toBeNull()
    expect(findProtocolProbeSpecForHost('example.com')).toBeNull()
  })

  it('takes current filenames from resources/chatgpt-web/current, not from hand-edited specs', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const onDisk = readdirSync(join(repoRoot, 'resources/chatgpt-web/current')).filter((name) =>
      name.endsWith('.js'),
    )
    const resolved = resolveChatgptWebCurrentReference({
      repoRoot,
      spec: CHATGPT_WEB_SPEC_TEMPLATE,
    })
    expect(listKnownFilenames(chatgptSpec).sort()).toEqual(onDisk.sort())
    expect(resolved.files).toEqual(chatgptWebCurrent.files)
    expect(CHATGPT_WEB_SPEC_TEMPLATE.knownFilenames).toBeUndefined()
    expect(CHATGPT_WEB_SPEC_TEMPLATE.roles.every((role) => !role.knownFilenames)).toBe(true)
  })

  it('validates actual current bundle markers after delta/resume move to the WebSocket chunk', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const fetched = chatgptWebCurrent.files.map(({ filename }) => ({
      filename,
      url: scriptUrl(filename),
      text: readFileSync(join(repoRoot, chatgptWebCurrent.dir, filename), 'utf8'),
    }))
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: fetched.map((file) => file.url),
      fetched,
      scanned: true,
    })
    expect(report.status).toBe('ok')
    expect(report.missingMarkers).toEqual([])
  })
})

describe('evaluateProtocolProbe', () => {
  it('dedupes script URLs and marks known / hinted files', () => {
    const urls = collectScriptUrls({
      scriptSrcs: [knownUrls[1]],
      preloadHrefs: [knownUrls[1]],
      resourceUrls: [knownUrls[0]],
    })
    expect(urls).toHaveLength(2)
    const scripts = summarizeScripts(urls, chatgptSpec)
    expect(scripts.filter((script) => script.known)).toHaveLength(2)
    expect(scripts.filter((script) => script.hinted)).toHaveLength(1)
  })

  it('reports ok when checked-in files and markers are present', () => {
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: knownUrls,
      fetched: [
        { url: knownUrls[0], filename: chatgptSpec.knownFilenames[0], text: orchestratorBody },
        { url: knownUrls[1], filename: chatgptSpec.knownFilenames[1], text: transportBody },
        { url: knownUrls[2], filename: chatgptSpec.knownFilenames[2], text: websocketBody },
      ],
      scanned: true,
    })
    expect(report.status).toBe('ok')
    expect(report.knownMissing).toEqual([])
    expect(report.roleUpdates.every((item) => item.current)).toBe(true)
  })

  it('reports url_drift when filenames changed but markers still match', () => {
    const next = [
      scriptUrl('aaaaaaaa-neworch.js'),
      scriptUrl('conversation-small-NEWHASH.js'),
      scriptUrl('bbbbbbbb-newws.js'),
    ]
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: next,
      fetched: [
        { url: next[0], filename: 'aaaaaaaa-neworch.js', text: orchestratorBody },
        { url: next[1], filename: 'conversation-small-NEWHASH.js', text: transportBody },
        { url: next[2], filename: 'bbbbbbbb-newws.js', text: websocketBody },
      ],
      scanned: true,
    })
    expect(report.status).toBe('url_drift')
    expect(formatProtocolProbeFilenameUpdates(report)).toContain('conversation-small-NEWHASH.js')
  })

  it('reports marker_drift when a required protocol string is gone', () => {
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: knownUrls,
      fetched: [
        { url: knownUrls[0], filename: chatgptSpec.knownFilenames[0], text: orchestratorBody },
        { url: knownUrls[1], filename: chatgptSpec.knownFilenames[1], text: 'unrelated' },
        { url: knownUrls[2], filename: chatgptSpec.knownFilenames[2], text: websocketBody },
      ],
      scanned: true,
    })
    expect(report.status).toBe('marker_drift')
    expect(report.missingMarkers.length).toBeGreaterThan(0)
  })

  it('reports incomplete when the page has no app scripts', () => {
    const report = evaluateProtocolProbe({ spec: chatgptSpec, scriptUrls: [] })
    expect(report.status).toBe('incomplete')
  })

  it('classifies the first file that contains every identify marker', () => {
    const roles = classifyFetchedScripts(chatgptSpec, [
      { url: scriptUrl('noise.js'), filename: 'noise.js', text: 'hello' },
      {
        url: scriptUrl('aaaaaaaa-neworch.js'),
        filename: 'aaaaaaaa-neworch.js',
        text: orchestratorBody,
      },
    ])
    expect(roles['conversation-orchestrator'].filename).toBe('aaaaaaaa-neworch.js')
  })

  it('fetches hinted and known files first', () => {
    const scripts = summarizeScripts(
      [scriptUrl('aaaaaaaa-other.js'), scriptUrl('conversation-small-NEWHASH.js')],
      chatgptSpec,
    )
    const selected = selectFetchCandidates({ spec: chatgptSpec, scripts, maxFetch: 1 })
    expect(selected[0].filename).toBe('conversation-small-NEWHASH.js')
  })

  it('deep-scans on missing names, first run, or a stale previous scan', () => {
    const scripts = summarizeScripts(knownUrls, chatgptSpec)
    expect(shouldDeepScan({ spec: chatgptSpec, scripts, previous: null })).toBe(true)
    expect(
      shouldDeepScan({
        spec: chatgptSpec,
        scripts,
        previous: { deepScannedAt: new Date().toISOString() },
        now: Date.now(),
        periodicMs: 24 * 60 * 60 * 1000,
      }),
    ).toBe(false)
    expect(
      shouldDeepScan({
        spec: chatgptSpec,
        scripts: summarizeScripts([scriptUrl('conversation-small-NEWHASH.js')], chatgptSpec),
        previous: { deepScannedAt: new Date().toISOString() },
      }),
    ).toBe(true)
    expect(shouldDeepScan({ spec: chatgptSpec, scripts, trigger: 'manual' })).toBe(true)
    expect(
      shouldDeepScan({
        spec: chatgptSpec,
        scripts: summarizeScripts([scriptUrl('conversation-small-NEWHASH.js')], chatgptSpec),
        previous: { status: 'url_drift', deepScannedAt: new Date().toISOString() },
        now: Date.now(),
        periodicMs: 24 * 60 * 60 * 1000,
      }),
    ).toBe(false)
  })

  it('treats a still-loading automatic snapshot as incomplete, not filename drift', () => {
    const early = [scriptUrl('aaaaaaaa-other.js')]
    expect(
      evaluateProtocolProbe({
        spec: chatgptSpec,
        scriptUrls: early,
        trigger: 'tab_complete',
      }).status,
    ).toBe('incomplete')
    expect(
      evaluateProtocolProbe({
        spec: chatgptSpec,
        scriptUrls: early,
        trigger: 'manual',
      }).status,
    ).toBe('url_drift')
  })

  it('does not call unidentified replacements marker drift', () => {
    const next = [scriptUrl('cccccccc-noise.js'), scriptUrl('conversation-small-NEWHASH.js')]
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: next,
      fetched: [{ url: next[0], filename: 'cccccccc-noise.js', text: 'hello' }],
      scanned: true,
      trigger: 'tab_complete',
    })
    expect(report.status).toBe('incomplete')
  })

  it('keeps a confirmed marker_drift when a later pass does not fetch bodies', () => {
    const report = evaluateProtocolProbe({
      spec: chatgptSpec,
      scriptUrls: knownUrls,
      previous: { status: 'marker_drift', deepScannedAt: new Date().toISOString() },
    })
    expect(report.status).toBe('marker_drift')
  })

  it('notifies only when status newly becomes a drift', () => {
    expect(shouldNotifyProtocolProbe({ status: 'ok' }, { status: 'url_drift' })).toBe(true)
    expect(shouldNotifyProtocolProbe({ status: 'url_drift' }, { status: 'url_drift' })).toBe(false)
    expect(shouldNotifyProtocolProbe(null, { status: 'ok' })).toBe(false)
  })
})

function createHarness({
  scripts = knownUrls,
  bodies = {
    [chatgptSpec.knownFilenames[0]]: orchestratorBody,
    [chatgptSpec.knownFilenames[1]]: transportBody,
    [chatgptSpec.knownFilenames[2]]: websocketBody,
  },
  tabUrl = 'https://chatgpt.com/',
} = {}) {
  const store = { protocolProbeReports: { version: 1, reports: {} } }
  const tab = { id: 7, url: tabUrl }
  const listeners = { updated: [], alarm: [] }

  const runtime = registerProtocolProbe({
    autoStart: false,
    now: () => Date.parse('2026-09-06T00:00:00.000Z'),
    delay: async () => {},
    periodicMs: 24 * 60 * 60 * 1000,
    tabSettleMs: 0,
    tabsApi: {
      query: async () => [tab],
      sendMessage: async () => ({
        ok: true,
        data: {
          specId: 'chatgpt-web',
          pageUrl: tabUrl,
          hostname: 'chatgpt.com',
          scripts,
        },
      }),
      onUpdated: { addListener: (fn) => listeners.updated.push(fn) },
    },
    alarmsApi: {
      get: vi.fn(async () => ({ name: 'protocol-probe-periodic' })),
      create: vi.fn(),
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    storageApi: {
      get: async () => ({ protocolProbeReports: store.protocolProbeReports }),
      set: async (value) => {
        store.protocolProbeReports = value.protocolProbeReports
      },
    },
    fetchImpl: async (url) => {
      const name = url.split('/').pop()
      const text = bodies[name]
      return text ? { ok: true, text: async () => text } : { ok: false, text: async () => '' }
    },
    notificationsApi: { create: vi.fn() },
  })

  return { store, listeners, runtime, notificationsApi: runtime.deps.notificationsApi }
}

describe('protocol probe service', () => {
  it('persists an ok report from a snapshot', async () => {
    const harness = createHarness()
    const result = await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      trigger: 'manual',
      pageUrl: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      scripts: knownUrls,
    })
    expect(result.ran).toBe(true)
    expect(harness.store.protocolProbeReports.reports['chatgpt-web'].status).toBe('ok')
  })

  it('ignores snapshots that are not a supported page', async () => {
    const harness = createHarness()
    const result = await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      pageUrl: 'https://example.com/',
      hostname: 'example.com',
      scripts: knownUrls,
    })
    expect(result.ran).toBe(false)
    expect(harness.store.protocolProbeReports.reports['chatgpt-web']).toBeUndefined()
  })

  it('scans an open ChatGPT tab from Check now', async () => {
    const harness = createHarness()
    const result = await runProtocolProbeOnOpenTabs({ trigger: 'manual' })
    expect(result).toEqual({ ran: true, reason: '', count: 1 })
    expect(harness.store.protocolProbeReports.reports['chatgpt-web'].status).toBe('ok')
  })

  it('notifies once when filenames first drift', async () => {
    const next = [
      scriptUrl('aaaaaaaa-neworch.js'),
      scriptUrl('conversation-small-NEWHASH.js'),
      scriptUrl('bbbbbbbb-newws.js'),
    ]
    const harness = createHarness({
      scripts: next,
      bodies: {
        'aaaaaaaa-neworch.js': orchestratorBody,
        'conversation-small-NEWHASH.js': transportBody,
        'bbbbbbbb-newws.js': websocketBody,
      },
    })
    await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      trigger: 'manual',
      pageUrl: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      scripts: next,
    })
    expect(harness.store.protocolProbeReports.reports['chatgpt-web'].status).toBe('url_drift')
    expect(harness.notificationsApi.create).toHaveBeenCalledTimes(1)
    await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      trigger: 'manual',
      pageUrl: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      scripts: next,
    })
    expect(harness.notificationsApi.create).toHaveBeenCalledTimes(1)
  })

  it('does not let a later automatic pass clear marker_drift', async () => {
    const harness = createHarness({
      bodies: {
        [chatgptSpec.knownFilenames[0]]: orchestratorBody,
        [chatgptSpec.knownFilenames[1]]: 'unrelated',
        [chatgptSpec.knownFilenames[2]]: websocketBody,
      },
    })
    await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      trigger: 'manual',
      pageUrl: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      scripts: knownUrls,
    })
    expect(harness.store.protocolProbeReports.reports['chatgpt-web'].status).toBe('marker_drift')
    await handleProtocolProbeSnapshot({
      specId: 'chatgpt-web',
      trigger: 'tab_complete',
      pageUrl: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      scripts: knownUrls,
    })
    expect(harness.store.protocolProbeReports.reports['chatgpt-web'].status).toBe('marker_drift')
  })

  it('runs after a matching tab finishes loading', async () => {
    const harness = createHarness()
    await harness.listeners.updated[0](
      7,
      { status: 'complete' },
      { id: 7, url: 'https://chatgpt.com/' },
    )
    expect(harness.store.protocolProbeReports.reports['chatgpt-web']?.status).toBe('ok')
  })
})
