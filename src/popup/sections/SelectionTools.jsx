import { useTranslation } from 'react-i18next'
import { config as toolsConfig } from '../../content-script/selection-tools/index.mjs'
import PropTypes from 'prop-types'
import { useState } from 'react'
import { defaultConfig } from '../../config/index.mjs'
import { PencilIcon, TrashIcon } from '@primer/octicons-react'
import Browser from 'webextension-polyfill'

SelectionTools.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const defaultTool = {
  name: '',
  iconKey: 'explain',
  prompt: 'Explain this: {{selection}}',
  active: true,
  usePageContext: false,
}

// Helper function to refresh context menu
const refreshContextMenu = () => {
  Browser.runtime.sendMessage({
    type: 'REFRESH_MENU',
  })
}

export function SelectionTools({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingTool, setEditingTool] = useState(defaultTool)
  const [editingIndex, setEditingIndex] = useState(-1)

  const editingComponent = (
    <div className="custom-tool-editor">
      {errorMessage && (
        <div className="error-message" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          {t('Name')} <span className="required">*</span>
        </label>
        <input
          type="text"
          className="form-input"
          placeholder={t('e.g., Summarize Page, Explain Code')}
          value={editingTool.name}
          onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t('Icon')}</label>
        <select
          className="form-select"
          value={editingTool.iconKey}
          onChange={(e) => setEditingTool({ ...editingTool, iconKey: e.target.value })}
        >
          {defaultConfig.selectionTools.map((key) => (
            <option key={key} value={key}>
              {t(toolsConfig[key].label)}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">
          {t('Prompt Template')} <span className="required">*</span>
        </label>
        <div className="hint-text">{t('Use {{selection}} as placeholder for selected text')}</div>
        <textarea
          className="form-textarea"
          placeholder={t('Explain this: {{selection}}')}
          value={editingTool.prompt}
          onChange={(e) => setEditingTool({ ...editingTool, prompt: e.target.value })}
          rows={4}
        />
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={editingTool.usePageContext || false}
            onChange={(e) => setEditingTool({ ...editingTool, usePageContext: e.target.checked })}
          />
          <span className="checkbox-text">
            {t('Also work on entire page (without text selection)')}
          </span>
        </label>
        <div className="hint-text">
          {t('When enabled, tool will appear in context menu even without selecting text')}
        </div>
      </div>

      <div className="button-group">
        <button
          className="button button-secondary"
          onClick={(e) => {
            e.preventDefault()
            setEditing(false)
            setErrorMessage('')
          }}
        >
          {t('Cancel')}
        </button>
        <button
          className="button button-primary"
          type="submit"
          onClick={async (e) => {
            e.preventDefault()
            if (!editingTool.name) {
              setErrorMessage(t('Name is required'))
              return
            }
            if (!editingTool.prompt.includes('{{selection}}')) {
              setErrorMessage(t('Prompt template should include {{selection}}'))
              return
            }
            if (editingIndex === -1) {
              await updateConfig({
                customSelectionTools: [...config.customSelectionTools, editingTool],
              })
            } else {
              const customSelectionTools = [...config.customSelectionTools]
              customSelectionTools[editingIndex] = editingTool
              await updateConfig({ customSelectionTools })
            }
            refreshContextMenu()
            setEditing(false)
            setErrorMessage('')
          }}
        >
          {t('Save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="selection-tools-container">
      <div className="tools-section">
        <h3 className="section-title">{t('Built-in Tools')}</h3>
        <div className="tools-list">
          {config.selectionTools.map((key) => (
            <label key={key} className="tool-item">
              <input
                type="checkbox"
                checked={config.activeSelectionTools.includes(key)}
                onChange={async (e) => {
                  const checked = e.target.checked
                  const activeSelectionTools = config.activeSelectionTools.filter((i) => i !== key)
                  if (checked) activeSelectionTools.push(key)
                  await updateConfig({ activeSelectionTools })
                  refreshContextMenu()
                }}
              />
              <span className="tool-name">{t(toolsConfig[key].label)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="tools-section">
        <h3 className="section-title">
          {t('Custom Tools')}
          {!editing && (
            <button
              className="button button-small button-primary add-tool-btn"
              onClick={(e) => {
                e.preventDefault()
                setEditing(true)
                setEditingTool(defaultTool)
                setEditingIndex(-1)
                setErrorMessage('')
              }}
            >
              {t('New')}
            </button>
          )}
        </h3>

        {editing && editingIndex === -1 && editingComponent}

        <div className="custom-tools-list">
          {config.customSelectionTools.map(
            (tool, index) =>
              tool.name &&
              (editing && editingIndex === index ? (
                <div key={index}>{editingComponent}</div>
              ) : (
                <div key={index} className="custom-tool-card">
                  <div className="tool-card-header">
                    <label className="tool-checkbox-label">
                      <input
                        type="checkbox"
                        checked={tool.active}
                        onChange={async (e) => {
                          const customSelectionTools = [...config.customSelectionTools]
                          customSelectionTools[index] = { ...tool, active: e.target.checked }
                          await updateConfig({ customSelectionTools })
                          refreshContextMenu()
                        }}
                      />
                      <span className="tool-card-name">
                        {tool.name}
                        {tool.usePageContext && ' 🌐'}
                      </span>
                    </label>
                    <div className="tool-card-actions">
                      <button
                        className="icon-button"
                        title={t('Edit')}
                        onClick={(e) => {
                          e.preventDefault()
                          setEditing(true)
                          // Ensure backward compatibility - add usePageContext if missing
                          setEditingTool({ usePageContext: false, ...tool })
                          setEditingIndex(index)
                          setErrorMessage('')
                        }}
                      >
                        <PencilIcon size={16} />
                      </button>
                      <button
                        className="icon-button icon-button-danger"
                        title={t('Delete')}
                        onClick={async (e) => {
                          e.preventDefault()
                          const customSelectionTools = [...config.customSelectionTools]
                          customSelectionTools.splice(index, 1)
                          await updateConfig({ customSelectionTools })
                          refreshContextMenu()
                        }}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="tool-card-body">
                    <div className="tool-prompt">{tool.prompt}</div>
                  </div>
                </div>
              )),
          )}
        </div>
      </div>
    </div>
  )
}
