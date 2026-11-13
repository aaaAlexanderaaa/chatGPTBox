import { useEffect, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import { SettingSection } from './SettingComponents.jsx'

const labels = {
  'generation.start': 'Independent questions',
  'conversation.append': 'Continue a verified conversation',
  'conversation.read': 'Read native history',
  'conversation.list': 'List native history',
  'chatgptweb.projects.list': 'List Projects',
  'chatgptweb.attachments.upload': 'Upload images',
  'chatgptweb.history.sync': 'Sync history',
}

export function EngineAccessPanel() {
  const { t } = useTranslation()
  const [engines, setEngines] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState({})
  async function request(method, payload) {
    const reply = await Browser.runtime.sendMessage({
      type: RuntimeMessage.EngineRequest,
      data: { method, payload },
    })
    if (!reply?.ok) throw new Error(reply?.error?.message || 'The engine runtime is unavailable.')
    return reply.value
  }
  async function load() {
    setEngines(await request('engines.list'))
  }
  useEffect(() => {
    void load().catch((cause) => setError(cause.message))
    const changed = (changes) => {
      if (
        Object.keys(changes).some(
          (key) => key.startsWith('engineExposure') || /WebEnabled$/.test(key),
        )
      )
        void load().catch((cause) => setError(cause.message))
    }
    Browser.storage.onChanged.addListener(changed)
    return () => Browser.storage.onChanged.removeListener(changed)
  }, [])
  async function change(engineId, patch, method = 'exposure.set') {
    setBusy(true)
    setError('')
    try {
      const value = await request(method, {
        engineId,
        ...(method === 'engine.review' ? { query: { acknowledgeUnverified: true } } : { patch }),
      })
      if (value?.ok === false)
        throw new Error(value.message || 'The original execution is still unresolved.')
      await load()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingSection
      title={t('External engine access')}
      description={t(
        'API and MCP use the same engine operations. Turning access off blocks new requests; existing runs remain available to view or stop. The bridge connection is configured in Advanced.',
      )}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {engines.map((engine) => (
        <fieldset
          key={engine.id}
          disabled={busy}
          className="rounded-xl border border-border p-3 space-y-2"
        >
          <legend className="px-1 text-sm font-medium">{engine.label}</legend>
          <p className="text-xs text-muted-foreground">
            {t(engine.enabled ? 'Engine enabled' : 'Engine disabled')} ·{' '}
            {t(
              engine.readiness.state === 'blocked'
                ? 'Account or page check required'
                : 'Account and page are rechecked before sending',
            )}
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={engine.exposure.externalEnabled}
              onChange={(event) =>
                void change(engine.id, { externalEnabled: event.target.checked })
              }
            />
            {t('Allow external API access')}
          </label>
          <details>
            <summary className="text-xs cursor-pointer">
              {t('Allowed operations and support')}
            </summary>
            <div className="mt-2 space-y-1">
              {[
                ...Object.entries(engine.operations)
                  .filter(([name]) => !name.startsWith('run.'))
                  .map(([name, capability]) => [name, capability.implemented]),
                ...(engine.externalExtensionOperations || []).map((name) => [name, true]),
              ].map(([name, supported]) => (
                <label key={name} className="flex gap-2 text-xs">
                  <input
                    type="checkbox"
                    disabled={!supported}
                    checked={supported && engine.exposure.operations.includes(name)}
                    onChange={(event) =>
                      void change(engine.id, {
                        operations: event.target.checked
                          ? [...engine.exposure.operations, name]
                          : engine.exposure.operations.filter((item) => item !== name),
                      })
                    }
                  />
                  {t(labels[name] || name)}
                  {!supported && ` — ${t('Not adapted')}`}
                </label>
              ))}
            </div>
          </details>
          {engine.unresolvedRuns.length > 0 && (
            <div className="text-xs space-y-2 border-t border-border pt-2">
              <p>
                {t(
                  'An earlier request has an unconfirmed outcome. Inspect its original website before allowing new work.',
                )}
              </p>
              <ul>
                {engine.unresolvedRuns.map((run) => (
                  <li key={run.runId} className="font-mono break-all">
                    {run.runId} · {run.outcome}
                  </li>
                ))}
              </ul>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={reviewed[engine.id] === true}
                  onChange={(event) =>
                    setReviewed({ ...reviewed, [engine.id]: event.target.checked })
                  }
                />
                {t(
                  'I inspected the original website and accept that this result remains unconfirmed.',
                )}
              </label>
              <button
                type="button"
                disabled={!reviewed[engine.id]}
                className="px-3 py-1 rounded border border-border disabled:opacity-50"
                onClick={() => void change(engine.id, null, 'engine.review')}
              >
                {t('Check and allow new work')}
              </button>
            </div>
          )}
        </fieldset>
      ))}
    </SettingSection>
  )
}
