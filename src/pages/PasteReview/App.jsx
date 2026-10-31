import { useEffect, useRef, useState } from 'preact/hooks'
import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import {
  PASTE_REVIEW_PORT,
  PasteReviewAction,
  isPasteJobId,
} from '../../native-chatgpt/review-contract.mjs'
import { REDACTION_KINDS, redactPaste } from '../../native-chatgpt/redaction.mjs'
import { nativeText } from '../../native-chatgpt/strings.mjs'

export function PasteReview() {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState([])
  const [originalAllowed, setOriginalAllowed] = useState(false)
  const [status, setStatus] = useState('Connecting to the original document…')
  const [language, setLanguage] = useState(navigator.language)
  const [busy, setBusy] = useState(false)
  const channel = useRef(null)
  const finished = useRef(false)
  const t = nativeText(language)
  let candidate = '',
    candidateError = ''
  if (data?.complete) {
    try {
      candidate = redactPaste(data.original, data.matches, selected)
    } catch (error) {
      candidateError = error.message
    }
  }
  const unchangedOriginal =
    data?.complete && data.matches.length > 0 && !candidateError && candidate === data.original
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tab = Number(params.get('tab')),
      documentId = params.get('document')
    if (!isPasteJobId(params.get('job')) || !Number.isInteger(tab) || tab < 0 || !documentId) {
      setStatus('This review is no longer available. Close it and paste again.')
      return
    }
    void Browser.storage.local.get({ preferredLanguage: 'auto' }).then((config) => {
      if (config.preferredLanguage !== 'auto') setLanguage(config.preferredLanguage)
    })
    let port = null,
      disposed = false
    const onMessage = (message) => {
      if (message.action === PasteReviewAction.Review) {
        setData(message)
        setSelected(message.matches.map((item) => item.id))
        setStatus('')
      } else if (message.action === PasteReviewAction.Finished) {
        finished.current = true
        setData(null)
        setSelected([])
        setStatus(message.message)
        setBusy(false)
      }
    }
    const onDisconnect = () => {
      setData(null)
      setSelected([])
      if (!finished.current)
        setStatus('This review is no longer available. Close it and paste again.')
      channel.current = null
      setBusy(false)
    }
    void Browser.runtime
      .sendMessage({
        type: RuntimeMessage.AuthenticateNativePasteReview,
        data: { jobId: params.get('job') },
      })
      .then(({ proof }) => {
        if (disposed) return
        port = Browser.tabs.connect(tab, { name: PASTE_REVIEW_PORT, documentId, frameId: 0 })
        channel.current = port
        port.onMessage.addListener(onMessage)
        port.onDisconnect.addListener(onDisconnect)
        port.postMessage({
          action: PasteReviewAction.Authenticate,
          jobId: params.get('job'),
          proof,
        })
      })
      .catch(() => {
        if (!disposed) setStatus('This review is no longer available. Close it and paste again.')
      })
    const close = () => {
      disposed = true
      try {
        port?.disconnect()
      } catch {
        /* already closed */
      }
    }
    window.addEventListener('pagehide', close, { once: true })
    return () => {
      port?.onMessage.removeListener(onMessage)
      port?.onDisconnect.removeListener(onDisconnect)
      window.removeEventListener('pagehide', close)
      close()
      channel.current = null
    }
  }, [])
  const submit = async (original) => {
    if (!channel.current || busy || ((original || unchangedOriginal) && !originalAllowed)) return
    setBusy(true)
    try {
      const tabId = Number(new URLSearchParams(location.search).get('tab'))
      const target = await Browser.tabs.get(tabId)
      await Browser.tabs.update(tabId, { active: true })
      await Browser.windows.update(target.windowId, { focused: true })
      channel.current.postMessage({
        action: PasteReviewAction.Apply,
        original,
        selected,
        allowOriginal: originalAllowed,
      })
    } catch {
      setData(null)
      setSelected([])
      setStatus('This review is no longer available. Close it and paste again.')
      setBusy(false)
    }
  }
  const cancel = () => {
    channel.current?.postMessage({ action: PasteReviewAction.Cancel })
    setData(null)
    setSelected([])
    window.close()
  }
  return (
    <main className="paste-review">
      <header>
        <span>ChatGPTBox</span>
        <h1>{t('Paste review')}</h1>
      </header>
      <p>
        {t('Only the supported rules are checked; an unmatched text is not a privacy guarantee.')}
      </p>
      {status && <p role="status">{t(status)}</p>}
      {data && (
        <>
          {data.formatted && (
            <p role="alert">
              {t('This paste also contains formatting. Confirm plain-text insertion.')}
            </p>
          )}
          {!data.complete && (
            <p role="alert">
              {Number.isInteger(data.ruleIndex) && (
                <>
                  {t('Rule')} {data.ruleIndex + 1}:{' '}
                </>
              )}
              {t(data.reason)}
            </p>
          )}
          {candidateError && <p role="alert">{t(candidateError)}</p>}
          {unchangedOriginal && (
            <label>
              <input
                type="checkbox"
                checked={originalAllowed}
                onChange={(event) => setOriginalAllowed(event.currentTarget.checked)}
              />
              {t(
                'The selected result is unchanged original text. I confirm sharing it with the website.',
              )}
            </label>
          )}
          <div className="paste-review-columns">
            <section>
              <h2>{t('Original text')}</h2>
              <pre>{data.original}</pre>
            </section>
            <section>
              <h2>{t('Text to insert')}</h2>
              <pre>{candidate}</pre>
            </section>
          </div>
          {data.matches.length > 0 && (
            <fieldset disabled={busy}>
              <legend>
                {t('Choose which matches to replace. Keys stay masked in this result.')}
              </legend>
              {data.matches.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.locked || selected.includes(item.id)}
                    disabled={item.locked}
                    onChange={(event) =>
                      setSelected(
                        event.currentTarget.checked
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    {t(REDACTION_KINDS[item.kind])}:{' '}
                    <code>{data.original.slice(item.start, item.end)}</code>
                    {' → '}
                    <code>{item.replacement || t('(delete)')}</code>
                    {item.ruleIndexes?.length > 0 && (
                      <small>
                        {' '}
                        {t('Rule')}: {item.ruleIndexes.map((index) => index + 1).join(', ')}
                      </small>
                    )}
                    {item.conflict && (
                      <small>
                        {' '}
                        {t('Overlapping rules conflict. The entire range uses one masked alias.')}
                      </small>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="paste-review-actions">
            <button
              type="button"
              disabled={
                busy ||
                !data.complete ||
                !!candidateError ||
                (unchangedOriginal && !originalAllowed)
              }
              onClick={() => submit(false)}
            >
              {t('Insert selected text')}
            </button>
            <button type="button" onClick={cancel}>
              {t('Cancel')}
            </button>
          </div>
          <details>
            <summary>{t('Insert original plain text once')}</summary>
            <label>
              <input
                type="checkbox"
                checked={originalAllowed}
                onChange={(event) => setOriginalAllowed(event.currentTarget.checked)}
              />
              {t('I understand that original text will be shared with the website.')}
            </label>
            <button type="button" disabled={!originalAllowed || busy} onClick={() => submit(true)}>
              {t('Insert original plain text once')}
            </button>
          </details>
        </>
      )}
      {!data && (
        <button type="button" onClick={() => window.close()}>
          {t('Close')}
        </button>
      )}
    </main>
  )
}
