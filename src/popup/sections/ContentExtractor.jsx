import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { useState, useCallback } from 'react'
import { Eye, Pencil, Trash2, RefreshCw, Copy, Plus } from 'lucide-react'
import Browser from 'webextension-polyfill'
import { defaultExtractor } from '../../config/extractors.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import { SettingSection } from '../components/SettingComponents.jsx'
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Input } from '../../components/ui/Input.jsx'
import { SelectField } from '../components/SelectField.jsx'
import { Toggle } from '../../components/ui/Toggle.jsx'

ContentExtractor.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}

const extractionMethods = [
  {
    key: 'auto',
    label: 'Smart Auto',
    desc: 'Automatically detect main content using multiple strategies',
  },
  {
    key: 'selectors',
    label: 'CSS Selectors',
    desc: 'Extract content from specific elements you define',
  },
  {
    key: 'readability',
    label: 'Article Mode',
    desc: 'Best for blog posts and news articles',
  },
  {
    key: 'largest',
    label: 'Largest Block',
    desc: 'Find the biggest content area on the page',
  },
]

const fieldLabelClass = 'block text-xs font-medium text-foreground mb-1.5'
const hintClass = 'text-xs text-muted-foreground mb-1.5'
const codeClass =
  'px-1.5 py-0.5 rounded-md bg-secondary/70 border border-border/60 text-foreground font-mono text-[11px]'

export function ContentExtractor({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingExtractor, setEditingExtractor] = useState(() => ({ ...defaultExtractor }))
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
        type: RuntimeMessage.GetExtractedContent,
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {errorMessage && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <div>
        <label className={fieldLabelClass}>
          {t('Name')} <span className="text-destructive">*</span>
        </label>
        <Input
          type="text"
          placeholder={t('e.g., My Blog, News Site')}
          value={editingExtractor.name}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, name: e.target.value })}
        />
      </div>

      <div>
        <label className={fieldLabelClass}>
          {t('URL Pattern')} <span className="text-destructive">*</span>
        </label>
        <p className={hintClass}>
          {t(
            'Match websites by URL. Use simple text like "example.com" or regex like "blog\\..*\\.org"',
          )}
        </p>
        <Input
          type="text"
          placeholder="example.com"
          value={editingExtractor.urlPattern}
          onChange={(e) => setEditingExtractor({ ...editingExtractor, urlPattern: e.target.value })}
        />
      </div>

      <div>
        <label className={fieldLabelClass}>{t('Extraction Method')}</label>
        <SelectField
          value={editingExtractor.method || 'auto'}
          onChange={(value) => setEditingExtractor({ ...editingExtractor, method: value })}
          options={extractionMethods.map((method) => ({ value: method.key, label: method.label }))}
          className="w-full"
        />
        <p className={hintClass} style={{ marginTop: '6px' }}>
          {extractionMethods.find((m) => m.key === (editingExtractor.method || 'auto'))?.desc}
        </p>
      </div>

      {/* Show Content Selectors for 'selectors' method (required) or 'auto' method (optional) */}
      {(editingExtractor.method === 'selectors' ||
        editingExtractor.method === 'auto' ||
        !editingExtractor.method) && (
        <div>
          <label className={fieldLabelClass}>
            {t('Content Selectors')}
            {editingExtractor.method === 'selectors' && <span className="text-destructive">*</span>}
          </label>
          <p className={hintClass}>
            {editingExtractor.method === 'selectors'
              ? t(
                  'Target specific content areas (e.g., "main article", ".post-content"). Avoid broad selectors like "p".',
                )
              : t('Optional: target specific areas. Leave empty for best auto-detection.')}
          </p>
          <Input
            type="text"
            placeholder="article, .post-content, #main-content"
            value={editingExtractor.selectors}
            onChange={(e) =>
              setEditingExtractor({ ...editingExtractor, selectors: e.target.value })
            }
          />
        </div>
      )}

      <div>
        <label className={fieldLabelClass}>{t('Exclude Elements')}</label>
        <p className={hintClass}>
          {t('Remove these elements before extraction (ads, sidebars, navigation, etc.)')}
        </p>
        <Input
          type="text"
          placeholder=".sidebar, .comments, .ads, nav, footer"
          value={editingExtractor.excludeSelectors}
          onChange={(e) =>
            setEditingExtractor({ ...editingExtractor, excludeSelectors: e.target.value })
          }
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.preventDefault()
            setEditing(false)
            setErrorMessage('')
          }}
        >
          {t('Cancel')}
        </Button>
        <Button
          size="sm"
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
            try {
              new RegExp(editingExtractor.urlPattern)
            } catch (err) {
              setErrorMessage(t('Invalid URL pattern'))
              return
            }
            if (editingExtractor.method === 'selectors' && !editingExtractor.selectors) {
              setErrorMessage(t('Content Selectors are required for CSS Selectors method'))
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
        </Button>
      </div>
    </div>
  )

  return (
    <SettingSection
      title={t('Content Extraction')}
      description={t('What page content gets sent to the AI for page-aware tools')}
    >
      <SegmentedControl
        options={[
          { value: 'preview', label: t('Preview Extraction'), icon: Eye },
          { value: 'rules', label: t('Custom Rules'), icon: Pencil },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        size="sm"
        className="w-full"
        ariaLabel={t('Content extraction views')}
      />

      {activeTab === 'preview' && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t('See exactly what content is extracted from the current page and sent to the AI.')}
            </p>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                onClick={(e) => {
                  e.preventDefault()
                  fetchExtractedContent()
                }}
                disabled={isLoadingPreview}
              >
                <RefreshCw
                  className={isLoadingPreview ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'}
                />
                <span>{isLoadingPreview ? t('Loading...') : t('Refresh')}</span>
              </Button>
              {previewContent && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    copyToClipboard()
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{t('Copy')}</span>
                </Button>
              )}
            </div>
          </div>

          {previewError && (
            <div
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
              role="alert"
            >
              {previewError}
            </div>
          )}

          {previewMetadata && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span>
                <span className="font-medium text-foreground">{t('Method')}:</span>{' '}
                <span className="text-muted-foreground">{previewMetadata.method || 'auto'}</span>
              </span>
              <span>
                <span className="font-medium text-foreground">{t('Characters')}:</span>{' '}
                <span className="text-muted-foreground">
                  {previewContent.length.toLocaleString()}
                </span>
              </span>
              {previewMetadata.selector && (
                <span>
                  <span className="font-medium text-foreground">{t('Selector')}:</span>{' '}
                  <code className={codeClass}>{previewMetadata.selector}</code>
                  {previewMetadata.matchCount && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({previewMetadata.matchCount} {t('elements')})
                    </span>
                  )}
                </span>
              )}
              {previewMetadata.matchedRule && (
                <span>
                  <span className="font-medium text-foreground">{t('Matched Rule')}:</span>{' '}
                  <span className="text-muted-foreground">{previewMetadata.matchedRule}</span>
                </span>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border overflow-hidden">
            {previewContent ? (
              <pre className="m-0 p-3 max-h-80 overflow-auto bg-card/80 text-foreground text-xs leading-relaxed whitespace-pre-wrap">
                {previewContent}
              </pre>
            ) : (
              <div className="p-4 text-xs text-muted-foreground">
                {isLoadingPreview
                  ? t('Extracting content...')
                  : t('Click Refresh to extract content from current page')}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-4 pt-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t(
                'Define custom rules for specific websites. Rules are matched by URL pattern and override default extraction.',
              )}
            </p>
            {!editing && (
              <Button
                size="sm"
                className="shrink-0"
                onClick={(e) => {
                  e.preventDefault()
                  setEditing(true)
                  setEditingExtractor({ ...defaultExtractor })
                  setEditingIndex(-1)
                  setErrorMessage('')
                }}
              >
                <Plus className="w-4 h-4" />
                {t('New')}
              </Button>
            )}
          </div>

          {editing && editingIndex === -1 && editingComponent}

          <div className="space-y-3">
            {customExtractors.map(
              (extractor, index) =>
                extractor.name &&
                (editing && editingIndex === index ? (
                  <div key={index}>{editingComponent}</div>
                ) : (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-card p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground truncate">
                        {extractor.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title={t('Edit')}
                          onClick={(e) => {
                            e.preventDefault()
                            setEditing(true)
                            setEditingExtractor(extractor)
                            setEditingIndex(index)
                            setErrorMessage('')
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title={t('Delete')}
                          onClick={async (e) => {
                            e.preventDefault()
                            const newExtractors = [...customExtractors]
                            newExtractors.splice(index, 1)
                            await updateConfig({ customContentExtractors: newExtractors })
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Toggle
                          checked={extractor.active !== false}
                          onChange={async (checked) => {
                            const newExtractors = [...customExtractors]
                            newExtractors[index] = { ...extractor, active: checked }
                            await updateConfig({ customContentExtractors: newExtractors })
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1 break-words">
                      <p>
                        <span className="font-medium text-foreground">{t('URL')}:</span>{' '}
                        <code className={codeClass}>{extractor.urlPattern}</code>
                      </p>
                      <p>
                        <span className="font-medium text-foreground">{t('Method')}:</span>{' '}
                        {extractionMethods.find((m) => m.key === (extractor.method || 'auto'))
                          ?.label || 'Smart Auto'}
                      </p>
                      {extractor.selectors && (
                        <p>
                          <span className="font-medium text-foreground">{t('Selectors')}:</span>{' '}
                          <code className={codeClass}>{extractor.selectors}</code>
                        </p>
                      )}
                      {extractor.excludeSelectors && (
                        <p>
                          <span className="font-medium text-foreground">{t('Exclude')}:</span>{' '}
                          <code className={codeClass}>{extractor.excludeSelectors}</code>
                        </p>
                      )}
                    </div>
                  </div>
                )),
            )}

            {customExtractors.filter((e) => e.name).length === 0 && !editing && (
              <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                {t('No custom extractors defined. Click "New" to create one.')}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card/60 p-3">
            <p className="text-xs font-medium text-foreground mb-1">
              {t('Built-in Site Adapters')}
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              {t(
                'These are pre-configured extractors for popular sites. They are enabled via the Sites tab.',
              )}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(config.siteAdapters || []).map((adapter) => {
                const isActive = config.activeSiteAdapters?.includes(adapter)
                return (
                  <span
                    key={adapter}
                    className={
                      isActive
                        ? 'px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-[11px] text-foreground'
                        : 'px-2 py-0.5 rounded-full border border-border text-[11px] text-muted-foreground'
                    }
                  >
                    {adapter}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </SettingSection>
  )
}
