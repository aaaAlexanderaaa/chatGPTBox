import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../../config/index.mjs'
import { initSession } from '../../services/init-session.mjs'
import {
  findStoredChatgptWebApiThreadContinuation,
  saveChatgptWebApiThread,
  saveChatgptWebSessionSnapshot,
} from '../../services/chatgpt-web-thread-state.mjs'
import {
  extractChatgptWebConversationListItems,
  formatChatgptWebConversationListItem,
} from '../../services/apis/chatgpt-web-conversation-state.mjs'
import { Models, chatgptWebModelKeys } from '../../config/index.mjs'
import { modelNameToApiMode } from '../../utils/model-name-convert.mjs'
import './styles.css'

const RECONNECT_DELAY = 3000
const MAX_LOG_ENTRIES = 200
const HEALTH_CHECK_INTERVAL = 15000
const PORT_KEEPALIVE_MS = 20_000

function slugToModelKey(slug) {
  const normalized = (slug || '').trim()
  for (const key of chatgptWebModelKeys) {
    if (Models[key] && Models[key].value === normalized) return key
  }
  if (Models[normalized]) return normalized
  return 'chatgptWeb54Thinking'
}

function formatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  if (messages.length === 1) return messages[0].content
  return messages
    .map((msg) => {
      const role =
        msg.role === 'system' ? 'System' : msg.role === 'assistant' ? 'Assistant' : 'User'
      return `${role}: ${msg.content}`
    })
    .join('\n\n')
}

function App() {
  const [enabled, setEnabled] = useState(null)
  const [port, setPort] = useState(18080)
  const [portInput, setPortInput] = useState('18080')
  const [status, setStatus] = useState('initializing')
  const [logs, setLogs] = useState([])
  const [requestCount, setRequestCount] = useState(0)
  const [serverHealth, setServerHealth] = useState(null)
  const [diag, setDiag] = useState(null)
  const [conversationIdInput, setConversationIdInput] = useState('')
  const [conversationList, setConversationList] = useState([])
  const [conversationListLoading, setConversationListLoading] = useState(false)
  const [conversationRefreshLoading, setConversationRefreshLoading] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [conversationPayload, setConversationPayload] = useState(null)

  const proxyPort = useRef(null)
  const reconnectTimer = useRef(null)
  const logsEndRef = useRef(null)
  const autoReconnect = useRef(true)
  const healthTimer = useRef(null)
  const keepaliveTimer = useRef(null)

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  const addLog = useCallback((msg, type = 'info') => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toISOString(), msg, type }]
      return next.slice(-MAX_LOG_ENTRIES)
    })
  }, [])

  // -----------------------------------------------------------------------
  // Load config
  // -----------------------------------------------------------------------

  useEffect(() => {
    getUserConfig().then((config) => {
      const p = Number(config.apiServerPort) || 18080
      setPort(p)
      setPortInput(String(p))
      setEnabled(config.apiServerEnabled === true)
    })
  }, [])

  // -----------------------------------------------------------------------
  // Build WebSocket URL from port
  // -----------------------------------------------------------------------

  const wsUrl = `ws://127.0.0.1:${port}/bridge`
  const baseUrl = `http://127.0.0.1:${port}`

  // -----------------------------------------------------------------------
  // Send data to API server via the background-proxied WebSocket
  // -----------------------------------------------------------------------

  const sendWs = useCallback((data) => {
    if (proxyPort.current) {
      proxyPort.current.postMessage({ action: 'send', payload: JSON.stringify(data) })
    }
  }, [])

  const fetchServerJson = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, options)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          data?.error?.message || `Request failed with ${response.status} ${response.statusText}`,
        )
      }
      return data
    },
    [baseUrl],
  )

  const syncBridgeConfig = useCallback(async (targetPort = proxyPort.current) => {
    if (!targetPort) return
    try {
      const runtimeConfig = await getUserConfig()
      targetPort.postMessage({
        action: 'send',
        payload: JSON.stringify({
          type: 'bridge_config',
          requestTimeoutSeconds: runtimeConfig.apiServerRequestTimeoutSeconds,
          thinkingRequestTimeoutSeconds: runtimeConfig.apiServerThinkingTimeoutSeconds,
        }),
      })
    } catch {
      /* ignore config sync errors */
    }
  }, [])

  // -----------------------------------------------------------------------
  // Handle incoming request from API server
  // -----------------------------------------------------------------------

  const handleRequest = useCallback(
    async (data) => {
      const { id, model, messages, stream } = data
      const modelKey = slugToModelKey(model)
      const apiMode = modelNameToApiMode(modelKey)
      const isThinkingRequest = typeof model === 'string' && model.trim().endsWith('-thinking')
      const continuation = isThinkingRequest
        ? await findStoredChatgptWebApiThreadContinuation({ model, messages }).catch(() => null)
        : null
      const question = continuation
        ? continuation.nextUserMessage.content
        : formatMessages(messages)

      addLog(`Request ${id.slice(0, 8)}...: model=${model} → ${modelKey}`)
      if (continuation) {
        addLog(
          `Reusing ChatGPT conversation ${continuation.conversationId.slice(
            0,
            8,
          )}... for follow-up thinking request`,
        )
      }
      setRequestCount((c) => c + 1)

      const runtimeConfigPromise = getUserConfig()

      const session = initSession({
        question,
        modelName: modelKey,
        apiMode: apiMode || null,
        conversationRecords: [],
        chatgptWebIncrementalOutput: stream === true,
      })
      session.chatgptWebModelSlugOverride = (model || '').trim() || undefined
      if (continuation) {
        session.conversationId = continuation.conversationId
        session.parentMessageId = continuation.parentMessageId
        void saveChatgptWebSessionSnapshot(session, { source: 'api-server-bridge' }).catch(() => {})
      }

      let bgPort
      try {
        bgPort = Browser.runtime.connect()
      } catch (err) {
        addLog(`Failed to connect to extension background: ${err.message}`, 'error')
        sendWs({ type: 'error', id, error: err.message || 'Failed to connect to extension' })
        return
      }

      let lastAnswer = ''
      let finished = false
      let latestSession = session

      bgPort.onMessage.addListener((msg) => {
        if (finished) return

        if (msg.error) {
          finished = true
          const errText = msg.error
          addLog(`Error ${id.slice(0, 8)}...: ${errText}`, 'error')
          if (/failed to fetch/i.test(errText)) {
            addLog(
              'Tip: Open chatgpt.com in this browser and log in. The extension routes ChatGPT Web requests through a dedicated background proxy tab.',
              'warn',
            )
          }
          sendWs({ type: 'error', id, error: msg.error })
          try {
            bgPort.disconnect()
          } catch {
            /* ignore */
          }
          return
        }

        if (msg.session) {
          latestSession = { ...latestSession, ...msg.session }
          void saveChatgptWebSessionSnapshot(latestSession, { source: 'api-server-bridge' }).catch(
            () => {},
          )
        }

        if (msg.answer !== undefined) {
          lastAnswer = msg.answer
          if (!msg.done) {
            sendWs({ type: 'chunk', id, answer: msg.answer })
          }
        }

        if (msg.done) {
          finished = true
          addLog(`Done ${id.slice(0, 8)}...: ${lastAnswer.length} chars`)
          if (isThinkingRequest && lastAnswer && latestSession?.conversationId) {
            void saveChatgptWebApiThread({
              model,
              messages,
              answer: lastAnswer,
              session: latestSession,
            }).catch(() => {})
          }
          sendWs({ type: 'done', id, answer: lastAnswer })
          try {
            bgPort.disconnect()
          } catch {
            /* ignore */
          }
        }
      })

      bgPort.onDisconnect.addListener(() => {
        if (finished) return
        finished = true
        const errorMessage = lastAnswer
          ? 'Extension background disconnected before response completed'
          : 'Extension background disconnected before responding'
        addLog(
          `${errorMessage}${lastAnswer ? ` (${lastAnswer.length} chars received)` : ''}`,
          'error',
        )
        sendWs({
          type: 'error',
          id,
          error: errorMessage,
        })
      })

      try {
        const runtimeConfig = await runtimeConfigPromise
        session.autoClean = runtimeConfig.apiServerKeepHistory !== true
        session.chatgptWebHistoryDisabledOverride = runtimeConfig.apiServerKeepHistory !== true
        bgPort.postMessage({ session })
      } catch (err) {
        if (!finished) {
          finished = true
          addLog(`Send error: ${err.message}`, 'error')
          sendWs({ type: 'error', id, error: err.message || 'Failed to send to extension' })
        }
      }
    },
    [addLog, sendWs],
  )

  const handleControlRequest = useCallback(
    async (data) => {
      const { id, action, payload } = data
      try {
        let response
        switch (action) {
          case 'chatgpt_web_list_conversations':
            response = await Browser.runtime.sendMessage({
              type: 'CHATGPT_WEB_LIST_CONVERSATIONS',
              data: payload || {},
            })
            break
          case 'chatgpt_web_get_conversation':
            response = await Browser.runtime.sendMessage({
              type: 'CHATGPT_WEB_GET_CONVERSATION',
              data: payload || {},
            })
            break
          case 'chatgpt_web_refresh_conversation':
            response = await Browser.runtime.sendMessage({
              type: 'CHATGPT_WEB_REFRESH_CONVERSATION',
              data: payload || {},
            })
            break
          case 'chatgpt_web_list_models':
            response = await Browser.runtime.sendMessage({
              type: 'CHATGPT_WEB_LIST_MODELS',
              data: payload || {},
            })
            break
          default:
            throw new Error(`Unsupported control action: ${action}`)
        }
        sendWs({ type: 'control_response', id, data: response })
      } catch (error) {
        addLog(`Control ${action}: ${error.message || error}`, 'error')
        sendWs({ type: 'control_error', id, error: error.message || String(error) })
      }
    },
    [addLog, sendWs],
  )

  const loadConversationList = useCallback(async () => {
    setConversationListLoading(true)
    setConversationError('')
    try {
      const data = await fetchServerJson('/chatgpt/conversations?offset=0&limit=28&order=updated')
      const items = extractChatgptWebConversationListItems(data).map((item) => ({
        ...formatChatgptWebConversationListItem(item),
        rawItem: item,
      }))
      setConversationList(items)
      setConversationPayload(data)
      addLog(`Loaded ${items.length} ChatGPT conversations`)
    } catch (error) {
      setConversationError(error.message || String(error))
      addLog(`Conversation list failed: ${error.message || error}`, 'error')
    } finally {
      setConversationListLoading(false)
    }
  }, [addLog, fetchServerJson])

  const refreshConversation = useCallback(async () => {
    const conversationId = conversationIdInput.trim()
    if (!conversationId) {
      setConversationError('Conversation ID is required')
      return
    }

    setConversationRefreshLoading(true)
    setConversationError('')
    try {
      const data = await fetchServerJson(
        `/chatgpt/conversations/${encodeURIComponent(conversationId)}/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            preferResume: true,
            resumeTimeoutMs: 10_000,
          }),
        },
      )
      setConversationPayload(data)
      addLog(
        `Conversation ${conversationId.slice(0, 8)}... refreshed: pending=${
          data?.pending === true
        }`,
      )
    } catch (error) {
      setConversationError(error.message || String(error))
      addLog(`Conversation refresh failed: ${error.message || error}`, 'error')
    } finally {
      setConversationRefreshLoading(false)
    }
  }, [addLog, conversationIdInput, fetchServerJson])

  // -----------------------------------------------------------------------
  // Connect via background-proxied WebSocket
  // -----------------------------------------------------------------------

  const connect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }

    autoReconnect.current = true

    if (proxyPort.current) {
      proxyPort.current.postMessage({ action: 'close' })
      try {
        proxyPort.current.disconnect()
      } catch {
        /* ignore */
      }
      proxyPort.current = null
    }

    setStatus('connecting')
    addLog(`Connecting to ${wsUrl} (via service worker)...`)

    let pp
    try {
      pp = Browser.runtime.connect({ name: 'api-bridge-proxy' })
    } catch (err) {
      addLog(`Failed to open proxy channel: ${err.message}`, 'error')
      setStatus('disconnected')
      if (autoReconnect.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
      }
      return
    }

    proxyPort.current = pp

    pp.onMessage.addListener((msg) => {
      if (msg.type === 'open') {
        setStatus('connected')
        addLog('Connected to API server', 'success')
        void syncBridgeConfig(pp)

        if (keepaliveTimer.current) clearInterval(keepaliveTimer.current)
        keepaliveTimer.current = setInterval(() => {
          try {
            pp.postMessage({ action: 'keepalive' })
          } catch {
            /* port already dead — the onDisconnect handler will clean up */
          }
        }, PORT_KEEPALIVE_MS)
      } else if (msg.type === 'close') {
        if (proxyPort.current !== pp) return
        if (keepaliveTimer.current) {
          clearInterval(keepaliveTimer.current)
          keepaliveTimer.current = null
        }
        proxyPort.current = null
        setStatus('disconnected')
        addLog('WebSocket disconnected')
        if (autoReconnect.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
        }
      } else if (msg.type === 'error') {
        addLog(
          `Connection error: ${msg.message || 'unknown'} — is the API server running?`,
          'error',
        )
      } else if (msg.type === 'message') {
        let data
        try {
          data = JSON.parse(msg.data)
        } catch {
          return
        }
        if (data.type === 'request') {
          handleRequest(data)
        } else if (data.type === 'control_request') {
          handleControlRequest(data)
        }
      }
    })

    pp.onDisconnect.addListener(() => {
      if (proxyPort.current !== pp) return
      if (keepaliveTimer.current) {
        clearInterval(keepaliveTimer.current)
        keepaliveTimer.current = null
      }
      proxyPort.current = null
      setStatus('disconnected')
      addLog('Proxy channel closed')
      if (autoReconnect.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
      }
    })

    pp.postMessage({ action: 'connect', url: wsUrl })
  }, [wsUrl, addLog, handleControlRequest, handleRequest, syncBridgeConfig])

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  const disconnect = useCallback(() => {
    autoReconnect.current = false

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }

    if (keepaliveTimer.current) {
      clearInterval(keepaliveTimer.current)
      keepaliveTimer.current = null
    }

    if (proxyPort.current) {
      proxyPort.current.postMessage({ action: 'close' })
      try {
        proxyPort.current.disconnect()
      } catch {
        /* ignore */
      }
      proxyPort.current = null
    }

    setStatus('disconnected')
    addLog('Disconnected')
  }, [addLog])

  // -----------------------------------------------------------------------
  // Health check + diagnostics
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (status !== 'connected') {
      setServerHealth(null)
      setDiag(null)
      return
    }

    function checkHealth() {
      void syncBridgeConfig()
      fetch(`${baseUrl}/health`)
        .then((r) => r.json())
        .then((h) => setServerHealth(h))
        .catch(() => setServerHealth(null))
    }

    function runDiag() {
      Browser.runtime
        .sendMessage({ type: 'API_BRIDGE_DIAGNOSE' })
        .then((result) => {
          setDiag(result)
          if (result && !result.chatgptTabOk && !result.canFetchChatgpt) {
            addLog(
              'Warning: Cannot reach chatgpt.com from background. Open chatgpt.com and log in so requests can be routed through the dedicated background proxy tab.',
              'warn',
            )
          }
        })
        .catch(() => setDiag(null))
    }

    checkHealth()
    runDiag()
    healthTimer.current = setInterval(checkHealth, HEALTH_CHECK_INTERVAL)
    return () => clearInterval(healthTimer.current)
  }, [status, baseUrl, addLog, syncBridgeConfig])

  // -----------------------------------------------------------------------
  // Auto-connect on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (enabled === null) return
    if (!enabled) {
      setStatus('disabled')
      addLog('API Server bridge is disabled in extension settings.', 'warn')
      return
    }
    connect()
    return () => disconnect()
  }, [enabled])

  // -----------------------------------------------------------------------
  // Scroll logs
  // -----------------------------------------------------------------------

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // -----------------------------------------------------------------------
  // Port save
  // -----------------------------------------------------------------------

  const savePort = useCallback(() => {
    const n = parseInt(portInput, 10)
    if (Number.isNaN(n) || n < 1 || n > 65535) {
      addLog('Invalid port: must be 1–65535', 'error')
      return
    }
    setPort(n)
    setUserConfig({ apiServerPort: n })
    addLog(`Port updated to ${n}. Reconnecting...`)
    disconnect()
    setTimeout(() => {
      autoReconnect.current = true
      connect()
    }, 500)
  }, [portInput, addLog, disconnect, connect])

  // -----------------------------------------------------------------------
  // Toggle enable
  // -----------------------------------------------------------------------

  const toggleEnabled = useCallback(() => {
    const next = !enabled
    setEnabled(next)
    setUserConfig({ apiServerEnabled: next })
    if (next) {
      addLog('API Server bridge enabled')
      connect()
    } else {
      addLog('API Server bridge disabled')
      disconnect()
      setStatus('disabled')
    }
  }, [enabled, addLog, connect, disconnect])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const statusColor =
    status === 'connected'
      ? '#22c55e'
      : status === 'connecting'
      ? '#eab308'
      : status === 'disabled'
      ? '#6b7280'
      : '#ef4444'

  const showPort = port !== 18080
  const selectedConversationId = conversationIdInput.trim()

  return (
    <div className="api-server-container">
      <header className="api-server-header">
        <h1>ChatGPTBox API Server Bridge</h1>
        <p className="subtitle">
          Bridges the local API server to the ChatGPT Web backend via this extension.
        </p>
      </header>

      <section className="api-server-status">
        <div className="status-row">
          <span className="status-dot" style={{ backgroundColor: statusColor }} />
          <span className="status-text">{status}</span>
          <span className="request-count">{requestCount} requests served</span>
        </div>

        <div className="control-row">
          <label className="toggle-label">
            <input type="checkbox" checked={!!enabled} onChange={toggleEnabled} />
            <span>Enable API Server Bridge</span>
          </label>
        </div>

        <div className="url-row">
          <label className="port-label">Port:</label>
          <input
            type="text"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            placeholder="18080"
            disabled={status === 'connected'}
            className="port-input"
          />
          {status !== 'connected' && portInput !== String(port) && (
            <button onClick={savePort} className="btn-save">
              Save
            </button>
          )}
          {enabled && status === 'connected' ? (
            <button onClick={disconnect} className="btn-disconnect">
              Disconnect
            </button>
          ) : enabled && status !== 'disabled' ? (
            <button onClick={connect} className="btn-connect">
              Connect
            </button>
          ) : null}
        </div>
      </section>

      {serverHealth && (
        <section className="api-server-health">
          <h3>Server Health</h3>
          <div className="health-grid">
            <div className="health-item">
              <span className="health-label">Status</span>
              <span className={`health-value health-${serverHealth.status}`}>
                {serverHealth.status}
              </span>
            </div>
            <div className="health-item">
              <span className="health-label">Uptime</span>
              <span className="health-value">{serverHealth.server?.uptime}</span>
            </div>
            <div className="health-item">
              <span className="health-label">Bridge</span>
              <span className="health-value">{serverHealth.bridge?.type || 'none'}</span>
            </div>
            <div className="health-item">
              <span className="health-label">Total Requests</span>
              <span className="health-value">{serverHealth.stats?.total_requests}</span>
            </div>
            <div className="health-item">
              <span className="health-label">Errors</span>
              <span
                className={`health-value ${
                  serverHealth.stats?.total_errors > 0 ? 'health-degraded' : ''
                }`}
              >
                {serverHealth.stats?.total_errors}
              </span>
            </div>
            <div className="health-item">
              <span className="health-label">Pending</span>
              <span className="health-value">{serverHealth.stats?.pending_requests}</span>
            </div>
            <div className="health-item">
              <span className="health-label">Timeout</span>
              <span className="health-value">{serverHealth.timeouts?.request_seconds}s</span>
            </div>
            <div className="health-item">
              <span className="health-label">Thinking Timeout</span>
              <span className="health-value">
                {serverHealth.timeouts?.thinking_request_seconds}s
              </span>
            </div>
          </div>
        </section>
      )}

      {diag && !diag.chatgptTabOk && !diag.canFetchChatgpt && (
        <section className="api-server-warn">
          <strong>ChatGPT Web models will not work yet.</strong>
          <p>
            This browser is blocking direct requests to chatgpt.com from the extension. To fix this,
            open{' '}
            <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
              chatgpt.com
            </a>{' '}
            in a tab in this browser and make sure you are logged in. The extension will
            automatically route requests through a dedicated background proxy tab.
          </p>
        </section>
      )}

      <section className="api-server-usage">
        <h3>Usage</h3>
        <ol>
          <li>Enable the API Server Bridge above</li>
          <li>
            Run <code>npm run api-server{showPort ? ` -- --port ${port}` : ''}</code> in a terminal
          </li>
          <li>Keep this page open (it bridges the API server to ChatGPT)</li>
          <li>
            Make sure you are logged in at{' '}
            <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
              chatgpt.com
            </a>
          </li>
          <li>
            Send requests to <code>http://127.0.0.1:{port}/v1/chat/completions</code>
          </li>
        </ol>
        <details>
          <summary>Example curl command</summary>
          <pre>{`curl http://127.0.0.1:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5-2",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'`}</pre>
        </details>
        <details>
          <summary>Configuration</summary>
          <div className="config-help">
            <p>
              <strong>Port:</strong> Change the port above, or start the server with{' '}
              <code>--port &lt;number&gt;</code> or set{' '}
              <code>CHATGPT_GATEWAY_PORT=&lt;number&gt;</code>.
            </p>
            <p>
              <strong>Enable/Disable:</strong> Use the toggle above. When disabled, the bridge will
              not connect to the API server.
            </p>
            <p>
              <strong>Status and health:</strong> Visit <code>http://127.0.0.1:{port}/status</code>{' '}
              for a quick bridge check, or <code>http://127.0.0.1:{port}/health</code> for detailed
              diagnostics.
            </p>
            <p>
              <strong>Conversation APIs:</strong> Use <code>GET /chatgpt/conversations</code>,{' '}
              <code>GET /chatgpt/conversations/&lt;id&gt;</code>, and{' '}
              <code>POST /chatgpt/conversations/&lt;id&gt;/refresh</code> for manual async
              inspection and refresh.
            </p>
          </div>
        </details>
      </section>

      <section className="api-server-conversations">
        <h3>ChatGPT Conversations</h3>
        <p className="conversation-subtitle">
          Manually inspect async thinking conversations through the local API server.
        </p>

        <div className="conversation-toolbar">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadConversationList()}
            disabled={conversationListLoading || status !== 'connected'}
          >
            {conversationListLoading ? 'Loading…' : 'Refresh Conversation List'}
          </button>

          <input
            type="text"
            value={conversationIdInput}
            onChange={(event) => setConversationIdInput(event.target.value)}
            placeholder="Conversation ID"
            className="conversation-input"
          />

          <button
            type="button"
            className="btn-secondary"
            onClick={() => void refreshConversation()}
            disabled={conversationRefreshLoading || status !== 'connected'}
          >
            {conversationRefreshLoading ? 'Refreshing…' : 'Refresh Conversation'}
          </button>
        </div>

        {conversationError && <div className="conversation-error">{conversationError}</div>}

        <div className="conversation-grid">
          <div className="conversation-list">
            {conversationList.length === 0 ? (
              <div className="conversation-empty">No conversation list loaded yet.</div>
            ) : (
              conversationList.map((item) => {
                const active = item.id === selectedConversationId
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`conversation-item ${active ? 'conversation-item-active' : ''}`}
                    onClick={() => {
                      setConversationIdInput(item.id || '')
                      setConversationPayload(item.rawItem || item)
                    }}
                  >
                    <div className="conversation-item-top">
                      <span className="conversation-title">{item.title || 'Untitled'}</span>
                      <span
                        className={`conversation-badge ${
                          item.pending ? 'conversation-badge-pending' : 'conversation-badge-ready'
                        }`}
                      >
                        {item.pending ? `pending (${item.asyncStatus ?? '...'})` : 'ready'}
                      </span>
                    </div>
                    <div className="conversation-meta">{item.id}</div>
                    <div className="conversation-meta">
                      Updated: {item.updateTime || item.createTime || 'unknown'}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="conversation-details">
            {conversationPayload?.text && (
              <div className="conversation-preview">
                <div className="conversation-preview-label">Extracted Text</div>
                <pre>{conversationPayload.text}</pre>
              </div>
            )}

            <textarea
              readOnly
              rows={16}
              value={conversationPayload ? JSON.stringify(conversationPayload, null, 2) : ''}
              placeholder="Conversation details will appear here"
              className="conversation-json"
            />
          </div>
        </div>

        <details className="conversation-help">
          <summary>Example commands</summary>
          <pre>{`curl http://127.0.0.1:${port}/status

curl http://127.0.0.1:${port}/chatgpt/conversations

curl http://127.0.0.1:${port}/chatgpt/conversations/<conversation-id>

curl -X POST http://127.0.0.1:${port}/chatgpt/conversations/<conversation-id>/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"preferResume":true,"resumeTimeoutMs":10000}'`}</pre>
        </details>
      </section>

      <section className="api-server-logs">
        <h3>
          Log
          {logs.length > 0 && (
            <button className="btn-clear-logs" onClick={() => setLogs([])}>
              Clear
            </button>
          )}
        </h3>
        <div className="log-container">
          {logs.length === 0 && <div className="log-empty">No log entries yet.</div>}
          {logs.map((entry, i) => (
            <div key={i} className={`log-entry log-${entry.type}`}>
              <span className="log-time">{entry.time.split('T')[1].split('.')[0]}</span>
              <span className="log-msg">{entry.msg}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  )
}

export default App
