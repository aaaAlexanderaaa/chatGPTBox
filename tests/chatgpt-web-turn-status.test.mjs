import { describe, expect, it, vi } from 'vitest'

const { storageData } = vi.hoisted(() => ({ storageData: {} }))
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storageData }
        },
        async set(values) {
          Object.assign(storageData, values)
        },
      },
    },
  },
}))

const { CHATGPT_WEB_TURN_STATUS_KEY, getChatgptWebTurnStatus, recordChatgptWebTurnStatus } =
  await import('../src/services/clients/chatgpt-web/turn-status.mjs')

describe('ChatGPT Web turn status retention', () => {
  it('allows a verified conversation read to repair a terminal record while ignoring late stream events', async () => {
    const ids = { conversationId: 'verified-conversation', messageId: 'verified-message' }
    recordChatgptWebTurnStatus({ ...ids, status: 'failed', error: 'Proxy disconnected' })
    expect(
      recordChatgptWebTurnStatus({ ...ids, status: 'completed', text: 'Late partial' }),
    ).toMatchObject({ status: 'failed' })
    expect(
      recordChatgptWebTurnStatus({
        ...ids,
        status: 'completed',
        text: 'Verified final',
        verifiedComplete: true,
      }),
    ).toMatchObject({ status: 'completed', text: 'Verified final', error: null })
    expect(
      recordChatgptWebTurnStatus({ ...ids, status: 'failed', error: 'Late stream error' }),
    ).toMatchObject({ status: 'completed', text: 'Verified final', error: null })
    await vi.waitFor(() =>
      expect(storageData[CHATGPT_WEB_TURN_STATUS_KEY]?.[ids.messageId]).toMatchObject({
        status: 'completed',
        error: null,
      }),
    )
  })

  it('preserves stored turn metadata when recovery completes after a worker restart', async () => {
    const ids = { conversationId: 'restored-conversation', messageId: 'restored-message' }
    storageData[CHATGPT_WEB_TURN_STATUS_KEY] = {
      [ids.messageId]: {
        ...ids,
        status: 'running',
        text: 'Old partial answer',
        query: 'Original question',
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    }
    expect(await getChatgptWebTurnStatus(ids)).toMatchObject({ status: 'running' })
    expect(
      recordChatgptWebTurnStatus({ ...ids, status: 'completed', text: 'Recovered final' }),
    ).toMatchObject({
      status: 'completed',
      text: 'Recovered final',
      query: 'Original question',
      createdAt: '2026-10-19T00:00:00.000Z',
    })
    await vi.waitFor(() =>
      expect(storageData[CHATGPT_WEB_TURN_STATUS_KEY][ids.messageId]).toMatchObject({
        status: 'completed',
      }),
    )
  })

  it('keeps an unfinished turn available after 31 newer finished turns', async () => {
    const conversationId = 'long-running-conversation'
    const messageId = 'long-running-message'
    recordChatgptWebTurnStatus({ conversationId, messageId, status: 'running' })
    for (let index = 0; index < 31; index++) {
      recordChatgptWebTurnStatus({
        conversationId: `finished-conversation-${index}`,
        messageId: `finished-message-${index}`,
        status: 'completed',
        text: 'done',
      })
    }
    expect(await getChatgptWebTurnStatus({ conversationId, messageId })).toMatchObject({
      status: 'running',
    })
    await vi.waitFor(() => {
      expect(storageData[CHATGPT_WEB_TURN_STATUS_KEY]?.[messageId]).toMatchObject({
        status: 'running',
      })
      expect(Object.keys(storageData[CHATGPT_WEB_TURN_STATUS_KEY])).toHaveLength(31)
    })
  })
})
