import { useTranslation } from 'react-i18next'
import { parseFloatWithClamp, parseIntWithClamp } from '../../utils/index.mjs'
import PropTypes from 'prop-types'
import { Tab, TabList, TabPanel, Tabs } from 'react-tabs'
import Browser from 'webextension-polyfill'
import {
  DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
  MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
  MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
  MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
  MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
  MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
} from '../../config/index.mjs'

ApiParams.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

function ApiParams({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <>
      <label>
        {t('Max Response Token Length') + `: ${config.maxResponseTokenLength}`}
        <input
          type="range"
          min="100"
          max={String(MAX_RESPONSE_TOKEN_LENGTH_LIMIT)}
          step="100"
          value={config.maxResponseTokenLength}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              DEFAULT_MAX_RESPONSE_TOKEN_LENGTH,
              100,
              MAX_RESPONSE_TOKEN_LENGTH_LIMIT,
            )
            updateConfig({ maxResponseTokenLength: value })
          }}
        />
      </label>
      <label>
        {t('Max Conversation Length') + `: ${config.maxConversationContextLength}`}
        <input
          type="range"
          min="0"
          max={String(MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT)}
          step="1"
          value={config.maxConversationContextLength}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              9,
              0,
              MAX_CONVERSATION_CONTEXT_LENGTH_LIMIT,
            )
            updateConfig({ maxConversationContextLength: value })
          }}
        />
      </label>
      <label>
        {t('Temperature') + `: ${config.temperature}`}
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={config.temperature}
          onChange={(e) => {
            const value = parseFloatWithClamp(e.target.value, 1, 0, 2)
            updateConfig({ temperature: value })
          }}
        />
      </label>
      <label>
        {t('ChatGPT Web poll interval (s)') +
          `: ${config.chatgptWebConversationPollIntervalSeconds}`}
        <input
          type="number"
          min={String(MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS)}
          max={String(MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS)}
          step="1"
          value={config.chatgptWebConversationPollIntervalSeconds}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
              MIN_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
              MAX_CHATGPT_WEB_CONVERSATION_POLL_INTERVAL_SECONDS,
            )
            updateConfig({ chatgptWebConversationPollIntervalSeconds: value })
          }}
        />
      </label>
      <label>
        {t('ChatGPT Web result timeout (s)') +
          `: ${config.chatgptWebConversationPollTimeoutSeconds}`}
        <input
          type="number"
          min={String(MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS)}
          max={String(MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS)}
          step="15"
          value={config.chatgptWebConversationPollTimeoutSeconds}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              DEFAULT_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
              MIN_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
              MAX_CHATGPT_WEB_CONVERSATION_POLL_TIMEOUT_SECONDS,
            )
            updateConfig({ chatgptWebConversationPollTimeoutSeconds: value })
          }}
        />
      </label>
      <label>
        {t('API request timeout (s)') + `: ${config.apiServerRequestTimeoutSeconds}`}
        <input
          type="number"
          min={String(MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS)}
          max={String(MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS)}
          step="15"
          value={config.apiServerRequestTimeoutSeconds}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              DEFAULT_API_SERVER_REQUEST_TIMEOUT_SECONDS,
              MIN_API_SERVER_REQUEST_TIMEOUT_SECONDS,
              MAX_API_SERVER_REQUEST_TIMEOUT_SECONDS,
            )
            updateConfig({ apiServerRequestTimeoutSeconds: value })
          }}
        />
      </label>
      <label>
        {t('Thinking request timeout (s)') + `: ${config.apiServerThinkingTimeoutSeconds}`}
        <input
          type="number"
          min={String(MIN_API_SERVER_THINKING_TIMEOUT_SECONDS)}
          max={String(MAX_API_SERVER_THINKING_TIMEOUT_SECONDS)}
          step="15"
          value={config.apiServerThinkingTimeoutSeconds}
          onChange={(e) => {
            const value = parseIntWithClamp(
              e.target.value,
              DEFAULT_API_SERVER_THINKING_TIMEOUT_SECONDS,
              MIN_API_SERVER_THINKING_TIMEOUT_SECONDS,
              MAX_API_SERVER_THINKING_TIMEOUT_SECONDS,
            )
            updateConfig({ apiServerThinkingTimeoutSeconds: value })
          }}
        />
      </label>
    </>
  )
}

ApiUrl.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

function ApiUrl({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <>
      <label>
        {t('Custom ChatGPT Web API Url')}
        <input
          type="text"
          value={config.customChatGptWebApiUrl}
          onChange={(e) => {
            const value = e.target.value
            updateConfig({ customChatGptWebApiUrl: value })
          }}
        />
      </label>
      <label>
        {t('Custom ChatGPT Web API Path')}
        <input
          type="text"
          value={config.customChatGptWebApiPath}
          onChange={(e) => {
            const value = e.target.value
            updateConfig({ customChatGptWebApiPath: value })
          }}
        />
      </label>
      <label>
        {t('Custom OpenAI API Url')}
        <input
          type="text"
          value={config.customOpenAiApiUrl}
          onChange={(e) => {
            const value = e.target.value
            updateConfig({ customOpenAiApiUrl: value })
          }}
        />
      </label>
      <label>
        {t('Custom Claude API Url')}
        <input
          type="text"
          value={config.customClaudeApiUrl}
          onChange={(e) => {
            const value = e.target.value
            updateConfig({ customClaudeApiUrl: value })
          }}
        />
      </label>
    </>
  )
}

Others.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

function Others({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={config.disableWebModeHistory !== true}
          onChange={(e) => {
            const checked = e.target.checked
            updateConfig({ disableWebModeHistory: !checked })
          }}
        />
        {t('Keep ChatGPTBox chats in ChatGPT history')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.apiServerKeepHistory === true}
          onChange={(e) => {
            const checked = e.target.checked
            updateConfig({ apiServerKeepHistory: checked })
          }}
        />
        {t(
          'Keep API Server chats in ChatGPT history so bridge requests remain visible in your official ChatGPT conversation list',
        )}
      </label>
      <button
        type="button"
        onClick={() => {
          Browser.runtime.sendMessage({
            type: 'OPEN_API_SERVER',
          })
        }}
      >
        {t('Open API Server Bridge')}
      </button>
      <label>
        <input
          type="checkbox"
          checked={config.hideContextMenu}
          onChange={async (e) => {
            const checked = e.target.checked
            await updateConfig({ hideContextMenu: checked })
            Browser.runtime.sendMessage({
              type: 'REFRESH_MENU',
            })
          }}
        />
        {t('Hide context menu of this extension')}
      </label>
      <br />
      <label>
        {t('Custom Site Regex')}
        <input
          type="text"
          value={config.siteRegex}
          onChange={(e) => {
            const regex = e.target.value
            updateConfig({ siteRegex: regex })
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.useSiteRegexOnly}
          onChange={(e) => {
            const checked = e.target.checked
            updateConfig({ useSiteRegexOnly: checked })
          }}
        />
        {t('Exclusively use Custom Site Regex for website matching, ignoring built-in rules')}
      </label>
      <br />
      <label>
        {t('Input Query')}
        <input
          type="text"
          value={config.inputQuery}
          onChange={(e) => {
            const query = e.target.value
            updateConfig({ inputQuery: query })
          }}
        />
      </label>
      <label>
        {t('Append Query')}
        <input
          type="text"
          value={config.appendQuery}
          onChange={(e) => {
            const query = e.target.value
            updateConfig({ appendQuery: query })
          }}
        />
      </label>
      <label>
        {t('Prepend Query')}
        <input
          type="text"
          value={config.prependQuery}
          onChange={(e) => {
            const query = e.target.value
            updateConfig({ prependQuery: query })
          }}
        />
      </label>
    </>
  )
}

AdvancedPart.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

export function AdvancedPart({ config, updateConfig }) {
  const { t } = useTranslation()

  return (
    <>
      <Tabs selectedTabClassName="popup-tab--selected">
        <TabList>
          <Tab className="popup-tab">{t('API Params')}</Tab>
          <Tab className="popup-tab">{t('API Url')}</Tab>
          <Tab className="popup-tab">{t('Others')}</Tab>
        </TabList>

        <TabPanel>
          <ApiParams config={config} updateConfig={updateConfig} />
        </TabPanel>
        <TabPanel>
          <ApiUrl config={config} updateConfig={updateConfig} />
        </TabPanel>
        <TabPanel>
          <Others config={config} updateConfig={updateConfig} />
        </TabPanel>
      </Tabs>
    </>
  )
}
