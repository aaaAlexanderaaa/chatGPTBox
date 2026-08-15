import { useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { ExternalLink } from 'lucide-react'
import { ModuleMessage } from '../../api.mjs'

// Engine-list settings card (roadmap A5): one card, default off, endpoint +
// diagnose + a door into the cockpit. Registered through the module seam
// (settings-cards.mjs) — never into the Advanced tab.

export function DshSettingsCard({ config, updateConfig }) {
  const { t } = useTranslation()
  const [diagnosis, setDiagnosis] = useState(null)
  const [testing, setTesting] = useState(false)
  const enabled = config.dshModuleEnabled === true

  const runDiagnose = async () => {
    setTesting(true)
    try {
      const result = await Browser.runtime.sendMessage({ type: ModuleMessage.DshDiagnose })
      setDiagnosis(
        result || {
          ok: false,
          stage: 'background',
          message: 'no answer from the background worker',
        },
      )
    } catch (error) {
      setDiagnosis({ ok: false, stage: 'background', message: String(error?.message || error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm">◆ DeepSeek Harness</span>
        <span className="text-[11px] text-muted-foreground">
          {t('local agent engine — off by default')}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => updateConfig('dshModuleEnabled', event.target.checked)}
          />
          {enabled ? t('Enabled') : t('Disabled')}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'A locally running `dsh web` instance becomes an agent engine: a full-page cockpit, approval notifications, and per-session auto-approve. Everything stays on your machine.',
        )}
      </p>
      {enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{t('Harness endpoint')}</span>
            <input
              className="flex-1 text-xs bg-secondary border border-border rounded-md px-2 py-1 outline-none"
              placeholder="http://127.0.0.1:3080"
              value={config.dshEndpoint || ''}
              onInput={(event) => updateConfig('dshEndpoint', event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
              onClick={() => void runDiagnose()}
              disabled={testing}
            >
              {testing ? t('Testing…') : t('Diagnose')}
            </button>
            <button
              className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary flex items-center gap-1"
              onClick={() => void Browser.tabs.create({ url: Browser.runtime.getURL('dsh.html') })}
            >
              <ExternalLink size={12} /> {t('Open the cockpit')}
            </button>
            {diagnosis && !testing && (
              <span className={`text-[11px] ${diagnosis.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {diagnosis.ok
                  ? t('Connected (harness {{version}}, {{latencyMs}}ms)', {
                      version: diagnosis.version,
                      latencyMs: diagnosis.latencyMs,
                    })
                  : t('Failed at "{{stage}}": {{message}}', {
                      stage: diagnosis.stage,
                      message: diagnosis.message,
                    })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
