import { useTranslation } from 'react-i18next'
import { config as toolsConfig } from '../../content-script/selection-tools/index.mjs'
import PropTypes from 'prop-types'
import { useState } from 'react'
import Browser from 'webextension-polyfill'
import { promptTemplateVariables } from '../../utils/prompt-template-context.mjs'
import {
  Languages,
  FileText,
  Lightbulb,
  Sparkles,
  Code,
  HelpCircle,
  Globe,
  Smile,
  SplitSquareVertical,
  Quote,
  Star,
  Wand2,
  PenLine,
  BookOpen,
  Clipboard,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react'
import { IconSelect } from '../components/IconSelect.jsx'
import { SettingSection, ToggleRow, Divider } from '../components/SettingComponents.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Input, Textarea } from '../../components/ui/Input.jsx'
import { Toggle } from '../../components/ui/Toggle.jsx'
import { RuntimeMessage } from '../../protocol/messages.mjs'

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
    type: RuntimeMessage.RefreshMenu,
  })
}

export function SelectionTools({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingTool, setEditingTool] = useState(defaultTool)
  const [editingIndex, setEditingIndex] = useState(-1)

  const iconOptions = [
    { value: 'explain', label: t(toolsConfig.explain.label), Icon: Lightbulb },
    { value: 'translate', label: t(toolsConfig.translate.label), Icon: Languages },
    { value: 'translateToEn', label: t(toolsConfig.translateToEn.label), Icon: Globe },
    { value: 'summary', label: t(toolsConfig.summary.label), Icon: FileText },
    { value: 'polish', label: t(toolsConfig.polish.label), Icon: Sparkles },
    { value: 'sentiment', label: t(toolsConfig.sentiment.label), Icon: Smile },
    { value: 'divide', label: t(toolsConfig.divide.label), Icon: SplitSquareVertical },
    { value: 'code', label: t(toolsConfig.code.label), Icon: Code },
    { value: 'ask', label: t(toolsConfig.ask.label), Icon: HelpCircle },

    // Extra icon-only options for custom tools
    { value: 'star', label: t('Star'), Icon: Star },
    { value: 'wand', label: t('Magic'), Icon: Wand2 },
    { value: 'quote', label: t('Quote'), Icon: Quote },
    { value: 'pen', label: t('Pen'), Icon: PenLine },
    { value: 'book', label: t('Book'), Icon: BookOpen },
    { value: 'clipboard', label: t('Clipboard'), Icon: Clipboard },
  ]
  const iconMap = new Map(iconOptions.map((o) => [o.value, o.Icon]))

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
        <label className="block text-xs font-medium text-foreground mb-1.5">
          {t('Name')} <span className="text-destructive">*</span>
        </label>
        <Input
          type="text"
          placeholder={t('e.g., Summarize Page, Explain Code')}
          value={editingTool.name}
          onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1.5">{t('Icon')}</label>
        <IconSelect
          value={editingTool.iconKey || 'ask'}
          onChange={(value) => setEditingTool({ ...editingTool, iconKey: value })}
          options={iconOptions}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground mb-1.5">
          {t('Prompt Template')} <span className="text-destructive">*</span>
        </label>
        <p className="text-xs text-muted-foreground mb-1">
          {t(
            'Use {{selection}} for highlighted text. If nothing is selected, it can use page text when "Work without selection" is enabled.',
          )}
        </p>
        <p className="text-xs text-muted-foreground mb-2">
          {`Available variables: ${promptTemplateVariables.map((key) => `{{${key}}}`).join(', ')}`}
        </p>
        <Textarea
          placeholder={t('Explain this: {{selection}}')}
          value={editingTool.prompt}
          onChange={(e) => setEditingTool({ ...editingTool, prompt: e.target.value })}
          rows={4}
          className="font-mono text-xs"
        />
      </div>

      <div>
        <ToggleRow
          label={t('Work without selection (use page content)')}
          hint={t(
            'Enabled: this tool appears in the right-click menu on the page even without selected text. Selection popup toolbar still appears only after you highlight text.',
          )}
          checked={editingTool.usePageContext || false}
          onChange={(value) => setEditingTool({ ...editingTool, usePageContext: value })}
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
            if (!editingTool.name) {
              setErrorMessage(t('Name is required'))
              return
            }
            if (!editingTool.prompt || !editingTool.prompt.trim()) {
              setErrorMessage('Prompt template is required')
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
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <SettingSection
        title={t('Built-in Tools')}
        description={t('Shown on the selection toolbar and in the context menu')}
      >
        <div className="rounded-xl border border-border bg-card/60 divide-y divide-border/60 overflow-hidden">
          {config.selectionTools.map((key) => (
            <div key={key} className="px-3">
              <ToggleRow
                label={t(toolsConfig[key].label)}
                checked={(config.activeSelectionTools || []).includes(key)}
                onChange={async (checked) => {
                  const activeSelectionTools = (config.activeSelectionTools || []).filter(
                    (i) => i !== key,
                  )
                  if (checked) activeSelectionTools.push(key)
                  await updateConfig({ activeSelectionTools })
                  refreshContextMenu()
                }}
              />
            </div>
          ))}
        </div>
      </SettingSection>

      <Divider />

      <SettingSection title={t('Custom Tools')}>
        {!editing && (
          <Button
            size="sm"
            onClick={(e) => {
              e.preventDefault()
              setEditing(true)
              setEditingTool(defaultTool)
              setEditingIndex(-1)
              setErrorMessage('')
            }}
          >
            <Plus className="w-4 h-4" />
            {t('New')}
          </Button>
        )}

        {editing && editingIndex === -1 && editingComponent}

        <div className="space-y-3">
          {config.customSelectionTools.map(
            (tool, index) =>
              tool.name &&
              (editing && editingIndex === index ? (
                <div key={index}>{editingComponent}</div>
              ) : (
                <div key={index} className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {(() => {
                        const Icon = iconMap.get(tool.iconKey || 'ask') || HelpCircle
                        return <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      })()}
                      <span className="text-sm font-medium text-foreground truncate">
                        {tool.name}
                        {tool.usePageContext && ' 🌐'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
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
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={t('Delete')}
                        onClick={async (e) => {
                          e.preventDefault()
                          const customSelectionTools = [...config.customSelectionTools]
                          customSelectionTools.splice(index, 1)
                          await updateConfig({ customSelectionTools })
                          refreshContextMenu()
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <Toggle
                        checked={tool.active !== false}
                        onChange={async (checked) => {
                          const customSelectionTools = [...config.customSelectionTools]
                          customSelectionTools[index] = { ...tool, active: checked }
                          await updateConfig({ customSelectionTools })
                          refreshContextMenu()
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground break-words leading-relaxed">
                    {tool.prompt}
                  </p>
                </div>
              )),
          )}
        </div>
      </SettingSection>
    </div>
  )
}
