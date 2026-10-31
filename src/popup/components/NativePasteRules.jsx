import PropTypes from 'prop-types'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useTranslation } from 'react-i18next'
import {
  normalizePasteRules,
  validatePasteRules,
  PASTE_LIMITS,
} from '../../native-chatgpt/paste-rules.mjs'
const SAVE_FAILURE = 'Rules could not be saved. Your draft is not the active policy; retry saving.'

function editable(value) {
  let rules
  try {
    rules = normalizePasteRules(value)
  } catch (error) {
    return { rules: null, error }
  }
  try {
    validatePasteRules(rules)
    return { rules, error: null }
  } catch (error) {
    return { rules, error }
  }
}

function policyText(value) {
  try {
    return JSON.stringify(normalizePasteRules(value))
  } catch {
    return JSON.stringify(value)
  }
}

export function NativePasteRules({ value, onSave }) {
  const { t } = useTranslation()
  const stored = policyText(value)
  const savedDraft = useMemo(() => editable(JSON.parse(stored)), [stored])
  const [draft, setDraft] = useState(savedDraft)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const savedPolicy = useRef(null)
  const reconciledPolicy = useRef(stored)
  const activePolicy = useRef(stored)
  activePolicy.current = stored
  useEffect(() => {
    if (reconciledPolicy.current === stored) return
    reconciledPolicy.current = stored
    const next = savedDraft
    const ownSave = JSON.stringify(next.rules) === savedPolicy.current
    if (ownSave) {
      savedPolicy.current = null
      // A late receipt must not overwrite edits made after Save completed.
      if (!dirty || JSON.stringify(draft.rules) === JSON.stringify(next.rules)) {
        if (!dirty) setDraft(next)
        setDirty(false)
        setConflict(false)
      }
      return
    }
    if (dirty && !ownSave) {
      setConflict(true)
      setNotice('')
      return
    }
    setDraft(next)
    setDirty(false)
    setConflict(false)
    // Chrome storage can reorder dictionary keys; compare normalized rule values.
    if (!ownSave) setNotice('')
    savedPolicy.current = null
  }, [stored])
  const change = (index, key, value) => {
    setDirty(true)
    setDraft({
      rules: draft.rules.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)),
      error: null,
    })
    setNotice('')
  }
  const inputClass =
    'w-full min-w-0 px-3 py-2 text-sm bg-input border border-border rounded-lg text-foreground'
  const buttonClass =
    'px-3 py-2 text-sm border border-border rounded-lg text-foreground disabled:opacity-50'
  return (
    <section aria-label={t('Regex replacement rules')} className="space-y-3">
      <h4 className="text-sm text-foreground">{t('Regex replacement rules')}</h4>
      <p className="text-xs text-muted-foreground">
        {t(
          'RE2 syntax; no / delimiters. Flags: i, m, s. Each rule matches globally, left to right without overlapping itself.',
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'Replacement: fixed text, empty to delete, $$ for $, $& for the match, $1 or $<name> for a capture. Captures can retain sensitive text; review the result.',
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'Up to 100 rules, 512 UTF-16 units per pattern, 256 per template and 16 captures. Lookaround and pattern backreferences are unsupported.',
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'Rules are stored locally and included in full configuration backups. Pasted originals are not saved.',
        )}
      </p>
      {Array.isArray(value) && value.some((item) => typeof item === 'string') && (
        <p className="text-xs text-muted-foreground">
          {t(
            'Legacy terms are escaped as literal patterns with [REDACTED] replacement. Save to upgrade; custom identity aliases are no longer generated for these rules.',
          )}
        </p>
      )}
      {savedDraft.error && (
        <p role="alert" className="text-sm text-foreground">
          {t(savedDraft.error.message)}{' '}
          {t('Invalid saved rules block checked insertion until repaired and saved.')}
        </p>
      )}
      {draft.error && draft.error !== savedDraft.error && (
        <p role="alert" className="text-sm text-foreground">
          {Number.isInteger(draft.error.ruleIndex) && (
            <>
              {t('Rule')} {draft.error.ruleIndex + 1}:{' '}
            </>
          )}
          {t(draft.error.message)}{' '}
          {draft.error.message !== SAVE_FAILURE &&
            t('This draft was not saved. Fix it before saving; the saved rules still apply.')}
        </p>
      )}
      {conflict && (
        <div role="alert" className="space-y-2 text-sm text-foreground">
          <p>
            {t(
              'Saved rules changed in another window. Your unsaved draft is kept. Choose which version to use before saving.',
            )}
          </p>
          <button
            type="button"
            disabled={saving}
            className={buttonClass}
            onClick={() => {
              savedPolicy.current = null
              setDraft(editable(JSON.parse(stored)))
              setDirty(false)
              setConflict(false)
              setNotice('')
            }}
          >
            {t('Use saved rules')}
          </button>{' '}
          <button
            type="button"
            disabled={saving}
            className={buttonClass}
            onClick={() => {
              setConflict(false)
              setNotice('Draft kept. Saving will replace the current saved rules.')
            }}
          >
            {t('Keep my draft')}
          </button>
        </div>
      )}
      {draft.rules === null ? (
        <>
          <pre className="max-h-32 overflow-auto text-xs text-muted-foreground">
            {stored.slice(0, 2000)}
            {stored.length > 2000 ? '…' : ''}
          </pre>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setDraft({ rules: [], error: null })
              setDirty(true)
              setNotice('Changes are not saved. Save rules to replace the invalid policy.')
            }}
          >
            {t('Reset invalid rules')}
          </button>
        </>
      ) : (
        <>
          {draft.rules.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t('No custom rules. Built-in email, phone and known-key checks still apply.')}
            </p>
          )}
          {draft.rules.map((rule, index) => (
            <fieldset
              key={index}
              disabled={saving}
              data-native-rule-row
              className="min-w-0 border border-border rounded-lg p-3 space-y-2"
            >
              <legend className="px-1 text-sm text-foreground">
                {t('Rule')} {index + 1}
              </legend>
              <label className="block text-sm text-foreground">
                {t('Matching pattern')}
                <input
                  className={inputClass}
                  value={rule.pattern}
                  spellCheck={false}
                  aria-invalid={draft.error?.ruleIndex === index}
                  onInput={(event) => change(index, 'pattern', event.currentTarget.value)}
                  placeholder="示例[甲乙]公司"
                />
              </label>
              <label className="block text-sm text-foreground">
                {t('Flags')}
                <input
                  className={inputClass}
                  value={rule.flags}
                  spellCheck={false}
                  onInput={(event) => change(index, 'flags', event.currentTarget.value)}
                  placeholder="i"
                />
              </label>
              <label className="block text-sm text-foreground">
                {t('Replacement text (empty deletes the match)')}
                <input
                  className={inputClass}
                  value={rule.replacement}
                  spellCheck={false}
                  onInput={(event) => change(index, 'replacement', event.currentTarget.value)}
                  placeholder="[客户]"
                />
              </label>
              <button
                type="button"
                className={buttonClass}
                aria-label={t('Remove rule') + ' ' + (index + 1)}
                onClick={() => {
                  setDraft({ rules: draft.rules.filter((_, i) => i !== index), error: null })
                  setDirty(true)
                  setNotice('')
                }}
              >
                {t('Remove rule')}
              </button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || draft.rules.length >= PASTE_LIMITS.rules}
              className={buttonClass}
              onClick={() => {
                setDraft({
                  rules: [...draft.rules, { pattern: '', flags: '', replacement: '[REDACTED]' }],
                  error: null,
                })
                setDirty(true)
                setNotice('')
              }}
            >
              {t('Add rule')}
            </button>
            <button
              type="button"
              disabled={saving || conflict}
              className={buttonClass}
              onClick={async () => {
                setSaving(true)
                setNotice('')
                let validated = false
                try {
                  const next = validatePasteRules(draft.rules)
                  validated = true
                  savedPolicy.current =
                    JSON.stringify(next) === stored ? null : JSON.stringify(next)
                  await onSave({ chatgptNativePasteTerms: next })
                  setDraft({ rules: next, error: null })
                  const superseded =
                    activePolicy.current !== stored && activePolicy.current !== JSON.stringify(next)
                  setDirty(superseded)
                  setConflict(superseded)
                  setNotice(superseded ? '' : 'Rules saved.')
                } catch (error) {
                  savedPolicy.current = null
                  setDraft({ ...draft, error: validated ? new Error(SAVE_FAILURE) : error })
                } finally {
                  setSaving(false)
                }
              }}
            >
              {t('Save rules')}
            </button>
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(notice)}
        </p>
      )}
    </section>
  )
}
NativePasteRules.propTypes = { value: PropTypes.any, onSave: PropTypes.func.isRequired }
