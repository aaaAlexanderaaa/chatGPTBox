import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHATGPT_WEB_HISTORY_EXPORT_SCOPE } from '../src/services/clients/chatgpt-web/history-transfer.mjs'
import {
  buildConversationList,
  conversationToMarkdown,
  formatLibraryConversation,
  listHistoryVolumeFiles,
  loadHistoryVolumes,
  searchConversationBodies,
  writeMergedHistoryVolume,
} from '../scripts/lib/chatgpt-history-library.mjs'

const dirs = []

afterEach(async () => {
  dirs.length = 0
})

function mappingFromTurns(conversationId, turns) {
  const mapping = {
    root: { id: 'root', parent: null, children: [] },
  }
  let parent = 'root'
  turns.forEach((turn, index) => {
    const id = `${turn.role}-${index}`
    mapping[id] = {
      id,
      parent,
      children: [],
      message: {
        id,
        author: { role: turn.role },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: [turn.text] },
      },
    }
    mapping[parent].children.push(id)
    parent = id
  })
  return {
    conversation_id: conversationId,
    title: turns[0] ? `Title ${conversationId}` : conversationId,
    create_time: 1700000000,
    update_time: 1700000100,
    current_node: parent === 'root' ? null : parent,
    default_model_slug: 'gpt-5-6-thinking',
    mapping,
  }
}

function volumePayload({ exportId = 'export-fixture', index = 1, count = 1, storage }) {
  return {
    scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
    schemaVersion: 2,
    exportedAt: '2026-09-19T00:00:00.000Z',
    exportId,
    volume: { index, count },
    storage,
    summary: { conversationCount: Object.keys(storage.chatgptWebConversationIndex || {}).length },
  }
}

async function writeVolumes(payloads) {
  const dir = await mkdtemp(join(tmpdir(), 'chatgptbox-history-viewer-'))
  dirs.push(dir)
  const paths = []
  for (const [index, payload] of payloads.entries()) {
    const filePath = join(
      dir,
      `chatgptbox-chatgpt-history-fixture-part${String(index + 1).padStart(2, '0')}-of-${String(
        payloads.length,
      ).padStart(2, '0')}.json`,
    )
    await writeFile(filePath, JSON.stringify(payload))
    paths.push(filePath)
  }
  return { dir, paths }
}

describe('ChatGPT history viewer library', () => {
  it('discovers and merges synthetic volume files', async () => {
    const alpha = mappingFromTurns('alpha', [
      { role: 'user', text: 'hello from alpha' },
      { role: 'assistant', text: 'alpha reply with unique-token-alpha' },
    ])
    const beta = mappingFromTurns('beta', [
      { role: 'user', text: 'hello from beta' },
      { role: 'assistant', text: 'beta reply' },
    ])
    const { dir } = await writeVolumes([
      volumePayload({
        index: 1,
        count: 2,
        storage: {
          chatgptWebConversationIndex: {
            alpha: {
              id: 'alpha',
              title: 'Alpha chat',
              updateTime: '2026-09-19T12:00:00.000Z',
              isArchived: false,
            },
            beta: {
              id: 'beta',
              title: 'Beta chat',
              updateTime: '2026-09-18T12:00:00.000Z',
              isArchived: true,
            },
            ghost: {
              id: 'ghost',
              title: 'Ghost chat',
              updateTime: '2026-09-17T12:00:00.000Z',
            },
          },
          'chatgptWebConversationSnapshot:alpha': {
            conversationId: 'alpha',
            snapshot: alpha,
          },
        },
      }),
      volumePayload({
        index: 2,
        count: 2,
        storage: {
          'chatgptWebConversationSnapshot:beta': {
            conversationId: 'beta',
            snapshot: beta,
          },
        },
      }),
    ])

    const files = await listHistoryVolumeFiles([dir])
    expect(files).toHaveLength(2)
    const library = await loadHistoryVolumes(files)
    expect(library.exportId).toBe('export-fixture')
    expect(library.conversations.map((item) => item.id)).toEqual(['alpha', 'beta', 'ghost'])
    expect(library.conversations.find((item) => item.id === 'ghost').hasSnapshot).toBe(false)

    const formatted = formatLibraryConversation(library.storage, 'alpha')
    expect(formatted.messages.map((message) => message.text)).toEqual([
      'hello from alpha',
      'alpha reply with unique-token-alpha',
    ])
    expect(conversationToMarkdown(formatted)).toContain('hello from alpha')
    expect(searchConversationBodies(library.storage, 'unique-token-alpha')[0].id).toBe('alpha')
  })

  it('keeps an oversized synthetic snapshot as its own conversation after merge', async () => {
    const huge = mappingFromTurns('huge', [
      { role: 'user', text: 'ask' },
      { role: 'assistant', text: 'x'.repeat(5000) },
    ])
    const storage = {
      chatgptWebConversationIndex: {
        huge: { id: 'huge', title: 'Huge', updateTime: '2026-09-19T00:00:00.000Z' },
      },
      'chatgptWebConversationSnapshot:huge': { conversationId: 'huge', snapshot: huge },
    }
    expect(buildConversationList(storage)[0].hasSnapshot).toBe(true)
    const { dir, paths } = await writeVolumes([volumePayload({ storage })])
    const library = await loadHistoryVolumes(paths)
    const mergedPath = join(dir, 'merged.json')
    await writeMergedHistoryVolume(library, mergedPath)
    const reloaded = await loadHistoryVolumes([mergedPath])
    expect(formatLibraryConversation(reloaded.storage, 'huge').messages[1].text).toHaveLength(5000)
  })

  it('keeps the list title when the snapshot is still New Chat', () => {
    const snapshot = mappingFromTurns('listed', [
      { role: 'user', text: 'plan the weekend' },
      { role: 'assistant', text: 'here is a plan' },
    ])
    snapshot.title = 'New chat'
    const storage = {
      chatgptWebConversationIndex: {
        listed: {
          id: 'listed',
          title: 'Plan the weekend',
          rawItem: { id: 'listed', title: 'Plan the weekend' },
          updateTime: '2026-09-19T00:00:00.000Z',
        },
      },
      'chatgptWebConversationSnapshot:listed': { conversationId: 'listed', snapshot },
    }

    expect(buildConversationList(storage)[0].title).toBe('Plan the weekend')
    expect(formatLibraryConversation(storage, 'listed').title).toBe('Plan the weekend')
    expect(searchConversationBodies(storage, 'plan the weekend')[0].title).toBe('Plan the weekend')
    expect(conversationToMarkdown(formatLibraryConversation(storage, 'listed'))).toContain(
      '# Plan the weekend',
    )
  })

  it('rejects mixed export ids', async () => {
    const { paths } = await writeVolumes([
      volumePayload({
        exportId: 'one',
        storage: { chatgptWebConversationIndex: { a: { id: 'a', title: 'A' } } },
      }),
      volumePayload({
        exportId: 'two',
        storage: { chatgptWebConversationIndex: { b: { id: 'b', title: 'B' } } },
      }),
    ])
    await expect(loadHistoryVolumes(paths)).rejects.toThrow(/different exports/)
  })
})
