import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  CHATGPT_WEB_CONVERSATION_INDEX_KEY,
  CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX,
} from '../../src/services/clients/chatgpt-web/conversation-cache.mjs'
import {
  formatChatgptWebConversationSnapshot,
  pickChatgptWebConversationTitle,
} from '../../src/services/clients/chatgpt-web/conversation-state.mjs'
import {
  CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
  CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR,
  mergeChatgptHistoryStorageData,
  normalizeImportPayload,
  summarizeChatgptHistoryExport,
} from '../../src/services/clients/chatgpt-web/history-transfer.mjs'

const VOLUME_PEEK_BYTES = 4096

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function toSortableTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && !trimmed.includes('-') && !trimmed.includes('T')) {
      return numeric < 1e12 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function peekLooksLikeHistoryVolume(head = '') {
  return (
    head.includes(CHATGPT_WEB_HISTORY_EXPORT_SCOPE) ||
    head.includes('chatgptWebConversationSnapshot:') ||
    head.includes(CHATGPT_WEB_CONVERSATION_INDEX_KEY)
  )
}

export async function fileLooksLikeHistoryVolume(filePath) {
  if (extname(filePath).toLowerCase() !== '.json') return false
  const handle = await open(filePath, 'r')
  try {
    const bytes = new Uint8Array(VOLUME_PEEK_BYTES)
    const { bytesRead } = await handle.read(bytes, 0, VOLUME_PEEK_BYTES, 0)
    return peekLooksLikeHistoryVolume(new TextDecoder().decode(bytes.subarray(0, bytesRead)))
  } finally {
    await handle.close()
  }
}

export async function listHistoryVolumeFiles(targets = []) {
  const files = []
  for (const target of targets) {
    const info = await stat(target)
    if (info.isDirectory()) {
      const names = await readdir(target)
      for (const name of names) {
        const fullPath = join(target, name)
        const child = await stat(fullPath)
        if (!child.isFile()) continue
        if (await fileLooksLikeHistoryVolume(fullPath)) files.push(fullPath)
      }
      continue
    }
    if (info.isFile() && (await fileLooksLikeHistoryVolume(target))) files.push(target)
  }
  return [...new Set(files)].sort((left, right) => basename(left).localeCompare(basename(right)))
}

function pickLibraryConversationTitle(indexEntry, snapshotTitle) {
  return (
    pickChatgptWebConversationTitle(indexEntry?.rawItem?.title, indexEntry?.title, snapshotTitle) ||
    'Untitled'
  )
}

function snapshotIdFromKey(key) {
  return key.startsWith(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX)
    ? key.slice(CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX.length)
    : ''
}

export function buildConversationList(storageData = {}) {
  const index = isPlainObject(storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY])
    ? storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY]
    : {}
  const snapshotIds = new Set(
    Object.keys(storageData)
      .map((key) => snapshotIdFromKey(key))
      .filter(Boolean),
  )

  const items = []
  for (const [id, entry] of Object.entries(index)) {
    const snapshot = storageData[`${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`]
    items.push({
      id,
      title: pickLibraryConversationTitle(entry, snapshot?.snapshot?.title),
      createTime: entry?.createTime ?? snapshot?.snapshot?.create_time ?? null,
      updateTime:
        entry?.updateTime ?? snapshot?.updateTime ?? snapshot?.snapshot?.update_time ?? null,
      isArchived: entry?.isArchived === true,
      isStarred: entry?.isStarred === true,
      workspaceId: entry?.workspaceId ?? null,
      snippet: typeof entry?.snippet === 'string' ? entry.snippet : '',
      hasSnapshot: snapshotIds.has(id),
      extra: false,
    })
  }

  for (const id of snapshotIds) {
    if (index[id]) continue
    const record = storageData[`${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`]
    const snapshot = record?.snapshot || {}
    items.push({
      id,
      title: pickLibraryConversationTitle(null, snapshot.title),
      createTime: snapshot.create_time ?? null,
      updateTime: record?.updateTime ?? snapshot.update_time ?? null,
      isArchived: snapshot.is_archived === true,
      isStarred: snapshot.is_starred === true,
      workspaceId: snapshot.workspace_id ?? null,
      snippet: '',
      hasSnapshot: true,
      extra: true,
    })
  }

  items.sort((left, right) => {
    const timeDelta = toSortableTimestamp(right.updateTime) - toSortableTimestamp(left.updateTime)
    if (timeDelta !== 0) return timeDelta
    return String(left.title || '').localeCompare(String(right.title || ''), 'zh')
  })
  return items
}

function envelopeMeta(payload, filePath) {
  return {
    path: filePath,
    filename: basename(filePath),
    scope: typeof payload?.scope === 'string' ? payload.scope : '',
    exportId: typeof payload?.exportId === 'string' ? payload.exportId.trim() : '',
    exportedAt: payload?.exportedAt ?? null,
    schemaVersion: payload?.schemaVersion ?? null,
    volume: isPlainObject(payload?.volume) ? payload.volume : null,
  }
}

export async function loadHistoryVolumes(filePaths = [], { onProgress } = {}) {
  if (filePaths.length === 0) {
    throw new Error('No ChatGPT history volume files found')
  }

  const volumes = []
  let merged = {}
  const exportIds = new Set()

  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index]
    const info = await stat(filePath)
    onProgress?.({
      index,
      total: filePaths.length,
      path: filePath,
      bytes: info.size,
    })
    const payload = JSON.parse(await readFile(filePath, 'utf8'))
    const meta = envelopeMeta(payload, filePath)
    if (meta.exportId) exportIds.add(meta.exportId)
    volumes.push({ ...meta, bytes: info.size })
    merged = mergeChatgptHistoryStorageData(merged, normalizeImportPayload(payload))
  }

  if (exportIds.size > 1) {
    throw new Error(CHATGPT_WEB_HISTORY_MIXED_EXPORT_IDS_ERROR)
  }

  return {
    exportId: [...exportIds][0] || '',
    volumes,
    storage: merged,
    summary: summarizeChatgptHistoryExport(merged),
    conversations: buildConversationList(merged),
  }
}

export function getConversationRecord(storageData, conversationId) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!id) return null
  const record = storageData[`${CHATGPT_WEB_CONVERSATION_SNAPSHOT_KEY_PREFIX}${id}`]
  return record && typeof record === 'object' ? record : null
}

export function formatLibraryConversation(storageData, conversationId, { think = false } = {}) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  const record = getConversationRecord(storageData, conversationId)
  const indexEntry = storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY]?.[id] || null
  if (!record?.snapshot) {
    return {
      conversationId: id,
      title: pickLibraryConversationTitle(indexEntry),
      missingSnapshot: true,
      messages: [],
      defaultModel: null,
      createTime: indexEntry?.createTime ?? null,
      updateTime: indexEntry?.updateTime ?? null,
      isArchived: indexEntry?.isArchived === true,
      isStarred: indexEntry?.isStarred === true,
    }
  }

  const formatted = formatChatgptWebConversationSnapshot(record.snapshot, { think })
  return {
    ...formatted,
    conversationId: formatted.conversationId || id,
    title: pickLibraryConversationTitle(indexEntry, formatted.title),
    missingSnapshot: false,
    cachedAt: record.cachedAt ?? null,
    source: record.source || null,
    isArchived: indexEntry?.isArchived === true,
    isStarred: indexEntry?.isStarred === true,
    workspaceId: indexEntry?.workspaceId ?? formatted.workspaceId ?? null,
    mappingNodeCount: isPlainObject(record.snapshot?.mapping)
      ? Object.keys(record.snapshot.mapping).length
      : 0,
  }
}

export function conversationToMarkdown(conversation) {
  const title = conversation?.title || 'Untitled'
  const lines = [`# ${title}`, '']
  if (conversation?.conversationId) lines.push(`- ID: \`${conversation.conversationId}\``)
  if (conversation?.defaultModel) lines.push(`- Model: ${conversation.defaultModel}`)
  if (conversation?.createTime) lines.push(`- Created: ${conversation.createTime}`)
  if (conversation?.updateTime) lines.push(`- Updated: ${conversation.updateTime}`)
  lines.push('')
  if (conversation?.missingSnapshot) {
    lines.push('_This conversation is in the list index but has no cached body._')
    return `${lines.join('\n')}\n`
  }
  for (const message of conversation?.messages || []) {
    const heading = message.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${heading}`)
    if (message.thoughtDurationLabel) lines.push(`_${message.thoughtDurationLabel}_`)
    lines.push('')
    lines.push(message.text || '')
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

function collectSearchableStrings(value, parts, limit) {
  if (parts.length >= limit) return
  if (typeof value === 'string') {
    if (value.trim()) parts.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchableStrings(item, parts, limit)
    return
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectSearchableStrings(item, parts, limit)
  }
}

function firstSnippet(texts, query) {
  const needle = query.toLowerCase()
  for (const text of texts) {
    const lower = text.toLowerCase()
    const at = lower.indexOf(needle)
    if (at < 0) continue
    const start = Math.max(0, at - 48)
    const end = Math.min(text.length, at + query.length + 72)
    return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${
      end < text.length ? '…' : ''
    }`
  }
  return ''
}

export function searchConversationBodies(storageData, query, { limit = 80 } = {}) {
  const needle = String(query || '')
    .trim()
    .toLowerCase()
  if (!needle) return []

  const hits = []
  for (const [key, record] of Object.entries(storageData)) {
    const id = snapshotIdFromKey(key)
    if (!id) continue
    const parts = []
    collectSearchableStrings(record, parts, 4000)
    const matched = parts.some((part) => part.toLowerCase().includes(needle))
    if (!matched) continue
    const snapshot = record?.snapshot || {}
    hits.push({
      id,
      title: pickLibraryConversationTitle(
        storageData[CHATGPT_WEB_CONVERSATION_INDEX_KEY]?.[id],
        snapshot.title,
      ),
      snippet: firstSnippet(parts, needle),
    })
    if (hits.length >= limit) break
  }
  return hits
}

export async function writeMergedHistoryVolume(library, outputPath) {
  const payload = {
    scope: CHATGPT_WEB_HISTORY_EXPORT_SCOPE,
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    exportId: library.exportId || '',
    volume: { index: 1, count: 1 },
    storage: library.storage,
    summary: library.summary,
    mergedFrom: library.volumes.map((volume) => ({
      filename: volume.filename,
      bytes: volume.bytes,
      volume: volume.volume,
    })),
  }
  await writeFile(outputPath, JSON.stringify(payload))
  return outputPath
}
