import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../../config/storage.mjs'
import { initSession } from '../../services/init-session.mjs'
import {
  findStoredChatgptWebApiThreadContinuation,
  saveChatgptWebApiThread,
  saveChatgptWebSessionSnapshot,
} from '../../services/clients/chatgpt-web/thread-state.mjs'
import {
  extractChatgptWebConversationListItems,
  formatChatgptWebConversationListItem,
} from '../../services/clients/chatgpt-web/conversation-state.mjs'
import {
  exportConversationCache,
  importConversationCache,
} from '../../services/clients/chatgpt-web/conversation-cache.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_KEY } from '../../config/limits.mjs'
import { Models, chatgptWebModelKeys } from '../../config/models.mjs'
import { modelNameToApiMode } from '../../utils/model-name-convert.mjs'
import { needsChatgptWebThinkingEffort } from '../../services/clients/chatgpt-web/thinking.mjs'
import { CHATGPT_PROXY_CONTROL_ACTIONS, RuntimeMessage } from '../../protocol/messages.mjs'
import './styles.css'

const RECONNECT_DELAY = 3000
const MAX_LOG_ENTRIES = 200
const HEALTH_CHECK_INTERVAL = 15000
const PORT_KEEPALIVE_MS = 20_000
const RETRYABLE_CONTROL_ACTIONS = CHATGPT_PROXY_CONTROL_ACTIONS

function slugToModelKey(slug) {
  const normalized = (slug || '').trim()
  for (const key of chatgptWebModelKeys) {
    if (Models[key] && Models[key].value === normalized) return key
  }
  if (Models[normalized]) return normalized
  return CHATGPT_WEB_DEFAULT_MODEL_KEY
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

function buildBridgeWsUrl(targetPort, token) {
  return `ws://127.0.0.1:${targetPort}/bridge${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

function App() {
  const [enabled, setEnabled] = useState(null)
  const [port, setPort] = useState(18080)
  const [portInput, setPortInput] = useState('18080')
  const [bridgeToken, setBridgeToken] = useState('')
  const [bridgeTokenInput, setBridgeTokenInput] = useState('')
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
  const fileInputRef = useRef(null)

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
      const token = config.apiServerBridgeToken || ''
      setBridgeToken(token)
      setBridgeTokenInput(token)
      setEnabled(config.apiServerEnabled === true)
    })
  }, [])

  // -----------------------------------------------------------------------
  // Build WebSocket URL from port
  // -----------------------------------------------------------------------

  const wsUrl = buildBridgeWsUrl(port, bridgeToken)
  const baseUrl = `http://127.0.0.1:${port}`

  // Reconnect timers are scheduled by whichever render created them, so `connect`
  // must not close over that render's port/token — a token saved afterwards would
  // never reach the socket and the retry loop would keep replaying the stale URL.
  // The live target lives in a ref that the save handlers update synchronously.
  const connectTarget = useRef({ port, token: bridgeToken, url: wsUrl })
  useEffect(() => {
    connectTarget.current = { port, token: bridgeToken, url: wsUrl }
  }, [port, bridgeToken, wsUrl])

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
      const isThinkingRequest = needsChatgptWebThinkingEffort(model)
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

        // Adapters signal completion with `{ answer: null, done: true }`, so a
        // null answer must not overwrite the text accumulated so far.
        if (typeof msg.answer === 'string') {
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

      // Maps a local API-bridge action name (the wire value shared with the
      // Node gateway) to the runtime message type dispatched in the background.
      // Both sides reference the protocol constants so this table can't drift
      // out of sync with the background receiver.
      const actionToMessageType = {
        chatgpt_web_create_conversation: RuntimeMessage.ChatgptWebCreateConversation,
        chatgpt_web_list_conversations: RuntimeMessage.ChatgptWebListConversations,
        chatgpt_web_get_conversation: RuntimeMessage.ChatgptWebGetConversation,
        chatgpt_web_refresh_conversation: RuntimeMessage.ChatgptWebRefreshConversation,
        chatgpt_web_send_conversation_message: RuntimeMessage.ChatgptWebSendConversationMessage,
        chatgpt_web_sync_conversations: RuntimeMessage.ChatgptWebSyncConversations,
        chatgpt_web_list_models: RuntimeMessage.ChatgptWebListModels,
      }

      try {
        const messageType = actionToMessageType[action]
        if (!messageType) throw new Error(`Unsupported control action: ${action}`)
        const canRetry = RETRYABLE_CONTROL_ACTIONS.has(action)

        let response = await Browser.runtime.sendMessage({
          type: messageType,
          data: payload || {},
        })

        // Service worker may have been terminated mid-request (MV3), retry once
        if (response === undefined && canRetry) {
          addLog(`Control ${action}: no response, retrying once...`, 'warn')
          response = await Browser.runtime.sendMessage({
            type: messageType,
            data: payload || {},
          })
        }

        if (response === undefined) {
          addLog(
            `Control ${action}: background returned no response${canRetry ? ' after retry' : ''}`,
            'error',
          )
          sendWs({
            type: 'control_error',
            id,
            error: `Background returned no response for ${action}. The service worker may have been terminated. Check that chatgpt.com is open and you are logged in.`,
          })
        } else {
          sendWs({ type: 'control_response', id, data: response })
        }
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

    const target = connectTarget.current

    setStatus('connecting')
    // Never log the URL verbatim — it carries the bridge token.
    addLog(`Connecting to ws://127.0.0.1:${target.port}/bridge (via service worker)...`)
    if (!target.token) {
      addLog(
        'No bridge token set. The gateway will refuse the connection — copy the token printed by `npm run api-server` into the field above.',
        'warn',
      )
    }

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
        // The WebSocket API never surfaces the HTTP status, so a rejected token
        // and a dead server are indistinguishable here — name both.
        addLog(
          `Connection error: ${
            msg.message || 'unknown'
          } — is the API server running, and does the bridge token match the one it printed?`,
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

    pp.postMessage({ action: 'connect', url: target.url })
  }, [addLog, handleControlRequest, handleRequest, syncBridgeConfig])

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
        .sendMessage({ type: RuntimeMessage.ApiBridgeDiagnose })
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

  // Parked in reconnectTimer so disconnect() can cancel it. An untracked timer
  // here would survive a disable and resurrect the bridge 500ms later, leaving
  // the page connected with no visible control to stop it.
  const scheduleReconnect = useCallback(() => {
    if (!enabled) {
      setStatus('disabled')
      addLog('Saved. The bridge is disabled, so it will connect when you enable it.', 'warn')
      return
    }
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      autoReconnect.current = true
      connect()
    }, 500)
  }, [enabled, addLog, connect])

  const savePort = useCallback(() => {
    const n = parseInt(portInput, 10)
    if (Number.isNaN(n) || n < 1 || n > 65535) {
      addLog('Invalid port: must be 1–65535', 'error')
      return
    }
    setPort(n)
    // Updated here as well as in the effect so the reconnect below cannot race
    // the re-render.
    connectTarget.current = { port: n, token: bridgeToken, url: buildBridgeWsUrl(n, bridgeToken) }
    setUserConfig({ apiServerPort: n })
    addLog(`Port updated to ${n}. Reconnecting...`)
    disconnect()
    scheduleReconnect()
  }, [portInput, bridgeToken, addLog, disconnect, scheduleReconnect])

  const saveBridgeToken = useCallback(() => {
    const next = bridgeTokenInput.trim()
    setBridgeToken(next)
    connectTarget.current = { port, token: next, url: buildBridgeWsUrl(port, next) }
    setUserConfig({ apiServerBridgeToken: next })
    addLog(next ? 'Bridge token updated. Reconnecting...' : 'Bridge token cleared.')
    disconnect()
    if (next) scheduleReconnect()
  }, [bridgeTokenInput, port, addLog, disconnect, scheduleReconnect])

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

  const handleExportCache = useCallback(async () => {
    try {
      const cache = await exportConversationCache()
      const blob = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chatgpt-web-cache-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      addLog('Conversation cache exported successfully')
    } catch (err) {
      addLog(`Failed to export cache: ${err.message}`, 'error')
    }
  }, [addLog])

  const handleImportCache = useCallback(
    async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const reader = new FileReader()
        reader.onload = async (event) => {
          try {
            const data = JSON.parse(event.target.result)
            const result = await importConversationCache(data)
            addLog(`Conversation cache imported successfully: ${result.count} conversations`)
            void loadConversationList()
          } catch (err) {
            addLog(`Failed to import cache: ${err.message}`, 'error')
          }
        }
        reader.readAsText(file)
      } catch (err) {
        addLog(`Failed to read file: ${err.message}`, 'error')
      }
      e.target.value = ''
    },
    [addLog, loadConversationList],
  )

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

        <div className="url-row">
          <label className="port-label">Bridge token:</label>
          <input
            type="password"
            value={bridgeTokenInput}
            onChange={(e) => setBridgeTokenInput(e.target.value)}
            placeholder="Printed by npm run api-server"
            className="port-input"
          />
          {bridgeTokenInput.trim() !== bridgeToken && (
            <button onClick={saveBridgeToken} className="btn-save">
              Save
            </button>
          )}
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
          <li>Copy the bridge token it prints into the field above</li>
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
    "model": "gpt-5-5-thinking",
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
              <strong>Bridge token:</strong> The gateway only accepts the bridge from a holder of
              this token, so no other page can take over the channel. It is printed on startup and
              stored in <code>~/.chatgptbox/gateway-bridge-token</code>; override it with{' '}
              <code>--bridge-token &lt;token&gt;</code> or <code>CHATGPT_GATEWAY_BRIDGE_TOKEN</code>
              . Note that it guards the bridge channel only — the gateway&apos;s completion and
              conversation endpoints stay unauthenticated and CORS-open, so while the bridge is
              paired any site you visit can call them. Run the gateway only while you need it.
            </p>
            <p>
              <strong>Status and health:</strong> Visit <code>http://127.0.0.1:{port}/status</code>{' '}
              for a quick bridge check, or <code>http://127.0.0.1:{port}/health</code> for detailed
              diagnostics.
            </p>
            <p>
              <strong>Conversation APIs:</strong> Use <code>GET /chatgpt/conversations</code> to
              read the local cache, or add <code>?force_sync=true</code> for a rate-limited full
              list sync after enabling history synchronization in extension settings,{' '}
              <code>POST /chatgpt/conversations</code> to start a new background thread without
              waiting for the answer, <code>GET /chatgpt/conversations/&lt;id&gt;?think=true</code>{' '}
              for a normalized snapshot with reasoning data,{' '}
              <code>POST /chatgpt/conversations/&lt;id&gt;/messages</code> to send a follow-up, and{' '}
              <code>POST /chatgpt/conversations/&lt;id&gt;/refresh</code> to refresh pending output.
            </p>
          </div>
        </details>
      </section>

      <section className="api-server-conversations">
        <h3>ChatGPT Conversations</h3>
        <p className="conversation-subtitle">
          Manually inspect cached ChatGPT conversations, reasoning data, and follow-up endpoints
          through the local API server.
        </p>

        <div className="conversation-toolbar">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadConversationList()}
            disabled={conversationListLoading || status !== 'connected'}
          >
            {conversationListLoading ? 'Loading…' : 'Refresh List'}
          </button>

          <button type="button" className="btn-secondary" onClick={() => void handleExportCache()}>
            Export Cache
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Import Cache
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportCache}
            style={{ display: 'none' }}
          />

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

curl "http://127.0.0.1:${port}/chatgpt/conversations?offset=0&limit=100&order=updated&force_sync=true"

curl -X POST http://127.0.0.1:${port}/chatgpt/conversations \\
  -H "Content-Type: application/json" \\
  -d '{"query":"start a new thread from this note"}'

curl "http://127.0.0.1:${port}/chatgpt/conversations/<conversation-id>?think=true"

curl -X POST http://127.0.0.1:${port}/chatgpt/conversations/<conversation-id>/messages \\
  -H "Content-Type: application/json" \\
  -d '{"query":"continue from the cached thread","think":true}'

curl -X POST http://127.0.0.1:${port}/chatgpt/conversations/<conversation-id>/refresh \\
  -H "Content-Type: application/json" \\
  -d '{"preferResume":true,"resumeTimeoutMs":10000,"think":true}'`}</pre>
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
