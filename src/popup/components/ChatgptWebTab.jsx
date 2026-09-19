import PropTypes from 'prop-types'
import Browser from 'webextension-polyfill'
import { useMemo, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, Divider } from './SettingComponents.jsx'
import { ProtocolProbeSection } from './ProtocolProbeSection.jsx'
import { buildModuleKit } from './module-kit.mjs'
import { getSettingsCards } from '../../modules/api.mjs'
import { refreshChatGptWebModelList } from '../../services/model-lists.mjs'
import { CHATGPT_WEB_DEFAULT_MODEL_SLUG } from '../../config/limits.mjs'

function openAdvancedBridge() {
  const url = new URL(window.location.href)
  url.searchParams.set('tab', 'advanced')
  url.hash = 'api-server-bridge'
  window.location.assign(url.toString())
}

export function ChatgptWebTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const kit = useMemo(() => buildModuleKit(), [])
  const Card = getSettingsCards().find((card) => card.id === 'chatgptweb')?.Component
  const catalog = Array.isArray(config.chatgptWebAccountModels)
    ? config.chatgptWebAccountModels.filter(Boolean)
    : []
  const enabled = Array.isArray(config.chatgptWebEnabledModels)
    ? config.chatgptWebEnabledModels.filter(Boolean)
    : []
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const signedIn = Boolean(config.accessToken)

  const toggleModel = (slug, on) => {
    const next = on ? [...new Set([...enabled, slug])] : enabled.filter((item) => item !== slug)
    updateConfig({ chatgptWebEnabledModels: next })
  }

  const refreshCatalog = async () => {
    setRefreshing(true)
    setRefreshError('')
    try {
      const models = await refreshChatGptWebModelList({ accessToken: config.accessToken })
      updateConfig({
        chatgptWebAccountModels: models,
        chatgptWebEnabledModels: enabled.filter((slug) => models.includes(slug)),
      })
    } catch (error) {
      setRefreshError(
        error?.message || t('Could not fetch ChatGPT Web models. Type a model id if needed.'),
      )
    } finally {
      setRefreshing(false)
    }
  }

  const modelSlugs = catalog.length > 0 ? catalog : [CHATGPT_WEB_DEFAULT_MODEL_SLUG]

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Account and login')}
        description={t('ChatGPT Web uses your chatgpt.com session')}
      >
        {signedIn ? (
          <p className="text-xs text-muted-foreground">{t('Signed in to ChatGPT Web')}</p>
        ) : (
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
            onClick={() => void Browser.tabs.create({ url: 'https://chatgpt.com/' })}
          >
            {t('Open chatgpt.com to sign in')}
          </button>
        )}
        <p className="text-xs text-muted-foreground">
          {catalog.length > 0
            ? t('Account catalog: {{count}} models', { count: catalog.length })
            : t('Account catalog unknown until you refresh after signing in')}
        </p>
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Models')}
        description={t('Enabled models appear in pickers as chatgptweb/<slug>')}
      >
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
            onClick={() => void refreshCatalog()}
            disabled={!signedIn || refreshing}
          >
            {refreshing ? t('Fetching…') : t('Refresh models')}
          </button>
        </div>
        {refreshError ? <p className="text-xs text-destructive">{refreshError}</p> : null}
        <ul className="space-y-1">
          {modelSlugs.map((slug) => (
            <li key={slug} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled.includes(slug)}
                onChange={(event) => toggleModel(slug, event.target.checked)}
              />
              <span className="font-mono text-xs">chatgptweb/{slug}</span>
            </li>
          ))}
        </ul>
      </SettingSection>

      <Divider />

      {Card ? <Card config={config} updateConfig={updateConfig} kit={kit} /> : null}

      <Divider />

      <ProtocolProbeSection />

      <Divider />

      <SettingSection title={t('API Bridge')}>
        <SettingRow
          label={t('Local API endpoints for web engines')}
          hint={t('The bridge itself stays in Advanced')}
        >
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
            onClick={openAdvancedBridge}
          >
            {t('Open API Bridge')}
          </button>
        </SettingRow>
      </SettingSection>
    </div>
  )
}

ChatgptWebTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
