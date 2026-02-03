import Browser from 'webextension-polyfill'
import { getModels as getChatGptWebModels } from './apis/chatgpt-web.mjs'

export const MODEL_LIST_CACHE_KEY = 'modelListCache'

function normalizeV1BaseUrl(apiUrl) {
  if (!apiUrl) return ''
  const trimmed = String(apiUrl).trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

function deriveV1BaseUrlFromEndpoint(url) {
  if (!url) return ''
  const raw = String(url).trim()
  try {
    const parsed = new URL(raw)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    const v1Index = pathname.indexOf('/v1')
    if (v1Index !== -1) {
      parsed.pathname = pathname.slice(0, v1Index + 3)
    } else {
      parsed.pathname = normalizeV1BaseUrl(pathname || '/').replace(/\/+$/, '')
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return normalizeV1BaseUrl(raw)
  }
}

async function fetchV1Models({ v1BaseUrl, apiKey }) {
  if (!v1BaseUrl) throw new Error('Missing API base URL')
  if (!apiKey) throw new Error('Missing API key')

  const resp = await fetch(`${v1BaseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(text || `${resp.status} ${resp.statusText}`)
  }

  const json = await resp.json().catch(() => ({}))
  const data = Array.isArray(json.data) ? json.data : []
  return data
    .map((m) => m?.id)
    .filter(Boolean)
    .sort()
}

async function getModelListCache() {
  const { [MODEL_LIST_CACHE_KEY]: cache } = await Browser.storage.local.get(MODEL_LIST_CACHE_KEY)
  if (!cache || typeof cache !== 'object') return {}
  return cache
}

export async function getCachedOpenAiModelList() {
  const cache = await getModelListCache()
  return Array.isArray(cache.openai?.models) ? cache.openai.models : []
}

export async function getCachedChatGptWebModelList() {
  const cache = await getModelListCache()
  return Array.isArray(cache.chatgptWeb?.models) ? cache.chatgptWeb.models : []
}

export async function getCachedCustomModelList({ apiUrl }) {
  const v1BaseUrl = deriveV1BaseUrlFromEndpoint(apiUrl)
  const cache = await getModelListCache()
  const entry = cache.custom?.[v1BaseUrl]
  return Array.isArray(entry?.models) ? entry.models : []
}

export async function refreshOpenAiModelList({ apiKey, apiUrl }) {
  const v1BaseUrl = normalizeV1BaseUrl(apiUrl)
  const models = await fetchV1Models({ v1BaseUrl, apiKey })
  const cache = await getModelListCache()
  const next = {
    ...cache,
    openai: {
      fetchedAt: Date.now(),
      v1BaseUrl,
      models,
    },
  }
  await Browser.storage.local.set({ [MODEL_LIST_CACHE_KEY]: next })
  return models
}

export async function refreshChatGptWebModelList({ accessToken }) {
  if (!accessToken) throw new Error('Missing access token')
  const models = (await getChatGptWebModels(accessToken)) || []
  const cache = await getModelListCache()
  const next = {
    ...cache,
    chatgptWeb: {
      fetchedAt: Date.now(),
      models,
    },
  }
  await Browser.storage.local.set({ [MODEL_LIST_CACHE_KEY]: next })
  return models
}

export async function refreshCustomModelList({ apiKey, apiUrl }) {
  const v1BaseUrl = deriveV1BaseUrlFromEndpoint(apiUrl)
  const models = await fetchV1Models({ v1BaseUrl, apiKey })
  const cache = await getModelListCache()
  const nextCustom = {
    ...(cache.custom && typeof cache.custom === 'object' ? cache.custom : {}),
    [v1BaseUrl]: {
      fetchedAt: Date.now(),
      v1BaseUrl,
      models,
    },
  }
  const next = {
    ...cache,
    custom: nextCustom,
  }
  await Browser.storage.local.set({ [MODEL_LIST_CACHE_KEY]: next })
  return models
}
