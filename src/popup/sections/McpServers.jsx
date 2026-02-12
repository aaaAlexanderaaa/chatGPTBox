import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { useState } from 'react'
import { PencilIcon, TrashIcon } from '@primer/octicons-react'
import { createId } from '../../utils/create-id.mjs'

McpServers.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const defaultServer = {
  id: '',
  name: '',
  transport: 'http',
  httpUrl: '',
  apiKey: '',
  active: true,
}

export function McpServers({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editingServer, setEditingServer] = useState(defaultServer)
  const [editingIndex, setEditingIndex] = useState(-1)
  const [errorMessage, setErrorMessage] = useState('')

  const servers = Array.isArray(config.mcpServers) ? config.mcpServers : []

  const startNew = () => {
    setEditing(true)
    setEditingIndex(-1)
    setEditingServer({
      ...defaultServer,
      id: createId('mcp'),
    })
    setErrorMessage('')
  }

  const startEdit = (server, index) => {
    setEditing(true)
    setEditingIndex(index)
    setEditingServer({
      ...defaultServer,
      ...server,
      id: server.id || createId('mcp'),
    })
    setErrorMessage('')
  }

  const save = async () => {
    if (!editingServer.name.trim()) {
      setErrorMessage(t('Name is required'))
      return
    }
    if (editingServer.transport !== 'builtin' && !editingServer.httpUrl.trim()) {
      setErrorMessage(t('HTTP URL is required'))
      return
    }
    const next = [...servers]
    if (editingIndex === -1) next.push(editingServer)
    else next[editingIndex] = editingServer
    await updateConfig({ mcpServers: next })
    setEditing(false)
    setEditingIndex(-1)
    setErrorMessage('')
  }

  return (
    <div className="selection-tools-container">
      <div className="tools-section">
        <h3 className="section-title">
          {t('MCP Servers')}
          {!editing && (
            <button className="button button-small button-primary add-tool-btn" onClick={startNew}>
              {t('New')}
            </button>
          )}
        </h3>
        <div className="hint-text" style={{ marginBottom: '10px' }}>
          {t('Built-in MCP tools and HTTP streaming MCP endpoints')}
        </div>

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
                value={editingServer.name}
                onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
              />
            </div>

            {editingServer.transport === 'builtin' ? (
              <div className="hint-text">{t('Built-in server: no URL or API key required')}</div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">
                    {t('Server URL')} <span className="required">*</span>
                  </label>
                  <input
                    className="form-input"
                    value={editingServer.httpUrl}
                    onChange={(e) =>
                      setEditingServer({ ...editingServer, httpUrl: e.target.value })
                    }
                    placeholder="https://example.com/mcp"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('API Key')}</label>
                  <input
                    className="form-input"
                    type="password"
                    value={editingServer.apiKey}
                    onChange={(e) => setEditingServer({ ...editingServer, apiKey: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editingServer.active !== false}
                  onChange={(e) => setEditingServer({ ...editingServer, active: e.target.checked })}
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
          {servers.map((server, index) =>
            server?.name ? (
              <div key={server.id || index} className="custom-tool-card">
                <div className="tool-card-header">
                  <label className="tool-checkbox-label">
                    <input
                      type="checkbox"
                      checked={server.active !== false}
                      onChange={async (e) => {
                        const next = [...servers]
                        next[index] = { ...server, active: e.target.checked }
                        await updateConfig({ mcpServers: next })
                      }}
                    />
                    <span className="tool-card-name">
                      {server.name} [{server.transport || 'http'}]
                    </span>
                  </label>
                  <div className="tool-card-actions">
                    <button className="icon-button" onClick={() => startEdit(server, index)}>
                      <PencilIcon size={16} />
                    </button>
                    <button
                      className="icon-button icon-button-danger"
                      onClick={async () => {
                        const next = [...servers]
                        next.splice(index, 1)
                        await updateConfig({
                          mcpServers: next,
                          defaultMcpServerIds: (config.defaultMcpServerIds || []).filter(
                            (id) => id !== server.id,
                          ),
                        })
                      }}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
                <div className="tool-card-body">
                  <div className="tool-prompt">
                    {server.transport === 'builtin'
                      ? t('Built-in MCP toolkit')
                      : server.httpUrl || t('Missing HTTP URL')}
                  </div>
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}
