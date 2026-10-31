import { nativeChatgptConfig } from '../config/native-chatgpt.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { nativeChatgptEditor, isNativeChatgptPage } from './editor.mjs'
import { capturePasteTarget, pasteTargetIsCurrent, insertNativePaste } from './paste-target.mjs'
import { scanPaste, redactPaste, PASTE_LIMITS } from './redaction.mjs'
import {
  PASTE_REVIEW_PORT,
  PASTE_REVIEW_TTL_MS,
  PasteReviewAction,
  trustedReviewPort,
} from './review-contract.mjs'
import { nativeText } from './strings.mjs'

export function installNativePaste({ doc = document, browser, insert = insertNativePaste }) {
  const win = doc.defaultView
  if (!isNativeChatgptPage(doc)) return { configure() {}, suspend() {}, dispose() {} }
  let config = null,
    pending = null,
    stopped = false,
    applying = false,
    composing = null
  let t = nativeText(win.navigator.language),
    message = '',
    scheduled = null,
    lastAnchor = null
  const root = doc.createElement('div')
  root.className = 'chatgptbox-native-actions'
  root.setAttribute('data-chatgptbox-native-paste', '')
  const label = doc.createElement('span')
  label.setAttribute('role', 'status')
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  root.append(label, cancel)
  const show = (value) => {
    message = value
    refresh()
  }
  const refresh = () => {
    scheduled = null
    if (stopped || config?.chatgptNativePasteEnabled === false || !doc.body) {
      root.remove()
      return
    }
    const editor = nativeChatgptEditor(doc)
    const anchor = editor?.closest('form') || editor || doc.body.lastElementChild
    if (anchor && (lastAnchor !== anchor || !root.isConnected)) {
      lastAnchor = anchor
      anchor.after(root)
    }
    const value = t(
      !editor && config?.chatgptNativePasteEnabled
        ? 'This editor or page is not supported.'
        : message ||
            (!config
              ? 'Local check is starting. Paste again shortly.'
              : editor
              ? 'Ready: local paste check.'
              : 'This editor or page is not supported.'),
    )
    if (label.textContent !== value) label.textContent = value
    if (cancel.textContent !== t('Cancel')) cancel.textContent = t('Cancel')
    cancel.hidden = !pending
  }
  const schedule = () => {
    if (!stopped && config?.chatgptNativePasteEnabled !== false && !scheduled)
      scheduled = win.requestAnimationFrame(refresh)
  }
  const finish = (job, result, ok = false) => {
    if (!job || pending !== job) return
    pending = null
    win.clearTimeout(job.timer)
    if (job.opening)
      void browser.runtime
        .sendMessage({ type: RuntimeMessage.CloseNativePasteReview, data: { jobId: job.id } })
        .catch(() => {})
    try {
      job.port?.postMessage({ action: PasteReviewAction.Finished, ok, message: result })
    } catch {
      /* closed */
    }
    try {
      job.port?.disconnect()
    } catch {
      /* closed */
    }
    for (const port of job.connections || []) {
      try {
        port.disconnect()
      } catch {
        /* closed */
      }
    }
    job.connections?.clear()
    job.raw = ''
    job.scan = null
    job.target = null
    job.port = null
    job.opening = null
    show(result)
  }
  const abort = (reason = 'Paste cancelled.') => {
    if (pending) finish(pending, reason)
  }
  cancel.addEventListener('click', () => abort())
  const commit = (job, value) => {
    if (pending !== job || !pasteTargetIsCurrent(job.target)) {
      finish(job, 'The input changed. Paste again.')
      return
    }
    applying = true
    try {
      insert(job.target, value)
      finish(job, 'Paste inserted.', true)
    } catch {
      finish(job, 'The editor did not confirm insertion. Check the draft before retrying.')
    } finally {
      applying = false
    }
  }
  const onConnect = (port) => {
    if (port.name !== PASTE_REVIEW_PORT) return
    const job = pending
    if (
      !job ||
      job.claimed ||
      job.connections.size >= 2 ||
      port.sender?.id !== browser.runtime.id
    ) {
      port.disconnect()
      return
    }
    job.connections.add(port)
    let authenticating = false,
      closed = false
    const timer = win.setTimeout(() => port.disconnect(), 5000)
    const onMessage = (data) => {
      if (pending !== job || closed) return
      if (job.port === port) {
        if (data?.action === PasteReviewAction.Cancel) abort()
        else if (data?.action === PasteReviewAction.Apply) {
          if (data.original === true) {
            if (data.allowOriginal === true) commit(job, job.raw)
            else finish(job, 'Original text needs explicit confirmation. Paste again.')
          } else if (job.scan.complete) {
            try {
              const value = redactPaste(job.raw, job.scan.matches, data.selected)
              if (job.scan.matches.length > 0 && value === job.raw && data.allowOriginal !== true)
                finish(job, 'Original text needs explicit confirmation. Paste again.')
              else commit(job, value)
            } catch {
              finish(job, 'Check incomplete. Original text was not inserted.')
            }
          }
        }
        return
      }
      if (
        authenticating ||
        data?.action !== PasteReviewAction.Authenticate ||
        data.jobId !== job.id
      ) {
        port.disconnect()
        return
      }
      authenticating = true
      void (async () => {
        try {
          const expected = await job.opening
          if (
            pending !== job ||
            closed ||
            job.claimed ||
            !expected?.proof ||
            data.proof !== expected.proof ||
            !trustedReviewPort(port.sender, expected, browser.runtime.id)
          ) {
            port.disconnect()
            return
          }
          job.claimed = true
          job.port = port
          win.clearTimeout(timer)
          port.postMessage({
            action: PasteReviewAction.Review,
            original: job.raw,
            complete: job.scan.complete,
            reason: job.scan.reason || '',
            ruleIndex: job.scan.ruleIndex,
            matches: job.scan.matches || [],
            formatted: job.formatted,
          })
        } catch {
          port.disconnect()
        }
      })()
    }
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(() => {
      closed = true
      win.clearTimeout(timer)
      job.connections.delete(port)
      port.onMessage.removeListener(onMessage)
      if (pending === job && job.port === port) finish(job, 'Review cancelled or target changed.')
    })
  }
  const onCancellation = (message, sender) => {
    const job = pending
    if (
      sender?.id !== browser.runtime.id ||
      message?.type !== RuntimeMessage.CancelNativePasteReview ||
      !job ||
      message.data?.jobId !== job.id
    )
      return
    void (async () => {
      try {
        const expected = await job.opening
        if (pending === job && expected?.proof && message.data.proof === expected.proof)
          finish(job, 'Review cancelled or target changed.')
      } catch {
        /* Opening failure already cancels the operation. */
      }
    })()
  }
  const onPaste = (event) => {
    if (stopped || config?.chatgptNativePasteEnabled === false || !event.isTrusted) return
    const editor = nativeChatgptEditor(doc)
    // Never take over search, rename, settings, or unknown website inputs.
    if (!editor) return
    if (!(event.target === editor || editor.contains(event.target))) return
    if (!event.cancelable) {
      show('This editor or page is not supported.')
      return
    }
    const types = Array.from(event.clipboardData?.types || [])
    if (!types.includes('text/plain') && event.clipboardData?.files?.length) {
      show('Images and files are not checked.')
      return
    }
    // This listener is installed synchronously at document_start, before config I/O.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (composing === editor) {
      show('Finish composing before pasting.')
      return
    }
    if (!config) {
      show('Local check is starting. Paste again shortly.')
      return
    }
    if (pending) {
      show('Finish or cancel the current paste first.')
      return
    }
    if (!types.includes('text/plain') || event.clipboardData?.files?.length) {
      show('Check incomplete. Original text was not inserted.')
      return
    }
    let raw, target
    try {
      target = capturePasteTarget(editor)
      raw = event.clipboardData.getData('text/plain')
      if (raw.length > PASTE_LIMITS.chars) {
        show('Paste is too long. Split it into parts of at most 20000 characters.')
        return
      }
    } catch {
      show('Check incomplete. Original text was not inserted.')
      return
    }
    const id = win.crypto.randomUUID()
    const job = {
      id,
      raw,
      target,
      formatted: types.includes('text/html'),
      scan: scanPaste(raw, config.chatgptNativePasteTerms, id.slice(0, 8)),
      opening: null,
      port: null,
      claimed: false,
      connections: new Set(),
      timer: null,
    }
    pending = job
    show('Checking locally…')
    job.timer = win.setTimeout(
      () => finish(job, 'Paste review expired. Paste again.'),
      PASTE_REVIEW_TTL_MS,
    )
    if (job.scan.complete && job.scan.matches.length === 0 && !job.formatted) {
      commit(job, raw)
      if (!pending && message === 'Paste inserted.') show('No rule matched. Text inserted.')
      return
    }
    show('Review this paste in the extension window.')
    job.opening = browser.runtime.sendMessage({
      type: RuntimeMessage.OpenNativePasteReview,
      data: { jobId: id },
    })
    void job.opening.catch(() => finish(job, 'Could not open the paste review. Paste again.'))
  }
  const changed = () => {
    if (composing && composing !== nativeChatgptEditor(doc)) composing = null
    if (!applying && pending && !pasteTargetIsCurrent(pending.target))
      finish(pending, 'The input changed. Paste again.')
    schedule()
  }
  const edited = (event) => {
    if (
      !applying &&
      pending &&
      (event.target === pending.target.element || pending.target.element.contains(event.target))
    )
      abort('The input changed. Paste again.')
  }
  const selectionChanged = (event) => {
    if (!applying && pending && event.isTrusted && doc.hasFocus() && !root.contains(event.target))
      abort('The input changed. Paste again.')
  }
  const keyChanged = (event) => {
    if (
      !applying &&
      pending &&
      event.isTrusted &&
      !['Meta', 'Control', 'Alt', 'Shift'].includes(event.key) &&
      !(event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey))
    )
      abort('The input changed. Paste again.')
  }
  const composition = (event) => {
    const editor = nativeChatgptEditor(doc)
    if (editor && (event.target === editor || editor.contains(event.target))) {
      composing = event.type === 'compositionstart' ? editor : null
      if (composing) abort('The input changed. Paste again.')
    }
  }
  doc.addEventListener('compositionstart', composition, true)
  doc.addEventListener('compositionend', composition, true)
  win.addEventListener('paste', onPaste, true)
  browser.runtime.onConnect.addListener(onConnect)
  browser.runtime.onMessage.addListener(onCancellation)
  doc.addEventListener('input', edited, true)
  doc.addEventListener('pointerdown', selectionChanged, true)
  doc.addEventListener('keydown', keyChanged, true)
  win.addEventListener('popstate', changed)
  win.addEventListener('hashchange', changed)
  const observer = new win.MutationObserver(changed)
  observer.observe(doc, { subtree: true, childList: true, characterData: true })
  const configure = (value) => {
    if (stopped) return
    abort('Review cancelled or target changed.')
    config = nativeChatgptConfig(value)
    if (config.chatgptNativePasteEnabled) {
      observer.observe(doc, { subtree: true, childList: true, characterData: true })
    } else observer.disconnect()
    t = nativeText(
      value.preferredLanguage === 'auto'
        ? win.navigator.language
        : value.preferredLanguage || win.navigator.language,
    )
    message = ''
    refresh()
  }
  const suspend = () => {
    // A known-off document stays native while unrelated settings are refreshed.
    if (stopped || config?.chatgptNativePasteEnabled === false) return
    abort('Review cancelled or target changed.')
    config = null
    show('Local check is starting. Paste again shortly.')
  }
  const dispose = () => {
    if (stopped) return
    abort('Review cancelled or target changed.')
    stopped = true
    if (scheduled) win.cancelAnimationFrame(scheduled)
    observer.disconnect()
    win.removeEventListener('paste', onPaste, true)
    win.removeEventListener('popstate', changed)
    win.removeEventListener('hashchange', changed)
    win.removeEventListener('pagehide', dispose)
    doc.removeEventListener('input', edited, true)
    doc.removeEventListener('compositionstart', composition, true)
    doc.removeEventListener('compositionend', composition, true)
    doc.removeEventListener('pointerdown', selectionChanged, true)
    doc.removeEventListener('keydown', keyChanged, true)
    browser.runtime.onConnect.removeListener(onConnect)
    browser.runtime.onMessage.removeListener(onCancellation)
    root.remove()
  }
  win.addEventListener('pagehide', dispose, { once: true })
  return { configure, suspend, dispose }
}
