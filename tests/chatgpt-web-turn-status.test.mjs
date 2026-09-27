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
