import { useCallback, useEffect, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import {
  getProtocolProbeSpecs,
  PROTOCOL_PROBE_STORAGE_KEY,
} from '../../services/protocol-probe/specs.mjs'
import { SettingSection } from './SettingComponents.jsx'

const STATUS_STYLES = {
  ok: 'border-border bg-secondary/30 text-muted-foreground',
  url_drift: 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  marker_drift: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
  incomplete: 'border-border bg-secondary/30 text-muted-foreground',
  error: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
}

function statusLabel(status, t) {
  switch (status) {
    case 'ok':
      return t('Same as the checked-in reference')
    case 'url_drift':
      return t('Script filenames changed; protocol markers may still match')
    case 'marker_drift':
      return t('Required protocol markers are missing')
    case 'incomplete':
      return t('Page loaded without the expected app scripts')
    case 'error':
      return t('Protocol scan failed')
    default:
      return t('Not scanned yet')
  }
}

function formatTime(value) {
  if (typeof value !== 'string' || !value) return ''
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString()
}

export function ProtocolProbeSection() {
  const { t } = useTranslation()
  const specs = getProtocolProbeSpecs()
  const [reports, setReports] = useState({})
  const [busy, setBusy] = useState(false)
  const [runMessage, setRunMessage] = useState('')

  const loadReports = useCallback(async () => {
    const data = await Browser.storage.local.get({
      [PROTOCOL_PROBE_STORAGE_KEY]: { reports: {} },
    })
    const store = data[PROTOCOL_PROBE_STORAGE_KEY]
    setReports(store?.reports && typeof store.reports === 'object' ? store.reports : {})
  }, [])

  useEffect(() => {
    void loadReports()
    const listener = (changes) => {
      if (changes?.[PROTOCOL_PROBE_STORAGE_KEY]) {
        const next = changes[PROTOCOL_PROBE_STORAGE_KEY].newValue
        setReports(next?.reports && typeof next.reports === 'object' ? next.reports : {})
      }
    }
    const storageChanges = Browser.storage.onChanged || Browser.storage.local.onChanged
    storageChanges.addListener(listener)
    return () => storageChanges.removeListener(listener)
  }, [loadReports])

  const runNow = useCallback(async () => {
    setBusy(true)
    setRunMessage('')
    try {
      const result = await Browser.runtime.sendMessage({
        type: RuntimeMessage.ProtocolProbeRun,
        data: {},
      })
      if (result?.ran) {
        setRunMessage(t('Checked {{count}} open tab(s)', { count: result.count }))
      } else if (result?.reason === 'busy') {
        setRunMessage(t('A scan is already running — try again in a moment'))
      } else {
        setRunMessage(t('No matching tab open — open the provider site to scan'))
      }
    } catch (error) {
      setRunMessage(error?.message || String(error))
    } finally {
      setBusy(false)
      void loadReports()
    }
  }, [loadReports, t])

  return (
    <SettingSection
      title={t('Web protocol fingerprints')}
      description={t(
        'Automatically compares official page scripts against the checked-in conversation-protocol reference whenever you load a supported site.',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runNow()}
          className="px-3 py-1.5 text-xs font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          {busy ? t('Working...') : t('Check now')}
        </button>
        {runMessage && <span className="text-xs text-muted-foreground">{runMessage}</span>}
      </div>

      <div className="space-y-3">
        {specs.map((spec) => {
          const report = reports[spec.id]
          const status = report?.status || 'pending'
          const updates = report?.roleUpdates || []
          const showUpdates =
            status === 'url_drift' ||
            status === 'marker_drift' ||
            (report?.knownMissing || []).length > 0
          return (
            <div
              key={spec.id}
              className={`rounded-lg border p-3 text-xs space-y-2 ${
                STATUS_STYLES[status] || STATUS_STYLES.incomplete
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{spec.label}</div>
                  <div>{statusLabel(status, t)}</div>
                </div>
                <div className="text-right text-muted-foreground">
                  {report?.checkedAt
                    ? `${t('Last checked')}: ${formatTime(report.checkedAt)}`
                    : t('Waiting for a site load')}
                </div>
              </div>

              {showUpdates && updates.length > 0 && (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {t('Checked-in file → live file')}
                  </div>
                  {updates.map((item) => (
                    <div key={item.id} className="space-y-0.5">
                      <div className="text-foreground">{item.label || item.id}</div>
                      <div className="font-mono break-all">
                        {(item.expected || []).join(', ') || '—'}
                      </div>
                      <div className="font-mono break-all">
                        → {item.current || t('Not identified')}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {report?.newAppFilenames?.length > 0 && (
                <div>
                  <div className="text-foreground">{t('Other new app scripts on the page')}</div>
                  <div className="font-mono break-all">{report.newAppFilenames.join(', ')}</div>
                </div>
              )}

              {report?.missingMarkers?.length > 0 && (
                <div>
                  {t('Missing markers')}: {report.missingMarkers.join(', ')}
                </div>
              )}

              {report?.error && <div>{report.error}</div>}

              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {t('Search keywords for the live page')}
                </summary>
                <div className="mt-1 font-mono break-all text-muted-foreground">
                  {(spec.searchHints || []).join(' · ')}
                </div>
              </details>
            </div>
          )
        })}
      </div>
    </SettingSection>
  )
}
