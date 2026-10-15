import { describe, expect, it, vi } from 'vitest'
import {
  uploadChatgptImages,
  consumeChatgptImageReadyStream,
  trustedImageUploadUrl,
} from '../src/services/clients/chatgpt-web/image-upload.mjs'
import {
  buildChatgptWebConversationRequestBody,
  buildChatgptWebConversationInitBody,
  buildChatgptWebConversationPrepareBody,
} from '../src/services/clients/chatgpt-web/request-wire.mjs'
const pointer = { asset_pointer: 'file-service://file-photo', size_bytes: 3, width: 1, height: 1 }
const image = {
  id: 'image-1',
  name: 'lunch.png',
  mimeType: 'image/png',
  base64: 'YWJj',
  sizeBytes: 3,
  width: 1,
  height: 1,
}
function stream(events, format = 'sse') {
  const bytes = new TextEncoder().encode(
    events
      .map((event) =>
        format === 'ndjson'
          ? `${JSON.stringify(event)}\r\n`
          : `data: ${JSON.stringify(event)}\r\n\r\n`,
      )
      .join(''),
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
    {
      headers: {
        'content-type': format === 'ndjson' ? 'application/x-ndjson' : 'text/event-stream',
      },
    },
  )
}
describe('ChatGPT Web image inputs and projects', () => {
  it('uses sediment pointers for the native file_ storage format', async () => {
    const apiFetch = vi.fn(async (path) =>
      path === '/files'
        ? Response.json({
            status: 'success',
            file_id: 'file_123',
            upload_url: 'https://photos.blob.core.windows.net/upload',
          })
        : stream([{ event: 'file.processing.file_ready', file_id: 'file_123' }]),
    )
    const uploaded = await uploadChatgptImages([image], {
      apiFetch,
      blobFetch: async () => new Response(''),
    })
    expect(uploaded[0].asset_pointer).toBe('sediment://file_123')
    expect(
      buildChatgptWebConversationRequestBody({ question: 'Lunch', images: uploaded }).messages[0]
        .content.parts[0].asset_pointer,
    ).toBe('sediment://file_123')
  })
  it.each(['legacy', 'codex-webview'])(
    'carries images and the Project through prepare, init and submission (%s)',
    (profile) => {
      const body = buildChatgptWebConversationRequestBody({
        profile,
        question: 'Lunch',
        projectId: 'project-1',
        images: [pointer],
      })
      expect(body.messages[0].content).toEqual({
        content_type: 'multimodal_text',
        parts: [{ content_type: 'image_asset_pointer', ...pointer }, 'Lunch'],
      })
      expect(body.conversation_mode).toEqual({ kind: 'gizmo_interaction', gizmo_id: 'project-1' })
      expect(buildChatgptWebConversationPrepareBody(body, profile).conversation_mode).toEqual(
        body.conversation_mode,
      )
      expect(buildChatgptWebConversationInitBody(body).gizmo_id).toBe('project-1')
    },
  )
  it('does not send an unconfirmed file or an invalid Project ID', () => {
    expect(() =>
      buildChatgptWebConversationRequestBody({
        images: [{ ...pointer, asset_pointer: 'https://example.com/private' }],
      }),
    ).toThrow('pointer')
    expect(() => buildChatgptWebConversationRequestBody({ projectId: '../other' })).toThrow(
      'project ID',
    )
  })
  it.each(['sse', 'ndjson'])(
    'only accepts the exact file-ready event through a genuinely chunked %s stream',
    async (format) => {
      await expect(
        consumeChatgptImageReadyStream(
          stream([{ event: 'file.processing.file_ready', file_id: 'file-photo' }], format),
          'file-photo',
        ),
      ).resolves.toBeUndefined()
      await expect(
        consumeChatgptImageReadyStream(
          stream([{ event: 'file.processing.file_ready', file_id: 'file-other' }], format),
          'file-photo',
        ),
      ).rejects.toThrow('did not confirm')
      await expect(
        consumeChatgptImageReadyStream(
          stream([{ event: 'file.processing.error', file_id: 'file-photo' }], format),
          'file-photo',
        ),
      ).rejects.toThrow('failed')
      await expect(
        consumeChatgptImageReadyStream(
          stream([{ event: 'file.processing.completed', file_id: 'file-photo' }], format),
          'file-photo',
        ),
      ).rejects.toThrow('did not confirm')
    },
  )
  it('reads a final NDJSON event without a trailing newline', async () => {
    await expect(
      consumeChatgptImageReadyStream(
        new Response(
          JSON.stringify({ event: 'file.processing.file_ready', file_id: 'file-photo' }),
        ),
        'file-photo',
      ),
    ).resolves.toBeUndefined()
  })
  it('uses the SSE event name when it is outside the JSON payload', async () => {
    await expect(
      consumeChatgptImageReadyStream(
        new Response('event: file.processing.file_ready\ndata: {"file_id":"file-photo"}\n\n'),
        'file-photo',
      ),
    ).resolves.toBeUndefined()
  })
  it('uses the verified upload flow and keeps authentication away from signed blob storage', async () => {
    const apiFetch = vi.fn(async (path) =>
      path === '/files'
        ? Response.json({
            status: 'success',
            file_id: 'file-photo',
            upload_url: 'https://photos.blob.core.windows.net/upload?sig=synthetic',
          })
        : stream([{ event: 'file.processing.file_ready', file_id: 'file-photo' }]),
    )
    const blobFetch = vi.fn(async () => new Response(''))
    const uploaded = await uploadChatgptImages([image], { apiFetch, blobFetch })
    expect(uploaded[0]).toMatchObject(pointer)
    expect(blobFetch.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      credentials: 'omit',
      redirect: 'error',
    })
    expect(blobFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(apiFetch.mock.calls.map((call) => call[0])).toEqual([
      '/files',
      '/files/process_upload_stream',
    ])
    expect(() => trustedImageUploadUrl('https://example.com/upload')).toThrow('destination')
    expect(() => trustedImageUploadUrl('http://photos.blob.core.windows.net/upload')).toThrow(
      'destination',
    )
  })
  it.each([
    ['Azure storage', 'https://photos.blob.core.windows.net/upload?sv=synthetic', true],
    ['Azure alias', 'https://photos.oaiusercontent.com/upload?sv=synthetic', true],
    [
      'AWS storage',
      'https://photos.s3.amazonaws.com/upload?X-Amz-Algorithm=AWS4-HMAC-SHA256',
      false,
    ],
    [
      'AWS alias',
      'https://photos.oaiusercontent.com/upload?x-amz-algorithm=AWS4-HMAC-SHA256',
      false,
    ],
  ])('uses the native storage headers for %s', async (_name, uploadUrl, azure) => {
    const apiFetch = vi.fn(async (path) =>
      path === '/files'
        ? Response.json({ file_id: 'file-photo', upload_url: uploadUrl })
        : stream([{ event: 'file.processing.file_ready', file_id: 'file-photo' }]),
    )
    const blobFetch = vi.fn(async () => new Response(''))
    await uploadChatgptImages([image], { apiFetch, blobFetch })
    const [, options] = blobFetch.mock.calls[0]
    const headers = new Headers(options.headers)
    expect(headers.get('content-type')).toBe(image.mimeType)
    expect(headers.get('x-ms-blob-type')).toBe(azure ? 'BlockBlob' : null)
    expect(headers.get('x-ms-version')).toBe(azure ? '2020-04-08' : null)
    expect(headers.get('x-ms-blob-content-type')).toBe(azure ? image.mimeType : null)
    expect(headers.has('authorization')).toBe(false)
    expect(options.credentials).toBe('omit')
    expect(options.redirect).toBe('error')
  })
  it('honors case-insensitive upload header overrides without duplicating Azure defaults', async () => {
    const apiFetch = vi.fn(async (path) =>
      path === '/files'
        ? Response.json({
            file_id: 'file-photo',
            upload_url: 'https://photos.oaiusercontent.com/upload?sv=synthetic',
            upload_headers: { 'X-MS-VERSION': '2024-05-04' },
          })
        : stream([{ event: 'file.processing.file_ready', file_id: 'file-photo' }]),
    )
    const blobFetch = vi.fn(async () => new Response(''))
    await uploadChatgptImages([image], { apiFetch, blobFetch })
    expect(new Headers(blobFetch.mock.calls[0][1].headers).get('x-ms-version')).toBe('2024-05-04')
  })
})
