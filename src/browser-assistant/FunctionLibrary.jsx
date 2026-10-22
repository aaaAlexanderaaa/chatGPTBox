import { useState } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import Browser from 'webextension-polyfill'
import { SettingSection, ToggleRow } from '../popup/components/SettingComponents.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Input, Textarea } from '../components/ui/Input.jsx'
import { downloadJsonFile } from '../popup/file-transfer.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { listEnabledEngineSelections } from '../config/engine-selection.mjs'
import { promptTemplateVariables } from '../utils/prompt-template-context.mjs'
import { IconSelect } from '../popup/components/IconSelect.jsx'
import { FUNCTION_ICONS } from './icons.mjs'
import {
  createFunction,
  validateFunction,
  importFunctions,
  exportFunctions,
  INPUT_SCOPES,
  OUTPUT_MODES,
  SCOPE_LABELS,
  OUTPUT_LABELS,
} from './functions.mjs'
import {
  FUNCTION_ENTRIES,
  DEFAULT_ENTRIES,
  listFunctions,
  localizeFunction,
  updateFunctionPatch,
  saveFunctionPatch,
  deleteFunctionPatch,
} from './catalog.mjs'

const SELECT_CLASS =
  'w-full h-10 px-3 text-sm bg-input border border-border rounded-lg text-foreground'

export function FunctionLibrary({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const functions = listFunctions(config, { includeDisabled: true })
  const engines = listEnabledEngineSelections(config)
  const persist = async (patch) => {
    try {
      await updateConfig(patch)
      await Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu })
      setError('')
      return true
    } catch (error) {
      setError(error.message)
      return false
    }
  }
  const field = (patch) => setEditing((previous) => ({ ...previous, ...patch }))
  const edit = (item, copy = false) => {
    const value = localizeFunction(item, t)
    setEditing(
      copy || item.source === 'builtin'
        ? { ...createFunction({ ...value, id: undefined }), source: 'custom' }
        : value,
    )
    setError('')
  }
  return (
    <SettingSection
      title={t('Functions')}
      description={t(
        'Choose what AI does, what material it uses, and where the function appears. All entries use the same functions.',
      )}
    >
      <div className="space-y-4">
        <ToggleRow
          label={t('Show function picker')}
          checked={config.browserAssistantEnabled !== false}
          onChange={(enabled) => persist({ browserAssistantEnabled: enabled })}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditing(
                createFunction({
                  name: t('My function'),
                  prompt: t('Explain the important points.'),
                }),
              )
              setError('')
            }}
          >
            {t('New function')}
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-sm">
            {t('Import functions')}
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  if (file.size > 2_000_000) throw new Error('Function file is too large')
                  await persist({
                    browserAssistantFunctions: importFunctions(
                      await file.text(),
                      config.browserAssistantFunctions || [],
                    ),
                  })
                } catch (error) {
                  setError(
                    error instanceof SyntaxError ? 'Unsupported function file' : error.message,
                  )
                }
              }}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!functions.some((item) => item.source !== 'builtin')}
            onClick={() =>
              downloadJsonFile(
                JSON.parse(exportFunctions(functions.filter((item) => item.source !== 'builtin'))),
                'chatgptbox-functions.json',
              )
            }
          >
            {t('Export functions')}
          </Button>
        </div>
        {editing && (
          <form
            className="space-y-3 rounded-xl border border-border bg-card p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                validateFunction(editing)
                const { patch } = saveFunctionPatch(config, editing)
                if (await persist(patch)) setEditing(null)
              } catch (error) {
                setError(error.message)
              }
            }}
          >
            <label className="block text-sm">
              {t('Function name')}
              <Input
                value={editing.name}
                onChange={(event) => field({ name: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              {t('Icon')}
              <IconSelect
                value={editing.iconKey || 'ask'}
                onChange={(iconKey) => field({ iconKey })}
                options={Object.entries(FUNCTION_ICONS).map(([value, item]) => ({
                  value,
                  Icon: item.Icon,
                  label: t(item.label),
                }))}
              />
            </label>
            <label className="block text-sm">
              {t('Instruction')}
              <Textarea
                rows={4}
                value={editing.prompt}
                onChange={(event) => field({ prompt: event.target.value })}
              />
            </label>
            <ToggleRow
              label={t('Use prompt template')}
              checked={editing.template === true}
              onChange={(template) => field({ template })}
            />
            {editing.template && (
              <p className="text-xs text-muted-foreground">
                {t('Available variables: {{variables}}', {
                  variables: promptTemplateVariables.map((key) => `{{${key}}}`).join(', '),
                })}
              </p>
            )}
            <label className="block text-sm">
              {t('Material to send')}
              <select
                className={SELECT_CLASS}
                value={editing.scope}
                onChange={(event) =>
                  field({ scope: event.target.value, output: 'chat', selectionOrPage: false })
                }
              >
                {INPUT_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {t(SCOPE_LABELS[scope])}
                  </option>
                ))}
              </select>
            </label>
            {editing.scope === 'selection' && (
              <ToggleRow
                label={t('Use page text when nothing is selected')}
                checked={editing.selectionOrPage === true}
                onChange={(selectionOrPage) => field({ selectionOrPage })}
              />
            )}
            <label className="block text-sm">
              {t('Result')}
              <select
                className={SELECT_CLASS}
                value={editing.output}
                onChange={(event) => field({ output: event.target.value })}
              >
                {OUTPUT_MODES.map((mode) => (
                  <option
                    key={mode}
                    value={mode}
                    disabled={
                      (mode === 'replacement' && editing.scope !== 'input') ||
                      (mode === 'annotations' && !['page', 'selection'].includes(editing.scope))
                    }
                  >
                    {t(OUTPUT_LABELS[mode])}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t('AI connection')}
              <select
                className={SELECT_CLASS}
                value={editing.engine || ''}
                onChange={(event) => field({ engine: event.target.value })}
              >
                <option value="">{t('Follow page default')}</option>
                {editing.engine && !engines.some((item) => item.value === editing.engine) && (
                  <option value={editing.engine}>
                    {editing.engine} ({t('Unavailable')})
                  </option>
                )}
                {engines.map((engine) => (
                  <option key={engine.value} value={engine.value}>
                    {engine.value}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend>{t('Available in')}</legend>
              {FUNCTION_ENTRIES.map((entry) => (
                <label key={entry.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(editing.entries || DEFAULT_ENTRIES).includes(entry.id)}
                    onChange={(event) => {
                      const entries = (editing.entries || DEFAULT_ENTRIES).filter(
                        (id) => id !== entry.id,
                      )
                      if (event.target.checked) entries.push(entry.id)
                      field({ entries })
                    }}
                  />
                  {t(entry.label)}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button size="sm" type="submit">
                {t('Save')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                {t('Cancel')}
              </Button>
            </div>
          </form>
        )}
        <div className="space-y-2">
          {functions.map((item) => {
            const value = localizeFunction(item, t)
            return (
              <div key={item.id} className="rounded-xl border border-border p-3">
                <ToggleRow
                  label={value.name}
                  checked={item.enabled !== false}
                  onChange={(enabled) => persist(updateFunctionPatch(config, item, { enabled }))}
                />
                <p className="mb-2 text-xs text-muted-foreground">
                  {t(item.source === 'builtin' ? 'Built-in' : 'Custom')} ·{' '}
                  {t(item.selectionOrPage ? 'Selection or page text' : SCOPE_LABELS[item.scope])} ·{' '}
                  {t(OUTPUT_LABELS[item.output])}
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {FUNCTION_ENTRIES.map((entry) => (
                    <label key={entry.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={item.entries.includes(entry.id)}
                        onChange={(event) => {
                          const entries = item.entries.filter((id) => id !== entry.id)
                          if (event.target.checked) entries.push(entry.id)
                          void persist(updateFunctionPatch(config, item, { entries }))
                        }}
                      />
                      {t(entry.label)}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => edit(item)}>
                    {t(item.source === 'builtin' ? 'Customize' : 'Edit')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => edit(item, true)}>
                    {t('Duplicate')}
                  </Button>
                  {item.source !== 'builtin' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => persist(deleteFunctionPatch(config, item))}
                    >
                      {t('Delete')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t(error)}
          </p>
        )}
      </div>
    </SettingSection>
  )
}
FunctionLibrary.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
