import { useEffect, useRef, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import {
  listCachedChatgptConversations,
  readChatgptConversationForExport,
} from '../../services/clients/chatgpt-web/conversation-library.mjs'
import {
  buildConversationExportFilename,
  conversationToMarkdown,
  parseChatgptConversationReference,
} from '../../services/clients/chatgpt-web/conversation-export.mjs'
import { exportChatgptHistoryData } from '../../services/clients/chatgpt-web/history-transfer.mjs'
import { downloadJsonFile, downloadTextFile } from '../../popup/file-transfer.mjs'
import './styles.css'

const PAGE_SIZE = 20

function displayTime(value) {
  if (!value) return ''
  const numeric = Number(value)
  const date = new Date(
    Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value,
  )
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export default function ChatgptHistoryBrowser() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [list, setList] = useState({ items: [], total: 0 })
  const [listBusy, setListBusy] = useState(false)
  const [reference, setReference] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [conversation, setConversation] = useState(null)
  const [messageOffset, setMessageOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const listRequest = useRef(0)

  useEffect(() => {
    const request = ++listRequest.current
    setListBusy(true)
    listCachedChatgptConversations({ query, filter, offset, limit: PAGE_SIZE })
      .then((result) => {
        if (request === listRequest.current) {
          setList(result)
          if (offset >= result.total && offset > 0) setOffset(0)
        }
      })
      .catch((reason) => {
        if (request === listRequest.current) setError(reason.message || String(reason))
      })
      .finally(() => {
        if (request === listRequest.current) setListBusy(false)
      })
    return () => {
      listRequest.current += 1
    }
  }, [query, filter, offset, revision])

  function showPreview(result) {
    setConversation(result)
    const count = result?.messages?.length || 0
    setMessageOffset(Math.max(0, Math.ceil(count / PAGE_SIZE) - 1) * PAGE_SIZE)
  }

  async function runAction(value, action, refresh = false) {
    setError('')
    setNotice('')
    setBusy(true)
    let id
    try {
      id = parseChatgptConversationReference(value)
      setSelectedId(id)
      setReference(value)
      setConversation(null)
      let result =
        action === 'preview' && !refresh
          ? await readChatgptConversationForExport(id, { cachedOnly: true })
          : null
      if (!result) result = await readChatgptConversationForExport(id, { refresh })
      showPreview(result)
      if (action === 'json') {
        const backup = await exportChatgptHistoryData({
          conversationIds: [id],
          maxVolumeBytes: Infinity,
        })
        if (backup.summary.partialSnapshotCount)
          throw new Error('Conversation history is incomplete; try loading it again')
        downloadJsonFile(backup.volumes[0], buildConversationExportFilename(result, 'json'), {
          pretty: false,
        })
      } else if (action === 'markdown') {
        downloadTextFile(
          conversationToMarkdown(result),
          buildConversationExportFilename(result, 'md'),
          { type: 'text/markdown;charset=utf-8' },
        )
      }
      if (action === 'json' || action === 'markdown') setNotice(t('Conversation exported'))
    } catch (reason) {
      setError(t(reason.message || String(reason)))
      if (id) {
        const cached = await readChatgptConversationForExport(id, { cachedOnly: true }).catch(
          () => null,
        )
        if (cached) showPreview(cached)
      }
    } finally {
      setBusy(false)
      setRevision((value) => value + 1)
    }
  }

  const messages = conversation?.messages || []
  const selectedReference = reference.trim() || selectedId
  return (
    <div className="chatgpt-history-browser">
      <p className="history-browser-hint">
        {t(
          'Browse the local conversation list. Only the conversation you open or export is downloaded when its cache needs updating.',
        )}
      </p>
      <div className="history-browser-controls">
        <input
          aria-label={t('Search conversations')}
          placeholder={t('Search by title or ID')}
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setOffset(0)
          }}
        />
        <select
          aria-label={t('Conversation filter')}
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value)
            setOffset(0)
          }}
        >
          <option value="all">{t('All conversations')}</option>
          <option value="active">{t('Active conversations')}</option>
          <option value="archived">{t('Archived conversations')}</option>
        </select>
        <button type="button" disabled={listBusy} onClick={() => setRevision((value) => value + 1)}>
          {t('Refresh local list')}
        </button>
      </div>
      <div className="history-browser-controls history-browser-direct">
        <input
          aria-label={t('Conversation ID or link')}
          placeholder={t('Paste a ChatGPT conversation link or ID')}
          value={reference}
          disabled={busy}
          onInput={(event) => setReference(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy && selectedReference)
              void runAction(selectedReference, 'preview')
          }}
        />
        <button
          type="button"
          disabled={busy || !selectedReference}
          onClick={() => void runAction(selectedReference, 'preview')}
        >
          {t('Preview conversation')}
        </button>
        <button
          type="button"
          disabled={busy || !selectedReference}
          onClick={() => void runAction(selectedReference, 'json')}
        >
          {t('Export JSON')}
        </button>
        <button
          type="button"
          disabled={busy || !selectedReference}
          onClick={() => void runAction(selectedReference, 'markdown')}
        >
          {t('Export Markdown')}
        </button>
      </div>
      {busy && <div role="status">{t('Loading selected conversation...')}</div>}
      {error && (
        <div className="history-browser-error" role="alert">
          {error}
        </div>
      )}
      {notice && <div role="status">{notice}</div>}
      <div className="history-browser-grid">
        <div>
          <div className="history-browser-list" aria-label={t('Conversation list')}>
            {!list.items.length && (
              <p className="history-browser-empty">
                {listBusy
                  ? t('Loading...')
                  : t(
                      'No matching local conversations. Sync the history list in settings, or paste a conversation link above.',
                    )}
              </p>
            )}
            {list.items.map((item) => (
              <div
                key={item.id}
                className={`history-browser-row ${item.id === selectedId ? 'is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="history-browser-title"
                  disabled={busy}
                  onClick={() => void runAction(item.id, 'preview')}
                >
                  <strong>{item.title}</strong>
                  <small>{displayTime(item.updateTime)}</small>
                  <small>{item.id}</small>
                </button>
                <div className="history-browser-row-actions">
                  <span>
                    {t(
                      !item.hasSnapshot
                        ? 'Body not cached'
                        : item.historyComplete === false
                        ? 'Partial cache'
                        : 'Cached',
                    )}
                    {item.isArchived ? ` · ${t('Archived')}` : ''}
                  </span>
                  <button
                    type="button"
                    aria-label={`${t('Export JSON')}: ${item.title}`}
                    disabled={busy}
                    onClick={() => void runAction(item.id, 'json')}
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('Export Markdown')}: ${item.title}`}
                    disabled={busy}
                    onClick={() => void runAction(item.id, 'markdown')}
                  >
                    MD
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="history-browser-pagination">
            <button
              type="button"
              disabled={listBusy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t('Previous')}
            </button>
            <span>
              {list.total
                ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, list.total)} / ${list.total}`
                : '0'}
            </span>
            <button
              type="button"
              disabled={listBusy || offset + PAGE_SIZE >= list.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t('Next')}
            </button>
          </div>
        </div>
        <div className="history-browser-preview" aria-label={t('Conversation preview')}>
          {!conversation ? (
            <p className="history-browser-empty">
              {t('Select a conversation to preview its messages')}
            </p>
          ) : (
            <>
              <div className="history-browser-preview-header">
                <strong>{conversation.title || selectedId}</strong>
                <small>
                  {t(conversation.history?.complete ? 'Complete cache' : 'Partial cache')}
                  {conversation.history?.scope === 'current_branch'
                    ? ` · ${t('Current branch')}`
                    : ''}
                </small>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(selectedId, 'load', conversation.history?.complete === true)
                  }
                >
                  {t(
                    conversation.history?.complete
                      ? 'Refresh conversation'
                      : 'Load remaining history',
                  )}
                </button>
              </div>
              <div className="history-browser-messages">
                {!messages.length && (
                  <p className="history-browser-empty">
                    {t('No visible messages in this conversation')}
                  </p>
                )}
                {messages.slice(messageOffset, messageOffset + PAGE_SIZE).map((message, index) => (
                  <article
                    key={message.messageId || `${messageOffset}-${index}`}
                    className={`history-browser-message history-browser-message-${message.role}`}
                  >
                    <strong>{t(message.role === 'user' ? 'User' : 'Assistant')}</strong>
                    {message.thoughtDurationLabel && <small>{message.thoughtDurationLabel}</small>}
                    <pre>{message.text}</pre>
                  </article>
                ))}
              </div>
              <div className="history-browser-pagination">
                <button
                  type="button"
                  disabled={messageOffset === 0}
                  onClick={() => setMessageOffset(Math.max(0, messageOffset - PAGE_SIZE))}
                >
                  {t('Earlier messages')}
                </button>
                <span>
                  {messages.length
                    ? `${messageOffset + 1}–${Math.min(
                        messageOffset + PAGE_SIZE,
                        messages.length,
                      )} / ${messages.length}`
                    : '0'}
                </span>
                <button
                  type="button"
                  disabled={messageOffset + PAGE_SIZE >= messages.length}
                  onClick={() => setMessageOffset(messageOffset + PAGE_SIZE)}
                >
                  {t('Later messages')}
                </button>
              </div>
              <p className="history-browser-hint">
                {t('Preview shows 20 messages per page. Export includes every loaded message.')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
