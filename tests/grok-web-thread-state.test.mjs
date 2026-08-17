import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  deleteGrokWebSessionSnapshot,
  restoreGrokWebSessionOnto,
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

  it('merges a snapshot onto a remounted session missing ids', async () => {
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
      { sessionId: 's', conversationId: 'c', previousResponseID: 'r' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    const merged = await restoreGrokWebSessionOnto(
      { sessionId: 's', conversationId: null, question: 'hi' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    expect(merged).toMatchObject({
      sessionId: 's',
      conversationId: 'c',
      previousResponseID: 'r',
      question: 'hi',
    })
  })

  it('fills a missing previousResponseID when conversationId is already set', async () => {
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
      { sessionId: 's', conversationId: 'c', previousResponseID: 'r' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    const merged = await restoreGrokWebSessionOnto(
      { sessionId: 's', conversationId: 'c', question: 'hi' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    expect(merged).toMatchObject({
      sessionId: 's',
      conversationId: 'c',
      previousResponseID: 'r',
      question: 'hi',
    })
  })

  it('does not overwrite a stored parent id with a null one', async () => {
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
      { sessionId: 's', conversationId: 'c', previousResponseID: 'r' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    await saveGrokWebSessionSnapshot(
      { sessionId: 's', conversationId: 'c', previousResponseID: null },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    const restored = await restoreGrokWebSessionSnapshot('s', {
      storage,
      key: 'grokWebThreadSnapshots',
    })
    expect(restored.previousResponseID).toBe('r')
  })

  it('deletes an extension-born snapshot', async () => {
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
      { sessionId: 's', conversationId: 'c', previousResponseID: 'r' },
      { storage, key: 'grokWebThreadSnapshots' },
    )
    await deleteGrokWebSessionSnapshot('s', { storage, key: 'grokWebThreadSnapshots' })
    expect(
      await restoreGrokWebSessionSnapshot('s', { storage, key: 'grokWebThreadSnapshots' }),
    ).toBeNull()
  })

  it('is wired from ConversationCard', () => {
    const src = readFileSync(
      new URL('../src/components/ConversationCard/index.jsx', import.meta.url),
      'utf8',
    )
    expect(src).toContain('restoreGrokWebSessionOnto')
    expect(src).toContain('isUsingGrokWebModel')
    expect(src).toMatch(
      /isUsingGrokWebModel\(session\)[\s\S]{0,180}conversationId && session\.previousResponseID/,
    )
    expect(src).toMatch(/if \(!session\.conversationId \|\| !session\.previousResponseID\) return/)
    expect(src).toMatch(/grokWebConversationUrl\(session\.conversationId\)/)
  })
})
