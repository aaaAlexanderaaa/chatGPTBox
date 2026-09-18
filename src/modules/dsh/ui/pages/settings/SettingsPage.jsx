import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { isSettingsConflict, settingsMutatePayload } from '../../models/settings-write.mjs'
import {
  credentialRefsFromProviders,
  credentialsDescribePayload,
  credentialsSetPayload,
  credentialsUnsetPayload,
  deriveKeyRef,
  DISCOVER_PROTOCOLS,
  discoverModelsPayload,
  normalizeProviders,
} from '../../models/credentials.mjs'
import { SchemaForm } from './SchemaForm.jsx'
import { PresetRoster } from './PresetRoster.jsx'
import {
  isSettingsNotExposed,
  sectionNamespace,
  sectionsFromDescribeResult,
  settingsTabForNamespace,
} from './load-sections.mjs'

const EMPTY_VALUES = {}
const BASE_URL_PLACEHOLDER = 'https://api.deepseek.com'
const BASE_URL_HELP =
  'Official DeepSeek: https://api.deepseek.com (no /v1). OpenAI-compatible gateways: origin + /v1, for example https://gateway.example/v1. Do not append /chat/completions or /responses — choose the API protocol instead.'

function sectionValues(section) {
  return section?.values || section?.value || EMPTY_VALUES
}

function namespaceOf(section) {
  return sectionNamespace(section)
}

export function SettingsPage({ rpc }) {
  const { t } = useTranslation()
  const TABS = [
    { id: 'general', label: t('General') },
    { id: 'models', label: t('Models') },
    { id: 'plugins', label: t('Plugins') },
    { id: 'presets', label: t('Presets') },
  ]
  const [tab, setTab] = useState('general')
  const [sections, setSections] = useState([])
  const [providers, setProviders] = useState([])
  const [credentials, setCredentials] = useState(null)
  const [status, setStatus] = useState(null)
  const [discoverNs, setDiscoverNs] = useState('llm-pi-ai')
  const [discoverEndpoint, setDiscoverEndpoint] = useState('')
  const [discoverProtocol, setDiscoverProtocol] = useState('openai-completions')
  const [discoverKey, setDiscoverKey] = useState('')
  const [discovered, setDiscovered] = useState(null)

  const loadDescribe = useCallback(async () => {
    try {
      const result = await rpc('settings.describe', {})
      setSections(sectionsFromDescribeResult(result))
    } catch (error) {
      setSections(sectionsFromDescribeResult(null, error))
      if (!isSettingsNotExposed(error)) {
        setStatus(error?.message || String(error))
      }
    }
  }, [rpc])

  const loadModelsExtras = useCallback(async () => {
    try {
      const providerList = normalizeProviders(await rpc('llm.providers', {}))
      setProviders(providerList)
      const refs = credentialRefsFromProviders(
        providerList,
        sections.filter((section) => settingsTabForNamespace(namespaceOf(section)) === 'models'),
      )
      if (refs.length === 0) {
        setCredentials(null)
        return
      }
      const creds = await rpc('credentials.describe', credentialsDescribePayload(refs))
      setCredentials(creds)
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }, [rpc, sections])

  useEffect(() => {
    void loadDescribe()
  }, [loadDescribe])

  useEffect(() => {
    if (tab === 'models') void loadModelsExtras()
  }, [tab, loadModelsExtras])

  const generalSections = useMemo(
    () => sections.filter((section) => settingsTabForNamespace(namespaceOf(section)) === 'general'),
    [sections],
  )
  const modelSections = useMemo(
    () => sections.filter((section) => settingsTabForNamespace(namespaceOf(section)) === 'models'),
    [sections],
  )
  const pluginSections = useMemo(
    () => sections.filter((section) => settingsTabForNamespace(namespaceOf(section)) === 'plugins'),
    [sections],
  )

  const saveSection = async (section, { ops, expectedRevision }) => {
    if (!ops?.length) return
    try {
      await rpc(
        'settings.mutate',
        settingsMutatePayload({
          namespace: namespaceOf(section),
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
      const result = await rpc(
        'llm.discoverModels',
        discoverModelsPayload({
          settingsNs: discoverNs,
          baseURL: discoverEndpoint,
          api: discoverProtocol,
          apiKey: discoverKey,
        }),
      )
      setDiscovered(result)
      setStatus(null)
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  const saveCredential = async (event) => {
    event.preventDefault()
    if (!discoverKey) return
    const ref =
      discoverNs === 'llm-deepseek'
        ? 'DEEPSEEK_API_KEY'
        : deriveKeyRef(discoverNs.replace(/^llm-/, ''))
    try {
      await rpc('credentials.set', credentialsSetPayload({ ref, value: discoverKey }))
      setDiscoverKey('')
      await loadModelsExtras()
      setStatus('Credential saved')
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  const unsetCredential = async (id) => {
    try {
      await rpc('credentials.unset', credentialsUnsetPayload({ ref: id }))
      await loadModelsExtras()
      setStatus('Credential unset')
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  const openSettingsDocument = async () => {
    try {
      const result = await rpc('settings.openDocument', {})
      setStatus(result?.opened === false && result.path ? result.path : 'Opened settings document')
    } catch (error) {
      setStatus(error?.message || String(error))
    }
  }

  const credentialRows = useMemo(() => {
    const map = credentials?.credentials
    if (map && typeof map === 'object') {
      return Object.entries(map).filter(([, view]) => view?.configured)
    }
    return []
  }, [credentials])

  const emptyCopy = {
    general: t(
      'No general preferences from this harness yet. Language, theme, and permission defaults appear here when the host exposes them.',
    ),
    models: t(
      'No model namespaces from this harness yet. Add an API key or a custom provider below.',
    ),
    plugins: t('No plugin settings from this harness yet.'),
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
        <button
          type="button"
          className="ml-auto text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
          onClick={() => void openSettingsDocument()}
        >
          {t('Open settings.yaml')}
        </button>
      </div>
      <div className="dsh-scroll flex-1 min-h-0 px-6 py-4 space-y-6">
        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {tab === 'general' &&
          (generalSections.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyCopy.general}</p>
          ) : (
            generalSections.map((section) => (
              <SchemaForm
                key={`${section.namespace}:${section.revision ?? ''}`}
                section={section}
                values={sectionValues(section)}
                onSubmit={(payload) => void saveSection(section, payload)}
              />
            ))
          ))}

        {tab === 'models' && (
          <>
            <p className="text-xs text-muted-foreground">
              {t(
                'Enter provider keys here. Official DeepSeek only needs an API key. Custom OpenAI-compatible servers need a base URL and a protocol.',
              )}
            </p>
            {Array.isArray(providers) && providers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t('Providers')}</h3>
                <ul className="text-xs space-y-1">
                  {providers.map((provider) => (
                    <li
                      key={
                        provider.provider ||
                        provider.id ||
                        provider.name ||
                        JSON.stringify(provider)
                      }
                    >
                      {provider.displayName || provider.name || provider.provider || provider.id}
                      {provider.active === false ? ' (inactive)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {modelSections.length === 0 ? (
              <p className="text-xs text-muted-foreground">{emptyCopy.models}</p>
            ) : (
              modelSections.map((section) => (
                <SchemaForm
                  key={`${section.namespace}:${section.revision ?? ''}`}
                  section={section}
                  values={sectionValues(section)}
                  onSubmit={(payload) => void saveSection(section, payload)}
                />
              ))
            )}
            {credentialRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t('Credentials')}</h3>
                <ul className="space-y-2">
                  {credentialRows.map(([id, view]) => (
                    <li key={id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono">{id}</span>
                      {view?.source && <span className="text-muted-foreground">{view.source}</span>}
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
                        disabled={view?.writable === false}
                        onClick={() => void unsetCredential(id)}
                      >
                        {t('Unset')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form className="space-y-2 border border-border rounded-md p-3" onSubmit={runDiscover}>
              <h3 className="text-sm font-medium">{t('Discover models')}</h3>
              <p className="text-[11px] text-muted-foreground">{BASE_URL_HELP}</p>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Adapter</span>
                <select
                  className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
                  value={discoverNs}
                  onChange={(event) => setDiscoverNs(event.target.value)}
                >
                  <option value="llm-deepseek">llm-deepseek (official DeepSeek)</option>
                  <option value="llm-pi-ai">llm-pi-ai (OpenAI-compatible / custom)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Base URL</span>
                <input
                  className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
                  value={discoverEndpoint}
                  placeholder={BASE_URL_PLACEHOLDER}
                  onInput={(event) => setDiscoverEndpoint(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">API protocol</span>
                <select
                  className="text-sm bg-secondary border border-border rounded-md px-2 py-1"
                  value={discoverProtocol}
                  onChange={(event) => setDiscoverProtocol(event.target.value)}
                >
                  {DISCOVER_PROTOCOLS.map((protocol) => (
                    <option key={protocol} value={protocol}>
                      {protocol}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-muted-foreground">
                openai-completions speaks /v1/chat/completions. openai-responses speaks
                /v1/responses. Put neither path on the base URL.
              </p>
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
          (pluginSections.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyCopy.plugins}</p>
          ) : (
            pluginSections.map((section) => (
              <SchemaForm
                key={`${section.namespace}:${section.revision ?? ''}`}
                section={section}
                values={sectionValues(section)}
                onSubmit={(payload) => void saveSection(section, payload)}
              />
            ))
          ))}

        {tab === 'presets' && <PresetRoster rpc={rpc} />}
      </div>
    </div>
  )
}
