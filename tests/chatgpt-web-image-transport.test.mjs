import { afterEach, describe, expect, it, vi } from 'vitest'

const { pageFetch } = vi.hoisted(() => ({ pageFetch: vi.fn() }))
vi.mock('../src/config/storage.mjs', () => ({
  getUserConfig: async () => ({ customChatGptWebApiUrl: 'https://chatgpt.com' }),
}))
vi.mock('../src/services/clients/chatgpt-web/page-integrity.mjs', () => ({
  getChatgptWebPageIntegrity: async () => ({ transport: 'native' }),
  buildChatgptWebPageHeaders: () => ({}),
}))
vi.mock('../src/services/clients/chatgpt-web/page-transport.mjs', () => ({
  createChatgptWebPageTransport: () => ({ fetch: pageFetch, close() {} }),
}))
import { uploadChatgptWebImages } from '../src/services/clients/chatgpt-web/image-upload.mjs'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const origin = 'https://chatgpt.com'
const uploadPath = '/backend-api/estuary/upload_content_bytes?upload_url=synthetic-signed-url'
const image = {
  id: 'image-1',
  name: 'photo.png',
  mimeType: 'image/png',
  base64: 'YWJj',
  sizeBytes: 3,
  width: 1,
  height: 1,
}

describe('ChatGPT image upload through the page API', () => {
  it.each([uploadPath, origin + uploadPath])(
    'uses the returned estuary URL (%s)',
    async (uploadUrl) => {
      const urls = []
      pageFetch.mockImplementation(async (url, options) => {
        urls.push(url)
        if (url === origin + '/backend-api/files')
          return Response.json({ file_id: 'file_photo', upload_url: uploadUrl })
        if (url === origin + uploadPath) {
          expect(options.formData).toMatchObject({
            uploadUrl: origin + uploadPath,
            base64: image.base64,
          })
          return new Response('')
        }
        if (url === origin + '/backend-api/files/process_upload_stream')
          return new Response(
            'data: {"event":"file.processing.file_ready","file_id":"file_photo"}\n\n',
          )
        throw new Error('Unexpected native URL: ' + url)
      })
      await expect(uploadChatgptWebImages({ images: [image] })).resolves.toMatchObject([
        { asset_pointer: 'sediment://file_photo', attachmentId: image.id },
      ])
      expect(urls).toEqual([
        origin + '/backend-api/files',
        origin + uploadPath,
        origin + '/backend-api/files/process_upload_stream',
      ])
    },
  )

  it.each([
    [origin + uploadPath, 'synthetic-signed-url'],
    [
      origin + '/backend-api/estuary/upload_content_bytes',
      origin + '/backend-api/estuary/upload_content_bytes',
    ],
  ])(
    'uses the inner upload destination, with a fallback when absent (%s)',
    async (url, expected) => {
      const { createChatgptWebPageTransport } = await vi.importActual(
        '../src/services/clients/chatgpt-web/page-transport.mjs',
      )
      const fetch = vi.fn(async () => new Response(''))
      vi.stubGlobal('fetch', fetch)
      await createChatgptWebPageTransport({}).fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        formData: { ...image, uploadUrl: url },
      })
      const options = fetch.mock.calls[0][1]
      expect(options.body.get('upload_url')).toBe(expected)
      expect(await options.body.get('file').text()).toBe('abc')
      expect(options.headers.has('Content-Type')).toBe(false)
    },
  )
})
