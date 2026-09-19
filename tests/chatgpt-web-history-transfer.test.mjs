import { beforeEach, describe, expect, it } from 'vitest'
import Browser from 'webextension-polyfill'
import { buildChatgptHistoryVolumeFilename } from '../src/popup/file-transfer.mjs'
import {
  CHATGPT_WEB_HISTORY_EMPTY_IMPORT_ERROR,
  CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION,
  CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
  CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR,
  CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE,
  buildChatgptHistoryExportVolumes,
  buildChatgptHistoryVolumePayloads,
  exportChatgptHistoryData,
  getChatgptHistoryLibraryStats,
  importChatgptHistoryData,
  listChatgptHistoryStorageKeys,
  packChatgptHistoryStorageIntoVolumeMaps,
  summarizeChatgptHistoryLibrary,
} from '../src/services/clients/chatgpt-web/history-transfer.mjs'

const store = new Map()
const getCalls = []
const setCalls = []
let getKeysEnabled = true

function resetStore() {
  store.clear()
  getCalls.length = 0
  setCalls.length = 0
  getKeysEnabled = true
}

function snapshotKey(id) {
  return `chatgptWebConversationSnapshot:${id}`
}

function makeSnapshot(id, extra = {}) {
  return {
    conversationId: id,
    cachedAt: extra.cachedAt || '2026-01-01T00:00:00.000Z',
    source: extra.source || 'test',
    snapshot: extra.snapshot || { id, mapping: { [id]: { content: extra.body || id } } },
  }
}

function makeIndexEntry(id, extra = {}) {
  return {
    id,
    title: extra.title || id,
    isArchived: extra.isArchived === true,
    updateTime: extra.updateTime || '2026-01-01T00:00:00.000Z',
  }
}

function installStorageShim() {
  Browser.storage.local.get = async (keysOrDefaults) => {
    getCalls.push(keysOrDefaults)
    if (keysOrDefaults == null) {
      throw new Error('storage.get(null) is forbidden')
    }
    if (Array.isArray(keysOrDefaults)) {
      expect(keysOrDefaults.length).toBeLessThanOrEqual(CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE)
      const out = {}
      for (const key of keysOrDefaults) {
        if (store.has(key)) out[key] = store.get(key)
      }
      return out
    }
    if (keysOrDefaults && typeof keysOrDefaults === 'object') {
      const out = {}
      for (const [key, fallback] of Object.entries(keysOrDefaults)) {
        out[key] = store.has(key) ? store.get(key) : fallback
      }
      return out
    }
    throw new Error(`unexpected storage.get argument: ${String(keysOrDefaults)}`)
  }
  Browser.storage.local.set = async (obj) => {
    setCalls.push(obj)
    expect(Object.keys(obj).length).toBeLessThanOrEqual(CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE)
    for (const [key, value] of Object.entries(obj)) store.set(key, value)
  }
  Browser.storage.local.remove = async (keys) => {
    for (const key of [].concat(keys)) store.delete(key)
  }
  Browser.storage.local.getKeys = async () => {
    if (!getKeysEnabled) {
      throw new Error('getKeys should not be called in fallback tests')
    }
    return [...store.keys()]
  }
}

function seedLibrary({
  conversations = [],
  extraSnapshots = [],
  meta = {},
  sessionSnapshots = {},
  apiThreads = [],
} = {}) {
  const index = {}
  for (const conversation of conversations) {
    const id = conversation.id
    index[id] = makeIndexEntry(id, conversation)
    if (conversation.withSnapshot !== false) {
      store.set(snapshotKey(id), makeSnapshot(id, conversation))
    }
  }
  store.set('chatgptWebConversationIndex', index)
  store.set('chatgptWebConversationMeta', meta)
  store.set('chatgptWebSessionSnapshots', sessionSnapshots)
  store.set('chatgptWebApiThreads', apiThreads)
  for (const snapshot of extraSnapshots) {
    store.set(snapshotKey(snapshot.id), makeSnapshot(snapshot.id, snapshot))
  }
}

function collectedStorage(volumes) {
  return Object.assign({}, ...volumes.map((volume) => volume.storage))
}

beforeEach(() => {
  resetStore()
  installStorageShim()
})

describe('ChatGPT history volume packing helpers', () => {
  it('packs five small snapshots into multiple volumes with shared exportId', () => {
    const storage = {
      chatgptWebConversationIndex: {
        a: makeIndexEntry('a'),
        b: makeIndexEntry('b'),
        c: makeIndexEntry('c'),
        d: makeIndexEntry('d'),
        e: makeIndexEntry('e'),
      },
      [snapshotKey('a')]: makeSnapshot('a', { body: 'aaaaaa' }),
      [snapshotKey('b')]: makeSnapshot('b', { body: 'bbbbbb' }),
      [snapshotKey('c')]: makeSnapshot('c', { body: 'cccccc' }),
      [snapshotKey('d')]: makeSnapshot('d', { body: 'dddddd' }),
      [snapshotKey('e')]: makeSnapshot('e', { body: 'eeeeee' }),
    }
    const volumes = buildChatgptHistoryVolumePayloads(storage, {
      maxVolumeBytes: 220,
      exportId: 'export-shared',
      exportedAt: '2026-09-19T00:00:00.000Z',
    })

    expect(volumes.length).toBeGreaterThan(1)
    expect(CHATGPT_WEB_HISTORY_EXPORT_SCHEMA_VERSION).toBe(2)
    for (const [index, volume] of volumes.entries()) {
      expect(volume.scope).toBe(CHATGPT_WEB_HISTORY_EXPORT_SCOPE)
      expect(volume.schemaVersion).toBe(2)
      expect(volume.exportId).toBe('export-shared')
      expect(volume.volume).toEqual({ index: index + 1, count: volumes.length })
      expect(volume.summary.conversationCount).toBe(5)
      expect(volume.summary.snapshotCount).toBe(5)
      expect(JSON.stringify(volume)).not.toMatch(/\n\s\s"/)
    }
    expect(collectedStorage(volumes)[snapshotKey('e')].conversationId).toBe('e')
  })

  it('gives an oversized snapshot its own volume and never drops it', () => {
    const hugeBody = 'x'.repeat(4000)
    const storage = {
      chatgptWebConversationIndex: {
        small: makeIndexEntry('small'),
        huge: makeIndexEntry('huge'),
        other: makeIndexEntry('other'),
      },
      [snapshotKey('small')]: makeSnapshot('small', { body: 's' }),
      [snapshotKey('huge')]: makeSnapshot('huge', { body: hugeBody }),
      [snapshotKey('other')]: makeSnapshot('other', { body: 'o' }),
    }
    const maps = packChatgptHistoryStorageIntoVolumeMaps(storage, { maxVolumeBytes: 500 })
    const hugeVolume = maps.find((map) =>
      Object.prototype.hasOwnProperty.call(map, snapshotKey('huge')),
    )
    expect(hugeVolume).toBeTruthy()
    expect(
      Object.keys(hugeVolume).filter((key) => key.startsWith('chatgptWebConversationSnapshot:')),
    ).toEqual([snapshotKey('huge')])
    expect(maps.some((map) => map[snapshotKey('small')])).toBe(true)
    expect(maps.some((map) => map[snapshotKey('other')])).toBe(true)
  })

  it('still emits schema 2 with volume.count === 1 when everything fits', () => {
    const storage = {
      chatgptWebConversationIndex: { a: makeIndexEntry('a') },
      [snapshotKey('a')]: makeSnapshot('a'),
    }
    const volumes = buildChatgptHistoryVolumePayloads(storage, { maxVolumeBytes: 16 * 1024 * 1024 })
    expect(volumes).toHaveLength(1)
    expect(volumes[0].volume).toEqual({ index: 1, count: 1 })
    expect(volumes[0].schemaVersion).toBe(2)
  })
})

describe('ChatGPT history export/import volumes', () => {
  it('exports multiple volumes from storage without calling get(null)', async () => {
    seedLibrary({
      conversations: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, body: `${id}-body-extra` })),
    })
    const result = await exportChatgptHistoryData({ maxVolumeBytes: 350 })
    expect(result.exportId).toEqual(expect.any(String))
    expect(result.volumes.length).toBeGreaterThan(1)
    expect(result.volumes.every((volume) => volume.exportId === result.exportId)).toBe(true)
    expect(result.volumes.map((volume) => volume.volume.index)).toEqual(
      result.volumes.map((_, index) => index + 1),
    )
    expect(result.volumes[0].volume.count).toBe(result.volumes.length)
    expect(getCalls.some((keys) => keys == null)).toBe(false)
  })

  it('imports all volumes and restores index plus snapshots', async () => {
    seedLibrary({
      conversations: [
        { id: 'keep', title: 'Keep' },
        { id: 'second', title: 'Second' },
      ],
    })
    const { volumes } = await buildChatgptHistoryExportVolumes()
    store.clear()
    getCalls.length = 0
    const imported = await importChatgptHistoryData(volumes)
    expect(imported.after.conversationCount).toBe(2)
    expect(imported.after.snapshotCount).toBe(2)
    expect(store.get('chatgptWebConversationIndex').keep.title).toBe('Keep')
    expect(store.get(snapshotKey('second')).conversationId).toBe('second')
    expect(getCalls.some((keys) => keys == null)).toBe(false)
  })

  it('allows a partial volume import and merges what was provided', async () => {
    seedLibrary({ conversations: [{ id: 'a' }, { id: 'b' }] })
    const { volumes } = await buildChatgptHistoryExportVolumes({ maxVolumeBytes: 260 })
    expect(volumes.length).toBeGreaterThan(1)
    store.clear()
    store.set('chatgptWebConversationIndex', { local: makeIndexEntry('local') })
    const imported = await importChatgptHistoryData(volumes[0])
    expect(imported.after.conversationCount).toBeGreaterThan(0)
    expect(store.get('chatgptWebConversationIndex').local).toBeTruthy()
  })

  it('throws when volume files come from different exports', async () => {
    const first = buildChatgptHistoryVolumePayloads(
      { chatgptWebConversationIndex: { a: makeIndexEntry('a') } },
      { exportId: 'export-a' },
    )[0]
    const second = buildChatgptHistoryVolumePayloads(
      { [snapshotKey('a')]: makeSnapshot('a') },
      { exportId: 'export-b' },
    )[0]
    await expect(importChatgptHistoryData([first, second])).rejects.toThrow(
      CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR,
    )
    expect(getCalls.some((keys) => keys == null)).toBe(false)
  })

  it('still imports schema v1 single-file payloads', async () => {
    await importChatgptHistoryData({
      scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
      schemaVersion: 1,
      storage: {
        chatgptWebConversationIndex: { legacy: makeIndexEntry('legacy', { title: 'Legacy' }) },
        [snapshotKey('legacy')]: makeSnapshot('legacy'),
      },
    })
    expect(store.get('chatgptWebConversationIndex').legacy.title).toBe('Legacy')
    expect(store.get(snapshotKey('legacy')).conversationId).toBe('legacy')
  })

  it('still imports a raw storage map', async () => {
    await importChatgptHistoryData({
      chatgptWebConversationIndex: { raw: makeIndexEntry('raw') },
      [snapshotKey('raw')]: makeSnapshot('raw'),
    })
    expect(store.get(snapshotKey('raw')).conversationId).toBe('raw')
  })

  it('rejects an empty import payload', async () => {
    await expect(
      importChatgptHistoryData({ scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE }),
    ).rejects.toThrow(CHATGPT_WEB_HISTORY_EMPTY_IMPORT_ERROR)
  })

  it('never calls storage.get with null during stats, export, or import', async () => {
    seedLibrary({
      conversations: Array.from({ length: 45 }, (_, index) => ({ id: `c${index}` })),
    })
    await getChatgptHistoryLibraryStats()
    const exported = await buildChatgptHistoryExportVolumes()
    await importChatgptHistoryData(exported.volumes)
    expect(getCalls.length).toBeGreaterThan(0)
    expect(getCalls.every((keys) => keys != null)).toBe(true)
    expect(
      getCalls
        .filter((keys) => Array.isArray(keys))
        .every((keys) => keys.length <= CHATGPT_WEB_HISTORY_STORAGE_CHUNK_SIZE),
    ).toBe(true)
  })
})

describe('ChatGPT history library stats', () => {
  it('counts archived missing vs active missing and extra snapshots', () => {
    const stats = summarizeChatgptHistoryLibrary(
      {
        active1: makeIndexEntry('active1'),
        active2: makeIndexEntry('active2'),
        arch1: makeIndexEntry('arch1', { isArchived: true }),
      },
      [snapshotKey('active1'), snapshotKey('orphan')],
      {
        lastSyncAt: '2026-01-01T00:00:00.000Z',
        lastArchivedSyncAt: '2026-01-02T00:00:00.000Z',
        lastIncrementalSyncAt: '2026-01-03T00:00:00.000Z',
        hydrateState: { completedAt: '2026-01-04T00:00:00.000Z' },
      },
    )
    expect(stats).toMatchObject({
      conversationCount: 3,
      activeCount: 2,
      archivedCount: 1,
      snapshotCount: 2,
      missingBodyCount: 2,
      missingActiveBodyCount: 1,
      missingArchivedBodyCount: 1,
      extraSnapshotCount: 1,
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      lastArchivedSyncAt: '2026-01-02T00:00:00.000Z',
      lastIncrementalSyncAt: '2026-01-03T00:00:00.000Z',
      lastHydrateAt: '2026-01-04T00:00:00.000Z',
    })
  })

  it('reads library stats from storage without get(null)', async () => {
    seedLibrary({
      conversations: [{ id: 'live' }, { id: 'archived', isArchived: true, withSnapshot: false }],
      extraSnapshots: [{ id: 'orphan' }],
      meta: {
        lastSyncAt: '2026-02-01T00:00:00.000Z',
        hydrateState: { completedAt: '2026-02-02T00:00:00.000Z' },
      },
    })
    const stats = await getChatgptHistoryLibraryStats()
    expect(stats.conversationCount).toBe(2)
    expect(stats.activeCount).toBe(1)
    expect(stats.archivedCount).toBe(1)
    expect(stats.missingArchivedBodyCount).toBe(1)
    expect(stats.extraSnapshotCount).toBe(1)
    expect(stats.lastHydrateAt).toBe('2026-02-02T00:00:00.000Z')
    expect(getCalls.some((keys) => keys == null)).toBe(false)
  })
})

describe('ChatGPT history getKeys fallback', () => {
  it('does not list extra snapshots missing from the index without getKeys', async () => {
    getKeysEnabled = false
    delete Browser.storage.local.getKeys
    seedLibrary({
      conversations: [{ id: 'listed' }],
      extraSnapshots: [{ id: 'orphan' }],
    })
    const keys = await listChatgptHistoryStorageKeys(Browser.storage.local)
    expect(keys).toContain(snapshotKey('listed'))
    expect(keys).not.toContain(snapshotKey('orphan'))
    const exported = await buildChatgptHistoryExportVolumes()
    expect(collectedStorage(exported.volumes)[snapshotKey('orphan')]).toBeUndefined()
    expect(exported.summary.extraSnapshotCount).toBe(0)
    expect(getCalls.some((keysOrDefaults) => keysOrDefaults == null)).toBe(false)
  })

  it('lists extra snapshots with getKeys', async () => {
    seedLibrary({
      conversations: [{ id: 'listed' }],
      extraSnapshots: [{ id: 'orphan' }],
    })
    const keys = await listChatgptHistoryStorageKeys(Browser.storage.local)
    expect(keys).toContain(snapshotKey('orphan'))
    const exported = await buildChatgptHistoryExportVolumes()
    expect(collectedStorage(exported.volumes)[snapshotKey('orphan')].conversationId).toBe('orphan')
    expect(exported.summary.extraSnapshotCount).toBe(1)
  })
})

describe('ChatGPT history volume filenames', () => {
  it('uses chatgptbox-chatgpt-history-<iso>-partNN-of-MM.json', () => {
    expect(buildChatgptHistoryVolumeFilename('2026-09-19T01:02:03.004Z', 1, 12)).toBe(
      'chatgptbox-chatgpt-history-2026-09-19T01-02-03-004Z-part01-of-12.json',
    )
    expect(buildChatgptHistoryVolumeFilename('2026-09-19T01:02:03.004Z', 1, 1)).toBe(
      'chatgptbox-chatgpt-history-2026-09-19T01-02-03-004Z-part01-of-01.json',
    )
  })
})
