import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import {
  listChatgptWebProjects,
  requireChatgptProject,
  uploadChatgptWebImages,
} from '../src/services/clients/chatgpt-web/image-upload.mjs'

const origin = 'https://chatgpt.com'
// Synthetic resource using the type returned by the official Project API.
const project = {
  id: 'g-p-meals',
  gizmo_type: 'snorlax',
  display: { name: 'Meals' },
}

beforeEach(() => pageFetch.mockReset())

describe('ChatGPT Project resource contracts', () => {
  it.each([
    ['direct', { gizmo: project }],
    ['wrapped', { resource: { gizmo: project } }],
  ])('accepts a native Project detail response (%s)', async (_shape, payload) => {
    const apiFetch = vi.fn(async () => Response.json(payload))
    await expect(requireChatgptProject(apiFetch, project.id)).resolves.toEqual(project)
    expect(apiFetch).toHaveBeenCalledWith('/gizmos/' + project.id)
  })

  it.each(['gpt', 'project', undefined])(
    'rejects a non-Project resource type (%s)',
    async (type) => {
      await expect(
        requireChatgptProject(
          async () => Response.json({ gizmo: { ...project, gizmo_type: type } }),
          project.id,
        ),
      ).rejects.toThrow('not an accessible ChatGPT Project')
    },
  )

  it('rejects a different Project returned for the selected ID', async () => {
    await expect(
      requireChatgptProject(async () => Response.json({ gizmo: project }), 'g-p-other'),
    ).rejects.toThrow('not an accessible ChatGPT Project')
  })

  it('preserves access failures from the Project API', async () => {
    await expect(
      requireChatgptProject(async () => new Response('', { status: 403 }), project.id),
    ).rejects.toThrow('HTTP 403')
  })

  it('lists native Projects in both sidebar shapes and excludes other resource types', async () => {
    const second = { ...project, id: 'g-p-second', display: { name: 'Second' } }
    pageFetch.mockResolvedValueOnce(
      Response.json({
        items: [
          { gizmo: { gizmo: project }, conversations: { items: [] } },
          { gizmo: second },
          { gizmo: { ...project, id: 'g-assistant', gizmo_type: 'gpt' } },
          { gizmo: { ...project, id: 'g-p-invalid', gizmo_type: 'project' } },
        ],
        cursor: null,
      }),
    )
    await expect(listChatgptWebProjects()).resolves.toEqual({
      projects: [
        { id: project.id, name: 'Meals' },
        { id: second.id, name: 'Second' },
      ],
      cursor: null,
    })
    const url = new URL(pageFetch.mock.calls[0][0])
    expect(url.pathname).toBe('/backend-api/gizmos/snorlax/sidebar')
    expect(url.searchParams.get('owned_only')).toBe('true')
    expect(url.searchParams.get('conversations_per_gizmo')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('retains native Projects while following the sidebar pagination cursor', async () => {
    pageFetch
      .mockResolvedValueOnce(Response.json({ items: [], cursor: 'next-page' }))
      .mockResolvedValueOnce(
        Response.json({ items: [{ gizmo: { gizmo: project } }], cursor: null }),
      )
    const first = await listChatgptWebProjects()
    const second = await listChatgptWebProjects({ cursor: first.cursor })
    expect(new URL(pageFetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('next-page')
    expect(second).toEqual({ projects: [{ id: project.id, name: 'Meals' }], cursor: null })
  })

  it('allows image preparation after the native Project is verified', async () => {
    const uploadUrl = origin + '/backend-api/estuary/upload_content_bytes?upload_url=signed-photo'
    pageFetch
      .mockResolvedValueOnce(Response.json({ gizmo: project }))
      .mockResolvedValueOnce(Response.json({ file_id: 'file_photo', upload_url: uploadUrl }))
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(
        new Response('data: {"event":"file.processing.file_ready","file_id":"file_photo"}\n\n'),
      )
    await expect(
      uploadChatgptWebImages({
        projectId: project.id,
        images: [
          {
            id: 'image-1',
            name: 'photo.png',
            mimeType: 'image/png',
            base64: 'YWJj',
            sizeBytes: 3,
            width: 1,
            height: 1,
          },
        ],
      }),
    ).resolves.toMatchObject([{ asset_pointer: 'sediment://file_photo', attachmentId: 'image-1' }])
    expect(pageFetch.mock.calls.map(([url]) => url)).toEqual([
      origin + '/backend-api/gizmos/' + project.id,
      origin + '/backend-api/files',
      uploadUrl,
      origin + '/backend-api/files/process_upload_stream',
    ])
  })

  it('rejects a GPT before starting any image upload', async () => {
    pageFetch.mockResolvedValueOnce(Response.json({ gizmo: { ...project, gizmo_type: 'gpt' } }))
    await expect(uploadChatgptWebImages({ projectId: project.id, images: [] })).rejects.toThrow(
      'not an accessible ChatGPT Project',
    )
    expect(pageFetch).toHaveBeenCalledTimes(1)
  })
})
