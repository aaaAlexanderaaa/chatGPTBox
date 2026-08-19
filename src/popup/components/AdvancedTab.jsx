import PropTypes from 'prop-types'
import { Download, Upload, RotateCcw, AlertTriangle, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { SettingRow, SettingSection, ToggleRow, NumberRow, Divider } from './SettingComponents.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { parseIntWithClamp } from '../../utils/index.mjs'
import {
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
} from '../../config/limits.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

/**
 * AdvancedTab - the API Server Bridge and config data. Generation parameters
 * live in Behavior, engines in Engines.
 */
export function AdvancedTab({ config, updateConfig, onExport, onImport, onReset }) {
  const { t } = useTranslation()

  const apiServerRequestTimeoutValue = parseIntWithClamp(
    config.apiServerRequestTimeoutSeconds,
    DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
    MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
    MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  )
  const apiServerThinkingTimeoutValue = parseIntWithClamp(
    config.apiServerThinkingTimeoutSeconds,
    DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
    MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
    MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  )
  return (
    <div className="space-y-4">
      <SettingSection
        title={t('API Server Bridge')}
        description={t('Expose ChatGPT Web as a local OpenAI-compatible endpoint')}
      >
        <ToggleRow
          label={t('Keep API Server chats in ChatGPT history')}
          hint={t(
            'When enabled, bridge requests create visible chats in your ChatGPT history instead of privacy-cleaned temporary conversations',
          )}
          checked={config.apiServerKeepHistory === true}
          onChange={(value) => updateConfig({ apiServerKeepHistory: value })}
        />

        <NumberRow
          label={t('API request timeout (s)')}
          hint={t('How long the local API Server waits before failing non-thinking requests')}
          value={apiServerRequestTimeoutValue}
          min={MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS}
          max={MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS}
          step={15}
          onChange={(raw) =>
            updateConfig({
              apiServerRequestTimeoutSeconds: parseIntWithClamp(
                raw,
                apiServerRequestTimeoutValue,
                MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
                MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
              ),
            })
          }
          className="[&_input]:w-28"
        />

        <NumberRow
          label={t('Thinking request timeout (s)')}
          hint={t(
            'How long the local API Server waits before failing high-effort thinking requests',
          )}
          value={apiServerThinkingTimeoutValue}
          min={MIN_API_SERVER_THINKING_TIMEOUT_SECONDS}
          max={MAX_API_SERVER_THINKING_TIMEOUT_SECONDS}
          step={15}
          onChange={(raw) =>
            updateConfig({
              apiServerThinkingTimeoutSeconds: parseIntWithClamp(
                raw,
                apiServerThinkingTimeoutValue,
                MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
                MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
              ),
            })
          }
          className="[&_input]:w-28"
        />

        <SettingRow
          label={t('Open API Server Bridge')}
          hint={`${t('Current port')}: ${Number(config.apiServerPort) || 18080}`}
        >
          <Button
            variant="secondary"
            onClick={() => {
              Browser.runtime.sendMessage({ type: RuntimeMessage.OpenApiServer }).catch(() => {})
            }}
          >
            <ExternalLink className="w-4 h-4" />
            {t('Open')}
          </Button>
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Data')}>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onExport} className="flex-1">
            <Download className="w-4 h-4" />
            {t('Export Config')}
          </Button>
          <Button variant="secondary" onClick={onImport} className="flex-1">
            <Upload className="w-4 h-4" />
            {t('Import Config')}
          </Button>
        </div>

        <Button variant="destructive" onClick={onReset} className="w-full mt-3">
          <RotateCcw className="w-4 h-4" />
          {t('Reset to Defaults')}
        </Button>
      </SettingSection>

      <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {t('Resetting will clear all your settings and conversation history.')}
          </p>
        </div>
      </div>
    </div>
  )
}

AdvancedTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  onExport: PropTypes.func,
  onImport: PropTypes.func,
  onReset: PropTypes.func,
}
