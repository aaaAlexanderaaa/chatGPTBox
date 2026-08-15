import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'

// The cockpit's single link to the background gateway: one runtime port
// ('dsh-gateway'), message-driven. Everything the UI knows arrives here —
// connection status, session rows, and the subscribed session's ledger.

const PORT_NAME = 'dsh-gateway'

export function useGatewayPort() {
  const portRef = useRef(null)
  const requestId = useRef(0)
  const pendingRpc = useRef(new Map())
  const ledgerListeners = useRef(new Set())
  const [connection, setConnection] = useState({ status: 'connecting', endpoint: '', version: null, lastError: null })
  const [sessions, setSessions] = useState([])
  const [sessionUpdates, setSessionUpdates] = useState({}) // sessionId -> summary
  const [connected, setConnected] = useState(false)

  const handleMessage = useCallback((message) => {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'hello':
      case 'connection':
        setConnection({
          status: message.status,
          endpoint: message.endpoint,
          version: message.version,
          lastError: message.lastError,
        })
        break
      case 'sessions':
        setSessions(message.items || [])
        setSessionUpdates({})
        break
      case 'session':
        setSessionUpdates((prev) => ({ ...prev, [message.summary.sessionId]: message.summary }))
        break
      case 'ledger':
        for (const listener of ledgerListeners.current) listener(message)
        break
      case 'res': {
        const entry = pendingRpc.current.get(message.id)
        if (!entry) break
        pendingRpc.current.delete(message.id)
        if (message.ok) entry.resolve(message.value)
        else entry.reject(new Error(message.error))
        break
      }
      default:
        break
    }
  }, [])

  useEffect(() => {
    const connect = () => {
      let port
      try {
        port = Browser.runtime.connect({ name: PORT_NAME })
      } catch {
        setConnected(false)
        return
      }
      portRef.current = port
      setConnected(true)
      port.onMessage.addListener(handleMessage)
      port.onDisconnect.addListener(() => {
        setConnected(false)
        // The background worker may have been idle-dead; retry quietly.
        setTimeout(connect, 1000)
      })
    }
    connect()
    return () => {
      try {
        portRef.current?.disconnect()
      } catch {
        // already gone
      }
    }
  }, [handleMessage])

  const send = useCallback((message) => {
    portRef.current?.postMessage(message)
  }, [])

  const rpc = useCallback(
    (method, args = {}) =>
      new Promise((resolve, reject) => {
        const id = `ui-${++requestId.current}`
        pendingRpc.current.set(id, { resolve, reject })
        send({ type: 'req', id, method, args })
        setTimeout(() => {
          if (pendingRpc.current.has(id)) {
            pendingRpc.current.delete(id)
            reject(new Error(`dsh gateway rpc "${method}" timed out`))
          }
        }, 30_000)
      }),
    [send],
  )

  const subscribeLedger = useCallback(
    (sessionId, listener) => {
      if (sessionId) send({ type: 'subscribe-ledger', sessionId })
      ledgerListeners.current.add(listener)
      return () => {
        ledgerListeners.current.delete(listener)
        if (sessionId) send({ type: 'unsubscribe-ledger', sessionId })
      }
    },
    [send],
  )

  return { connection, sessions, sessionUpdates, connected, rpc, subscribeLedger, send }
}
