import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { SettingSection, ToggleRow, NumberRow, Divider } from './SettingComponents.jsx'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import {
  DEFAULT_MAX_CONVERSATION_CONTEXT_LENGTH,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
} from '../../config/limits.mjs'
import { isUsingL1Engine } from '../../config/engine-selection.mjs'

/**
 * BehaviorTab - how conversations behave: generation parameters on one side,
 * window/interaction behavior on the other. Relocated from the old
 * General "Options" grab-bag and Advanced "Model Parameters".
 */
export function BehaviorTab({ config, updateConfig }) {
  const { t } = useTranslation()

  const maxResponseTokenLengthValue = parseIntWithClamp(
    config.maxResponseTokenLength,
    DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
    100,
    MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  )
  const maxConversationContextLengthValue = parseIntWithClamp(
    config.maxConversationContextLength,
    DEFAULT_MAX_CONVERSATION_CONTEXT_LENGTH,
    0,
    MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  )
  const temperatureValue = parseFloatWithClamp(config.temperature, 1, 0, 2)
  const l1Active = isUsingL1Engine(config, config)

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Generation')}
        description={t('These three knobs apply to L1 API providers only')}
      >
        {!l1Active && (
          <p className="text-xs text-muted-foreground bg-secondary/50 border border-border rounded-lg px-3 py-2">
            {t(
              'The current engine is a web engine. ChatGPT Web, Grok Web, and DeepSeek Harness ignore Max Response Tokens, Context Length, and Temperature.',
            )}
          </p>
        )}
        <NumberRow
          label={t('Max Response Tokens')}
          hint={t('Maximum tokens in response (actual model/provider limits still apply)')}
          value={maxResponseTokenLengthValue}
          min={100}
          max={MAX_RESPONSE_TOKEN_LENGTH_LIMIT}
          step={100}
          onChange={(raw) =>
            updateConfig({
              maxResponseTokenLength: parseIntWithClamp(
                raw,
                maxResponseTokenLengthValue,
                100,
                MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
              ),
            })
          }
        />
        <NumberRow
          label={t('Context Length')}
          hint={t('Conversation history')}
          value={maxConversationContextLengthValue}
          min={0}
          max={MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT}
          step={1}
          onChange={(raw) =>
            updateConfig({
              maxConversationContextLength: parseIntWithClamp(
                raw,
                maxConversationContextLengthValue,
                0,
                MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
              ),
            })
          }
        />
        <NumberRow
          label={t('Temperature')}
          hint={t('Response randomness (0-2)')}
          value={temperatureValue}
          min={0}
          max={2}
          step={0.1}
          onChange={(raw) =>
            updateConfig({ temperature: parseFloatWithClamp(raw, temperatureValue, 0, 2) })
          }
        />
        <ToggleRow
          label={t("Crop Text to ensure the input tokens do not exceed the model's limit")}
          checked={config.cropText}
          onChange={(value) => updateConfig({ cropText: value })}
        />
        <ToggleRow
          label={t('Regenerate the answer after switching model')}
          checked={config.autoRegenAfterSwitchModel}
          onChange={(value) => updateConfig({ autoRegenAfterSwitchModel: value })}
        />
      </SettingSection>

      <Divider />

      <SettingSection
        title={t('Windows & Interaction')}
        description={t('How chat windows open and behave while you browse')}
      >
        <ToggleRow
          label={t('Insert ChatGPT at the top of search results')}
          checked={config.insertAtTop}
          onChange={(value) => updateConfig({ insertAtTop: value })}
        />
        <ToggleRow
          label={t('Always display floating window, disable sidebar for all site adapters')}
          checked={config.alwaysFloatingSidebar}
          onChange={(value) => updateConfig({ alwaysFloatingSidebar: value })}
        />
        <ToggleRow
          label={t('Always pin floating window')}
          checked={config.alwaysPinWindow}
          onChange={(value) => updateConfig({ alwaysPinWindow: value })}
        />
        <ToggleRow
          label={t('Always Create New Conversation Window')}
          checked={config.alwaysCreateNewConversationWindow}
          onChange={(value) => updateConfig({ alwaysCreateNewConversationWindow: value })}
        />
        <ToggleRow
          label={t('Lock scrollbar while answering')}
          checked={config.lockWhenAnswer}
          onChange={(value) => updateConfig({ lockWhenAnswer: value })}
        />
        <ToggleRow
          label={t('Focus input after answer')}
          checked={config.focusAfterAnswer}
          onChange={(value) => updateConfig({ focusAfterAnswer: value })}
        />
        <ToggleRow
          label={t('Allow ESC to close windows')}
          checked={config.allowEscToCloseAll}
          onChange={(value) => updateConfig({ allowEscToCloseAll: value })}
        />
        <ToggleRow
          label={t('Selection tools next to input box')}
          checked={config.selectionToolsNextToInputBox}
          onChange={(value) => updateConfig({ selectionToolsNextToInputBox: value })}
        />
      </SettingSection>
    </div>
  )
}

BehaviorTab.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
