import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { useState, useCallback } from 'react'
import { PencilIcon, TrashIcon, EyeIcon, SyncIcon, CopyIcon } from '@primer/octicons-react'
import Browser from 'webextension-polyfill'

ContentExtractor.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const defaultExtractor = {
  name: '',
  urlPattern: '',
  selectors: '',
  excludeSelectors: '',
  preProcess: '',
  active: true,
}

const extractionMethods = [
  { key: 'auto', label: 'Auto (Readability + Fallback)' },
  { key: 'readability', label: 'Readability Only' },
  { key: 'selectors', label: 'CSS Selectors Only' },
  { key: 'largest', label: 'Largest Element' },
  { key: 'custom', label: 'Custom Script' },
]

export function ContentExtractor({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingExtractor, setEditingExtractor] = useState(defaultExtractor)
  const [editingIndex, setEditingIndex] = useState(-1)

  // Preview state
  const [previewContent, setPreviewContent] = useState('')
  const [previewMetadata, setPreviewMetadata] = useState(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [activeTab, setActiveTab] = useState('preview')

  const customExtractors = config.customContentExtractors || []

  const fetchExtractedContent = useCallback(async () => {
    setIsLoadingPreview(true)
    setPreviewError('')
    setPreviewContent('')
    setPreviewMetadata(null)

    try {
      const tabs = await Browser.tabs.query({ active: true, currentWindow: true })
      if (!tabs || tabs.length === 0) {
        setPreviewError(t('No active tab found'))
        return
      }

      const response = await Browser.tabs.sendMessage(tabs[0].id, {
        type: 'GET_EXTRACTED_CONTENT',
        data: { customExtractors },
      })

      if (response?.error) {
        setPreviewError(response.error)
      } else if (response?.content) {
        setPreviewContent(response.content)
        setPreviewMetadata(response.metadata || null)
      } else {
        setPreviewError(t('No content extracted'))
      }
    } catch (e) {
      console.error('Failed to get extracted content:', e)
      setPreviewError(t('Failed to communicate with page. Make sure the page is loaded.'))
    } finally {
      setIsLoadingPreview(false)
    }
  }, [customExtractors, t])

  const copyToClipboard = useCallback(async () => {
    if (previewContent) {
      try {
        await navigator.clipboard.writeText(previewContent)
      } catch (e) {
        console.error('Failed to copy:', e)
      }
    }
  }, [previewContent])

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
          placeholder={t('e.g., My Blog, News Site')}
          value={editingExtractor.name}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, name: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          {t('URL Pattern')} <span className="required">*</span>
        </label>
        <div className="hint-text">
          {t('Regex pattern to match URLs. e.g., example\\.com, blog\\..*\\.org')}
        </div>
        <input
          type="text"
          className="form-input"
          placeholder="example\\.com/article/.*"
          value={editingExtractor.urlPattern}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, urlPattern: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t('Extraction Method')}</label>
        <select
          className="form-select"
          value={editingExtractor.method || 'auto'}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, method: e.target.value })}
        >
          {extractionMethods.map((method) => (
            <option key={method.key} value={method.key}>
              {t(method.label)}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">{t('Content Selectors')}</label>
        <div className="hint-text">
          {t('CSS selectors for content, comma-separated. First match wins.')}
        </div>
        <input
          type="text"
          className="form-input"
          placeholder="article, .post-content, #main-content"
          value={editingExtractor.selectors}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, selectors: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t('Exclude Selectors')}</label>
        <div className="hint-text">
          {t('Elements to exclude from extraction, comma-separated.')}
        </div>
        <input
          type="text"
          className="form-input"
          placeholder=".sidebar, .comments, .ads, nav, footer"
          value={editingExtractor.excludeSelectors}
          onChange={(e) =>
            setEditingExtractor({ ...editingExtractor, excludeSelectors: e.target.value })
          }
        />
      </div>

      <div className="form-group">
        <label className="form-label">{t('Custom Script (Advanced)')}</label>
        <div className="hint-text">
          {t('JavaScript function body. Return the extracted text. Available: document, window')}
        </div>
        <textarea
          className="form-textarea"
          placeholder={`// Example:
const article = document.querySelector('article');
return article ? article.innerText : '';`}
          value={editingExtractor.customScript || ''}
          onChange={(e) =>
            setEditingExtractor({ ...editingExtractor, customScript: e.target.value })
          }
          rows={6}
        />
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
            if (!editingExtractor.name) {
              setErrorMessage(t('Name is required'))
              return
            }
            if (!editingExtractor.urlPattern) {
              setErrorMessage(t('URL Pattern is required'))
              return
            }
            // Validate regex
            try {
              new RegExp(editingExtractor.urlPattern)
            } catch (err) {
              setErrorMessage(t('Invalid URL pattern regex'))
              return
            }

            const newExtractors = [...customExtractors]
            if (editingIndex === -1) {
              newExtractors.push(editingExtractor)
            } else {
              newExtractors[editingIndex] = editingExtractor
            }
            await updateConfig({ customContentExtractors: newExtractors })
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
    <div className="content-extractor-container">
      {/* Tab Navigation */}
      <div className="extractor-tabs">
        <button
          className={`extractor-tab ${activeTab === 'preview' ? 'extractor-tab--active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          <EyeIcon size={14} />
          <span>{t('Preview Extraction')}</span>
        </button>
        <button
          className={`extractor-tab ${activeTab === 'rules' ? 'extractor-tab--active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <PencilIcon size={14} />
          <span>{t('Custom Rules')}</span>
        </button>
      </div>

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div className="preview-section">
          <div className="preview-header">
            <h3 className="section-title">{t('AI Input Payload Preview')}</h3>
            <div className="preview-actions">
              <button
                className="button button-small button-primary"
                onClick={(e) => {
                  e.preventDefault()
                  fetchExtractedContent()
                }}
                disabled={isLoadingPreview}
              >
                <SyncIcon size={12} />
                <span>{isLoadingPreview ? t('Loading...') : t('Refresh')}</span>
              </button>
              {previewContent && (
                <button
                  className="button button-small button-secondary"
                  onClick={(e) => {
                    e.preventDefault()
                    copyToClipboard()
                  }}
                >
                  <CopyIcon size={12} />
                  <span>{t('Copy')}</span>
                </button>
              )}
            </div>
          </div>

          <div className="hint-text" style={{ marginBottom: '12px' }}>
            {t('See exactly what content is extracted from the current page and sent to the AI.')}
          </div>

          {previewError && (
            <div className="error-message" role="alert">
              {previewError}
            </div>
          )}

          {previewMetadata && (
            <div className="extraction-metadata">
              <div className="metadata-item">
                <span className="metadata-label">{t('Method')}:</span>
                <span className="metadata-value">{previewMetadata.method || 'auto'}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">{t('Characters')}:</span>
                <span className="metadata-value">{previewContent.length.toLocaleString()}</span>
              </div>
              {previewMetadata.selector && (
                <div className="metadata-item">
                  <span className="metadata-label">{t('Selector')}:</span>
                  <span className="metadata-value metadata-code">{previewMetadata.selector}</span>
                </div>
              )}
              {previewMetadata.matchedRule && (
                <div className="metadata-item">
                  <span className="metadata-label">{t('Matched Rule')}:</span>
                  <span className="metadata-value">{previewMetadata.matchedRule}</span>
                </div>
              )}
            </div>
          )}

          <div className="preview-content-wrapper">
            {previewContent ? (
              <pre className="preview-content">{previewContent}</pre>
            ) : (
              <div className="preview-empty">
                {isLoadingPreview
                  ? t('Extracting content...')
                  : t('Click Refresh to extract content from current page')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Rules Tab */}
      {activeTab === 'rules' && (
        <div className="rules-section">
          <div className="tools-section">
            <h3 className="section-title">
              {t('Custom Content Extractors')}
              {!editing && (
                <button
                  className="button button-small button-primary add-tool-btn"
                  onClick={(e) => {
                    e.preventDefault()
                    setEditing(true)
                    setEditingExtractor(defaultExtractor)
                    setEditingIndex(-1)
                    setErrorMessage('')
                  }}
                >
                  {t('New')}
                </button>
              )}
            </h3>

            <div className="hint-text" style={{ marginBottom: '12px' }}>
              {t(
                'Define custom rules for specific websites. Rules are matched by URL pattern and override default extraction.',
              )}
            </div>

            {editing && editingIndex === -1 && editingComponent}

            <div className="custom-tools-list">
              {customExtractors.map(
                (extractor, index) =>
                  extractor.name &&
                  (editing && editingIndex === index ? (
                    <div key={index}>{editingComponent}</div>
                  ) : (
                    <div key={index} className="custom-tool-card">
                      <div className="tool-card-header">
                        <label className="tool-checkbox-label">
                          <input
                            type="checkbox"
                            checked={extractor.active !== false}
                            onChange={async (e) => {
                              const newExtractors = [...customExtractors]
                              newExtractors[index] = { ...extractor, active: e.target.checked }
                              await updateConfig({ customContentExtractors: newExtractors })
                            }}
                          />
                          <span className="tool-card-name">{extractor.name}</span>
                        </label>
                        <div className="tool-card-actions">
                          <button
                            className="icon-button"
                            title={t('Edit')}
                            onClick={(e) => {
                              e.preventDefault()
                              setEditing(true)
                              setEditingExtractor(extractor)
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
                              const newExtractors = [...customExtractors]
                              newExtractors.splice(index, 1)
                              await updateConfig({ customContentExtractors: newExtractors })
                            }}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="tool-card-body">
                        <div className="tool-prompt">
                          <span className="extractor-label">{t('URL')}:</span>{' '}
                          {extractor.urlPattern}
                        </div>
                        {extractor.selectors && (
                          <div className="tool-prompt">
                            <span className="extractor-label">{t('Selectors')}:</span>{' '}
                            {extractor.selectors}
                          </div>
                        )}
                        {extractor.method && extractor.method !== 'auto' && (
                          <div className="tool-badge">{extractor.method}</div>
                        )}
                      </div>
                    </div>
                  )),
              )}

              {customExtractors.filter((e) => e.name).length === 0 && !editing && (
                <div className="empty-state">
                  {t('No custom extractors defined. Click "New" to create one.')}
                </div>
              )}
            </div>
          </div>

          {/* Built-in Adapters Reference */}
          <div className="tools-section">
            <h3 className="section-title">{t('Built-in Site Adapters')}</h3>
            <div className="hint-text" style={{ marginBottom: '8px' }}>
              {t(
                'These are pre-configured extractors for popular sites. They are enabled via the Sites tab.',
              )}
            </div>
            <div className="builtin-adapters-list">
              {(config.siteAdapters || []).map((adapter) => (
                <span
                  key={adapter}
                  className={`adapter-badge ${
                    config.activeSiteAdapters?.includes(adapter)
                      ? 'adapter-active'
                      : 'adapter-inactive'
                  }`}
                >
                  {adapter}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
