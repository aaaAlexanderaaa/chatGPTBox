import PropTypes from 'prop-types'
import { Download, Upload, RotateCcw, AlertTriangle, ExternalLink, Sliders } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import {
  SettingRow,
  SettingSection,
  ToggleRow,
  ToggleSwitch,
  Divider,
} from './SettingComponents.jsx'
import { QuickLinkCard } from './QuickLinkCard.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import {
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
} from '../../config/limits.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

const TEXT_INPUT_CLASS =
  'w-56 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-foreground'

/**
 * AdvancedTab - advanced parameters, the API server bridge, site matching,
 * and data. Provider/engine configuration moved to the Engines tab and the
 * ChatGPT Web groups into the chatgptweb module card (roadmap C1/C2).
 */
export function AdvancedTab({
  config,
  updateConfig,
  isPopupMode,
  openFullSettings,
  onExport,
  onImport,
  onReset,
}) {
  const { t } = useTranslation()

  const maxResponseTokenLengthValue = parseIntWithClamp(
    config.maxResponseTokenLength,
    DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
    100,
    MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  )
  const maxConversationContextLengthValue = parseIntWithClamp(
    config.maxConversationContextLength,
    9,
    0,
    MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  )
  const temperatureValue = parseFloatWithClamp(config.temperature, 1, 0, 2)
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
      {/* Model Parameters */}
      <SettingSection title={t('Model Parameters')}>
        <SettingRow
          label={t('Max Response Tokens')}
          hint={t('Maximum tokens in response (actual model/provider limits still apply)')}
        >
          <input
            type="number"
            min={100}
            max={MAX_RESPONSE_TOKEN_LENGTH_LIMIT}
            step={100}
            value={maxResponseTokenLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxResponseTokenLengthValue,
                100,
                MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
              )
              updateConfig({ maxResponseTokenLength: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow label={t('Context Length')} hint={t('Conversation history')}>
          <input
            type="number"
            min={0}
            max={MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT}
            step={1}
            value={maxConversationContextLengthValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                maxConversationContextLengthValue,
                0,
                MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
              )
              updateConfig({ maxConversationContextLength: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow label={t('Temperature')} hint={t('Response randomness (0-2)')}>
          <input
            type="number"
            value={temperatureValue}
            step={0.1}
            min={0}
            max={2}
            onChange={(e) => {
              const value = parseFloatWithClamp(e.target.value, temperatureValue, 0, 2)
              updateConfig({ temperature: value })
            }}
            className="w-24 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>
      </SettingSection>

      <Divider />

      <SettingSection title={t('API Server Bridge')}>
        <SettingRow
          label={t('Keep API Server chats in ChatGPT history')}
          hint={t(
            'When enabled, bridge requests create visible chats in your ChatGPT history instead of privacy-cleaned temporary conversations',
          )}
        >
          <button
            type="button"
            role="switch"
            aria-checked={config.apiServerKeepHistory === true}
            onClick={() =>
              updateConfig({ apiServerKeepHistory: config.apiServerKeepHistory !== true })
            }
            className={`relative w-10 h-6 rounded-full transition-colors ${
              config.apiServerKeepHistory === true ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                config.apiServerKeepHistory === true ? 'left-5' : 'left-1'
              }`}
            />
          </button>
        </SettingRow>

        <SettingRow
          label={t('API request timeout (s)')}
          hint={t('How long the local API Server waits before failing non-thinking requests')}
        >
          <input
            type="number"
            min={MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS}
            max={MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS}
            step={15}
            value={apiServerRequestTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                apiServerRequestTimeoutValue,
                MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
                MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
              )
              updateConfig({ apiServerRequestTimeoutSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow
          label={t('Thinking request timeout (s)')}
          hint={t(
            'How long the local API Server waits before failing high-effort thinking requests',
          )}
        >
          <input
            type="number"
            min={MIN_API_SERVER_THINKING_TIMEOUT_SECONDS}
            max={MAX_API_SERVER_THINKING_TIMEOUT_SECONDS}
            step={15}
            value={apiServerThinkingTimeoutValue}
            onChange={(e) => {
              const value = parseIntWithClamp(
                e.target.value,
                apiServerThinkingTimeoutValue,
                MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
                MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
              )
              updateConfig({ apiServerThinkingTimeoutSeconds: value })
            }}
            className="w-28 h-9 px-3 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right text-foreground"
          />
        </SettingRow>

        <SettingRow
          label={t('Open API Server Bridge')}
          hint={`${t('Current port')}: ${Number(config.apiServerPort) || 18080}`}
        >
          <button
            type="button"
            onClick={() => {
              Browser.runtime.sendMessage({ type: RuntimeMessage.OpenApiServer }).catch(() => {})
            }}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('Open')}
          </button>
        </SettingRow>
      </SettingSection>

      {!isPopupMode && (
        <>
          <Divider />

          <SettingSection title={t('Site Matching & Menus')}>
            <SettingRow
              label={t('Hide context menu of this extension')}
              hint={t('Removes the ChatGPTBox entries from the browser right-click menu')}
            >
              <ToggleSwitch
                checked={config.hideContextMenu === true}
                onChange={async (value) => {
                  await updateConfig({ hideContextMenu: value })
                  Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})
                }}
              />
            </SettingRow>

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

          <Divider />

          <SettingSection title={t('Search Engine Queries')}>
            <SettingRow
              label={t('Input Query')}
              hint={t('Selector used to read the search box of a matched site')}
            >
              <input
                type="text"
                value={config.inputQuery || ''}
                onChange={(e) => updateConfig({ inputQuery: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>

            <SettingRow label={t('Prepend Query')}>
              <input
                type="text"
                value={config.prependQuery || ''}
                onChange={(e) => updateConfig({ prependQuery: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>

            <SettingRow label={t('Append Query')}>
              <input
                type="text"
                value={config.appendQuery || ''}
                onChange={(e) => updateConfig({ appendQuery: e.target.value })}
                className={TEXT_INPUT_CLASS}
              />
            </SettingRow>
          </SettingSection>
        </>
      )}

      {isPopupMode ? (
        <>
          <Divider />

          <QuickLinkCard
            icon={Sliders}
            title={t('Diagnostics and backups moved to full settings')}
            description={t(
              'Provider toggles, ChatGPT Web request logs, config import/export, and reset actions are available in the full settings workspace.',
            )}
            stats={[
              `${Object.values(config.enabledProviders || {}).filter(Boolean).length} ${t(
                'providers enabled',
              )}`,
              config.debugChatgptWebRequests === true ? t('Web debug on') : t('Web debug off'),
            ]}
            actionLabel={t('Open full settings')}
            onAction={() => openFullSettings?.('advanced')}
          />
        </>
      ) : (
        <>
          <Divider />

          <SettingSection title={t('Data')}>
            <div className="flex gap-3">
              <button
                onClick={onExport}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
              >
                <Download className="w-4 h-4" />
                {t('Export Config')}
              </button>
              <button
                onClick={onImport}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-foreground bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {t('Import Config')}
              </button>
            </div>

            <button
              onClick={onReset}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-destructive bg-destructive/10 rounded-lg hover:bg-destructive/20 transition-colors mt-3"
            >
              <RotateCcw className="w-4 h-4" />
              {t('Reset to Defaults')}
            </button>
          </SettingSection>

          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('Resetting will clear all your settings and conversation history.')}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

AdvancedTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
  isPopupMode: PropTypes.bool,
  openFullSettings: PropTypes.func,
  onExport: PropTypes.func,
  onImport: PropTypes.func,
  onReset: PropTypes.func,
}
