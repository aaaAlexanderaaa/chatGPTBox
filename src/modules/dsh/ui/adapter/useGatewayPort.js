import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { createPortReconnect } from '../port-reconnect.mjs'
import { applyPortMessage, emptyPortState } from './port-state.mjs'

// The full-page UI's single link to the background gateway: one runtime port
// ('dsh-gateway'), message-driven. Everything the UI knows arrives here —
// connection status, session rows, workspaces, and the subscribed session's ledger.

const PORT_NAME = 'dsh-gateway'

export function useGatewayPort() {
  const portRef = useRef(null)
  const requestId = useRef(0)
  const pendingRpc = useRef(new Map())
  const ledgerListeners = useRef(new Set())
  const subscriptionsRef = useRef(new Set())
  const [portState, setPortState] = useState(emptyPortState)
  const [connected, setConnected] = useState(false)
  const connectionRef = useRef(portState.connection)
  connectionRef.current = portState.connection

  const handleMessage = useCallback((message) => {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
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
      default: {
        setPortState((prev) => {
          const next = applyPortMessage(prev, message)
          if (message.type === 'hello' || message.type === 'connection') {
            connectionRef.current = next.connection
          }
          return next
        })
        break
      }
    }
  }, [])

  useEffect(() => {
    const life = createPortReconnect({
      connect: () => {
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
          life.onDisconnect()
        })
        for (const sessionId of subscriptionsRef.current) {
          try {
            port.postMessage({ type: 'subscribe-ledger', sessionId })
          } catch {
            // port died before replay
          }
        }
      },
    })
    life.start()
    return () => {
      life.stop()
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
      if (sessionId) {
        subscriptionsRef.current.add(sessionId)
        send({ type: 'subscribe-ledger', sessionId })
      }
      ledgerListeners.current.add(listener)
      return () => {
        ledgerListeners.current.delete(listener)
        if (sessionId) {
          subscriptionsRef.current.delete(sessionId)
          send({ type: 'unsubscribe-ledger', sessionId })
        }
      }
    },
    [send],
  )

  return {
    connection: portState.connection,
    sessions: portState.sessions,
    sessionUpdates: portState.sessionUpdates,
    workspaces: portState.workspaces,
    connected,
    rpc,
    subscribeLedger,
    send,
  }
}
