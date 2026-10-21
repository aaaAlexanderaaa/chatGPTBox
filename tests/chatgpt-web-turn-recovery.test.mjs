import { describe, expect, it, vi } from 'vitest'
import { createChatgptWebTurnRecovery } from '../src/services/clients/chatgpt-web/turn-recovery.mjs'
import { formatChatgptWebConversationSnapshot } from '../src/services/clients/chatgpt-web/conversation-state.mjs'

const ids = { conversationId: 'thread', messageId: 'question' }
function conversation({ userId = 'question', endTurn = true, pending = false } = {}) {
  return {
    ...formatChatgptWebConversationSnapshot(
      {
        conversation_id: 'thread',
        current_node: 'answer',
        async_status: pending ? 'in_progress' : null,
        messages: [
          { id: userId, author: { role: 'user' }, content: { parts: ['Same question'] } },
          {
            id: 'answer',
            author: { role: 'assistant' },
            channel: 'final',
            content: { content_type: 'text', parts: ['Complete answer with its final paragraph.'] },
            status: 'finished_successfully',
            end_turn: endTurn,
            metadata: { finished_duration_sec: 900 },
          },
        ],
        page_info: { has_previous_page: false },
      },
      { userMessageId: ids.messageId },
    ),
    cache: { source: 'network', stale: false },
  }
}

function setup(options = {}) {
  let record = { ...ids, status: 'running', text: 'Interim text' }
  const getStatus = vi.fn(async () => record)
  const recordStatus = vi.fn((next) => (record = next))
  const readConversation = vi.fn(async () => conversation())
  const onCompleted = vi.fn()
  const recover = createChatgptWebTurnRecovery({
    getStatus,
    recordStatus,
    readConversation,
    onCompleted,
    ...options,
  })
  return { recover, getStatus, recordStatus, readConversation, onCompleted }
}

describe('ChatGPT turn recovery after a lost completion event', () => {
  it('does not recover a later answer for an older user-message anchor', async () => {
    const snapshot = {
      ...formatChatgptWebConversationSnapshot(
        {
          conversation_id: 'thread',
          current_node: 'later-answer',
          async_status: null,
          messages: [
            { id: 'question', author: { role: 'user' }, content: { parts: ['Same question'] } },
            {
              id: 'first-answer',
              author: { role: 'assistant' },
              content: { parts: ['Original final answer'] },
              status: 'finished_successfully',
              end_turn: true,
              metadata: { finished_duration_sec: 31 },
            },
            {
              id: 'later-question',
              author: { role: 'user' },
              content: { parts: ['Same question'] },
            },
            {
              id: 'later-answer',
              author: { role: 'assistant' },
              content: { parts: ['A longer answer belonging to the later turn'] },
              status: 'finished_successfully',
              end_turn: true,
              metadata: { finished_duration_sec: 53 },
            },
          ],
          page_info: { has_previous_page: false },
        },
        { userMessageId: ids.messageId },
      ),
      cache: { source: 'network', stale: false },
    }
    const { recover } = setup({ readConversation: async () => snapshot })
    expect(await recover(ids)).toMatchObject({
      status: 'completed',
      text: 'Original final answer',
      thoughtDurationSec: 31,
    })
  })

  it('reads the acknowledged turn and records its final answer and reported duration', async () => {
    const { recover, readConversation, onCompleted } = setup()
    expect(await recover(ids)).toMatchObject({
      ...ids,
      status: 'completed',
      text: 'Complete answer with its final paragraph.',
      thoughtDurationSec: 900,
    })
    expect(readConversation).toHaveBeenCalledExactlyOnceWith({
      conversationId: ids.conversationId,
      userMessageId: ids.messageId,
      forceRefresh: true,
      latestOnly: true,
      requestTimeoutMs: 10_000,
    })
    expect(onCompleted).toHaveBeenCalledWith(ids)
  })

  it('reconstructs an expired local record from the exact user message', async () => {
    const { recover } = setup({ getStatus: async () => null })
    expect(await recover(ids)).toMatchObject({ ...ids, status: 'completed' })
  })

  it.each([
    ['same text on an older user message', () => conversation({ userId: 'old-question' })],
    ['final-looking fragment', () => conversation({ endTurn: false })],
    ['still running upstream', () => conversation({ pending: true })],
    ['a different conversation', () => ({ ...conversation(), conversationId: 'other-thread' })],
    [
      'an old cached answer',
      () => ({ ...conversation(), cache: { source: 'cache', stale: true } }),
    ],
    [
      'a failed forced refresh',
      () => ({ ...conversation(), cache: { source: 'network', stale: true } }),
    ],
    [
      'an empty final answer',
      () => {
        const result = conversation()
        result.message.text = '  '
        return result
      },
    ],
  ])('does not finish on %s', async (_label, snapshot) => {
    const { recover, readConversation, recordStatus } = setup()
    readConversation.mockResolvedValueOnce(snapshot())
    expect(await recover(ids)).toMatchObject({ status: 'running', text: 'Interim text' })
    expect(recordStatus).not.toHaveBeenCalled()
  })

  it('shares a recovery read between callers and limits checks to once per minute', async () => {
    let time = 0
    let release
    const { recover, readConversation } = setup({ now: () => time })
    readConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = recover(ids)
    const second = recover(ids)
    await vi.waitFor(() => expect(readConversation).toHaveBeenCalledTimes(1))
    release(conversation({ pending: true }))
    await Promise.all([first, second])
    time = 59_999
    await recover(ids)
    expect(readConversation).toHaveBeenCalledTimes(1)
    time = 60_000
    expect(await recover(ids)).toMatchObject({ status: 'completed' })
    expect(readConversation).toHaveBeenCalledTimes(2)
    await recover(ids)
    expect(readConversation).toHaveBeenCalledTimes(2)
  })

  it('bounds a hung read and ignores its late result, then permits another recovery', async () => {
    let time = 0
    let release
    const { recover, readConversation, recordStatus } = setup({ now: () => time, timeoutMs: 10 })
    readConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await expect(recover(ids)).rejects.toMatchObject({ code: 'CHATGPT_WEB_TURN_RECOVERY_TIMEOUT' })
    release(conversation())
    await Promise.resolve()
    expect(recordStatus).not.toHaveBeenCalled()
    time = 60_000
    expect(await recover(ids)).toMatchObject({ status: 'completed' })
    expect(readConversation).toHaveBeenCalledTimes(2)
  })

  it('preserves a live completion that arrives during the recovery read', async () => {
    const { recover, readConversation, recordStatus } = setup()
    readConversation.mockImplementationOnce(async () => {
      recordStatus({ ...ids, status: 'completed', text: 'Live final answer' })
      return conversation({ pending: true })
    })
    expect(await recover(ids)).toMatchObject({ status: 'completed', text: 'Live final answer' })
  })
})
