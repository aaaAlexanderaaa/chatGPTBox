/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  decodeImageAttachment,
  ImageAttachmentStore,
  normalizeGatewayImageMessages,
} from '../scripts/lib/image-attachments.mjs'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
const dirs = []
const create = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-photos-'))
  dirs.push(dir)
  return new ImageAttachmentStore(dir)
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
describe('gateway photo attachments', () => {
  it('checks file bytes and derives dimensions rather than trusting caller metadata', () => {
    expect(
      decodeImageAttachment({ data_url: `data:image/png;base64,${png}`, width: 1000 }),
    ).toMatchObject({ width: 1, height: 1, mimeType: 'image/png' })
    expect(() => decodeImageAttachment({ base64: png, mime_type: 'image/jpeg' })).toThrow(
      'declared format',
    )
    expect(() => decodeImageAttachment({ base64: '!!!!', mime_type: 'image/png' })).toThrow()
    expect(() => decodeImageAttachment({ data_url: 'https://example.com/photo.png' })).toThrow(
      'data URL',
    )
  })
  it('deduplicates upload retries and survives a process restart without returning image bytes', () => {
    const store = create()
    const first = store.put({ data_url: `data:image/png;base64,${png}`, name: 'lunch.png' })
    const second = store.put({ base64: png, mime_type: 'image/png', name: 'again.png' })
    expect(second.id).toBe(first.id)
    expect(first).not.toHaveProperty('base64')
    expect(new ImageAttachmentStore(store.directory).get(first.id).base64).toBe(png)
    expect(fs.statSync(store.file(first.id)).mode & 0o777).toBe(0o600)
    expect(() => store.get('../private')).toThrow('Invalid attachment ID')
  })
  it('rejects expired, changed, oversized and excessive attachments before a message can be sent', () => {
    const store = create(),
      info = store.put({ base64: png, mime_type: 'image/png' })
    const record = JSON.parse(fs.readFileSync(store.file(info.id), 'utf8'))
    fs.writeFileSync(store.file(info.id), JSON.stringify({ ...record, expiresAt: '2000-01-01' }))
    expect(() => store.get(info.id)).toThrow('expired')
    expect(() => store.resolve(Array(5).fill(info.id))).toThrow('At most 4')
    expect(() =>
      decodeImageAttachment({ base64: 'A'.repeat(12 * 1024 * 1024), mime_type: 'image/png' }),
    ).toThrow('8 MiB')
  })
  it('preserves standard text and image inputs without stringifying image objects into prompts', () => {
    const result = normalizeGatewayImageMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze lunch' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        ],
      },
    ])
    expect(result.messages[0].content).toBe('Analyze lunch\n[Photo 1]')
    expect(result.images[0].width).toBe(1)
    expect(() =>
      normalizeGatewayImageMessages([{ role: 'user', content: [{ type: 'audio' }] }]),
    ).toThrow('Supported content')
  })
})
