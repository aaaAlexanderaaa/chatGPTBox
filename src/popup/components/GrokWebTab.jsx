import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingSection, Divider } from './SettingComponents.jsx'
import { getSettingsCards } from '../../modules/api.mjs'

function openAdvancedBridge() {
  const url = new URL(window.location.href)
  url.searchParams.set('tab', 'advanced')
  url.hash = 'api-server-bridge'
  window.location.assign(url.toString())
}

function Placeholder({ title, body, t }) {
  return (
    <SettingSection title={t(title)}>
      <p className="text-xs text-muted-foreground">{t(body)}</p>
    </SettingSection>
  )
}

Placeholder.propTypes = {
  title: PropTypes.string.isRequired,
  body: PropTypes.string.isRequired,
  t: PropTypes.func.isRequired,
}

export function GrokWebTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const Card = getSettingsCards().find((card) => card.id === 'grokweb')?.Component
  const catalog = Array.isArray(config.grokWebAccountModels)
    ? config.grokWebAccountModels.filter(Boolean)
    : []
  const enabled = Array.isArray(config.grokWebEnabledModels)
    ? config.grokWebEnabledModels.filter(Boolean)
    : []

  const toggleModel = (slug, on) => {
    const next = on ? [...new Set([...enabled, slug])] : enabled.filter((item) => item !== slug)
    updateConfig({ grokWebEnabledModels: next })
  }

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Account and login')}
        description={t('Grok Web uses your grok.com session')}
      >
        {Card ? <Card config={config} /> : null}
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Models')}
        description={t('Enabled models appear in pickers as grokweb/<slug>')}
      >
        {catalog.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('Sign in on grok.com so the catalog can be probed. Then enable a subset here.')}
          </p>
        ) : (
          <ul className="space-y-1">
            {catalog.map((slug) => (
              <li key={slug} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled.includes(slug)}
                  onChange={(event) => toggleModel(slug, event.target.checked)}
                />
                <span className="font-mono text-xs">grokweb/{slug}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingSection>

      <Divider />
      <Placeholder
        title="Official site history"
        body="Not enabled yet. v1 conversations stay on grok.com and cannot be turned off."
        t={t}
      />
      <Divider />
      <Placeholder
        title="History sync"
        body="Not enabled yet. Local Grok list sync is not in this version."
        t={t}
      />
      <Divider />
      <Placeholder
        title="Requests and polling"
        body="Not enabled yet. Polling and thinking controls are not exposed for Grok."
        t={t}
      />
      <Divider />
      <Placeholder
        title="Endpoint"
        body="Not enabled yet. A custom grok.com base URL is not available."
        t={t}
      />
      <Divider />
      <Placeholder
        title="Debug"
        body="Not enabled yet. Grok request debugging is not available."
        t={t}
      />
      <Divider />
      <Placeholder
        title="Protocol probe"
        body="Not enabled yet. Grok protocol probe is not wired in."
        t={t}
      />
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

GrokWebTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
