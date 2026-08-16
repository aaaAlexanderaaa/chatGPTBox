import { describe, expect, it } from 'vitest'
import {
  grokWriteOperationPath,
  matchGrokConversationRoute,
} from '../scripts/lib/grok-conversation-routes.mjs'

describe('matchGrokConversationRoute', () => {
  it('matches grok paths only', () => {
    expect(matchGrokConversationRoute('/grok/conversations')).toEqual({ kind: 'collection' })
    expect(matchGrokConversationRoute('/grok/conversations/abc')).toEqual({
      kind: 'item',
      id: 'abc',
    })
    expect(matchGrokConversationRoute('/grok/conversations/abc/messages')).toEqual({
      kind: 'messages',
      id: 'abc',
    })
    expect(matchGrokConversationRoute('/grok/conversations/abc/refresh')).toEqual({
      kind: 'refresh',
      id: 'abc',
    })
    expect(matchGrokConversationRoute('/chatgpt/conversations')).toBeNull()
    expect(matchGrokConversationRoute('/v1/chat/completions')).toBeNull()
  })
})

describe('grokWriteOperationPath', () => {
  it('returns ledger paths that cannot collide with /chatgpt/', () => {
    expect(grokWriteOperationPath('collection')).toBe('/grok/conversations')
    expect(grokWriteOperationPath('create')).toBe('/grok/conversations')
    expect(grokWriteOperationPath('messages')).toBe('/grok/conversations/:id/messages')
    expect(grokWriteOperationPath('messages', 'abc')).toBe('/grok/conversations/abc/messages')
  })
})
