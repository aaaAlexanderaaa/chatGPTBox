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
  expiresAt: '2099-01-01T00:00:00.000Z',
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
    const runtime = vm.createContext({
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
    if (extras.dateSetup) vm.runInContext(extras.dateSetup, runtime)
    vm.runInContext(sources[action], runtime)
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
  it.each([false, true])(
    'sends and retries a Project message when the Drafts date parser returns null (photos=%s)',
    (hasPhotos) => {
      const content =
        'Lunch\n\n' +
        photoMarker({
          images: hasPhotos ? [photo] : [],
          pendingPhotos: [],
          projectId: 'g-p-synthetic',
        })
      const extras = { dateSetup: 'Date.parse = () => null' }
      const first = run(3, content, [ok({ phase: 'preparing' }, 202)], extras)
      expect(first.error).toBeUndefined()
      expect(first.requests).toHaveLength(1)
      expect(first.requests[0]).toMatchObject({
        method: 'POST',
        data: {
          query: 'Lunch',
          project_id: 'g-p-synthetic',
          attachments: hasPhotos ? [photo.id] : [],
        },
      })
      const retry = run(3, first.draft.content, [ok({ phase: 'uploading' }, 202)], extras)
      expect(retry.error).toBeUndefined()
      expect(retry.requests).toHaveLength(1)
      expect(retry.requests[0]).toEqual(first.requests[0])
      expect(job(retry.draft.content)).toEqual(job(first.draft.content))
    },
  )
  it('refreshes an expired photo even when the Drafts date parser returns null', () => {
    const expiredPhoto = { ...photo, expiresAt: '2000-01-01T00:00:00.000Z' }
    const result = run(
      3,
      'Lunch\n\n' + photoMarker({ images: [expiredPhoto], pendingPhotos: [] }),
      [ok(photo, 201), ok({ phase: 'preparing' }, 202)],
      {
        dateSetup: 'Date.parse = () => null',
        files: new Map([[photo.path, { name: photo.name, data_url: 'synthetic' }]]),
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/chatgpt/attachments',
      '/chatgpt/conversations',
    ])
    expect(result.requests[1].data.attachments).toEqual([photo.id])
  })
  it.each(['2000-01-01T00:00:00.000Z', 'invalid', null])(
    'preserves the send ID and prevents replay for an old or invalid saved time (%s)',
    (createdAt) => {
      const sent = run(3, 'Lunch\n\n' + photoMarker(), [ok({ phase: 'sending' }, 202)])
      const operation = { ...job(sent.draft.content), createdAt }
      const content = sent.draft.content.replace(
        /<!-- chatgptbox-photo-operation:(\{.*\}) -->/,
        '<!-- chatgptbox-photo-operation:' + JSON.stringify(operation) + ' -->',
      )
      const retry = run(3, content, [], { dateSetup: 'Date.parse = () => null' })
      expect(retry.error).toBeDefined()
      expect(retry.error.message).toMatch(/recovery window|saved send time/i)
      expect(retry.requests).toEqual([])
      expect(job(retry.draft.content)).toEqual(operation)
    },
  )
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
  it.each([false, true])(
    'Get recovers the exact submitted photo turn after a lost acknowledgement (pending=%s)',
    (pending) => {
      const sent = run(3, note(), [ok({ phase: 'sending' }, 202)])
      const edited = sent.draft.content.replace('\nLunch\n', '\nNext meal\n')
      const fetched = run(2, edited, [
        ok({
          phase: 'ambiguous',
          operationId: 'photo-message',
          dispatched: true,
          retryable: false,
        }),
        ok({
          conversationId: 'conversation-1',
          pending,
          messages: [
            { role: 'user', messageId: 'photo-message', text: 'Lunch' },
            ...(!pending
              ? [{ role: 'assistant', messageId: 'answer-1', text: 'Meal analysis', isFinal: true }]
              : []),
          ],
        }),
      ])
      expect(fetched.error).toBeUndefined()
      expect(fetched.requests).toHaveLength(2)
      expect(fetched.requests.every((request) => request.method === 'GET')).toBe(true)
      const target = new URL(fetched.requests[1].url)
      expect(target.pathname).toBe('/chatgpt/conversations/conversation-1')
      expect(target.searchParams.get('user_message_id')).toBe('photo-message')
      expect(target.searchParams.get('force_refresh')).toBe('true')
      expect(fetched.draft.content).not.toContain('chatgptbox-photo-operation:')
      expect(fetched.draft.content).toContain('Next meal')
      const metadata = JSON.parse(
        fetched.draft.content.match(/<!-- chatgptbox-photos:(\{.*\}) -->/)[1],
      )
      expect(metadata.images).toEqual([])
      expect(metadata.projectId).toBe('project-1')
      if (pending) {
        expect(fetched.draft.content).toContain('"pendingMessageId":"photo-message"')
        expect(fetched.draft.content).toContain('### ASSISTANT (pending)')
      } else {
        expect(fetched.draft.content).toContain('Meal analysis')
        expect(fetched.draft.content).not.toContain('pendingMessageId')
      }
    },
  )
  it.each(['same-text-old-turn', 'wrong-conversation', 'read-failed'])(
    'keeps the uncertain operation when recovery cannot confirm its exact turn (%s)',
    (scenario) => {
      const sent = run(3, note(), [ok({ phase: 'sending' }, 202)])
      const response =
        scenario === 'read-failed'
          ? { success: false, statusCode: 503, responseData: { error: { message: 'Read failed' } } }
          : ok({
              conversationId:
                scenario === 'wrong-conversation' ? 'conversation-2' : 'conversation-1',
              pending: false,
              messages: [
                {
                  role: 'user',
                  messageId: scenario === 'wrong-conversation' ? 'photo-message' : 'old-message',
                  text: 'Lunch',
                },
                { role: 'assistant', text: 'Old answer', isFinal: true },
              ],
            })
      const fetched = run(2, sent.draft.content, [
        ok({ phase: 'ambiguous', operationId: 'photo-message', dispatched: true }),
        response,
      ])
      expect(fetched.requests).toHaveLength(2)
      expect(fetched.requests.every((request) => request.method === 'GET')).toBe(true)
      expect(job(fetched.draft.content)).toEqual(job(sent.draft.content))
      expect(fetched.draft.content).toContain(photo.id)
      expect(fetched.draft.content).not.toContain('Old answer')
    },
  )
  it('keeps a new-conversation send protected when no conversation ID is known', () => {
    const sent = run(3, 'Lunch\n\n' + photoMarker(), [ok({ phase: 'sending' }, 202)])
    const fetched = run(2, sent.draft.content, [
      ok({ phase: 'ambiguous', operationId: 'photo-message', dispatched: true }),
    ])
    expect(fetched.error).toBeUndefined()
    expect(fetched.requests).toHaveLength(1)
    expect(job(fetched.draft.content)).toEqual(job(sent.draft.content))
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
