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
import { GeminiProxyControlAction } from '../src/protocol/messages.mjs'
import {
  isGeminiEngineKey,
  isGrokEngineKey,
  slugToModelKey,
} from '../src/pages/ApiServer/model-slug.mjs'

const gateway = fs.readFileSync(new URL('../scripts/api-server.mjs', import.meta.url), 'utf8')
const bridge = fs.readFileSync(new URL('../src/pages/ApiServer/App.jsx', import.meta.url), 'utf8')
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
    readBody: async (body) => JSON.stringify(body),
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
    handler: vm.runInNewContext(
      `${between(
        gateway,
        'async function handleChatCompletions',
        'let cachedModels',
      )}\nhandleChatCompletions`,
      context,
    ),
    context,
    send,
  }
}

function bridgeHandler() {
  let receive
  const port = {
    onMessage: {
      addListener(fn) {
        receive = fn
      },
    },
    onDisconnect: { addListener() {} },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  }
  const context = {
    slugToModelKey,
    isGeminiEngineKey,
    isGrokEngineKey,
    modelNameToApiMode: () => null,
    needsChatgptWebThinkingEffort: vi.fn(),
    findStoredChatgptWebApiThreadContinuation: vi.fn(),
    getUserConfig: async () => ({ apiServerKeepHistory: false }),
    initSession: (data) => ({ sessionId: 'local', ...data }),
    Browser: { runtime: { connect: () => port, sendMessage: vi.fn() } },
    sendWs: vi.fn(),
    addLog() {},
    setRequestCount() {},
    saveChatgptWebSessionSnapshot: vi.fn(),
    saveChatgptWebApiThread: vi.fn(),
  }
  const callback = between(
    bridge.slice(bridge.indexOf('const handleRequest = useCallback(')),
    'async (data) => {',
    ',\n    [addLog, sendWs]',
  )
  const handler = vm.runInNewContext(
    `${between(
      bridge,
      'function formatMessages',
      'function buildBridgeWsUrl',
    )}\n(${callback.trim()})`,
    context,
  )
  return { handler, port, context, receive: (packet) => receive(packet) }
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

  it('publishes one verified Gemini final snapshot without ChatGPT uploads/history/snapshots', async () => {
    const f = bridgeHandler()
    await f.handler({
      id: 'request-1234',
      model: GEMINI_WEB_MODEL,
      messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
    })
    const session = f.port.postMessage.mock.calls[0][0].session
    expect(session.modelName).toBe(GEMINI_WEB_SELECTION)
    expect(session).not.toHaveProperty('chatgptWebHistoryDisabledOverride')
    expect(session).not.toHaveProperty('chatgptWebModelSlugOverride')
    f.receive({ answer: '<p>Partial</p>', session: { conversationId: 'native' } })
    expect(f.context.sendWs).not.toHaveBeenCalled()
    f.receive({ done: true, outcome: 'completed', finalContent: '<p>Complete</p>' })
    expect(f.context.sendWs.mock.calls.map(([packet]) => packet)).toEqual([
      { type: 'chunk', id: 'request-1234', answer: '<p>Complete</p>' },
      { type: 'done', id: 'request-1234', answer: '<p>Complete</p>' },
    ])
    expect(f.context.Browser.runtime.sendMessage).not.toHaveBeenCalled()
    expect(f.context.saveChatgptWebSessionSnapshot).not.toHaveBeenCalled()
    expect(f.context.saveChatgptWebApiThread).not.toHaveBeenCalled()
    expect(f.context.findStoredChatgptWebApiThreadContinuation).not.toHaveBeenCalled()
  })

  it.each(['stopped', 'incomplete', 'failed'])(
    'does not turn %s into a successful API completion',
    async (outcome) => {
      const f = bridgeHandler()
      await f.handler({
        id: 'request',
        model: GEMINI_WEB_MODEL,
        messages: [{ role: 'user', content: 'Explain a reversible migration.' }],
      })
      f.receive({ answer: '<p>Partial</p>', done: true, outcome })
      expect(f.context.sendWs).toHaveBeenCalledTimes(1)
      expect(f.context.sendWs.mock.calls[0][0].type).toBe('error')
    },
  )

  it('requires a fresh config-only Gemini model reply even when ChatGPT/Grok lists are cached', async () => {
    let enabled = true
    const send = vi.fn(async (action) =>
      action === GeminiProxyControlAction.ListModels
        ? enabled
          ? [GEMINI_WEB_MODEL]
          : []
        : ['gpt-6-thinking'],
    )
    const handler = vm.runInNewContext(
      `${between(gateway, 'let cachedModels =', 'function handleStatus')}\nhandleModels`,
      {
        isBridgeConnected: () => true,
        sendControlRequestToBridge: send,
        GeminiProxyControlAction,
        isGeminiWebModel,
        AVAILABLE_MODELS: [],
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
    expect(
      send.mock.calls.filter(([action]) => action === GeminiProxyControlAction.ListModels),
    ).toHaveLength(2)
  })
})
