import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { initSession } from '../../services/init-session.mjs'
import { Models, chatgptWebModelKeys } from '../../config/index.mjs'
import { modelNameToApiMode } from '../../utils/model-name-convert.mjs'
import './styles.css'

const DEFAULT_WS_URL = 'ws://127.0.0.1:18080/bridge'
const RECONNECT_DELAY = 3000
const MAX_LOG_ENTRIES = 100

function slugToModelKey(slug) {
  const normalized = (slug || '').trim()
  for (const key of chatgptWebModelKeys) {
    if (Models[key] && Models[key].value === normalized) return key
  }
  if (Models[normalized]) return normalized
  return 'chatgptWeb52Auto'
}

// Flattens an OpenAI-style messages array into a single prompt string.
// Limitation: multi-turn conversations lose native ChatGPT Web conversation
// threading (conversation_id / parent_message_id). Each API request starts a
// fresh conversation. System prompts are inlined as text, not handled at the
// system level. Acceptable for v1; a future version could maintain persistent
// conversation sessions keyed by a client-supplied conversation ID.
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
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL)
  const [status, setStatus] = useState('disconnected')
  const [logs, setLogs] = useState([])
  const [requestCount, setRequestCount] = useState(0)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const logsEndRef = useRef(null)
  const autoReconnect = useRef(true)

  const addLog = useCallback((msg, type = 'info') => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toISOString(), msg, type }]
      return next.slice(-MAX_LOG_ENTRIES)
    })
  }, [])

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

      let port
      try {
        port = Browser.runtime.connect()
      } catch (err) {
        addLog(`Error ${id.slice(0, 8)}...: failed to connect to background`, 'error')
        sendWs({
          type: 'error',
          id,
          error: err.message || 'Failed to connect to extension background',
        })
        return
      }

      let lastAnswer = ''
      let finished = false

      port.onMessage.addListener((msg) => {
        if (finished) return

        if (msg.error) {
          finished = true
          addLog(`Error ${id.slice(0, 8)}...: ${msg.error}`, 'error')
          sendWs({ type: 'error', id, error: msg.error })
          try {
            port.disconnect()
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
            port.disconnect()
          } catch {
            /* ignore */
          }
        }
      })

      port.onDisconnect.addListener(() => {
        if (finished) return
        finished = true
        if (lastAnswer) {
          addLog(`Done ${id.slice(0, 8)}...: ${lastAnswer.length} chars (port closed)`)
          sendWs({ type: 'done', id, answer: lastAnswer })
        } else {
          addLog(`Error ${id.slice(0, 8)}...: port disconnected unexpectedly`, 'error')
          sendWs({
            type: 'error',
            id,
            error: 'Extension background disconnected before responding',
          })
        }
      })

      try {
        port.postMessage({ session })
      } catch (err) {
        if (!finished) {
          finished = true
          addLog(`Error ${id.slice(0, 8)}...: ${err.message}`, 'error')
          sendWs({ type: 'error', id, error: err.message || 'Failed to send request to extension' })
        }
      }
    },
    [addLog, sendWs],
  )

  const sendWs = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const connect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }

    autoReconnect.current = true

    if (wsRef.current) {
      const old = wsRef.current
      wsRef.current = null
      old.onclose = null
      old.onerror = null
      old.onmessage = null
      old.close()
    }

    setStatus('connecting')
    addLog(`Connecting to ${wsUrl}...`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      addLog('Connected to API server', 'success')
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      setStatus('disconnected')
      addLog('Disconnected from API server')
      if (autoReconnect.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
      }
    }

    ws.onerror = () => {
      addLog('WebSocket error — is the API server running?', 'error')
    }

    ws.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if (data.type === 'request') {
        handleRequest(data)
      }
    }
  }, [wsUrl, addLog, handleRequest])

  const disconnect = useCallback(() => {
    autoReconnect.current = false
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (wsRef.current) {
      const old = wsRef.current
      wsRef.current = null
      old.onclose = null
      old.onerror = null
      old.onmessage = null
      old.close()
    }
    setStatus('disconnected')
    addLog('Disconnected')
  }, [addLog])

  // Intentionally empty deps: we only want the initial connect on mount
  // and cleanup on unmount. connect/disconnect are stable on first render.
  useEffect(() => {
    connect()
    return () => disconnect()
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const statusColor =
    status === 'connected' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444'

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

        <div className="url-row">
          <input
            type="text"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://127.0.0.1:18080/bridge"
            disabled={status === 'connected'}
          />
          {status === 'connected' ? (
            <button onClick={disconnect} className="btn-disconnect">
              Disconnect
            </button>
          ) : (
            <button onClick={connect} className="btn-connect">
              Connect
            </button>
          )}
        </div>
      </section>

      <section className="api-server-usage">
        <h3>Usage</h3>
        <ol>
          <li>
            Run <code>npm run api-server</code> in a terminal
          </li>
          <li>Keep this page open (it bridges the API server to ChatGPT)</li>
          <li>
            Make sure you are logged in at{' '}
            <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
              chatgpt.com
            </a>
          </li>
          <li>
            Send requests to <code>http://127.0.0.1:18080/v1/chat/completions</code>
          </li>
        </ol>
        <details>
          <summary>Example curl command</summary>
          <pre>{`curl http://127.0.0.1:18080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5-2",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'`}</pre>
        </details>
      </section>

      <section className="api-server-logs">
        <h3>Log</h3>
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
