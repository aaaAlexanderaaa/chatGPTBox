import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { getUserConfig, setUserConfig } from '../../config/index.mjs'
import { initSession } from '../../services/init-session.mjs'
import { Models, chatgptWebModelKeys } from '../../config/index.mjs'
import { modelNameToApiMode } from '../../utils/model-name-convert.mjs'
import './styles.css'

const RECONNECT_DELAY = 3000
const MAX_LOG_ENTRIES = 200
const HEALTH_CHECK_INTERVAL = 15000

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

  const proxyPort = useRef(null)
  const reconnectTimer = useRef(null)
  const logsEndRef = useRef(null)
  const autoReconnect = useRef(true)
  const healthTimer = useRef(null)

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

  // -----------------------------------------------------------------------
  // Handle incoming request from API server
  // -----------------------------------------------------------------------

  const handleRequest = useCallback(
    (data) => {
      const { id, model, messages } = data
      const question = formatMessages(messages)
      const modelKey = slugToModelKey(model)
      const apiMode = modelNameToApiMode(modelKey)

      addLog(`Request ${id.slice(0, 8)}...: model=${model} → ${modelKey}`)
      setRequestCount((c) => c + 1)

      const session = initSession({
        question,
        modelName: modelKey,
        apiMode: apiMode || null,
        autoClean: true,
        conversationRecords: [],
      })

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

      bgPort.onMessage.addListener((msg) => {
        if (finished) return

        if (msg.error) {
          finished = true
          addLog(`Error ${id.slice(0, 8)}...: ${msg.error}`, 'error')
          sendWs({ type: 'error', id, error: msg.error })
          try {
            bgPort.disconnect()
          } catch {
            /* ignore */
          }
          return
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
        if (lastAnswer) {
          addLog(`Done ${id.slice(0, 8)}...: ${lastAnswer.length} chars (port closed)`)
          sendWs({ type: 'done', id, answer: lastAnswer })
        } else {
          addLog(`Extension background disconnected before responding`, 'error')
          sendWs({
            type: 'error',
            id,
            error: 'Extension background disconnected before responding',
          })
        }
      })

      try {
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
      } else if (msg.type === 'close') {
        if (proxyPort.current !== pp) return
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
        }
      }
    })

    pp.onDisconnect.addListener(() => {
      if (proxyPort.current !== pp) return
      proxyPort.current = null
      setStatus('disconnected')
      addLog('Proxy channel closed')
      if (autoReconnect.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
      }
    })

    pp.postMessage({ action: 'connect', url: wsUrl })
  }, [wsUrl, addLog, handleRequest])

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  const disconnect = useCallback(() => {
    autoReconnect.current = false

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
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
  // Health check (fetches directly — fine even in Brave since it's just a
  // status read; if blocked, we silently skip without affecting the bridge)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (status !== 'connected') {
      setServerHealth(null)
      return
    }

    function check() {
      fetch(`${baseUrl}/health`)
        .then((r) => r.json())
        .then((h) => setServerHealth(h))
        .catch(() => setServerHealth(null))
    }

    check()
    healthTimer.current = setInterval(check, HEALTH_CHECK_INTERVAL)
    return () => clearInterval(healthTimer.current)
  }, [status, baseUrl])

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
          </div>
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
              <strong>Health check:</strong> Visit <code>http://127.0.0.1:{port}/health</code> for
              detailed server diagnostics.
            </p>
          </div>
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
