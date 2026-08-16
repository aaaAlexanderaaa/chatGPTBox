import Browser from 'webextension-polyfill'
import { useTranslation } from 'react-i18next'

// Engines-tab settings card for Grok Web: login CTA or signed-in tier/models.
// Config is written by the core probe; this card is display + user-initiated
// tab open only (ordinary grok.com — not the proxy URL, not the probe).

export function GrokWebSettingsCard({ config }) {
  const { t } = useTranslation()
  const signedIn = config.grokWebSignedIn === true
  const tier = config.grokWebAccountTier || ''
  const models = Array.isArray(config.grokWebAccountModels) ? config.grokWebAccountModels : []

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm">{t('Grok (Web)')}</span>
      </div>
      {!signedIn ? (
        <button
          type="button"
          className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary"
          onClick={() => void Browser.tabs.create({ url: 'https://grok.com/' })}
        >
          {t('Open grok.com to sign in')}
        </button>
      ) : (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('Signed in to grok.com')}</p>
          <p>
            {t('Grok plan')}: {tier}
          </p>
          {models.length > 0 ? <p>{models.join(', ')}</p> : null}
        </div>
      )}
    </div>
  )
}
