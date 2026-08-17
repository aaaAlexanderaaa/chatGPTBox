/* eslint-env node */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

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
  it('does not require custom headers from standard OpenAI clients', () => {
    const handler = sourceBetween(
      gatewaySource,
      'async function handleChatCompletions',
      'let cachedModels',
    )

    expect(handler).toContain("beginWriteOperation(req, '/v1/chat/completions', body)")
    expect(handler).not.toContain('requireIdempotencyKey: true')
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
    expect(createHandler).toContain('isGrokWebPrePostControlError')
    expect(messageHandler).toContain('result?.dispatched === false')
    expect(messageHandler).toContain('respondGrokNotDispatched')
    expect(messageHandler).toContain('isGrokWebPrePostControlError')
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
})
