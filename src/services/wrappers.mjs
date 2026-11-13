import { clearOldAccessToken, getUserConfig, setAccessToken } from '../config/index.mjs'
import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { apiModeToModelName, modelNameToDesc } from '../utils/model-name-convert.mjs'
import { PASTE_REVIEW_PORT } from '../native-chatgpt/review-contract.mjs'
import { prepareLocalSessionDispatch } from './local-session.mjs'
import { isProviderAdmissionMessage } from '../protocol/messages.mjs'

export async function getChatGptAccessToken() {
  await clearOldAccessToken()
  const userConfig = await getUserConfig()
  if (userConfig.accessToken) {
    return userConfig.accessToken
  } else {
    const cookie = (await Browser.cookies.getAll({ url: 'https://chatgpt.com/' }))
      .map((cookie) => {
        return `${cookie.name}=${cookie.value}`
      })
      .join('; ')
    const resp = await fetch('https://chatgpt.com/api/auth/session', {
      headers: {
        Cookie: cookie,
      },
    })
    if (resp.status === 403) {
      throw new Error('CLOUDFLARE')
    }
    const data = await resp.json().catch(() => ({}))
    if (!data.accessToken) {
      throw new Error('UNAUTHORIZED')
    }
    await setAccessToken(data.accessToken)
    return data.accessToken
  }
}

export function handlePortError(session, port, err) {
  console.error(err)
  if (
    err.chatgptWebNotDispatched === true ||
    err.dispatched === false ||
    err.submission === 'not_attempted'
  ) {
    port.postMessage({ error: err.message, errorCode: err.code, dispatched: false })
    return
  }
  if (err.message) {
    if (!err.message.includes('aborted')) {
      if (
        ['message you submitted was too long', 'maximum context length'].some((m) =>
          err.message.includes(m),
        )
      )
        port.postMessage({ error: t('Exceeded maximum context length') + '\n\n' + err.message })
      else if (['CaptchaChallenge', 'CAPTCHA'].some((m) => err.message.includes(m)))
        port.postMessage({ error: t('Captcha challenge') + '\n\n' + err.message })
      else if (['exceeded your current quota'].some((m) => err.message.includes(m)))
        port.postMessage({ error: t('Exceeded quota') + '\n\n' + err.message })
      else if (['Rate limit reached'].some((m) => err.message.includes(m)))
        port.postMessage({ error: t('Rate limit') + '\n\n' + err.message })
      else if (['authentication token has expired'].some((m) => err.message.includes(m)))
        port.postMessage({ error: 'UNAUTHORIZED' })
      else port.postMessage({ error: err.message })
    }
  } else {
    const errMsg = JSON.stringify(err)
    port.postMessage({ error: errMsg ?? 'unknown error' })
  }
}

function isPortLifecycleMessage(message) {
  if (!message || typeof message !== 'object') return false
  return (
    Object.prototype.hasOwnProperty.call(message, 'session') ||
    Object.prototype.hasOwnProperty.call(message, 'dshSessionId') ||
    Object.prototype.hasOwnProperty.call(message, 'dshStatus') ||
    Object.prototype.hasOwnProperty.call(message, 'dshDecision') ||
    Object.prototype.hasOwnProperty.call(message, 'answer') ||
    Object.prototype.hasOwnProperty.call(message, 'finalContent') ||
    Object.prototype.hasOwnProperty.call(message, 'outcome') ||
    message.accepted === true ||
    message.started === true ||
    message.done === true ||
    Object.prototype.hasOwnProperty.call(message, 'error')
  )
}

/**
 * Per-port generation token so Stop / retry do not let a stale executor post
 * `answer` / `done` / `error` after the UI has already moved on.
 */
export function createPortRunGuard(port) {
  let currentRunId = 0
  let currentToken
  let stoppingRunId = null
  let terminalPosted = false

  function wrapPort(runId, requestToken) {
    const listeners = new Map()
    const onMessage = {
      addListener(listener) {
        if (listeners.has(listener)) return
        const guarded = (message, ...args) => {
          if (runId !== currentRunId) return
          if (message?.stop && message.requestToken !== requestToken) return
          return listener(message, ...args)
        }
        listeners.set(listener, guarded)
        port.onMessage.addListener(guarded)
      },
      removeListener(listener) {
        const guarded = listeners.get(listener)
        if (guarded) port.onMessage.removeListener(guarded)
        listeners.delete(listener)
      },
    }
    return new Proxy(port, {
      get(target, prop, receiver) {
        if (prop === '__uiPort') return target
        if (prop === '__stopRequested')
          return (
            runId !== currentRunId || stoppingRunId === runId || target.__stopRequested === true
          )
        if (prop === 'onMessage') return onMessage
        if (prop === 'postMessage') {
          return (message) => {
            if (isPortLifecycleMessage(message)) {
              if (runId !== currentRunId || terminalPosted) return
              if (stoppingRunId === runId && message.outcome !== 'stopped') return
              if (message.done === true || message.error) terminalPosted = true
            }
            return target.postMessage(requestToken ? { ...message, requestToken } : message)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  return {
    isCurrent(runId) {
      return runId === currentRunId
    },
    dispose() {
      currentRunId += 1
      port.__stopRequested = true
    },
    ackStopWithoutSession(requestToken) {
      if (requestToken !== currentToken) return
      const stoppedRunId = currentRunId
      if (stoppingRunId === stoppedRunId) return
      stoppingRunId = stoppedRunId
      port.__stopRequested = true
      queueMicrotask(() => {
        if (currentRunId !== stoppedRunId) return
        currentRunId += 1
        if (!terminalPosted)
          port.postMessage({
            done: true,
            outcome: 'stopped',
            ...(currentToken ? { requestToken: currentToken } : {}),
          })
      })
    },
    beginSessionRun(requestToken) {
      currentRunId += 1
      currentToken = requestToken
      stoppingRunId = null
      terminalPosted = false
      port.__stopRequested = false
      const runId = currentRunId
      return { runId, port: wrapPort(runId, requestToken) }
    },
  }
}

function createProviderAdmissionPort(port, initialSession) {
  let admitted = false
  let session = initialSession
  return new Proxy(port, {
    get(target, prop, receiver) {
      if (prop !== 'postMessage') return Reflect.get(target, prop, receiver)
      return (message) => {
        if (message.session && !message.error) session = { ...session, ...message.session }
        if (message.dshSessionId) session = { ...session, dshSessionId: message.dshSessionId }
        if (message.started === true) admitted = true
        else if (!admitted && isProviderAdmissionMessage(message)) {
          admitted = true
          target.postMessage({ session, started: true })
        }
        return target.postMessage(message)
      }
    },
  })
}

export function isUiPortStopRequested(uiPort) {
  if (!uiPort) return false
  return uiPort.__stopRequested === true || uiPort.__uiPort?.__stopRequested === true
}

/**
 * Listen for `{stop:true}` on a UI port as soon as a proxy request is queued,
 * not only after the content-script response port connects.
 */
export function createPendingProxyCancellation(uiPort) {
  let cancelled = false
  const cancelListeners = new Set()
  const onMessage = (msg) => {
    if (cancelled || !msg?.stop) return
    cancelled = true
    for (const listener of cancelListeners) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  }
  uiPort?.onMessage?.addListener?.(onMessage)
  return {
    get cancelled() {
      return cancelled
    },
    onCancel(listener) {
      if (typeof listener === 'function') cancelListeners.add(listener)
    },
    dispose() {
      try {
        uiPort?.onMessage?.removeListener?.(onMessage)
      } catch {
        /* ignore */
      }
      cancelListeners.clear()
    },
  }
}

export function registerPortListener(executor) {
  Browser.runtime.onConnect.addListener((port) => {
    if (
      port.name === 'api-bridge-proxy' ||
      port.name === PASTE_REVIEW_PORT ||
      /^(chatgpt|grok)-proxy-response:/.test(port.name || '')
    )
      return
    console.debug('connected')
    const runGuard = createPortRunGuard(port)
    const onMessage = async (msg) => {
      console.debug('received msg', msg)
      if (msg?.stop && !msg.session) {
        runGuard.ackStopWithoutSession(msg.requestToken)
        return
      }
      const session = msg.session
      if (!session) return
      const token = typeof msg.requestToken === 'string' ? msg.requestToken : undefined
      const { runId, port: guardedPort } = runGuard.beginSessionRun(token)
      let providerEntered = false
      try {
        const config = await getUserConfig()
        if (!runGuard.isCurrent(runId)) return
        if (!session.modelName) session.modelName = config.modelName
        if (!session.apiMode && session.modelName !== 'customModel')
          session.apiMode = config.apiMode
        if (!session.aiName)
          session.aiName =
            session.apiMode?.displayName?.trim() ||
            modelNameToDesc(
              session.apiMode ? apiModeToModelName(session.apiMode) : session.modelName,
              t,
              config.customModelName,
            )
        if (msg.localSession === true) await prepareLocalSessionDispatch(session)
        if (!runGuard.isCurrent(runId)) return
        providerEntered = true
        await executor(session, createProviderAdmissionPort(guardedPort, session), config)
      } catch (err) {
        const error = err && typeof err === 'object' ? err : new Error(String(err))
        if (!providerEntered) error.chatgptWebNotDispatched = true
        handlePortError(session, guardedPort, error)
      }
    }

    const onDisconnect = () => {
      runGuard.dispose()
      console.debug('port disconnected, remove listener')
      port.onMessage.removeListener(onMessage)
      port.onDisconnect.removeListener(onDisconnect)
    }

    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
  })
}
