/* eslint-env node */
// Synthetic scale probe. Storage generates each body on demand, as browser IPC does.
import Browser from 'webextension-polyfill'
import {
  streamChatgptHistoryExport,
  getChatgptHistoryLibraryStats,
} from '../../src/services/clients/chatgpt-web/history-transfer.mjs'
const total = 1200
const bodyBytes = 256 * 1024
const snapshotPrefix = 'chatgptWebConversationSnapshot:'
const index = Object.fromEntries(
  Array.from({ length: total }, (_, n) => [
    `chat-${n}`,
    {
      id: `chat-${n}`,
      title: `Synthetic conversation ${n}`,
      workspaceId: `project-${n % 14}`,
      snapshotHistoryComplete: true,
      snapshotHistoryScope: 'current_branch',
      snapshotCachedAt: '2026-11-04T00:00:00Z',
    },
  ]),
)
const catalog = {
  chatgptWebConversationIndex: index,
  chatgptWebConversationMeta: {},
  chatgptWebSessionSnapshots: {},
  chatgptWebApiThreads: [],
}
let bodyReads = 0,
  peakHeap = 0,
  peakRss = 0,
  maxBodiesPerRead = 0,
  volumes = 0,
  writtenBytes = 0,
  heartbeats = 0
const sample = () => {
  const m = process.memoryUsage()
  peakHeap = Math.max(peakHeap, m.heapUsed)
  peakRss = Math.max(peakRss, m.rss)
}
Browser.storage.local.getKeys = async () => [
  ...Object.keys(catalog),
  ...Object.keys(index).map((id) => snapshotPrefix + id),
]
Browser.storage.local.get = async (keys) => {
  const out = {}
  maxBodiesPerRead = Math.max(
    maxBodiesPerRead,
    keys.filter((key) => key.startsWith(snapshotPrefix)).length,
  )
  for (const key of keys) {
    if (key in catalog) out[key] = catalog[key]
    else if (key.startsWith(snapshotPrefix)) {
      const id = key.slice(snapshotPrefix.length)
      bodyReads++
      out[key] = {
        conversationId: id,
        cachedAt: '2026-11-04T00:00:00Z',
        snapshot: {
          conversation_id: id,
          messages: [
            {
              id: 'message-' + id,
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['x'.repeat(bodyBytes)] },
            },
          ],
          page_info: { has_previous_page: false },
        },
      }
    }
  }
  sample()
  return out
}
const stats = await getChatgptHistoryLibraryStats()
if (bodyReads) throw Error('Live statistics read a body')
const timer = setInterval(() => {
  heartbeats++
}, 0)
const started = performance.now()
const result = await streamChatgptHistoryExport({
  writeVolume: async (volume) => {
    const json = JSON.stringify(volume)
    writtenBytes += Buffer.byteLength(json)
    volumes++
    sample()
    await new Promise((resolve) => setTimeout(resolve, 0))
  },
})
clearInterval(timer)
if (result.summary.snapshotCount !== total || bodyReads !== total * 2 || maxBodiesPerRead !== 1)
  throw Error('Unexpected export coverage')
console.log(
  JSON.stringify({
    conversations: stats.conversationCount,
    projects: 14,
    rawBodyMiB: (total * bodyBytes) / 1024 / 1024,
    bodyReads,
    maxBodiesPerRead,
    volumes,
    writtenMiB: Number((writtenBytes / 1024 / 1024).toFixed(2)),
    peakHeapMiB: Number((peakHeap / 1024 / 1024).toFixed(2)),
    peakRssMiB: Number((peakRss / 1024 / 1024).toFixed(2)),
    elapsedMs: Math.round(performance.now() - started),
    heartbeats,
  }),
)
