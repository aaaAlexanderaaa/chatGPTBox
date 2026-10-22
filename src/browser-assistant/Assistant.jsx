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
import { captureReadingSnapshot } from './context.mjs'
import { AssistantResult } from './Result.jsx'
import {
  listFunctions,
  findFunction,
  canRunFunction,
  localizeFunction,
  saveFunctionPatch,
} from './catalog.mjs'
import { resolvePromptTemplate } from '../utils/prompt-template-context.mjs'
import { i18nReady } from '../_locales/i18n-react.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'

export function BrowserAssistant({
  context,
  initialConfig,
  siteEngine,
  onClose,
  functionId,
  autoRun = false,
}) {
  const { t, i18n } = useTranslation()
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
  const starting = useRef(false)
  const engineOptions = listEnabledEngineSelections(config)
  const functions = listFunctions(config, { entry: 'function-picker', context })
  const preview = useMemo(() => {
    try {
      if (fn.scope === 'page' || fn.output === 'annotations') {
        const snapshot = captureReadingSnapshot(context, fn.scope)
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
  const start = async () => {
    if (starting.current) return
    starting.current = true
    setBusy(true)
    setError('')
    try {
      await i18nReady
      if (context.document.location.href !== context.url)
        throw new Error('The page changed. Open the assistant again.')
      if (preview.error) throw new Error(preview.error)
      const latest = await getUserConfig()
      const language = await getPreferredLanguage()
      const prepared = prepareFunctionRun({
        fn: localizeFunction(fn, i18n.t.bind(i18n)),
        context,
        temporaryEngine,
        siteEngine,
        config: latest,
        snapshot: preview.snapshot,
        language,
        resolveTemplate: (template, material) =>
          resolvePromptTemplate(template, {
            selection: material,
            customExtractors: latest.customContentExtractors,
            allowFullHtml: false,
            pageContext: {
              title: context.title,
              url: context.url,
              language,
              ...(fn.scope === 'page' ? { content: material } : {}),
            },
          }),
      })
      setSession(
        initSession({ modelName: prepared.engine, extraCustomModelName: latest.customModelName }),
      )
      setRun(prepared)
      setRefinements([])
      setActualEngine(prepared.engine)
      setBusy(true)
    } catch (error) {
      setError(error.message)
      setBusy(false)
    } finally {
      starting.current = false
    }
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
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoRun && !autoStarted.current) {
      autoStarted.current = true
      void start()
    }
  }, [autoRun])
  return (
    <section className="box-assistant" aria-label={t('Functions')}>
      <header className="box-assistant-header">
        <div>
          <strong>ChatGPTBox</strong>
          <small title={context.url}>{context.title || context.url}</small>
        </div>
        <button className="box-assistant-icon" title={t('Close')} onClick={onClose}>
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
              <button
                onClick={() => {
                  edit({
                    prompt: functionWithRefinements(
                      run.fn,
                      refinements,
                      t('Additional user instructions:'),
                    ).prompt,
                  })
                  if (actualEngine && actualEngine !== run.engine) setTemporaryEngine(actualEngine)
                  setRun(null)
                  setBusy(false)
                }}
              >
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
                  if (last) setBusy(last.type === 'answer' && !last.done)
                }}
                renderAnswer={
                  run.fn.output === 'chat'
                    ? undefined
                    : (item, index) =>
                        item.type !== 'answer' ? null : item.done ? (
                          <AssistantResult
                            key={`${run.id}-${item.content}`}
                            run={run}
                            text={item.content}
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
            <div className="box-assistant-presets" aria-label={t('Saved functions')}>
              {functions.map((item) => (
                <button
                  key={item.id}
                  className={fn.id === item.id ? 'is-active' : ''}
                  disabled={!canRunFunction(item, context)}
                  onClick={() => {
                    setFn(item)
                    setTemporaryEngine('')
                    setSaved(false)
                    setError('')
                  }}
                >
                  {localizeFunction(item, t).name}
                </button>
              ))}
            </div>
            <label>
              {t('What would you like help with?')}
              <textarea
                rows={4}
                value={displayFn.prompt}
                onChange={(event) => edit({ prompt: event.target.value })}
              />
            </label>
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
            {fn.scope === 'url' && (
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
            <div className="box-assistant-actions">
              <button
                className="is-primary"
                disabled={busy || !fn.prompt.trim() || !!preview.error || !preview.text}
                onClick={start}
              >
                <Play size={14} />
                {t('Run')}
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
