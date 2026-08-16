import { describe, expect, it } from 'vitest'
import {
  restoreGrokWebSessionSnapshot,
  saveGrokWebSessionSnapshot,
} from '../src/services/clients/grok-web/thread-state.mjs'

describe('grok thread snapshots', () => {
  it('round-trips extension-born ids', async () => {
    const store = new Map()
    const storage = {
      async get(key) {
        return { [key]: store.get(key) }
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, v)
      },
    }
    await saveGrokWebSessionSnapshot(
      { sessionId: 's', conversationId: 'c', previousResponseID: 'r', modelName: 'grokWebExpert' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    const restored = await restoreGrokWebSessionSnapshot('s', {
      storage,
      key: 'grokWebThreadSnapshots',
    })
    expect(restored).toMatchObject({ conversationId: 'c', previousResponseID: 'r' })
  })
})
