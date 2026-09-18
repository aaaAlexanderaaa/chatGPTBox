import PropTypes from 'prop-types'
import { Globe, MapPin } from 'lucide-react'
import { useMemo } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { ToggleSwitch, SettingRow, SettingSection, ToggleRow } from './SettingComponents.jsx'
import { SearchableSelect } from './SearchableSelect.jsx'
import { ContentExtractor } from '../sections/ContentExtractor.jsx'
import { buildEngineOptions } from './engine-options.mjs'
import { engineSelectionLabel, getSelectionString } from '../../config/engine-selection.mjs'

const TEXT_INPUT_CLASS =
  'w-56 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'

const SITE_DISPLAY_NAMES = {
  google: 'Google Search',
  bing: 'Bing',
  yahoo: 'Yahoo',
  duckduckgo: 'DuckDuckGo',
  startpage: 'Startpage',
  baidu: 'Baidu',
  kagi: 'Kagi',
  yandex: 'Yandex',
  naver: 'Naver',
  brave: 'Brave',
  searx: 'Searx',
  ecosia: 'Ecosia',
  neeva: 'Neeva',
  presearch: 'Presearch',
  github: 'GitHub',
  gitlab: 'GitLab',
  youtube: 'YouTube',
  reddit: 'Reddit',
  quora: 'Quora',
  stackoverflow: 'Stack Overflow',
  arxiv: 'arXiv',
  bilibili: 'Bilibili',
  zhihu: 'Zhihu',
  juejin: 'Juejin',
  'mp.weixin.qq': 'WeChat Articles',
  followin: 'Followin',
}

/**
 * FeaturesTab - the Sites section: where the product integrates (集成).
 *
 * Per-site rules live here as one row per site: adapter on/off and — D-14 —
 * the site's engine assignment ("on GitHub, answer with Claude"). Page
 * context extraction and site matching complete the "on this site,
 * behave like this" roof.
 */
export function FeaturesTab({ config, updateConfig }) {
  const { t } = useTranslation()

  const siteKeys = useMemo(() => {
    const stored = Array.isArray(config.siteAdapters) ? config.siteAdapters : []
    const known = Object.keys(SITE_DISPLAY_NAMES)
    return [...new Set([...stored, ...known])]
  }, [config.siteAdapters])

  const engineOptions = useMemo(() => buildEngineOptions(config, t, {}), [config, t])

  const defaultEngineLabel = useMemo(() => {
    const name = getSelectionString(config)
    return name ? engineSelectionLabel(name, t) : t('Default engine')
  }, [config, t])

  const toggleSiteAdapter = (key, enabled) => {
    const activeSiteAdapters = config.activeSiteAdapters || []
    if (enabled) {
      updateConfig({ activeSiteAdapters: [...activeSiteAdapters, key] })
    } else {
      updateConfig({ activeSiteAdapters: activeSiteAdapters.filter((k) => k !== key) })
    }
  }

  const isSiteEnabled = (key) => (config.activeSiteAdapters || []).includes(key)

  const setSiteEngine = (key, opt) => {
    const overrides = { ...(config.siteEngineOverrides || {}) }
    if (!opt || !opt.value) delete overrides[key]
    else overrides[key] = { modelName: opt.value, apiMode: null }
    updateConfig({ siteEngineOverrides: overrides })
  }

  const siteEngineValue = (key) => {
    const override = config.siteEngineOverrides?.[key]
    if (!override) return ''
    return override.modelName || ''
  }

  return (
    <div className="space-y-4">
      {/* Site Integrations */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {t('Site Rules')}
        </h3>
        {siteKeys.map((key) => (
          <div
            key={key}
            className="p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center border border-border">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t(SITE_DISPLAY_NAMES[key] || key)}
                  </p>
                  <p className="text-xs text-muted-foreground">{key}</p>
                </div>
              </div>
              <ToggleSwitch
                checked={isSiteEnabled(key)}
                onChange={(enabled) => toggleSiteAdapter(key, enabled)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 pl-11">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {t('Engine on this site')}
              </span>
              <SearchableSelect
                value={siteEngineValue(key)}
                onChange={(value) =>
                  setSiteEngine(
                    key,
                    engineOptions.find((opt) => opt.value === value),
                  )
                }
                options={[
                  {
                    value: '',
                    label: `${t('Follow default')} (${defaultEngineLabel})`,
                  },
                  ...engineOptions,
                ]}
                minWidth="220px"
                searchPlaceholder={t('Search…')}
              />
            </div>
          </div>
        ))}
      </div>

      <SettingSection title={t('Site Matching')}>
        <SettingRow
          label={t('Custom Site Regex')}
          hint={t('Match extra sites where the search-engine panel is injected')}
        >
          <input
            type="text"
            value={config.siteRegex || ''}
            onChange={(e) => updateConfig({ siteRegex: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </SettingRow>

        <ToggleRow
          label={t(
            'Exclusively use Custom Site Regex for website matching, ignoring built-in rules',
          )}
          checked={config.useSiteRegexOnly === true}
          onChange={(value) => updateConfig({ useSiteRegexOnly: value })}
        />
      </SettingSection>

      <ContentExtractor config={config} updateConfig={updateConfig} />
    </div>
  )
}

FeaturesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
