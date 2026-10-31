import PropTypes from 'prop-types'
import { useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import { SettingSection, ToggleRow } from './SettingComponents.jsx'
import { NativePasteRules } from './NativePasteRules.jsx'

export function NativeChatgptSettings({ config, updateConfig, configReadState = 'ready' }) {
  const { t } = useTranslation()
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const chromium = Browser.runtime.getManifest().manifest_version === 3
  if (configReadState !== 'ready')
    return (
      <SettingSection title={t('ChatGPT website enhancements')}>
        <p
          role={configReadState === 'error' ? 'alert' : 'status'}
          className="text-sm text-foreground"
        >
          {t(
            configReadState === 'error'
              ? 'Saved website settings could not be read. Reload settings before changing ChatGPT enhancements.'
              : 'Loading saved website settings…',
          )}
        </p>
        {configReadState === 'error' && (
          <button
            type="button"
            onClick={() => location.reload()}
            className="px-3 py-2 text-sm border border-border rounded-lg text-foreground"
          >
            {t('Reload settings')}
          </button>
        )}
      </SettingSection>
    )
  return (
    <SettingSection
      title={t('ChatGPT website enhancements')}
      description={t('Works on chatgpt.com independently of the ChatGPT Web engine and gateway.')}
    >
      <ToggleRow
        label={t('Rewrite draft')}
        hint={t(
          'Show a draft-rewrite entry beside the native ChatGPT input. Uses your existing Functions and chosen engine.',
        )}
        checked={config.chatgptNativeRewriteEnabled === true}
        onChange={(enabled) => updateConfig({ chatgptNativeRewriteEnabled: enabled })}
      />
      {chromium && (
        <ToggleRow
          label={t('Local paste check')}
          hint={t(
            'Checks normal text paste in the main ChatGPT editor. Matches require confirmation in an extension window.',
          )}
          checked={config.chatgptNativePasteEnabled === true}
          onChange={async (enabled) => {
            if (saving) return
            setSaving(true)
            setNotice('')
            try {
              await Browser.runtime.sendMessage({
                type: RuntimeMessage.SetNativePasteEnabled,
                data: { enabled },
              })
              setNotice('Reload ChatGPT to apply local paste checking.')
            } catch {
              setNotice(
                'Local paste checking is unconfirmed. Do not rely on it; reload the extension and try again.',
              )
            } finally {
              setSaving(false)
            }
          }}
        />
      )}
      {typeof config.chatgptNativePasteActivationError === 'string' &&
        config.chatgptNativePasteActivationError && (
          <p role="alert" className="text-xs text-muted-foreground">
            {t(config.chatgptNativePasteActivationError)}
          </p>
        )}
      <p className="text-xs text-muted-foreground">
        {t('Reload ChatGPT after installing or updating the extension. Desktop Chromium only.')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'This checks the intercepted paste event, not all clipboard access. A website with clipboard-read permission can read the clipboard separately.',
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('Only the supported rules are checked; an unmatched text is not a privacy guarantee.')}
      </p>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(notice)}
        </p>
      )}
      {chromium && (
        <NativePasteRules value={config.chatgptNativePasteTerms} onSave={updateConfig} />
      )}
    </SettingSection>
  )
}
NativeChatgptSettings.propTypes = {
  configReadState: PropTypes.oneOf(['loading', 'ready', 'error']),
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
