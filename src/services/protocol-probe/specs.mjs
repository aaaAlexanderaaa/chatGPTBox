// Conversation-protocol fingerprint for official provider pages.
//
// Filenames are not hardcoded here. ChatGPT Web's current bundles live in
// resources/chatgpt-web/current/; scripts/sync-protocol-reference.mjs maps
// them to roles by marker. Markers must be protocol strings (paths, headers,
// event names), never minified locals like `kTt`.

import chatgptWebCurrent from './chatgpt-web-current.mjs'

export const PROTOCOL_PROBE_STORAGE_KEY = 'protocolProbeReports'
export const PROTOCOL_PROBE_ALARM = 'protocol-probe-periodic'
export const PROTOCOL_PROBE_ALARM_MINUTES = 6 * 60
export const PROTOCOL_PROBE_PERIODIC_SCAN_MS = 24 * 60 * 60 * 1000
export const PROTOCOL_PROBE_TAB_SETTLE_MS = 4_000
export const PROTOCOL_PROBE_MAX_FETCH = 12
export const PROTOCOL_PROBE_FETCH_CONCURRENCY = 3
export const PROTOCOL_PROBE_STORE_VERSION = 1

/**
 * @typedef {object} ProtocolProbeRole
 * @property {string} id
 * @property {string} label
 * @property {string[]} [knownFilenames]
 * @property {string[]} identifyAll
 * @property {string[]} [requiredMarkers]
 */

/**
 * @typedef {object} ProtocolProbeSpec
 * @property {string} id
 * @property {string} label
 * @property {string[]} matchHosts
 * @property {string[]} [staticHosts]
 * @property {string[]} [excludeUrlIncludes]
 * @property {string[]} [excludePathIncludes]
 * @property {string[]} [urlHints]
 * @property {string[]} [knownFilenames]
 * @property {ProtocolProbeRole[]} roles
 * @property {string[]} [searchHints]
 */

export function applyReferenceFiles(spec, reference) {
  const files = Array.isArray(reference?.files) ? reference.files : []
  return {
    ...spec,
    knownFilenames: files.map((file) => file.filename),
    roles: (spec?.roles || []).map((role) => ({
      ...role,
      knownFilenames: files.filter((file) => file.roleId === role.id).map((file) => file.filename),
    })),
  }
}

/** @type {ProtocolProbeSpec} */
export const CHATGPT_WEB_SPEC_TEMPLATE = {
  id: 'chatgpt-web',
  label: 'ChatGPT Web',
  matchHosts: ['chatgpt.com'],
  staticHosts: ['cdn.oaistatic.com', 'chatgpt.com', 'openai.com'],
  excludePathIncludes: ['/auth/login'],
  excludeUrlIncludes: [
    'recaptcha',
    'turnstile',
    'sentry',
    'datadog',
    'hotjar',
    'mapbox',
    'google-analytics',
    'googletagmanager',
    'intercom',
    'cloudflareinsights',
    'facebook.net',
    'doubleclick',
  ],
  urlHints: ['conversation-small'],
  roles: [
    {
      id: 'conversation-orchestrator',
      label: 'Conversation orchestration',
      identifyAll: ['/f/conversation/resume', 'subscribe_ws_topic'],
      requiredMarkers: [
        '/f/conversation/resume',
        'subscribe_ws_topic',
        'stream_handoff',
        'resume_conversation_token',
      ],
    },
    {
      id: 'conversation-transport',
      label: 'SSE transport / delta / poll',
      identifyAll: ['No done event received', 'resume_token_ttl_ms'],
      requiredMarkers: [
        'No done event received',
        'resume_token_ttl_ms',
        'resume_conversation_token',
        'delta_encoding',
      ],
    },
    {
      id: 'conversation-websocket',
      label: 'WebSocket topic',
      identifyAll: ['includeAllHistory'],
      requiredMarkers: ['includeAllHistory'],
    },
  ],
  searchHints: [
    '/backend-api/f/conversation',
    '/f/conversation/resume',
    'x-conduit-token',
    'stream_handoff',
    'subscribe_ws_topic',
    'resume_conversation_token',
    'resume_sse_endpoint',
    'No done event received',
    'resume_token_ttl_ms',
    'delta_encoding',
    'includeAllHistory',
    'conversation-small',
    '/backend-api/conversations',
    '/backend-api/conversation/',
    'stream_status',
  ],
}

/** @type {ProtocolProbeSpec[]} */
export const PROTOCOL_PROBE_SPECS = [
  applyReferenceFiles(CHATGPT_WEB_SPEC_TEMPLATE, chatgptWebCurrent),
]

export function getProtocolProbeSpecs() {
  return PROTOCOL_PROBE_SPECS
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
}

export function specMatchesHost(spec, hostname) {
  const host = normalizeHostname(hostname)
  if (!host || !spec?.matchHosts) return false
  return spec.matchHosts.some((candidate) => {
    const needle = normalizeHostname(candidate)
    return Boolean(needle) && (host === needle || host.endsWith(`.${needle}`))
  })
}

export function specExcludesPath(spec, url) {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return (spec?.excludePathIncludes || []).some((item) => {
      const needle = String(item || '').toLowerCase()
      return needle && path.includes(needle)
    })
  } catch {
    return false
  }
}

export function specMatchesUrl(spec, url) {
  try {
    const parsed = new URL(url)
    if (!specMatchesHost(spec, parsed.hostname)) return false
    return !specExcludesPath(spec, url)
  } catch {
    return false
  }
}

export function findProtocolProbeSpecForHost(hostname) {
  return PROTOCOL_PROBE_SPECS.find((spec) => specMatchesHost(spec, hostname)) || null
}

export function findProtocolProbeSpecForUrl(url) {
  return PROTOCOL_PROBE_SPECS.find((spec) => specMatchesUrl(spec, url)) || null
}
