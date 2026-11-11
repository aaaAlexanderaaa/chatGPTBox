import { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft, Play, BookmarkPlus, ExternalLink } from 'lucide-react'
import Browser from 'webextension-polyfill'
import ConversationCard from '../components/ConversationCard'
import { getUserConfig, setUserConfig } from '../config/storage.mjs'
import { getSelectionString, listEnabledEngineSelections } from '../config/engine-selection.mjs'
import { getPreferredLanguage } from '../config/language.mjs'
import { initSession } from '../services/init-session.mjs'
import {
  INPUT_SCOPES,
  OUTPUT_MODES,
  SCOPE_LABELS,
  OUTPUT_LABELS,
  prepareFunctionRun,
  functionWithRefinements,
} from './functions.mjs'
import { captureInput, captureReadingSnapshot } from './context.mjs'
import { AssistantResult } from './Result.jsx'
import {
  listFunctions,
  findFunction,
  canRunFunction,
  localizeFunction,
  saveFunctionPatch,
} from './catalog.mjs'
import {
  extractTemplateVariables,
  resolvePromptTemplateSnapshot,
} from '../utils/prompt-template-context.mjs'
import { i18nReady } from '../_locales/i18n-react.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'

export function BrowserAssistant({
  context: initialContext,
  initialConfig,
  siteEngine,
  onClose,
  functionId,
  autoRun = false,
}) {
  const { t, i18n } = useTranslation()
  const [context, setContext] = useState(initialContext)
  const [config, setConfig] = useState(initialConfig)
  const [fn, setFn] = useState(() => {
    return (
      findFunction(initialConfig, functionId, context) ||
      listFunctions(initialConfig, { context }).find(
        (item) =>
          canRunFunction(item, context) &&
          item.scope === (context.input ? 'input' : context.selection ? 'selection' : 'page'),
      ) ||
      findFunction(initialConfig, 'preset.page-overview', context)
    )
  })
  const displayFn = localizeFunction(fn, t)
  const [temporaryEngine, setTemporaryEngine] = useState('')
  const [run, setRun] = useState(null)
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refinements, setRefinements] = useState([])
  const [actualEngine, setActualEngine] = useState('')
  const instructionRef = useRef(null)
  const dialogRef = useRef(null)
  const starting = useRef(false)
  const engineOptions = listEnabledEngineSelections(config)
  const functions = listFunctions(config, { entry: 'function-picker', context })
  const snapshots = useRef(new Map())
  const templateVariables = useRef({})
  const [request, setRequest] = useState(null)
  const [confirmedExtras, setConfirmedExtras] = useState(null)
  const preview = useMemo(() => {
    try {
      if (fn.scope === 'page' || fn.output === 'annotations') {
        if (!snapshots.current.has(fn.scope))
          snapshots.current.set(fn.scope, captureReadingSnapshot(context, fn.scope))
        const snapshot = snapshots.current.get(fn.scope)
        return {
          snapshot,
          text: snapshot.blocks.map((item) => `[${item.ref}] ${item.text}`).join('\n\n'),
        }
      }
      return {
        text:
          fn.scope === 'url'
            ? context.url
            : fn.scope === 'input'
            ? context.input?.selectedText || context.input?.text || ''
            : context.selection,
      }
    } catch (error) {
      return { error: error.message }
    }
  }, [context, fn.scope, fn.output])
  const edit = (patch) => {
    setFn((prev) => ({ ...localizeFunction(prev, t), ...patch, customized: true }))
    setSaved(false)
  }
  const preparationKey = useMemo(() => ({}), [fn, preview, temporaryEngine, siteEngine, config])
  // Recompute on edits, then consume exactly this object on Run. No DOM reads at dispatch.
  useEffect(() => {
    let disposed = false
    setRequest(null)
    void (async () => {
      try {
        await i18nReady
        if (preview.error) throw new Error(preview.error)
        const language = await getPreferredLanguage()
        let variables = {}
        const keys = fn.template ? extractTemplateVariables(fn.prompt) : []
        if (keys.some((key) => ['fullhtml', 'bodyhtml'].includes(key)))
          throw new Error(
            'Raw HTML is unavailable in page functions. Choose explicit page variables instead.',
          )
        const prepared = prepareFunctionRun({
          fn: localizeFunction(fn, i18n.t.bind(i18n)),
          context,
          temporaryEngine,
          siteEngine,
          config,
          snapshot: preview.snapshot,
          language,
          resolveTemplate: (template, material) => {
            const result = resolvePromptTemplateSnapshot(template, {
              selection: material,
              material,
              customExtractors: config.customContentExtractors,
              allowFullHtml: false,
              pageContext: { title: context.title, url: context.url, language, content: material },
              frozenVariables: templateVariables.current,
            })
            for (const [key, value] of Object.entries(result.variables))
              if (!['selection', 'content', 'title', 'url', 'language'].includes(key))
                templateVariables.current[key] = value
            variables = result.variables
            return result.text
          },
        })
        const extras = Object.entries(variables).filter(
          ([key]) => !['selection', 'content', 'title', 'url', 'language'].includes(key),
        )
        if (!disposed) setRequest({ key: preparationKey, prepared, extras })
      } catch (error) {
        if (!disposed) setRequest({ key: preparationKey, error: error.message })
      }
    })()
    return () => {
      disposed = true
    }
  }, [preparationKey])
  const readyRequest = request?.key === preparationKey ? request : null
  const needsExtraConfirmation = !!readyRequest?.extras?.length
  const extraKey = JSON.stringify([
    context.url,
    [...(readyRequest?.extras || [])].sort(([left], [right]) => left.localeCompare(right)),
  ])
  const extraConfirmed = confirmedExtras === extraKey
  const start = async () => {
    if (starting.current || !readyRequest?.prepared || (needsExtraConfirmation && !extraConfirmed))
      return
    starting.current = true
    setBusy(true)
    setError('')
    try {
      if (context.document.location.href !== context.url)
        throw new Error('The page changed. Open the assistant again.')
      const latest = await getUserConfig()
      const prepared = readyRequest.prepared
      // Validate availability against current settings without changing the previewed payload.
      if (!listEnabledEngineSelections(latest).some((item) => item.value === prepared.engine))
        throw new Error(
          'This engine is unavailable. Choose an enabled engine in Settings → Engines.',
        )
      setSession(
        initSession({ modelName: prepared.engine, extraCustomModelName: latest.customModelName }),
      )
      setRun(prepared)
      setRefinements([])
      setActualEngine(prepared.engine)
    } catch (error) {
      setError(error.message)
      setBusy(false)
    } finally {
      starting.current = false
    }
  }
  const changeRun = (output = run.fn.output) => {
    if (run.fn.scope === 'input') {
      try {
        if (context.document.location.href !== context.url)
          throw new Error('The page changed. Open the assistant again.')
        const input = captureInput(context.input?.element, context.document)
        if (!input?.element.isConnected)
          throw new Error('The selected input is no longer available')
        setContext({ ...context, input })
      } catch (error) {
        setError(error.message)
        return
      }
    }
    edit({
      ...functionWithRefinements(run.fn, refinements, t('Additional user instructions:')),
      output,
    })
    if (actualEngine && actualEngine !== run.engine) setTemporaryEngine(actualEngine)
    setRun(null)
    setBusy(false)
  }
  const openSave = () => {
    if (!saving && run) {
      edit({
        prompt: functionWithRefinements(run.fn, refinements, t('Additional user instructions:'))
          .prompt,
      })
      if (actualEngine && actualEngine !== run.engine) setTemporaryEngine(actualEngine)
    }
    setSaving(!saving)
  }
  const save = async () => {
    setError('')
    try {
      const latest = await getUserConfig()
      const { item, patch } = saveFunctionPatch(latest, {
        ...localizeFunction(fn, t),
        engine: temporaryEngine || fn.engine || '',
      })
      await setUserConfig(patch)
      await Browser.runtime.sendMessage({ type: RuntimeMessage.RefreshMenu }).catch(() => {})
      setConfig({ ...latest, ...patch })
      setFn({ ...item, source: 'custom' })
      setSaving(false)
      setSaved(true)
    } catch (error) {
      setError(error.message)
    }
  }
  useEffect(() => {
    if (run) dialogRef.current?.focus({ preventScroll: true })
    else if (!autoRun || needsExtraConfirmation)
      instructionRef.current?.focus({ preventScroll: true })
  }, [run?.id, needsExtraConfirmation])
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoRun && readyRequest?.prepared && !needsExtraConfirmation && !autoStarted.current) {
      autoStarted.current = true
      void start()
    }
  }, [autoRun, readyRequest, needsExtraConfirmation])
  return (
    <section
      className="box-assistant"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={t('Functions')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="box-assistant-header">
        <div>
          <strong>ChatGPTBox</strong>
          <small title={context.url}>{context.title || context.url}</small>
        </div>
        <button
          className="box-assistant-icon"
          aria-label={t('Close')}
          title={t('Close')}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="box-assistant-content">
        {run ? (
          <>
            <div className="box-assistant-run-summary">
              <span>
                {t(SCOPE_LABELS[run.fn.scope])} · {run.material.length} {t('chars')} ·{' '}
                {actualEngine || run.engine}
              </span>
              <label>
                {t('Use result as')}
                <select
                  value={run.fn.output}
                  disabled={busy}
                  onChange={(event) => changeRun(event.target.value)}
                >
                  {OUTPUT_MODES.map((output) => (
                    <option
                      key={output}
                      value={output}
                      disabled={
                        (output === 'replacement' && run.fn.scope !== 'input') ||
                        (output === 'annotations' && !['page', 'selection'].includes(run.fn.scope))
                      }
                    >
                      {t(OUTPUT_LABELS[output])}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={() => changeRun()}>
                <ArrowLeft size={14} />
                {t('Change instruction')}
              </button>
            </div>
            <div className="chatgptbox-container box-assistant-chat">
              <ConversationCard
                key={run.id}
                session={session}
                question={run.prompt}
                selection=""
                notClampSize={true}
                disconnectOnUnmount={true}
                onUpdate={(_port, currentSession, items) => {
                  setActualEngine(getSelectionString(currentSession))
                  // The initial material is not rendered as a question item.
                  // Provider records may contain rewritten/truncated copies of
                  // that material, so never derive saved prompts from them.
                  const next = items
                    .filter((item) => item.type === 'question')
                    .map((item) => item.content)
                  setRefinements((previous) =>
                    JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
                  )
                  const last = items.at(-1)
                  setBusy(!!last && last.type === 'answer' && !last.done)
                }}
                renderAnswer={
                  run.fn.output === 'chat'
                    ? undefined
                    : (item, index) =>
                        item.type !== 'answer' ? null : item.done ? (
                          <AssistantResult
                            key={`${run.id}-${item.content}`}
                            run={run}
                            text={
                              item.outcome && item.outcome !== 'completed'
                                ? item.content
                                : item.finalContent ?? item.content
                            }
                            outcome={item.outcome || 'completed'}
                            resultId={`${run.id}-${index}`}
                          />
                        ) : (
                          <p key={`${run.id}-pending`} className="box-assistant-note" role="status">
                            {t(
                              run.fn.output === 'annotations'
                                ? 'Preparing reading guide...'
                                : 'Preparing rewrite preview...',
                            )}
                          </p>
                        )
                }
              />
            </div>
          </>
        ) : (
          <>
            <label className="box-assistant-picker">
              {t('Saved functions')}
              <select
                value={fn.id}
                onChange={(event) => {
                  const item = functions.find((item) => item.id === event.target.value)
                  if (!item) return
                  setFn(item)
                  setTemporaryEngine('')
                  setSaved(false)
                  setError('')
                }}
              >
                {!functions.some((item) => item.id === fn.id) && (
                  <option value={fn.id}>{displayFn.name}</option>
                )}
                {functions
                  .filter((item) => canRunFunction(item, context))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {localizeFunction(item, t).name} · {t(OUTPUT_LABELS[item.output])}
                    </option>
                  ))}
                {functions.some((item) => !canRunFunction(item, context)) && (
                  <optgroup label={t('Select text or focus an input to use these functions')}>
                    {functions
                      .filter((item) => !canRunFunction(item, context))
                      .map((item) => (
                        <option key={item.id} value={item.id} disabled>
                          {localizeFunction(item, t).name}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              {t('What would you like help with?')}
              <textarea
                ref={instructionRef}
                rows={4}
                value={displayFn.prompt}
                onChange={(event) => edit({ prompt: event.target.value })}
              />
            </label>
            <div className="box-assistant-context" role="status">
              <span>
                {t(SCOPE_LABELS[fn.scope])} → {t(OUTPUT_LABELS[fn.output])}
              </span>
              <span>{temporaryEngine || fn.engine || siteEngine || config.modelName}</span>
            </div>
            <details className="box-assistant-settings">
              <summary>{t('Material, result and connection')}</summary>
              <div className="box-assistant-fields">
                <label>
                  {t('Material to send')}
                  <select
                    value={fn.scope}
                    onChange={(event) =>
                      edit({
                        scope: event.target.value,
                        output:
                          event.target.value === 'input'
                            ? 'replacement'
                            : fn.output === 'replacement' ||
                              (fn.output === 'annotations' && event.target.value === 'url')
                            ? 'chat'
                            : fn.output,
                      })
                    }
                  >
                    {INPUT_SCOPES.map((scope) => (
                      <option
                        key={scope}
                        value={scope}
                        disabled={
                          (scope === 'selection' && !context.selection) ||
                          (scope === 'input' && !context.input)
                        }
                      >
                        {t(SCOPE_LABELS[scope])}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('Result')}
                  <select
                    value={fn.output}
                    onChange={(event) => edit({ output: event.target.value })}
                  >
                    {OUTPUT_MODES.map((output) => (
                      <option
                        key={output}
                        value={output}
                        disabled={
                          (output === 'replacement' && fn.scope !== 'input') ||
                          (output === 'annotations' && !['page', 'selection'].includes(fn.scope))
                        }
                      >
                        {t(OUTPUT_LABELS[output])}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                {t('AI connection')}
                <select
                  value={temporaryEngine}
                  onChange={(event) => {
                    setTemporaryEngine(event.target.value)
                    setSaved(false)
                  }}
                >
                  <option value="">
                    {fn.engine || siteEngine || config.modelName} (
                    {t('Follow function or page default')})
                  </option>
                  {engineOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.value}
                    </option>
                  ))}
                </select>
              </label>
            </details>
            <details className="box-assistant-preview">
              <summary>
                {t('Preview material')} · {t(SCOPE_LABELS[fn.scope])} · {preview.text?.length || 0}{' '}
                {t('chars')}
              </summary>
              <pre>
                {preview.text ||
                  t(preview.error || 'No material is available for this input scope')}
              </pre>
            </details>
            {fn.scope === 'url' && !needsExtraConfirmation && (
              <p className="box-assistant-note">
                {t(
                  'Only the link is sent. Whether the AI can read it depends on the selected connection.',
                )}
              </p>
            )}
            {preview.snapshot?.truncated && (
              <p className="box-assistant-note">
                {t('Page text was shortened to the preview shown above.')}
              </p>
            )}
            <details className="box-assistant-preview">
              <summary>{t('Preview complete request')}</summary>
              <pre>
                {readyRequest?.prepared?.prompt ||
                  t(readyRequest?.error || 'Preparing request preview...')}
              </pre>
            </details>
            {needsExtraConfirmation && (
              <div className="box-assistant-note" role="status">
                <p>
                  {t('This template also reads page information beyond the selected material:')}
                </p>
                {readyRequest.extras.map(([key, value]) => (
                  <details key={key}>
                    <summary>
                      {key} · {value.length} {t('chars')}
                    </summary>
                    <pre>{value}</pre>
                  </details>
                ))}
                <label className="box-assistant-extra-consent">
                  <input
                    type="checkbox"
                    checked={extraConfirmed}
                    onChange={(event) => setConfirmedExtras(event.target.checked ? extraKey : null)}
                  />
                  {t('Include the additional page information shown above')}
                </label>
              </div>
            )}
            <div className="box-assistant-actions box-assistant-primary-actions">
              <button
                className="is-primary"
                disabled={
                  busy || !readyRequest?.prepared || (needsExtraConfirmation && !extraConfirmed)
                }
                onClick={start}
              >
                <Play size={14} />
                {t(busy ? 'Starting...' : 'Run')}
              </button>
              <button onClick={openSave}>
                <BookmarkPlus size={14} />
                {t(saved ? 'Saved' : 'Save as function')}
              </button>
              <a
                href={Browser.runtime.getURL('options.html?tab=tools')}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} />
                {t('Manage functions')}
              </a>
            </div>
          </>
        )}
        {run && !busy && (
          <div className="box-assistant-actions">
            <button onClick={openSave}>
              <BookmarkPlus size={14} />
              {t(saved ? 'Saved' : 'Save as function')}
            </button>
          </div>
        )}
        {saving && (
          <div className="box-assistant-save">
            <label>
              {t('Function name')}
              <input
                value={displayFn.name}
                onChange={(event) => edit({ name: event.target.value })}
              />
            </label>
            <label>
              {t('Instruction')}
              <textarea
                rows={3}
                value={displayFn.prompt}
                onChange={(event) => edit({ prompt: event.target.value })}
              />
            </label>
            <button onClick={save}>{t('Save')}</button>
          </div>
        )}
        {error && (
          <p className="box-assistant-error" role="alert">
            {t(error)}
          </p>
        )}
      </div>
    </section>
  )
}
BrowserAssistant.propTypes = {
  context: PropTypes.object.isRequired,
  initialConfig: PropTypes.object.isRequired,
  siteEngine: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  functionId: PropTypes.string,
  autoRun: PropTypes.bool,
}
