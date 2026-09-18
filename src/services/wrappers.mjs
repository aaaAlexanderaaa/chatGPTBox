import { clearOldAccessToken, getUserConfig, setAccessToken } from '../config/index.mjs'
import Browser from 'webextension-polyfill'
import { t } from 'i18next'
import { apiModeToModelName, modelNameToDesc } from '../utils/model-name-convert.mjs'

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
    Object.prototype.hasOwnProperty.call(message, 'answer') ||
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

  function wrapPort(runId) {
    return new Proxy(port, {
      get(target, prop, receiver) {
        if (prop === '__uiPort') return target
        if (prop === 'postMessage') {
          return (message) => {
            if (runId !== currentRunId && isPortLifecycleMessage(message)) return
            return target.postMessage(message)
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
    ackStopWithoutSession() {
      currentRunId += 1
      port.__stopRequested = true
      port.postMessage({ done: true })
    },
    beginSessionRun() {
      currentRunId += 1
      port.__stopRequested = false
      const runId = currentRunId
      return { runId, port: wrapPort(runId) }
    },
  }
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
    if (port.name === 'api-bridge-proxy') return
    console.debug('connected')
    const runGuard = createPortRunGuard(port)
    const onMessage = async (msg) => {
      console.debug('received msg', msg)
      if (msg?.stop && !msg.session) {
        runGuard.ackStopWithoutSession()
        return
      }
      const session = msg.session
      if (!session) return
      const { runId, port: guardedPort } = runGuard.beginSessionRun()
      const config = await getUserConfig()
      if (!runGuard.isCurrent(runId)) return
      if (!session.modelName) session.modelName = config.modelName
      if (!session.apiMode && session.modelName !== 'customModel') session.apiMode = config.apiMode
      if (!session.aiName)
        session.aiName = session.apiMode?.displayName?.trim()
          ? session.apiMode.displayName.trim()
          : modelNameToDesc(
              session.apiMode ? apiModeToModelName(session.apiMode) : session.modelName,
              t,
              config.customModelName,
            )
      guardedPort.postMessage({ session })
      try {
        await executor(session, guardedPort, config)
      } catch (err) {
        handlePortError(session, guardedPort, err)
      }
    }

    const onDisconnect = () => {
      console.debug('port disconnected, remove listener')
      port.onMessage.removeListener(onMessage)
      port.onDisconnect.removeListener(onDisconnect)
    }

    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
  })
}
