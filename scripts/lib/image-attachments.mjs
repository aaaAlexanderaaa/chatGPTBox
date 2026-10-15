/* eslint-env node */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  MAX_CHATGPT_IMAGE_BYTES,
  MAX_CHATGPT_IMAGES,
} from '../../src/services/clients/chatgpt-web/image-content.mjs'

export function decodeImageAttachment(input = {}) {
  let mime = input.mime_type || input.mimeType
  let encoded = input.base64
  const dataUrl = input.data_url || input.dataUrl
  if (dataUrl) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
    if (!match) throw new Error('Use a base64 JPEG, PNG or WebP data URL')
    mime = match[1]
    encoded = match[2]
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || typeof encoded !== 'string')
    throw new Error('A JPEG, PNG or WebP image and base64 data are required')
  encoded = encoded.replace(/[\r\n]/g, '')
  if (
    !encoded ||
    encoded.length > Math.ceil(MAX_CHATGPT_IMAGE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new Error('Invalid base64 or image larger than 8 MiB')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded || bytes.length > MAX_CHATGPT_IMAGE_BYTES)
    throw new Error('Invalid base64 or oversized image')
  const { width, height } = imageDimensions(bytes, mime)
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384))
    throw new Error('Invalid image dimensions')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]
  const name =
    typeof input.name === 'string' ? input.name.replace(/[\r\n/\\<>]/g, '_').slice(0, 160) : ''
  return {
    id: `img-${sha256}`,
    sha256,
    name: name || `photo.${extension}`,
    mimeType: mime,
    width,
    height,
    sizeBytes: bytes.length,
    base64: encoded,
  }
}

export function imageDimensions(bytes, mime) {
  if (
    mime === 'image/png' &&
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (mime === 'image/jpeg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const size = bytes.readUInt16BE(offset)
      if (size < 2 || offset + size > bytes.length) break
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        size >= 8
      )
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
      offset += size
    }
  }
  if (
    mime === 'image/webp' &&
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X')
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
      return { width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 }
    if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }
    }
  }
  throw new Error('Image bytes do not match the declared format')
}

export class ImageAttachmentStore {
  constructor(directory, { ttlMs = 7 * 24 * 60 * 60 * 1000, maxBytes = 256 * 1024 * 1024 } = {}) {
    this.directory = directory
    this.ttlMs = ttlMs
    this.maxBytes = maxBytes
  }
  file(id) {
    if (!/^img-[a-f0-9]{64}$/.test(id)) throw new Error('Invalid attachment ID')
    return path.join(this.directory, `${id}.json`)
  }
  put(input) {
    const image = decodeImageAttachment(input)
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    let total = 0
    for (const name of fs.readdirSync(this.directory)) {
      if (!/^img-[a-f0-9]{64}\.json$/.test(name)) continue
      const file = path.join(this.directory, name)
      const stat = fs.statSync(file)
      if (Date.now() - stat.mtimeMs > this.ttlMs) fs.unlinkSync(file)
      else if (file !== this.file(image.id)) total += stat.size
    }
    const record = {
      ...image,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    }
    const json = JSON.stringify(record)
    if (total + Buffer.byteLength(json) > this.maxBytes)
      throw new Error('Attachment storage is full; try again after older photos expire')
    const file = this.file(image.id)
    const temp = `${file}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temp, json, { mode: 0o600 })
    fs.renameSync(temp, file)
    return this.info(record)
  }
  get(id) {
    let record
    try {
      record = JSON.parse(fs.readFileSync(this.file(id), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Photo is missing; attach it again')
      throw error
    }
    if (Date.parse(record.expiresAt) <= Date.now())
      throw new Error('Photo has expired; attach it again')
    // Verify immutable content before dispatch, including after a gateway restart.
    const image = decodeImageAttachment({
      base64: record.base64,
      mime_type: record.mimeType,
      name: record.name,
    })
    if (image.id !== id) throw new Error('Stored photo failed its integrity check')
    return { ...record, ...image }
  }
  resolve(ids = []) {
    if (!Array.isArray(ids) || ids.length > MAX_CHATGPT_IMAGES)
      throw new Error('At most 4 image attachments are supported')
    return ids.map((id) => this.get(id))
  }
  info(record) {
    const { base64: _bytes, ...info } = record
    void _bytes
    return { ...info, status: 'stored' }
  }
}

export function normalizeGatewayImageMessages(messages) {
  const images = []
  const normalized = messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('Invalid message')
    if (typeof message.content === 'string') return message
    if (!Array.isArray(message.content))
      throw new Error('Message content must be text or a content array')
    const text = message.content
      .map((part) => {
        if (part?.type === 'text' && typeof part.text === 'string') return part.text
        if (part?.type === 'image_url' && message.role === 'user') {
          images.push(decodeImageAttachment({ data_url: part.image_url?.url }))
          return `[Photo ${images.length}]`
        }
        throw new Error(
          'Supported content parts are text and user image_url with a base64 data URL',
        )
      })
      .join('\n')
    return { ...message, content: text }
  })
  if (images.length > MAX_CHATGPT_IMAGES)
    throw new Error('At most 4 images are supported per request')
  return { messages: normalized, images }
}
