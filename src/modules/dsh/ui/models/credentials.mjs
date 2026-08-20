export function deriveKeyRef(provider) {
  const stem = String(provider || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return stem ? `${stem}_API_KEY` : 'API_KEY'
}

export function normalizeProviders(result) {
  const list = result?.providers || result?.items || (Array.isArray(result) ? result : [])
  return Array.isArray(list) ? list : []
}

function collectApiKeyEnv(value, refs) {
  if (!value || typeof value !== 'object') return
  if (typeof value.apiKeyEnv === 'string' && value.apiKeyEnv) refs.add(value.apiKeyEnv)
  if (Array.isArray(value)) {
    for (const entry of value) collectApiKeyEnv(entry, refs)
    return
  }
  for (const entry of Object.values(value)) collectApiKeyEnv(entry, refs)
}

export function credentialRefsFromProviders(providers = [], sections = []) {
  const refs = new Set()
  for (const provider of providers) {
    const id = provider?.provider || provider?.id
    if (id) refs.add(deriveKeyRef(id))
  }
  refs.add('DEEPSEEK_API_KEY')
  for (const section of sections) collectApiKeyEnv(section?.value || section?.values, refs)
  return [...refs].filter((ref) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)).slice(0, 64)
}

export function credentialsDescribePayload(refs = []) {
  return { refs }
}

export function credentialsSetPayload({ ref, value, apiKey } = {}) {
  return { ref, value: value || apiKey }
}

export function credentialsUnsetPayload({ ref, id } = {}) {
  return { ref: ref || id }
}

export function discoverModelsPayload({
  settingsNs,
  endpoint,
  baseURL,
  api,
  apiKey,
  provider,
} = {}) {
  const payload = { settingsNs }
  const url = baseURL || endpoint
  if (url) payload.baseURL = url
  if (api) payload.api = api
  if (apiKey) payload.apiKey = apiKey
  if (provider) payload.provider = provider
  return payload
}

export const DISCOVER_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
