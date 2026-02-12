import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { useState } from 'react'
import { PencilIcon, TrashIcon } from '@primer/octicons-react'
import { createId } from '../../utils/create-id.mjs'

Assistants.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const defaultAssistant = {
  id: '',
  name: '',
  systemPrompt: '',
  defaultSkillIds: [],
  defaultMcpServerIds: [],
  active: true,
}

export function Assistants({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editingAssistant, setEditingAssistant] = useState(defaultAssistant)
  const [editingIndex, setEditingIndex] = useState(-1)
  const [errorMessage, setErrorMessage] = useState('')

  const assistants = Array.isArray(config.assistants) ? config.assistants : []
  const skillOptions = (Array.isArray(config.installedSkills) ? config.installedSkills : []).filter(
    (skill) => skill?.id && skill?.name,
  )
  const mcpOptions = (Array.isArray(config.mcpServers) ? config.mcpServers : []).filter(
    (server) => server?.id && server?.name,
  )

  const toggleId = (arr, id) => {
    const source = Array.isArray(arr) ? arr : []
    if (source.includes(id)) return source.filter((item) => item !== id)
    return [...source, id]
  }

  const startNew = () => {
    setEditing(true)
    setEditingIndex(-1)
    setEditingAssistant({
      ...defaultAssistant,
      id: createId('assistant'),
    })
    setErrorMessage('')
  }

  const startEdit = (assistant, index) => {
    setEditing(true)
    setEditingIndex(index)
    setEditingAssistant({
      ...defaultAssistant,
      ...assistant,
      id: assistant.id || createId('assistant'),
      defaultSkillIds: Array.isArray(assistant.defaultSkillIds) ? assistant.defaultSkillIds : [],
      defaultMcpServerIds: Array.isArray(assistant.defaultMcpServerIds)
        ? assistant.defaultMcpServerIds
        : [],
    })
    setErrorMessage('')
  }

  const save = async () => {
    if (!editingAssistant.name.trim()) {
      setErrorMessage(t('Name is required'))
      return
    }
    const next = [...assistants]
    if (editingIndex === -1) next.push(editingAssistant)
    else next[editingIndex] = editingAssistant
    await updateConfig({ assistants: next })
    setEditing(false)
    setEditingIndex(-1)
    setErrorMessage('')
  }

  return (
    <div className="selection-tools-container">
      <div className="tools-section">
        <h3 className="section-title">
          {t('Assistants')}
          {!editing && (
            <button className="button button-small button-primary add-tool-btn" onClick={startNew}>
              {t('New')}
            </button>
          )}
        </h3>

        {editing && (
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
                className="form-input"
                value={editingAssistant.name}
                onChange={(e) => setEditingAssistant({ ...editingAssistant, name: e.target.value })}
                placeholder={t('e.g., Research Assistant')}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('System Prompt')}</label>
              <textarea
                className="form-textarea"
                rows={5}
                value={editingAssistant.systemPrompt}
                onChange={(e) =>
                  setEditingAssistant({ ...editingAssistant, systemPrompt: e.target.value })
                }
                placeholder={t('You are a helpful assistant specialized in...')}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('Default Skills')}</label>
              <div className="tools-list">
                {skillOptions.length === 0 && (
                  <div className="hint-text">{t('No skills installed')}</div>
                )}
                {skillOptions.map((skill) => (
                  <label key={skill.id} className="tool-item">
                    <input
                      type="checkbox"
                      checked={(editingAssistant.defaultSkillIds || []).includes(skill.id)}
                      onChange={() =>
                        setEditingAssistant({
                          ...editingAssistant,
                          defaultSkillIds: toggleId(editingAssistant.defaultSkillIds, skill.id),
                        })
                      }
                    />
                    <span className="tool-name">{skill.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t('Default MCP Servers')}</label>
              <div className="tools-list">
                {mcpOptions.length === 0 && (
                  <div className="hint-text">{t('No MCP servers available')}</div>
                )}
                {mcpOptions.map((server) => (
                  <label key={server.id} className="tool-item">
                    <input
                      type="checkbox"
                      checked={(editingAssistant.defaultMcpServerIds || []).includes(server.id)}
                      onChange={() =>
                        setEditingAssistant({
                          ...editingAssistant,
                          defaultMcpServerIds: toggleId(
                            editingAssistant.defaultMcpServerIds,
                            server.id,
                          ),
                        })
                      }
                    />
                    <span className="tool-name">{server.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editingAssistant.active !== false}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, active: e.target.checked })
                  }
                />
                <span className="checkbox-text">{t('Active')}</span>
              </label>
            </div>

            <div className="button-group">
              <button
                className="button button-secondary"
                onClick={() => {
                  setEditing(false)
                  setEditingIndex(-1)
                  setErrorMessage('')
                }}
              >
                {t('Cancel')}
              </button>
              <button className="button button-primary" onClick={save}>
                {t('Save')}
              </button>
            </div>
          </div>
        )}

        <div className="custom-tools-list">
          {assistants.map((assistant, index) =>
            assistant?.name ? (
              <div key={assistant.id || index} className="custom-tool-card">
                <div className="tool-card-header">
                  <label className="tool-checkbox-label">
                    <input
                      type="checkbox"
                      checked={assistant.active !== false}
                      onChange={async (e) => {
                        const next = [...assistants]
                        next[index] = { ...assistant, active: e.target.checked }
                        await updateConfig({ assistants: next })
                      }}
                    />
                    <span className="tool-card-name">{assistant.name}</span>
                  </label>
                  <div className="tool-card-actions">
                    <button className="icon-button" onClick={() => startEdit(assistant, index)}>
                      <PencilIcon size={16} />
                    </button>
                    <button
                      className="icon-button icon-button-danger"
                      onClick={async () => {
                        const next = [...assistants]
                        next.splice(index, 1)
                        const value = config.defaultAssistantId === assistant.id ? '' : undefined
                        if (value === '')
                          await updateConfig({ assistants: next, defaultAssistantId: '' })
                        else await updateConfig({ assistants: next })
                      }}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
                <div className="tool-card-body">
                  <div className="tool-prompt">
                    {assistant.systemPrompt || t('No system prompt')}
                  </div>
                </div>
                <div className="tools-list" style={{ marginTop: '8px' }}>
                  <label className="tool-item">
                    <input
                      type="radio"
                      name="default-assistant"
                      checked={config.defaultAssistantId === assistant.id}
                      onChange={() => updateConfig({ defaultAssistantId: assistant.id })}
                    />
                    <span className="tool-name">{t('Default Assistant')}</span>
                  </label>
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}
