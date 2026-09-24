/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { getChatgptWebThinkingEffortOverride } from '../src/services/clients/chatgpt-web/thinking.mjs'

const gatewaySource = fs.readFileSync(new URL('../scripts/api-server.mjs', import.meta.url), 'utf8')
const bridgePageSource = fs.readFileSync(
  new URL('../src/pages/ApiServer/App.jsx', import.meta.url),
  'utf8',
)
const draftsWriteClientSource = fs.readFileSync(
  new URL('../docs/drafts/action-3-send-waiting-reply.js', import.meta.url),
  'utf8',
)

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  return source.slice(startIndex, endIndex)
}

describe('API gateway compatibility contract', () => {
  it.each([
    [
      'handleChatgptConversationCreate',
      'handleChatgptConversationGet',
      'chatgpt_web_create_conversation',
    ],
    [
      'handleChatgptConversationMessage',
      'handleGrokConversationList',
      'chatgpt_web_send_conversation_message',
    ],
  ])(
    '%s forwards thinking effort and rejects invalid values before dispatch',
    async (name, next, action) => {
      // Run the actual handler with an in-memory bridge; no account or listening port is needed.
      const send = vi.fn(async () => ({ conversationId: 'conversation-1' }))
      const begin = vi.fn(() => ({ record: { operationId: 'operation-1' } }))
      const handler = vm.runInNewContext(
        `${sourceBetween(
          gatewaySource,
          `async function ${name}`,
          `async function ${next}`,
        )}\n${name}`,
        {
          getChatgptWebThinkingEffortOverride,
          isBridgeConnected: () => true,
          readBodyObject: async (body) => body,
          beginWriteOperation: begin,
          respondForControlWriteOperation: () => false,
          sendControlRequestToBridge: send,
          bridgeRuntimeConfig: { requestTimeoutMs: 60_000 },
          operationLedger: { complete() {} },
        },
      )
      const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
      for (const key of ['thinking_effort', 'reasoning_effort', 'thinkingEffort']) {
        await handler(
          { query: 'test', model: 'gpt-5-6-thinking', [key]: 'max' },
          res,
          'conversation-1',
        )
        expect(send).toHaveBeenLastCalledWith(
          action,
          expect.objectContaining({
            model: 'gpt-5-6-thinking',
            thinkingEffort: 'max',
            query: 'test',
          }),
          60_000,
        )
        expect(res.writeHead).toHaveBeenLastCalledWith(200, expect.anything())
      }
      send.mockClear()
      begin.mockClear()
      await handler({ query: 'test', thinking_effort: 'invalid' }, res, 'conversation-1')
      expect(res.writeHead).toHaveBeenLastCalledWith(400, expect.anything())
      expect(send).not.toHaveBeenCalled()
      expect(begin).not.toHaveBeenCalled()
    },
  )

  it('does not require custom headers from standard OpenAI clients', () => {
    const handler = sourceBetween(
      gatewaySource,
      'async function handleChatCompletions',
      'let cachedModels',
    )

    expect(handler).toContain("beginWriteOperation(req, '/v1/chat/completions', body)")
    expect(handler).not.toContain('requireIdempotencyKey: true')
  })

  it('reports post-dispatch /v1 non-stream failures as ambiguous_dispatch and disables SDK retries', () => {
    const handler = sourceBetween(
      gatewaySource,
      'async function handleChatCompletions',
      'let cachedModels',
    )

    expect(handler).not.toContain('requireIdempotencyKey: true')
    expect(handler).toContain("setHeader('x-should-retry', 'false')")

    const catchBlock = handler.slice(handler.lastIndexOf('} catch (err) {'))
    expect(catchBlock).toContain('makeAmbiguousDispatchError')
    expect(catchBlock).toContain('writeHead(409')
    expect(catchBlock).not.toContain('writeHead(500')
  })

  it('requires idempotency keys only on custom conversation write endpoints', () => {
    const createHandler = sourceBetween(
      gatewaySource,
      'async function handleChatgptConversationCreate',
      'async function handleChatgptConversationGet',
    )
    const messageHandler = sourceBetween(
      gatewaySource,
      'async function handleChatgptConversationMessage',
      '// ---------------------------------------------------------------------------\n// HTTP polling bridge endpoints',
    )

    expect(createHandler).toContain('requireIdempotencyKey: true')
    expect(messageHandler).toContain('requireIdempotencyKey: true')
    expect(gatewaySource).toContain('idempotency_key_required')
  })

  it('implements the custom conversation idempotency contract in the Drafts client', () => {
    expect(draftsWriteClientSource).toContain("'Idempotency-Key': idempotencyKey")
    expect(draftsWriteClientSource).toContain('prepareNewConversationOperation(noteContent)')
    expect(draftsWriteClientSource).toContain(
      "persistWaitingReplyOperation(draft.content || '', waitingReply)",
    )
  })

  it('only retries read-only bridge control actions', () => {
    const retryableActions = bridgePageSource.match(
      /const RETRYABLE_CONTROL_ACTIONS = new Set\(\[([\s\S]*?)\]\)/,
    )?.[1]

    expect(retryableActions).toContain('ListConversations')
    expect(retryableActions).toContain('GetConversation')
    expect(retryableActions).toContain('ListModels')
    expect(retryableActions).not.toContain('CreateConversation')
    expect(retryableActions).not.toContain('SendConversationMessage')
    expect(retryableActions).not.toContain('RefreshConversation')
    expect(retryableActions).not.toContain('SyncConversations')
  })

  it('does not mark Grok pre-POST failures as ambiguous_dispatch', () => {
    const createHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationCreate',
      'async function handleGrokConversationMessage',
    )
    const messageHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationMessage',
      '// ---------------------------------------------------------------------------\n// HTTP polling bridge endpoints',
    )
    expect(createHandler).toContain('result?.dispatched === false')
    expect(createHandler).toContain('respondGrokNotDispatched')
    expect(createHandler).toContain('respondGrokWriteFailure')
    expect(messageHandler).toContain('result?.dispatched === false')
    expect(messageHandler).toContain('respondGrokNotDispatched')
    expect(messageHandler).toContain('respondGrokWriteFailure')
    expect(gatewaySource).toContain('isGrokWebPrePostControlError')
    expect(messageHandler.indexOf('previousResponseID is required')).toBeGreaterThan(-1)
    expect(messageHandler.indexOf('previousResponseID is required')).toBeLessThan(
      messageHandler.indexOf('beginWriteOperation'),
    )
    expect(gatewaySource).toContain('function respondGrokNotDispatched')
    expect(gatewaySource).toContain('operationLedger.abort')
    expect(gatewaySource).toContain('grokPrePostRetryable')
  })

  it('caches live /v1/models lists only (not AVAILABLE_MODELS fallback)', () => {
    const handleModels = sourceBetween(
      gatewaySource,
      'async function handleModels(res)',
      'function handleStatus(res)',
    )

    expect(handleModels).toContain('fromLiveChatgpt = true')
    expect(handleModels).toMatch(
      /if \(fromLiveChatgpt\) \{[\s\S]*?cachedModels = models[\s\S]*?cachedModelsAt = Date\.now\(\)/,
    )
    const fallbackIdx = handleModels.indexOf('AVAILABLE_MODELS.map')
    const cacheGuardIdx = handleModels.indexOf('if (fromLiveChatgpt)')
    const cacheAssignIdx = handleModels.indexOf('cachedModels = models')
    expect(fallbackIdx).toBeGreaterThan(-1)
    expect(cacheGuardIdx).toBeGreaterThan(fallbackIdx)
    expect(cacheAssignIdx).toBeGreaterThan(cacheGuardIdx)
  })

  it('replaces cached Grok slugs when the live list is empty (signed out)', () => {
    const handleModels = sourceBetween(
      gatewaySource,
      'async function handleModels(res)',
      'function handleStatus(res)',
    )

    const emptyListIdx = handleModels.indexOf('if (Array.isArray(grokSlugs))')
    const cacheAssignIdx = handleModels.indexOf('cachedGrokModels = grokSlugs.filter')
    expect(emptyListIdx).toBeGreaterThan(-1)
    expect(cacheAssignIdx).toBeGreaterThan(emptyListIdx)
    expect(handleModels).not.toContain('grokSlugs.length > 0')
  })

  it('maps post-dispatch Grok 429 to HTTP 429 instead of ambiguous_dispatch', () => {
    const createHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationCreate',
      'async function handleGrokConversationMessage',
    )
    const messageHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationMessage',
      '// ---------------------------------------------------------------------------\n// HTTP polling bridge endpoints',
    )

    expect(gatewaySource).toContain('function respondGrokWriteFailure')
    expect(gatewaySource).toContain('isGrokWebRateLimitError')
    expect(createHandler).toContain('respondGrokWriteFailure')
    expect(messageHandler).toContain('respondGrokWriteFailure')

    const helper = sourceBetween(
      gatewaySource,
      'function respondGrokWriteFailure',
      'function markOperationAmbiguous',
    )
    expect(helper).toContain('writeHead(429')
    expect(helper).toContain('isGrokWebRateLimitError')
    expect(helper.indexOf('writeHead(429')).toBeLessThan(helper.indexOf('writeHead(409'))
  })

  it('retries Grok slugs after a ChatGPT model-list cache hit', () => {
    const handleModels = sourceBetween(
      gatewaySource,
      'async function handleModels(res)',
      'function handleStatus(res)',
    )

    expect(handleModels).toContain('cachedGrokModels')
    expect(handleModels).toContain('grokModelsReady')
    const cacheHitIdx = handleModels.indexOf('models = cachedModels')
    const grokFetchIdx = handleModels.indexOf("sendControlRequestToBridge('grok_web_list_models'")
    const uncachedChatgptIdx = handleModels.indexOf('if (!models)')
    expect(cacheHitIdx).toBeGreaterThan(-1)
    expect(grokFetchIdx).toBeGreaterThan(-1)
    expect(uncachedChatgptIdx).toBeGreaterThan(-1)
    expect(grokFetchIdx).toBeGreaterThan(uncachedChatgptIdx)
  })

  it('maps a null Grok conversation GET to 502 like list and refresh', () => {
    const getHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationGet',
      'async function handleGrokConversationRefresh',
    )
    expect(getHandler).toContain('if (result == null)')
    expect(getHandler).toContain("res.writeHead(502, { 'Content-Type': 'application/json' })")
    expect(getHandler).toContain('Grok conversation get returned null')
    expect(getHandler.indexOf('if (result == null)')).toBeLessThan(
      getHandler.indexOf('writeHead(200'),
    )
  })

  it('maps a null Grok conversation refresh to 502 like GET and list', () => {
    const refreshHandler = sourceBetween(
      gatewaySource,
      'async function handleGrokConversationRefresh',
      'async function handleGrokConversationCreate',
    )
    expect(refreshHandler).toContain('if (result == null)')
    expect(refreshHandler).toContain("res.writeHead(502, { 'Content-Type': 'application/json' })")
    expect(refreshHandler).toContain('Grok conversation refresh returned null')
    expect(refreshHandler.indexOf('if (result == null)')).toBeLessThan(
      refreshHandler.indexOf('writeHead(200'),
    )
  })

  it('points Grok control no-response errors at grok.com', () => {
    expect(bridgePageSource).toContain('GROK_PROXY_CONTROL_ACTIONS.has(action)')
    expect(bridgePageSource).toContain("? 'grok.com' : 'chatgpt.com'")
  })
})
