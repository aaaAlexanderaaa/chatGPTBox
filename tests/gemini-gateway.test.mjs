import { createProviderBridgeFixture } from './helpers/engine-provider-fixture.mjs'
import {
  EngineError,
  serializeEngineError,
  compilePromptTranscript,
} from '../src/engines/contract.mjs'
/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { normalizeGatewayImageMessages } from '../scripts/lib/image-attachments.mjs'
import { normalizeChatgptProjectId } from '../src/services/clients/chatgpt-web/image-content.mjs'
import {
  GEMINI_WEB_MODEL,
  GEMINI_WEB_SELECTION,
  isGeminiWebModel,
} from '../src/config/gemini-web.mjs'

const gateway = fs.readFileSync(new URL('../scripts/api-server.mjs', import.meta.url), 'utf8')
const between = (source, start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const response = () => ({ writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn(), on: vi.fn() })

function completionHandler() {
  const pendingRequests = new Map(),
    send = vi.fn((request) => {
      const pending = pendingRequests.get(request.id)
      pending.onChunk('<p>Verified final answer</p>')
      pending.resolve()
    })
  const context = {
    readBody: async (req) => JSON.stringify(req.body),
    EngineError,
    serializeEngineError,
    compilePromptTranscript,
    sendJson: (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    },
    DEFAULT_MODEL: 'gpt-6-thinking',
    DEFAULT_THINKING_EFFORT: 'extended',
    GEMINI_WEB_MODEL,
    GEMINI_WEB_SELECTION,
    isGeminiWebModel,
    normalizeChatgptProjectId,
    normalizeGatewayImageMessages,
    makeCompletionId: () => 'completion',
    getRequestTimeoutMs: () => 60000,
    SUPPORTED_THINKING_EFFORTS: new Set(['min', 'standard', 'extended', 'xhigh', 'max']),
    isBridgeConnected: () => true,
    stats: { totalRequests: 0, totalErrors: 0 },
    log() {},
    beginWriteOperation: vi.fn(() => ({ record: { operationId: 'operation' } })),
    respondForExistingOperation: () => false,
    sendToBridge: send,
    pendingRequests,
    crypto: { randomUUID: () => 'request' },
    setTimeout,
    clearTimeout,
    operationLedger: { complete: vi.fn() },
  }
  return {
    handler: (body, res) =>
      vm.runInNewContext(
        `${between(
          gateway,
          'async function handleChatCompletions',
          'async function handleModels(res)',
        )}\nhandleChatCompletions`,
        context,
      )({ headers: {}, body }, res),
    context,
    send,
  }
}

describe('Gemini gateway boundary', () => {
  it.each([GEMINI_WEB_MODEL, GEMINI_WEB_SELECTION])(
    'forwards only the explicit Gemini selector %s',
    async (model) => {
      const f = completionHandler(),
        res = response()
      await f.handler(
        {
          model,
          reasoning_effort: 'high',
          messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
        },
        res,
      )
      expect(f.send).toHaveBeenCalledTimes(1)
      expect(f.send).toHaveBeenCalledWith(
        expect.objectContaining({ model, thinkingEffort: 'high', images: [] }),
      )
      expect(JSON.parse(res.end.mock.calls.at(-1)[0]).choices[0].message.content).toBe(
        '<p>Verified final answer</p>',
      )
    },
  )

  it.each([
    { model: 'gemini-unknown' },
    { reasoning_effort: 'low' },
    { thinking_effort: 'extended' },
    { project_id: 'project' },
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          ],
        },
      ],
    },
  ])('rejects unsupported Gemini input before admission: %j', async (override) => {
    const f = completionHandler(),
      res = response()
    await f.handler(
      {
        model: GEMINI_WEB_MODEL,
        messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
        ...override,
      },
      res,
    )
    expect(res.writeHead).toHaveBeenLastCalledWith(400, expect.anything())
    expect(f.context.beginWriteOperation).not.toHaveBeenCalled()
    expect(f.send).not.toHaveBeenCalled()
  })

  it('keeps omitted effort native and leaves standard ChatGPT effort validation intact', async () => {
    const f = completionHandler(),
      res = response()
    await f.handler(
      {
        model: GEMINI_WEB_MODEL,
        messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
      },
      res,
    )
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ thinkingEffort: '' }))
    f.send.mockClear()
    await f.handler(
      {
        model: 'gpt-6-thinking',
        reasoning_effort: 'high',
        messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
      },
      res,
    )
    expect(res.writeHead).toHaveBeenLastCalledWith(400, expect.anything())
    expect(f.send).not.toHaveBeenCalled()
  })

  it('publishes one verified Gemini final snapshot through the common runtime', async () => {
    const f = await createProviderBridgeFixture({ model: GEMINI_WEB_MODEL, engineId: 'geminiweb' })
    expect(f.session.modelName).toBe(GEMINI_WEB_SELECTION)
    expect(f.session.chatgptWebModelSlugOverride).toBeUndefined()
    f.receive({ answer: '<p>Partial</p>' })
    expect(f.wire).toHaveLength(0)
    f.receive({ done: true, outcome: 'completed', finalContent: '<p>Complete</p>' })
    await f.done
    expect(f.wire).toEqual([
      expect.objectContaining({ type: 'done', answer: '<p>Complete</p>', format: 'safe-html' }),
    ])
  })
  it.each(['stopped', 'incomplete', 'failed'])(
    'does not turn %s into a successful API completion',
    async (outcome) => {
      const f = await createProviderBridgeFixture({
        model: GEMINI_WEB_MODEL,
        engineId: 'geminiweb',
      })
      f.receive({ answer: '<p>Partial</p>', done: true, outcome })
      await f.done
      expect(f.wire).toEqual([expect.objectContaining({ type: 'error' })])
    },
  )

  it('requires a fresh config-only Gemini model reply even when ChatGPT/Grok lists are cached', async () => {
    let enabled = true
    const send = vi.fn(async (_action, command) =>
      command.method === 'engines.list'
        ? [{ id: 'geminiweb', route: 'gemini-web', enabled }]
        : { items: [{ id: GEMINI_WEB_MODEL }], source: 'page-check', availability: 'unknown' },
    )
    const handler = vm.runInNewContext(
      `${between(
        gateway,
        'async function handleModels(res)',
        'function handleStatus',
      )}\nhandleModels`,
      {
        sendControlRequestToBridge: send,
        serializeEngineError,
        sendJson: (res, status, body) => {
          res.writeHead(status)
          res.end(JSON.stringify(body))
        },
        log() {},
      },
    )
    const first = response()
    await handler(first)
    expect(JSON.parse(first.end.mock.calls[0][0]).data).toContainEqual(
      expect.objectContaining({ id: GEMINI_WEB_MODEL, owned_by: 'gemini-web' }),
    )
    enabled = false
    const second = response()
    await handler(second)
    expect(
      JSON.parse(second.end.mock.calls[0][0]).data.some((item) => item.id === GEMINI_WEB_MODEL),
    ).toBe(false)
    expect(send.mock.calls.filter(([, command]) => command.method === 'engines.list')).toHaveLength(
      2,
    )
  })
})
