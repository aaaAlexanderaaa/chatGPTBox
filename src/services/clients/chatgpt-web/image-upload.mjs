import { getUserConfig } from '../../../config/storage.mjs'
import { getChatgptWebPageIntegrity, buildChatgptWebPageHeaders } from './page-integrity.mjs'
import { createChatgptWebPageTransport } from './page-transport.mjs'
import {
  MAX_CHATGPT_IMAGES,
  MAX_CHATGPT_IMAGE_BYTES,
  normalizeChatgptProjectId,
  validateChatgptImagePointer,
  chatgptImageAssetPointer,
} from './image-content.mjs'

const CHATGPT_PROJECT_GIZMO_TYPE = 'snorlax'

export async function consumeChatgptImageReadyStream(response, fileId) {
  if (!response.ok) throw new Error(`ChatGPT image processing failed (HTTP ${response.status})`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('ChatGPT image processing returned no stream')
  const decoder = new TextDecoder()
  let buffer = '',
    ready = false
  const consume = (frame) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') return
    const event = JSON.parse(data)
    if (event.file_id && event.file_id !== fileId) return
    if (/(?:error|failed|cancelled|unknown)$/.test(event.event || ''))
      throw new Error(`ChatGPT image processing failed: ${event.event}`)
    if (event.event === 'file.processing.file_ready' && event.file_id === fileId) ready = true
  }
  try {
    let done = false
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      buffer += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r/g, '')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
      if (buffer.length > 1024 * 1024) throw new Error('Oversized image processing event')
      if (chunk.done) {
        if (buffer.trim()) consume(buffer)
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (!ready) throw new Error('ChatGPT did not confirm that the image is ready')
}

export function trustedImageUploadUrl(value, baseUrl = 'https://chatgpt.com') {
  const url = new URL(value, baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Unsupported ChatGPT image upload destination')
  const estuary =
    url.origin === 'https://chatgpt.com' &&
    url.pathname === '/backend-api/estuary/upload_content_bytes'
  const signedBlob = ['blob.core.windows.net', 's3.amazonaws.com', 'oaiusercontent.com'].some(
    (host) => url.hostname.endsWith(`.${host}`),
  )
  if (!estuary && !signedBlob) throw new Error('Unsupported ChatGPT image upload destination')
  return { url: url.href, estuary }
}

export async function uploadChatgptImages(
  images,
  { apiFetch, blobFetch = fetch, baseUrl = 'https://chatgpt.com', signal } = {},
) {
  if (!Array.isArray(images) || !images.length || images.length > MAX_CHATGPT_IMAGES)
    throw new Error('Provide between 1 and 4 images')
  const result = []
  for (const image of images) {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) ||
      typeof image.base64 !== 'string' ||
      image.base64.length > Math.ceil(MAX_CHATGPT_IMAGE_BYTES / 3) * 4
    )
      throw new Error('Unsupported or oversized image')
    const decoded = atob(image.base64)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    if (bytes.length !== image.sizeBytes || bytes.length > MAX_CHATGPT_IMAGE_BYTES)
      throw new Error('Image size does not match its bytes')
    const response = await apiFetch('/files', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        file_name: image.name,
        file_size: bytes.length,
        use_case: 'multimodal',
        mime_type: image.mimeType,
        timezone_offset_min: new Date().getTimezoneOffset(),
        store_in_library: false,
        entry_surface: 'composer',
        supports_direct_azure_multipart: false,
      }),
    })
    if (!response.ok)
      throw new Error(`ChatGPT image upload could not start (HTTP ${response.status})`)
    const entry = await response.json()
    if (
      entry.status === 'error' ||
      !/^file[-_][A-Za-z0-9_-]+$/.test(entry.file_id || '') ||
      typeof entry.upload_url !== 'string'
    )
      throw new Error('ChatGPT returned an invalid image upload entry')
    const pointer = validateChatgptImagePointer({
      asset_pointer: chatgptImageAssetPointer(entry.file_id),
      width: image.width,
      height: image.height,
      size_bytes: bytes.length,
    })
    const destination = trustedImageUploadUrl(entry.upload_url, baseUrl)
    let uploaded
    if (destination.estuary) {
      uploaded = await apiFetch('/estuary/upload_content_bytes' + new URL(destination.url).search, {
        method: 'POST',
        signal,
        formData: {
          name: image.name,
          mimeType: image.mimeType,
          base64: image.base64,
          uploadUrl: destination.url,
        },
      })
    } else {
      const headers = { 'Content-Type': image.mimeType, ...entry.upload_headers }
      if (new URL(destination.url).hostname.endsWith('.blob.core.windows.net'))
        headers['x-ms-blob-type'] ||= 'BlockBlob'
      uploaded = await blobFetch(destination.url, {
        method: 'PUT',
        signal,
        body: bytes,
        headers,
        credentials: 'omit',
        redirect: 'error',
      })
    }
    if (!uploaded.ok) throw new Error(`ChatGPT photo transfer failed (HTTP ${uploaded.status})`)
    await uploaded.text()
    const processed = await apiFetch('/files/process_upload_stream', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        file_id: entry.file_id,
        file_name: image.name,
        use_case: 'multimodal',
        mime_type: image.mimeType,
        index_for_retrieval: false,
        entry_surface: 'composer',
        ...(image.sha256 && { client_sha256_digest: image.sha256 }),
      }),
    })
    await consumeChatgptImageReadyStream(processed, entry.file_id)
    result.push({ ...pointer, name: image.name, attachmentId: image.id })
  }
  return result
}

async function withPageApi(run) {
  const config = await getUserConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)
  let transport
  try {
    const context = await getChatgptWebPageIntegrity({
      signal: controller.signal,
      apiUrl: config.customChatGptWebApiUrl,
      apiPath: '/backend-api/f/conversation',
    })
    transport = createChatgptWebPageTransport(context)
    const baseUrl = config.customChatGptWebApiUrl || 'https://chatgpt.com'
    const apiFetch = (path, options = {}) =>
      transport.fetch(`${baseUrl}/backend-api${path}`, {
        ...options,
        signal: controller.signal,
        credentials: 'include',
        headers: buildChatgptWebPageHeaders(context, {
          apiPath: `/backend-api${path}`,
          accept: 'application/json',
        }),
      })
    return await run({ apiFetch, baseUrl, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    transport?.close()
  }
}

export async function uploadChatgptWebImages(payload = {}) {
  return withPageApi(async (context) => {
    const projectId = normalizeChatgptProjectId(payload.projectId)
    if (projectId) await requireChatgptProject(context.apiFetch, projectId)
    return uploadChatgptImages(payload.images, context)
  })
}

export async function requireChatgptProject(apiFetch, projectId) {
  const response = await apiFetch(`/gizmos/${normalizeChatgptProjectId(projectId)}`)
  if (!response.ok) throw new Error(`ChatGPT project is unavailable (HTTP ${response.status})`)
  const data = await response.json()
  const gizmo = data.gizmo || data.resource?.gizmo
  if (gizmo?.id !== projectId || gizmo.gizmo_type !== CHATGPT_PROJECT_GIZMO_TYPE)
    throw new Error('The selected ID is not an accessible ChatGPT Project')
  return gizmo
}

export async function listChatgptWebProjects(payload = {}) {
  return withPageApi(async ({ apiFetch }) => {
    const query = new URLSearchParams({
      conversations_per_gizmo: '0',
      owned_only: 'true',
      limit: '20',
    })
    if (payload.cursor) query.set('cursor', String(payload.cursor))
    const response = await apiFetch(`/gizmos/snorlax/sidebar?${query}`)
    if (!response.ok) throw new Error(`Could not list ChatGPT projects (HTTP ${response.status})`)
    const data = await response.json()
    return {
      projects: (data.items || [])
        .map((item) => item.gizmo?.gizmo || item.gizmo)
        .filter((gizmo) => gizmo?.gizmo_type === CHATGPT_PROJECT_GIZMO_TYPE)
        .map((gizmo) => ({ id: gizmo.id, name: gizmo.display?.name || gizmo.id })),
      cursor: data.cursor || null,
    }
  })
}
