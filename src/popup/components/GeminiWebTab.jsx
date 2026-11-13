import PropTypes from 'prop-types'
import Browser from 'webextension-polyfill'
import { useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import { GEMINI_WEB_SELECTION } from '../../config/gemini-web.mjs'
import { SettingSection } from './SettingComponents.jsx'

export function GeminiWebTab({ config, updateConfig }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)
  const [pending, setPending] = useState(false)
  const [acknowledgeUnverified, setAcknowledgeUnverified] = useState(false)
  const action = async (type) => {
    setPending(true)
    try {
      const result = await Browser.runtime.sendMessage({
        type,
        ...(type === RuntimeMessage.GeminiWebReview && { data: { acknowledgeUnverified } }),
      })
      setStatus(result || { ok: false, message: t('Gemini could not be checked.') })
      if (!result?.needsUnverifiedAcknowledgement) setAcknowledgeUnverified(false)
    } catch (error) {
      setStatus({ ok: false, message: error.message })
    } finally {
      setPending(false)
    }
  }
  const buttonClass =
    'text-xs px-3 py-2 rounded-lg border border-border hover:bg-secondary disabled:opacity-50'
  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Account and model')}
        description={t('Uses your signed-in Gemini website and its native submission checks.')}
      >
        <p className="text-sm">4 Argon · {t('Thinking level')}: High</p>
        <p className="text-xs text-muted-foreground">
          {t(
            'Open Gemini, select 4 Argon and High, then check the page. The adapter refuses other models and unknown website versions.',
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() => action(RuntimeMessage.GeminiWebOpen)}
          >
            {t('Open Gemini')}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() => action(RuntimeMessage.GeminiWebInspect)}
          >
            {t('Check Gemini page')}
          </button>
          {config.geminiWebReady === true && (
            <button
              type="button"
              className={buttonClass}
              disabled={pending}
              onClick={() => updateConfig({ modelName: GEMINI_WEB_SELECTION, apiMode: null })}
            >
              {t('Use as default engine')}
            </button>
          )}
        </div>
        {status && (
          <div role="status" className="text-xs space-y-1">
            <p>
              {status.message ||
                (status.ready
                  ? t('Gemini is ready: 4 Argon / High.')
                  : t('Gemini is open. Select 4 Argon / High, then check the page.'))}
            </p>
            {status.model && !status.ready && (
              <p>
                {t('Current model')}: {status.model}
              </p>
            )}
            {status.hold && (
              <p>
                {t(
                  'Gemini requests are paused. Inspect the existing result on the website before allowing new requests.',
                )}
              </p>
            )}
          </div>
        )}
      </SettingSection>
      <SettingSection title={t('Interrupted requests')}>
        <p className="text-xs text-muted-foreground">
          {t(
            'A timeout, disconnect, Stop or website error keeps submission paused across restarts. Allowing new requests never resends the old prompt.',
          )}
        </p>
        {status?.needsUnverifiedAcknowledgement && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={acknowledgeUnverified}
              disabled={pending}
              onChange={(event) => setAcknowledgeUnverified(event.currentTarget.checked)}
            />
            <span>
              {t(
                'I inspected the old Gemini result. Its outcome remains unconfirmed; allow new requests without replaying it.',
              )}
            </span>
          </label>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={pending}
          onClick={() => action(RuntimeMessage.GeminiWebReview)}
        >
          {t('Allow new requests after checking Gemini')}
        </button>
      </SettingSection>
      <p className="text-xs text-muted-foreground">
        {t(
          'Text chat only. Keep its dedicated tab open for follow-ups. Regeneration, attachments and history import are not supported. Native website recovery stays enabled; account safety cannot be guaranteed by a compatibility test.',
        )}
      </p>
    </div>
  )
}

GeminiWebTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
