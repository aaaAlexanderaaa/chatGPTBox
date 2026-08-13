import { describe, expect, it } from 'vitest'
import {
  CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS,
  isChatgptWebThinkingModelSlug,
  needsChatgptWebThinkingEffort,
  requiresChatgptWebExtendedThinkingEffort,
} from '../src/services/clients/chatgpt-web/thinking.mjs'
import {
  extractChatgptWebMessageText,
  flattenChatgptWebMessageText,
  isFinalChatgptWebMessageStatus,
  isPendingChatgptWebConversation,
  isPendingChatgptWebMessageStatus,
  selectChatgptWebRefreshResult,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import {
  isChatgptWebConversationSnapshotStale,
  normalizeChatgptWebConversationIndexEntry,
} from '../src/services/clients/chatgpt-web/conversation-cache.mjs'

// These are the pure helpers under clients/chatgpt-web/ — parsing,
//classification, and cache-shape logic that has no unit coverage otherwise.
// The websocket singleton and network paths are intentionally not tested here.

describe('chatgpt-web thinking predicates', () => {
  it('flags slugs ending in -thinking', () => {
    expect(isChatgptWebThinkingModelSlug('gpt-5-5-thinking')).toBe(true)
    expect(isChatgptWebThinkingModelSlug('GPT-5-5-THINKING')).toBe(true) // case-insensitive
    expect(isChatgptWebThinkingModelSlug('gpt-5-5-pro')).toBe(false)
  })

  it('needsChatgptWebThinkingEffort includes -thinking AND the extra set', () => {
    expect(needsChatgptWebThinkingEffort('gpt-5-4-thinking')).toBe(true)
    expect(needsChatgptWebThinkingEffort('gpt-5-5-pro')).toBe(true) // in EXTRA set
    expect(needsChatgptWebThinkingEffort('gpt-5-4')).toBe(false)
  })

  it('requiresChatgptWebExtendedThinkingEffort is true only for the extra set', () => {
    for (const slug of CHATGPT_WEB_EXTRA_THINKING_EFFORT_MODEL_SLUGS) {
      expect(requiresChatgptWebExtendedThinkingEffort(slug)).toBe(true)
    }
    // a plain -thinking model is NOT in the extended set
    expect(requiresChatgptWebExtendedThinkingEffort('gpt-5-4-thinking')).toBe(false)
  })

  it('handles non-string / empty input without throwing', () => {
    expect(isChatgptWebThinkingModelSlug(undefined)).toBe(false)
    expect(needsChatgptWebThinkingEffort(null)).toBe(false)
    expect(requiresChatgptWebExtendedThinkingEffort('')).toBe(false)
  })
})

describe('chatgpt-web message text extraction', () => {
  it('flattens a content.parts array of strings', () => {
    expect(flattenChatgptWebMessageText({ parts: ['hello ', 'world'] })).toBe('hello world')
  })

  it('flattens nested parts recursively', () => {
    expect(flattenChatgptWebMessageText({ parts: ['a', { parts: ['b', 'c'] }, 'd'] })).toBe('abcd')
  })

  it('returns empty string for null/non-object content', () => {
    expect(flattenChatgptWebMessageText(null)).toBe('')
    expect(flattenChatgptWebMessageText('string')).toBe('')
    expect(flattenChatgptWebMessageText({})).toBe('') // no parts
  })

  it('extractChatgptWebMessageText strips citation tokens', () => {
    // The \uE200cite\uE202...\uE201 token is an internal ChatGPT citation marker.
    const message = {
      content: { parts: ['Hello \uE200cite\uE202some-cite\uE201 world'] },
    }
    expect(extractChatgptWebMessageText(message)).toBe('Hello  world')
  })

  it('extractChatgptWebMessageText returns empty for falsy input', () => {
    expect(extractChatgptWebMessageText(null)).toBe('')
    expect(extractChatgptWebMessageText(undefined)).toBe('')
  })
})

describe('chatgpt-web message status predicates', () => {
  it('recognizes pending statuses (case-insensitive)', () => {
    expect(isPendingChatgptWebMessageStatus('in_progress')).toBe(true)
    expect(isPendingChatgptWebMessageStatus('STREAMING')).toBe(true)
    expect(isPendingChatgptWebMessageStatus('queued')).toBe(true)
  })

  it('rejects non-pending statuses', () => {
    expect(isPendingChatgptWebMessageStatus('finished_successfully')).toBe(false)
    expect(isPendingChatgptWebMessageStatus('')).toBe(false)
    expect(isPendingChatgptWebMessageStatus(undefined)).toBe(false)
  })

  it('recognizes final statuses', () => {
    expect(isFinalChatgptWebMessageStatus('finished_successfully')).toBe(true)
    expect(isFinalChatgptWebMessageStatus('completed')).toBe(true)
    expect(isFinalChatgptWebMessageStatus('complete')).toBe(true)
  })

  it('pending and final are mutually exclusive', () => {
    const all = ['in_progress', 'finished_successfully', 'completed', 'streaming']
    for (const s of all) {
      expect(isPendingChatgptWebMessageStatus(s) && isFinalChatgptWebMessageStatus(s)).toBe(false)
    }
  })
})

describe('isPendingChatgptWebConversation', () => {
  it('is pending when asyncStatus field is present', () => {
    expect(isPendingChatgptWebConversation({ asyncStatus: 'in_progress' })).toBe(true)
    expect(isPendingChatgptWebConversation({ async_status: 'queued' })).toBe(true)
  })

  it('is not pending when asyncStatus is null/undefined', () => {
    expect(isPendingChatgptWebConversation({ asyncStatus: null })).toBe(false)
    expect(isPendingChatgptWebConversation({ title: 'real title' })).toBe(false)
  })

  it('treats an untitled "new chat" as pending only when allowUntitledListItem', () => {
    const newChat = { title: 'New Chat' }
    expect(isPendingChatgptWebConversation(newChat)).toBe(false)
    expect(isPendingChatgptWebConversation(newChat, { allowUntitledListItem: true })).toBe(true)
  })

  it('returns false for non-object input', () => {
    expect(isPendingChatgptWebConversation(null)).toBe(false)
    expect(isPendingChatgptWebConversation(undefined)).toBe(false)
  })
})

describe('selectChatgptWebRefreshResult', () => {
  it('prefers resume text when the resume message id differs from conversation', () => {
    // A differing message id signals the resume is a newer/regenerated message.
    const conversation = { message: { text: 'conv-answer', messageId: 'm1' }, pending: false }
    const resume = { message: { text: 'resume-answer', id: 'm2' } }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('resume-answer')
  })

  it('prefers conversation text when ids match and not pending', () => {
    const conversation = { message: { text: 'conv-answer', messageId: 'm1' }, pending: false }
    const resume = { message: { text: 'resume-answer', id: 'm1' } }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('conv-answer')
    expect(result.pending).toBe(false)
  })

  it('prefers resume text when conversation is pending', () => {
    const conversation = { message: { text: '', messageId: 'm1' }, pending: true }
    const resume = { message: { text: 'resume-answer', isFinal: true }, pending: false }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('resume-answer')
    expect(result.pending).toBe(false)
  })

  it('prefers resume text when resume message is final', () => {
    const conversation = { message: { text: 'partial', messageId: 'm1' }, pending: true }
    const resume = { message: { text: 'complete', isFinal: true }, pending: false }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('complete')
  })

  it('falls back to resume text when conversation text is empty', () => {
    const conversation = { message: { text: '' } }
    const resume = { message: { text: 'fallback' } }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('fallback')
  })

  it('does not replace conversation text with an incomplete resume stream', () => {
    const conversation = { message: { text: 'safe snapshot' }, pending: false }
    const resume = {
      completed: false,
      message: { text: 'truncated delta', isFinal: true },
      pending: false,
    }
    expect(selectChatgptWebRefreshResult(conversation, resume).text).toBe('safe snapshot')
  })

  it('does not expose truncated resume text when no conversation snapshot exists', () => {
    const conversation = { message: { text: '' }, pending: true }
    const resume = {
      completed: false,
      message: { text: 'truncated delta', isFinal: true },
      pending: false,
    }
    const result = selectChatgptWebRefreshResult(conversation, resume)
    expect(result.text).toBe('')
    expect(result.pending).toBe(true)
  })
})

describe('normalizeChatgptWebConversationIndexEntry', () => {
  it('normalizes a raw item with id and title', () => {
    const entry = normalizeChatgptWebConversationIndexEntry({
      id: 'conv-1',
      title: 'My Chat',
      create_time: 1700000000,
      update_time: 1700000100,
    })
    expect(entry).not.toBeNull()
    expect(entry.id).toBe('conv-1')
    expect(entry.title).toBe('My Chat')
    expect(entry.pending).toBe(false)
  })

  it('accepts conversation_id as an alternative id field', () => {
    const entry = normalizeChatgptWebConversationIndexEntry({ conversation_id: 'conv-2' })
    expect(entry.id).toBe('conv-2')
  })

  it('returns null when no id is present', () => {
    expect(normalizeChatgptWebConversationIndexEntry({ title: 'no id' })).toBeNull()
    expect(normalizeChatgptWebConversationIndexEntry({})).toBeNull()
    expect(normalizeChatgptWebConversationIndexEntry(null)).toBeNull()
  })

  it('preserves firstSeenAt/snapshotCachedAt from an existing entry', () => {
    const existing = { firstSeenAt: '2024-01-01', snapshotCachedAt: '2024-01-02' }
    const entry = normalizeChatgptWebConversationIndexEntry({ id: 'c1' }, existing)
    expect(entry.firstSeenAt).toBe('2024-01-01')
    expect(entry.snapshotCachedAt).toBe('2024-01-02')
  })
})

describe('isChatgptWebConversationSnapshotStale', () => {
  it('is not stale when index and snapshot match', () => {
    const indexEntry = { id: 'c1', updateTime: 100, asyncStatus: null }
    const snapshot = { conversationId: 'c1', updateTime: 100, asyncStatus: null }
    expect(isChatgptWebConversationSnapshotStale(indexEntry, snapshot)).toBe(false)
  })

  it('is stale when snapshot is missing', () => {
    expect(isChatgptWebConversationSnapshotStale({ id: 'c1' }, null)).toBe(true)
    expect(isChatgptWebConversationSnapshotStale({ id: 'c1' }, undefined)).toBe(true)
  })

  it('is stale when index updateTime is newer than snapshot', () => {
    const indexEntry = { id: 'c1', updateTime: 200, asyncStatus: null }
    const snapshot = { conversationId: 'c1', updateTime: 100, asyncStatus: null }
    expect(isChatgptWebConversationSnapshotStale(indexEntry, snapshot)).toBe(true)
  })

  it('is stale when asyncStatus differs', () => {
    const indexEntry = { id: 'c1', updateTime: 100, asyncStatus: 'in_progress' }
    const snapshot = { conversationId: 'c1', updateTime: 100, asyncStatus: null }
    expect(isChatgptWebConversationSnapshotStale(indexEntry, snapshot)).toBe(true)
  })

  it('is stale when index is pending but snapshot is not', () => {
    const indexEntry = { id: 'c1', updateTime: 100, asyncStatus: null, pending: true }
    const snapshot = { conversationId: 'c1', updateTime: 100, asyncStatus: null, pending: false }
    expect(isChatgptWebConversationSnapshotStale(indexEntry, snapshot)).toBe(true)
  })
})
