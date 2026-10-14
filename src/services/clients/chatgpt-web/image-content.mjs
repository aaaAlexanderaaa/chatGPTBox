export const MAX_CHATGPT_IMAGES = 4
export const MAX_CHATGPT_IMAGE_BYTES = 8 * 1024 * 1024

export function chatgptImageAssetPointer(fileId) {
  if (typeof fileId !== 'string' || !/^file[-_][A-Za-z0-9_-]+$/.test(fileId))
    throw new Error('Invalid ChatGPT image file ID')
  // The official client uses sediment storage for file_ IDs and file-service
  // for file- IDs. Keep the scheme paired with the returned ID format.
  return `${fileId.startsWith('file_') ? 'sediment' : 'file-service'}://${fileId}`
}

export function normalizeChatgptProjectId(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    throw new Error('Invalid ChatGPT project ID')
  return value
}

export function validateChatgptImagePointer(image) {
  if (
    !image ||
    typeof image.asset_pointer !== 'string' ||
    !/^(?:file-service:\/\/file-|sediment:\/\/file_)[A-Za-z0-9_-]+$/.test(image.asset_pointer) ||
    ![image.width, image.height, image.size_bytes].every((n) => Number.isInteger(n) && n > 0) ||
    image.size_bytes > MAX_CHATGPT_IMAGE_BYTES ||
    image.width > 16384 ||
    image.height > 16384
  )
    throw new Error('Invalid or oversized ChatGPT image pointer')
  return {
    content_type: 'image_asset_pointer',
    asset_pointer: image.asset_pointer,
    size_bytes: image.size_bytes,
    width: image.width,
    height: image.height,
  }
}

export function buildChatgptImageContent(text, images = []) {
  if (!Array.isArray(images) || images.length > MAX_CHATGPT_IMAGES)
    throw new Error(`At most ${MAX_CHATGPT_IMAGES} images are supported per message`)
  if (!images.length) return { content_type: 'text', parts: [text] }
  return {
    content_type: 'multimodal_text',
    parts: [...images.map(validateChatgptImagePointer), text],
  }
}
