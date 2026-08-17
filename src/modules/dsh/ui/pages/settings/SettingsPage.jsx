import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { isSettingsConflict, settingsMutatePayload } from '../../models/settings-write.mjs'
import { SchemaForm } from './SchemaForm.jsx'
import { PresetRoster } from './PresetRoster.jsx'
import { sectionsFromDescribeResult } from './load-sections.mjs'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'presets', label: 'Presets' },
]

const PLUGIN_NS = /agent-loop|bash|web-search|plugin/i

function sectionValues(section) {
  return section?.values || section?.value || {}
}

function namespaceOf(section) {
  return section?.namespace || ''
}

export function SettingsPage({ rpc }) {
  const [tab, setTab] = useState('general')
  const [sections, setSections] = useState([])
  const [providers, setProviders] = useState([])
  const [credentials, setCredentials] = useState(null)
  const [status, setStatus] = useState(null)
  const [discoverEndpoint, setDiscoverEndpoint] = useState('')
  const [discoverKey, setDiscoverKey] = useState('')
  const [discovered, setDiscovered] = useState(null)

  const loadDescribe = useCallback(async () => {
    try {
      const result = await rpc('settings.describe', {})
      setSections(sectionsFromDescribeResult(result))
    } catch (error) {
      setSections(sectionsFromDescribeResult(null, error))
      setStatus(error?.message || String(error))
    }
  }, [rpc])

  const loadModelsExtras = useCallback(async () => {
    try {
      const [providerList, creds] = await Promise.all([
        rpc('llm.providers'),
        rpc('credentials.describe'),
      ])
      setProviders(providerList?.providers || providerList?.items || providerList || [])
      setCredentials(creds)
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }, [rpc])

  useEffect(() => {
    void loadDescribe()
  }, [loadDescribe])

  useEffect(() => {
    if (tab === 'models') void loadModelsExtras()
  }, [tab, loadModelsExtras])

  const generalSections = useMemo(
    () =>
      sections.filter((section) => {
        const ns = namespaceOf(section)
        if (!ns || ns.startsWith('llm') || ns === 'agent-presets') return false
        if (PLUGIN_NS.test(ns)) return false
        return true
      }),
    [sections],
  )

  const modelSections = useMemo(
    () => sections.filter((section) => namespaceOf(section).startsWith('llm')),
    [sections],
  )

  const pluginSections = useMemo(
    () => sections.filter((section) => PLUGIN_NS.test(namespaceOf(section))),
    [sections],
  )

  const saveSection = async (section, { ops, expectedRevision }) => {
    if (!ops?.length) return
    try {
      await rpc(
        'settings.mutate',
        settingsMutatePayload({
          namespace: section.namespace,
          ops,
          expectedRevision,
        }),
      )
      setStatus('Saved')
      await loadDescribe()
    } catch (error) {
      if (isSettingsConflict(error)) {
        setStatus('Conflict — reloaded latest settings; save again if needed.')
        await loadDescribe()
        return
      }
      setStatus(error?.message || String(error))
    }
  }

  const runDiscover = async (event) => {
    event.preventDefault()
    try {
      const result = await rpc('llm.discoverModels', {
        endpoint: discoverEndpoint || undefined,
        apiKey: discoverKey || undefined,
      })
      setDiscovered(result)
      setStatus(null)
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  const saveCredential = async (event) => {
    event.preventDefault()
    if (!discoverKey) return
    try {
      await rpc('credentials.set', {
        endpoint: discoverEndpoint || undefined,
        apiKey: discoverKey,
      })
      setDiscoverKey('')
      await loadModelsExtras()
      setStatus('Credential saved')
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`text-xs px-2.5 py-1 rounded-md border ${
              tab === entry.id ? 'border-primary bg-secondary' : 'border-border hover:bg-secondary'
            }`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="dsh-scroll flex-1 min-h-0 px-6 py-4 space-y-6">
        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {tab === 'general' &&
          generalSections.map((section) => (
            <SchemaForm
              key={section.namespace}
              section={section}
              values={sectionValues(section)}
              onSubmit={(payload) => void saveSection(section, payload)}
            />
          ))}

        {tab === 'models' && (
          <>
            {Array.isArray(providers) && providers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Providers</h3>
                <ul className="text-xs space-y-1">
                  {providers.map((provider) => (
                    <li key={provider.id || provider.name || JSON.stringify(provider)}>
                      {provider.name || provider.id || String(provider)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {modelSections.map((section) => (
              <SchemaForm
                key={section.namespace}
                section={section}
                values={sectionValues(section)}
                onSubmit={(payload) => void saveSection(section, payload)}
              />
            ))}
            {credentials && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Credentials</h3>
                <pre className="text-[11px] bg-secondary rounded-md p-3 overflow-auto max-h-40">
                  {JSON.stringify(credentials, null, 2)}
                </pre>
              </div>
            )}
            <form className="space-y-2 border border-border rounded-md p-3" onSubmit={runDiscover}>
              <h3 className="text-sm font-medium">Discover models</h3>
              <p className="text-[11px] text-muted-foreground">
                Draft endpoint/key are only sent to discoverModels unless you save credentials.
              </p>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Endpoint</span>
                <input
                  className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
                  value={discoverEndpoint}
                  onInput={(event) => setDiscoverEndpoint(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">API key</span>
                <input
                  type="password"
                  className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
                  value={discoverKey}
                  onInput={(event) => setDiscoverKey(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
                >
                  Discover
                </button>
                <button
                  type="button"
                  className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
                  onClick={(event) => void saveCredential(event)}
                >
                  Save credential
                </button>
              </div>
            </form>
            {discovered && (
              <pre className="text-[11px] bg-secondary rounded-md p-3 overflow-auto max-h-48">
                {JSON.stringify(discovered, null, 2)}
              </pre>
            )}
          </>
        )}

        {tab === 'plugins' &&
          pluginSections.map((section) => (
            <SchemaForm
              key={section.namespace}
              section={section}
              values={sectionValues(section)}
              onSubmit={(payload) => void saveSection(section, payload)}
            />
          ))}

        {tab === 'presets' && <PresetRoster rpc={rpc} />}
      </div>
    </div>
  )
}
