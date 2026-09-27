import Browser from 'webextension-polyfill'

export const CHATGPT_WEB_TURN_STATUS_KEY = 'chatgptWebTurnStatuses'
const MAX_FINISHED_TURNS = 30
const TERMINAL = new Set(['completed', 'failed'])
const live = new Map()
let persistQueue = Promise.resolve()

function trim(records) {
  const entries = Object.entries(records)
  const running = entries.filter(([, record]) => !TERMINAL.has(record?.status))
  const finished = entries.filter(([, record]) => TERMINAL.has(record?.status))
  return Object.fromEntries(
    running.concat(
      finished
        .sort(([, left], [, right]) =>
          String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')),
        )
        .slice(0, MAX_FINISHED_TURNS),
    ),
  )
}

export function recordChatgptWebTurnStatus({
  conversationId,
  messageId,
  status,
  text,
  error,
  query,
  thoughtDurationSec,
} = {}) {
  if (!conversationId || !messageId) return null
  const previous = live.get(messageId)
  if (previous && previous.conversationId !== conversationId) return null
  if (previous && TERMINAL.has(previous.status)) return previous
  const next = {
    conversationId,
    messageId,
    status: TERMINAL.has(status) ? status : 'running',
    text: typeof text === 'string' ? text : previous?.text || '',
    error: typeof error === 'string' ? error : previous?.error || null,
    query: typeof query === 'string' ? query : previous?.query || '',
    thoughtDurationSec:
      Number.isFinite(thoughtDurationSec) && thoughtDurationSec >= 0
        ? thoughtDurationSec
        : previous?.thoughtDurationSec ?? null,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  live.set(messageId, next)
  const excessFinished = [...live.entries()]
    .filter(([, record]) => TERMINAL.has(record.status))
    .sort(([, left], [, right]) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(MAX_FINISHED_TURNS)
  for (const [oldMessageId] of excessFinished) live.delete(oldMessageId)
  persistQueue = persistQueue
    .catch(() => {})
    .then(async () => {
      const stored = await Browser.storage.local.get({ [CHATGPT_WEB_TURN_STATUS_KEY]: {} })
      await Browser.storage.local.set({
        [CHATGPT_WEB_TURN_STATUS_KEY]: trim({
          ...(stored[CHATGPT_WEB_TURN_STATUS_KEY] || {}),
          ...Object.fromEntries(live),
        }),
      })
    })
    .catch(() => {})
  return next
}

export async function getChatgptWebTurnStatus({ conversationId, messageId } = {}) {
  if (!conversationId || !messageId) return null
  let record = live.get(messageId)
  if (!record) {
    const stored = await Browser.storage.local.get({ [CHATGPT_WEB_TURN_STATUS_KEY]: {} })
    record = stored[CHATGPT_WEB_TURN_STATUS_KEY]?.[messageId] || null
  }
  return record?.conversationId === conversationId ? record : null
}
