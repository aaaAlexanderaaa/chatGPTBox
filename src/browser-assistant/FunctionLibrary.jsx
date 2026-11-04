import { useEffect, useRef, useState } from 'react'
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
  const [query, setQuery] = useState('')
  const [editingAt, setEditingAt] = useState(null)
  const [pending, setPending] = useState(false)
  const persisting = useRef(false)
  const [editingTitle, setEditingTitle] = useState('Edit function')
  const formRef = useRef(null)
  const promptRef = useRef(null)
  const returnFocus = useRef(null)
  const searchRef = useRef(null)
  useEffect(() => {
    if (editing) formRef.current?.querySelector('input')?.focus()
    else if (returnFocus.current) {
      const target = returnFocus.current.isConnected ? returnFocus.current : searchRef.current
      target?.focus()
    }
  }, [editing?.id])
  const closeEditor = () => {
    setEditing(null)
    setEditingAt(null)
    setError('')
  }
  const insertVariable = (key) => {
    const input = promptRef.current
    const start = input?.selectionStart ?? editing.prompt.length
    const end = input?.selectionEnd ?? start
    const variable = `{{${key}}}`
    field({ prompt: editing.prompt.slice(0, start) + variable + editing.prompt.slice(end) })
    requestAnimationFrame(() => {
      input?.focus({ preventScroll: true })
      input?.setSelectionRange(start + variable.length, start + variable.length)
    })
  }
  const functions = listFunctions(config, { includeDisabled: true })
  const engines = listEnabledEngineSelections(config)
  const visibleFunctions = functions.filter((item) => {
    if (item.id === editingAt) return true
    const value = localizeFunction(item, t)
    return `${value.name} ${value.prompt} ${t(SCOPE_LABELS[item.scope])}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  })
  const persist = async (patch) => {
    // Reserve file reads too, and guard submissions before the disabled state renders.
    if (persisting.current) return false
    persisting.current = true
    setPending(true)
    try {
      await updateConfig(typeof patch === 'function' ? await patch() : patch)
      await Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})
      setError('')
      return true
    } catch (error) {
      setError(error instanceof SyntaxError ? 'Unsupported function file' : error.message)
      return false
    } finally {
      persisting.current = false
      setPending(false)
    }
  }
  const field = (patch) => setEditing((previous) => ({ ...previous, ...patch }))
  const edit = (item, copy = false) => {
    returnFocus.current = document.activeElement
    setEditingAt(item.id)
    setEditingTitle(
      copy
        ? 'Duplicate function'
        : item.source === 'builtin'
        ? 'Customize function'
        : 'Edit function',
    )
    const value = localizeFunction(item, t)
    setEditing(
      copy || item.source === 'builtin'
        ? { ...createFunction({ ...value, id: undefined }), source: 'custom' }
        : value,
    )
    setError('')
  }
  const editor = editing && (
    <form
      ref={formRef}
      aria-label={t('Edit function')}
      className="space-y-4 rounded-xl border border-primary/30 bg-secondary/20 p-4"
      onSubmit={async (event) => {
        event.preventDefault()
        try {
          validateFunction(editing)
          const { patch } = saveFunctionPatch(config, editing)
          if (await persist(patch)) closeEditor()
        } catch (error) {
          setError(error.message)
        }
      }}
    >
      <h4 className="text-sm font-semibold text-foreground">{t(editingTitle)}</h4>
      <label className="block text-sm">
        {t('Function name')}
        <Input value={editing.name} onChange={(event) => field({ name: event.target.value })} />
      </label>
      <label className="block text-sm">
        {t('Icon')}
        <IconSelect
          triggerClassName="min-w-0 w-full"
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
          ref={promptRef}
          rows={5}
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
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {t(
              'Insert a variable at the cursor. Without a material variable, the selected material is appended automatically.',
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {['selection', 'content', 'title', 'url', 'language'].map((key) => (
              <Button
                key={key}
                size="sm"
                variant="outline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertVariable(key)}
              >
                {`{{${key}}}`}
              </Button>
            ))}
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('More variables')}</summary>
            <p className="mt-2 break-words">
              {promptTemplateVariables
                .filter(
                  (key) =>
                    ![
                      'selection',
                      'content',
                      'title',
                      'url',
                      'language',
                      'fullHtml',
                      'bodyHtml',
                    ].includes(key),
                )
                .map((key) => `{{${key}}}`)
                .join(', ')}
            </p>
          </details>
        </div>
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
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t('Connection and entries')}
        </summary>
        <label className="block text-sm mt-3">
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
      </details>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {t(pending ? 'Saving...' : 'Save')}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={closeEditor}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  )
  return (
    <SettingSection
      title={t('Functions')}
      description={t(
        'Choose what AI does, what material it uses, and where the function appears. All entries use the same functions.',
      )}
    >
      <fieldset
        disabled={pending}
        aria-busy={pending}
        aria-label={t('Functions')}
        className="min-w-0 space-y-4 disabled:opacity-60"
      >
        <ToggleRow
          label={t('Show function picker')}
          checked={config.browserAssistantEnabled !== false}
          onChange={(enabled) => persist({ browserAssistantEnabled: enabled })}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              returnFocus.current = document.activeElement
              setEditingAt(null)
              setEditingTitle('New function')
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
                await persist(async () => {
                  if (file.size > 2_000_000) throw new Error('Function file is too large')
                  return {
                    browserAssistantFunctions: importFunctions(
                      await file.text(),
                      config.browserAssistantFunctions || [],
                    ),
                  }
                })
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
        {editing && !editingAt && editor}
        <div className="flex items-center gap-3">
          <Input
            ref={searchRef}
            type="search"
            aria-label={t('Search functions')}
            placeholder={t('Search functions')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="shrink-0 text-xs text-muted-foreground" role="status">
            {visibleFunctions.length} / {functions.length}
          </span>
        </div>
        {!visibleFunctions.length && (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            {t('No matching functions. Try another search or create a function.')}
          </p>
        )}
        <div className="space-y-3">
          {visibleFunctions.map((item) => {
            const value = localizeFunction(item, t)
            const Icon = (FUNCTION_ICONS[item.iconKey] || FUNCTION_ICONS.ask).Icon
            return (
              <div
                key={item.id}
                data-function-id={item.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex gap-3">
                  <span className="mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <ToggleRow
                      label={value.name}
                      checked={item.enabled !== false}
                      onChange={(enabled) =>
                        persist(updateFunctionPatch(config, item, { enabled }))
                      }
                    />
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t(item.source === 'builtin' ? 'Built-in' : 'Custom')} ·{' '}
                      {t(
                        item.selectionOrPage ? 'Selection or page text' : SCOPE_LABELS[item.scope],
                      )}{' '}
                      · {t(OUTPUT_LABELS[item.output])}
                    </p>
                    <details className="mb-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {t('Available in')}:{' '}
                        {item.entries.length
                          ? item.entries
                              .map((id) =>
                                t(FUNCTION_ENTRIES.find((entry) => entry.id === id)?.label || id),
                              )
                              .join(' · ')
                          : t('No entries selected')}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-3">
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
                    </details>
                    <div className="flex flex-wrap gap-2">
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
                </div>
                {editingAt === item.id && <div className="mt-4">{editor}</div>}
              </div>
            )
          })}
        </div>
        {error && !editing && (
          <p className="text-sm text-destructive" role="alert">
            {t(error)}
          </p>
        )}
      </fieldset>
    </SettingSection>
  )
}
FunctionLibrary.propTypes = {
  config: PropTypes.object.isRequired,
  updateConfig: PropTypes.func.isRequired,
}
