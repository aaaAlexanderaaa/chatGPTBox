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
function stream(events) {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
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
  it('only accepts the exact file-ready event through a genuinely chunked SSE stream', async () => {
    await expect(
      consumeChatgptImageReadyStream(
        stream([{ event: 'file.processing.file_ready', file_id: 'file-photo' }]),
        'file-photo',
      ),
    ).resolves.toBeUndefined()
    await expect(
      consumeChatgptImageReadyStream(
        stream([{ event: 'file.processing.file_ready', file_id: 'file-other' }]),
        'file-photo',
      ),
    ).rejects.toThrow('did not confirm')
    await expect(
      consumeChatgptImageReadyStream(
        stream([{ event: 'file.processing.error', file_id: 'file-photo' }]),
        'file-photo',
      ),
    ).rejects.toThrow('failed')
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
})
