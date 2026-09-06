import { isChatgptWebWorkModelSlug } from './thinking.mjs'

const MODELS_QUERY = 'supports_model_picker_upgrade_presets=true'

/** Chat / Latest picker. Official GPT-6 here is `gpt-6-pro`. */
export const CHATGPT_WEB_CHAT_MODELS_PATH = `/models?${MODELS_QUERY}`

/**
 * ChatGPT Work / TPP picker. Official fetches this as a second `/models`
 * family request. Every row is `is_work_mode_model` and uses `*-wm` slugs
 * (`gpt-6-astra-wm`, not `gpt-6-pro`). Work rows may also carry
 * `default_thinking_effort`.
 */
export const CHATGPT_WEB_WORK_MODELS_PATH = `/tpp/models/?${MODELS_QUERY}`

function trimSlug(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueSlugs(values) {
  const slugs = []
  const seen = new Set()
  for (const value of values) {
    const slug = trimSlug(value)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    slugs.push(slug)
  }
  return slugs
}

export function isChatgptWebWorkCatalogModel(model) {
  if (!model || typeof model !== 'object') return false
  if (model.is_work_mode_model === true) return true
  return isChatgptWebWorkModelSlug(model.slug)
}

export function collectChatgptWebModelSlugs(payload) {
  const slugs = new Set()

  if (Array.isArray(payload?.models)) {
    for (const model of payload.models) {
      const slug = trimSlug(model?.slug)
      if (slug) slugs.add(slug)
    }
  }

  if (Array.isArray(payload?.categories)) {
    for (const category of payload.categories) {
      const defaultModel = trimSlug(category?.default_model)
      if (defaultModel) slugs.add(defaultModel)
      if (Array.isArray(category?.supported_models)) {
        for (const slug of category.supported_models) {
          const normalized = trimSlug(slug)
          if (normalized) slugs.add(normalized)
        }
      }
    }
  }

  if (Array.isArray(payload?.versions)) {
    for (const version of payload.versions) {
      if (!Array.isArray(version?.slugs)) continue
      for (const slug of version.slugs) {
        const normalized = trimSlug(slug)
        if (normalized) slugs.add(normalized)
      }
    }
  }

  const defaultSlug = trimSlug(payload?.default_model_slug)
  if (defaultSlug) slugs.add(defaultSlug)

  return [...slugs]
}

function inferChatgptWebCatalogKind(payload, { chatSlugs, models }) {
  if (Array.isArray(models) && models.length > 0 && models.every(isChatgptWebWorkCatalogModel)) {
    return 'work'
  }
  if (payload?.title === 'Latest') return 'chat'
  if (chatSlugs.length > 0) return 'chat'
  if (payload?.title === 'ChatGPT') return 'work'
  return 'unknown'
}

/**
 * Split one official `/models` (or `/tpp/models/`) payload into Chat vs Work.
 * Chat Latest embeds `*-wm` rows with `is_work_mode_model: true`; those stay Work.
 */
export function classifyChatgptWebModelsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      kind: 'unknown',
      title: '',
      slugs: [],
      chatSlugs: [],
      workSlugs: [],
    }
  }

  const models = Array.isArray(payload.models) ? payload.models : []
  const listedSlugs = []
  const chatSlugs = []
  const workSlugs = []

  for (const model of models) {
    const slug = trimSlug(model?.slug)
    if (!slug) continue
    listedSlugs.push(slug)
    if (isChatgptWebWorkCatalogModel(model)) workSlugs.push(slug)
    else chatSlugs.push(slug)
  }

  for (const slug of collectChatgptWebModelSlugs(payload)) {
    if (listedSlugs.includes(slug)) continue
    listedSlugs.push(slug)
    if (isChatgptWebWorkModelSlug(slug)) workSlugs.push(slug)
    else chatSlugs.push(slug)
  }

  return {
    kind: inferChatgptWebCatalogKind(payload, { chatSlugs, models }),
    title: typeof payload.title === 'string' ? payload.title : '',
    slugs: uniqueSlugs(listedSlugs),
    chatSlugs: uniqueSlugs(chatSlugs),
    workSlugs: uniqueSlugs(workSlugs),
  }
}

export function mergeChatgptWebModelCatalogs(chatPayload, workPayload) {
  const chat = classifyChatgptWebModelsPayload(chatPayload)
  const work = classifyChatgptWebModelsPayload(workPayload)
  const chatSlugs = chat.kind === 'work' ? [] : chat.chatSlugs
  const workSlugs = uniqueSlugs([
    ...chat.workSlugs,
    ...(work.kind === 'chat' ? work.workSlugs : work.slugs),
  ])

  return {
    slugs: uniqueSlugs([...chat.slugs, ...work.slugs]),
    chatSlugs,
    workSlugs,
    catalogs: { chat, work },
  }
}
