/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
const sources = Object.fromEntries(
  [2, 3, 4].map((n) => [
    n,
    fs.readFileSync(
      new URL(
        `../docs/drafts/action-${n}-${
          { 2: 'open-checked-conversation', 3: 'send-waiting-reply', 4: 'attach-photos' }[n]
        }.js`,
        import.meta.url,
      ),
      'utf8',
    ),
  ]),
)
const photo = {
  id: 'img-' + 'a'.repeat(64),
  name: 'lunch.jpg',
  expiresAt: '2099-01-01',
  path: '/local-photo.json',
}
const photoMarker = (metadata = { images: [photo], pendingPhotos: [], projectId: 'project-1' }) =>
  '<!-- chatgptbox-photos:' + JSON.stringify(metadata) + ' -->'
const note = (query = 'Lunch', metadata = { conversationId: 'conversation-1' }) =>
  '# Prior conversation\n\n## Waiting Reply\n\n<!-- chatgptbox-waiting-reply:start ' +
  JSON.stringify(metadata) +
  ' -->\n' +
  query +
  '\n<!-- chatgptbox-waiting-reply:end -->\n\n' +
  photoMarker()
function run(action, content, responses, extras = {}) {
  const requests = [],
    files = extras.files || new Map()
  const draft = { content, update: vi.fn() },
    app = { displayErrorMessage: vi.fn(), displaySuccessMessage: vi.fn() }
  let error
  try {
    vm.runInNewContext(sources[action], {
      draft,
      app,
      HTTP: {
        create: () => ({
          request: (request) => {
            requests.push(JSON.parse(JSON.stringify(request)))
            const response = responses.shift()
            if (!response) throw new Error('Unexpected HTTP request')
            return response
          },
        }),
      },
      FileManager: {
        createLocal: () => ({
          createDirectory() {},
          readJSON: (path) => files.get(path),
          writeJSON(path, data) {
            files.set(path, data)
            return true
          },
        }),
      },
      HTMLPreview: { create: () => ({ show: () => true }) },
      context: {
        previewValues: {
          chatgptboxPhotos: [{ name: 'lunch.jpg', data_url: 'data:image/jpeg;base64,synthetic' }],
        },
      },
    })
  } catch (caught) {
    error = caught
  }
  return { draft, requests, error, files, app }
}
const ok = (payload, statusCode = 200) => ({ success: true, statusCode, responseData: payload })
const job = (content) =>
  JSON.parse(content.match(/<!-- chatgptbox-photo-operation:(\{.*\}) -->/)[1])
describe('Drafts photo sends', () => {
  it('packages native Script steps using the same action format as the shipped Preview action', () => {
    for (const name of ['attach-photos', 'select-project']) {
      const artifact = JSON.parse(
        fs.readFileSync(
          new URL(`../docs/drafts/chatgptbox-${name}.draftsAction`, import.meta.url),
          'utf8',
        ),
      )
      expect(artifact.steps[0]).toMatchObject({
        type: 'script',
        platforms: 3,
        data: { allowAsync: 'false' },
      })
      expect(artifact.steps[0].data.script).toContain('PASTE_GATEWAY_API_TOKEN_HERE')
      expect(artifact.steps[0].uuid).toMatch(/^[A-F0-9-]{36}$/)
    }
  })
  it('keeps offline photos outside the draft and can retry upload without asking for them again', () => {
    const first = run(4, '', [
      { success: false, statusCode: 503, responseData: { error: { message: 'Gateway offline' } } },
    ])
    expect(first.error.message).toBe('Gateway offline')
    expect(first.files.size).toBe(1)
    expect(first.draft.content).not.toContain('base64')
    expect(first.draft.content).toContain('pendingPhotos')
    const second = run(4, first.draft.content, [ok(photo, 201)], { files: first.files })
    expect(second.error).toBeUndefined()
    expect(second.requests).toHaveLength(1)
    expect(
      JSON.parse(second.draft.content.match(/<!-- chatgptbox-photos:(\{.*\}) -->/)[1])
        .pendingPhotos,
    ).toEqual([])
  })
  it('persists the operation before Send and reuses its exact text, images and Project after a lost response', () => {
    const first = run(3, note(), [
      { success: false, statusCode: 500, responseData: { error: { message: 'Response lost' } } },
    ])
    expect(first.error).toBeDefined()
    const operation = job(first.draft.content)
    expect(operation.request).toMatchObject({
      query: 'Lunch',
      attachments: [photo.id],
      project_id: 'project-1',
      async: true,
    })
    const edited = first.draft.content.replace('\nLunch\n', '\nEdited lunch\n')
    const second = run(3, edited, [ok({ phase: 'uploading' }, 202)])
    expect(second.error).toBeUndefined()
    expect(second.requests[0].headers['Idempotency-Key']).toBe(
      first.requests[0].headers['Idempotency-Key'],
    )
    expect(second.requests[0].data).toEqual(first.requests[0].data)
    expect(second.draft.content).toContain('Edited lunch')
  })
  it('Get checks upload status before a conversation ID exists and keeps the draft intact', () => {
    const sent = run(3, 'Lunch\n\n' + photoMarker(), [ok({ phase: 'uploading' }, 202)])
    const fetched = run(2, sent.draft.content, [ok({ phase: 'uploading', uploadedCount: 0 })])
    expect(fetched.error).toBeUndefined()
    expect(fetched.requests).toHaveLength(1)
    expect(fetched.requests[0].url).toContain('/chatgpt/operations/')
    expect(job(fetched.draft.content).id).toBe(job(sent.draft.content).id)
    expect(fetched.draft.content).toContain('Lunch')
  })
  it('Get transfers an accepted send to the exact message anchor and preserves newly edited text', () => {
    const sent = run(3, note(), [ok({ phase: 'uploading' }, 202)])
    const edited = sent.draft.content.replace('\nLunch\n', '\nNext question\n')
    const result = {
      conversationId: 'conversation-1',
      messageId: 'photo-message',
      query: 'Lunch',
      attachments: [photo.id],
      projectId: 'project-1',
    }
    const fetched = run(2, edited, [
      ok({ phase: 'accepted', result }),
      ok({ conversationId: 'conversation-1', pending: true, messages: [] }),
    ])
    expect(fetched.error).toBeUndefined()
    expect(fetched.requests[1].url).toContain('user_message_id=photo-message')
    expect(fetched.draft.content).toContain('Next question')
    expect(fetched.draft.content).toContain('"pendingMessageId":"photo-message"')
    expect(fetched.draft.content).not.toContain('chatgptbox-photo-operation:')
    expect(
      JSON.parse(fetched.draft.content.match(/<!-- chatgptbox-photos:(\{.*\}) -->/)[1]).images,
    ).toEqual([])
  })
  it('Get preserves an uncertain send and never dispatches it again', () => {
    const sent = run(3, note(), [ok({ phase: 'sending' }, 202)])
    const fetched = run(2, sent.draft.content, [
      ok({ phase: 'ambiguous', dispatched: true, retryable: false }),
    ])
    expect(fetched.requests).toHaveLength(1)
    expect(fetched.requests[0].method).toBe('GET')
    expect(job(fetched.draft.content).id).toBe(job(sent.draft.content).id)
  })
  it('a normal Get preserves photos attached to the next unsent question', () => {
    const fetched = run(2, note('Next lunch'), [
      ok({ conversationId: 'conversation-1', pending: false, messages: [] }),
    ])
    expect(fetched.error).toBeUndefined()
    expect(fetched.draft.content).toContain(photo.id)
    expect(fetched.draft.content).toContain('Next lunch')
  })
})
