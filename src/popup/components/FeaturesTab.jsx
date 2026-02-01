import PropTypes from 'prop-types'
import { Zap, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ToggleSwitch } from './SettingComponents.jsx'

/**
 * FeaturesTab - Feature pages and site integrations
 * Matches the demo design
 */
export function FeaturesTab({ config, updateConfig }) {
  const { t } = useTranslation()

  // Site adapters configuration
  const siteAdapters = [
    { key: 'google', name: 'Google Search', domain: 'google.com' },
    { key: 'github', name: 'GitHub', domain: 'github.com' },
    { key: 'youtube', name: 'YouTube', domain: 'youtube.com' },
    { key: 'reddit', name: 'Reddit', domain: 'reddit.com' },
    { key: 'stackoverflow', name: 'Stack Overflow', domain: 'stackoverflow.com' },
    { key: 'arxiv', name: 'arXiv', domain: 'arxiv.org' },
    { key: 'bilibili', name: 'Bilibili', domain: 'bilibili.com' },
    { key: 'zhihu', name: 'Zhihu', domain: 'zhihu.com' },
  ]

  const toggleSiteAdapter = (key, enabled) => {
    const activeSiteAdapters = config.activeSiteAdapters || []
    if (enabled) {
      updateConfig({ activeSiteAdapters: [...activeSiteAdapters, key] })
    } else {
      updateConfig({ activeSiteAdapters: activeSiteAdapters.filter((k) => k !== key) })
    }
  }

  const isSiteEnabled = (key) => {
    return (config.activeSiteAdapters || []).includes(key)
  }

  return (
    <div className="space-y-4">
      {/* Feature Pages Header */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">{t('Feature Pages')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('Enhanced AI integration on supported websites')}
            </p>
          </div>
        </div>
      </div>

      {/* Site Integrations */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {t('Site Integrations')}
        </h3>
        {siteAdapters.map((site) => (
          <div
            key={site.key}
            className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center border border-border">
                <Globe className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{site.name}</p>
                <p className="text-xs text-muted-foreground">{site.domain}</p>
              </div>
            </div>
            <ToggleSwitch
              checked={isSiteEnabled(site.key)}
              onChange={(enabled) => toggleSiteAdapter(site.key, enabled)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

FeaturesTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
