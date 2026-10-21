import { useState } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { SettingSection, ToggleRow } from '../popup/components/SettingComponents.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Input, Textarea } from '../components/ui/Input.jsx'
import { downloadJsonFile } from '../popup/file-transfer.mjs'
import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { listEnabledEngineSelections } from '../config/engine-selection.mjs'
import {
  createFunction,
  validateFunction,
  importFunctions,
  exportFunctions,
  FUNCTION_PRESETS,
  INPUT_SCOPES,
  OUTPUT_MODES,
  SCOPE_LABELS,
  OUTPUT_LABELS,
} from './functions.mjs'

const SELECT_CLASS =
  'w-full h-10 px-3 text-sm bg-input border border-border rounded-lg text-foreground'

export function FunctionLibrary({ config, updateConfig }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const functions = config.browserAssistantFunctions || []
  const engines = listEnabledEngineSelections(config)
  const persist = async (list) => {
    try {
      await updateConfig({ browserAssistantFunctions: list })
      setError('')
      return true
    } catch (error) {
      setError(error.message)
      return false
    }
  }
  const field = (patch) => setEditing((prev) => ({ ...prev, ...patch }))
  return (
    <SettingSection
      title={t('Browser assistant')}
      description={t(
        'Get help on the page, then save a useful instruction for next time. Open it from the page context menu or the selection toolbar.',
      )}
    >
      <div className="space-y-4">
        <ToggleRow
          label={t('Enable browser assistant')}
          checked={config.browserAssistantEnabled !== false}
          onChange={async (enabled) => {
            await updateConfig({ browserAssistantEnabled: enabled })
            await Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu })
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditing(createFunction({ name: t('My function') }))
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
                  await persist(importFunctions(await file.text(), functions))
                } catch (error) {
                  setError(error.message)
                }
              }}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!functions.length}
            onClick={() =>
              downloadJsonFile(JSON.parse(exportFunctions(functions)), 'chatgptbox-functions.json')
            }
          >
            {t('Export functions')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {FUNCTION_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(
                  createFunction({
                    ...preset,
                    id: undefined,
                    name: t(preset.name),
                    prompt: t(preset.prompt),
                  }),
                )
                setError('')
              }}
            >
              {t(preset.name)}
            </Button>
          ))}
        </div>
        {editing && (
          <form
            className="space-y-3 rounded-xl border border-border bg-card p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                const item = validateFunction(editing)
                if (await persist([...functions.filter((entry) => entry.id !== item.id), item]))
                  setEditing(null)
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
              {t('Instruction')}
              <Textarea
                rows={4}
                value={editing.prompt}
                onChange={(event) => field({ prompt: event.target.value })}
              />
            </label>
            <label className="block text-sm">
              {t('Material to send')}
              <select
                className={SELECT_CLASS}
                value={editing.scope}
                onChange={(event) => field({ scope: event.target.value, output: 'chat' })}
              >
                {INPUT_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {t(SCOPE_LABELS[scope])}
                  </option>
                ))}
              </select>
            </label>
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
                {editing.engine && !engines.some((entry) => entry.value === editing.engine) && (
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
        {!functions.length && !editing && (
          <p className="text-sm text-muted-foreground">
            {t('Presets are ready on the page. Saved functions will appear here.')}
          </p>
        )}
        <div className="space-y-2">
          {functions.map((item) => (
            <div key={item.id} className="rounded-xl border border-border p-3">
              <ToggleRow
                label={item.name}
                checked={item.enabled !== false}
                onChange={(enabled) =>
                  persist(
                    functions.map((entry) =>
                      entry.id === item.id ? { ...entry, enabled } : entry,
                    ),
                  )
                }
              />
              <p className="mb-2 text-xs text-muted-foreground">
                {t(SCOPE_LABELS[item.scope])} · {t(OUTPUT_LABELS[item.output])} ·{' '}
                {item.engine || t('Follow page default')}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing({ ...item })
                    setError('')
                  }}
                >
                  {t('Edit')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEditing(
                      createFunction({
                        ...item,
                        id: undefined,
                        name: `${item.name} (${t('Copy')})`,
                      }),
                    )
                  }
                >
                  {t('Duplicate')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => persist(functions.filter((entry) => entry.id !== item.id))}
                >
                  {t('Delete')}
                </Button>
              </div>
            </div>
          ))}
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
