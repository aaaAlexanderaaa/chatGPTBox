import { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import ConversationItem from '../components/ConversationItem'
import { copyTextWhenReady } from '../utils/clipboard.mjs'
import { parseReadingResult } from './functions.mjs'
import { rangeForAnnotation } from './context.mjs'
import { applyInputReplacement, revealAnnotation, showAnnotations } from './effects.mjs'
import { normalizeModelAnswer, unwrapAnswerFence } from '../services/model-answer.mjs'

export function AssistantResult({ run, text, resultId }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [marked, setMarked] = useState(false)
  const [applied, setApplied] = useState(false)
  const cleanup = useRef(null)
  const undo = useRef(null)
  const answer = useMemo(() => normalizeModelAnswer(text), [text])
  const replacement = unwrapAnswerFence(answer.text)
  useEffect(() => () => cleanup.current?.(), [])
  const reading = useMemo(() => {
    if (run.fn.output !== 'annotations') return null
    try {
      const result = parseReadingResult(text)
      return {
        ...result,
        annotations: result.annotations.map((item) => {
          try {
            rangeForAnnotation(run.snapshot, item)
            return { ...item, valid: true }
          } catch (error) {
            return { ...item, valid: false, error: error.message }
          }
        }),
      }
    } catch (error) {
      return { error: error.message }
    }
  }, [run, text])
  const act = (action) => {
    try {
      action()
      setError('')
    } catch (error) {
      setError(error.message)
    }
  }
  return (
    <div className="box-assistant-result">
      {answer.reasoning && (
        <details className="box-assistant-note">
          <summary>{t('Thinking')}</summary>
          <pre>{answer.reasoning}</pre>
        </details>
      )}
      {error && (
        <p className="box-assistant-error" role="alert">
          {t(error)}
        </p>
      )}
      {answer.pending || !answer.text ? (
        <p className="box-assistant-note" role="status">
          {t(
            'The model returned thinking without a final answer. Continue the conversation to request the result.',
          )}
        </p>
      ) : run.fn.output === 'replacement' ? (
        <>
          <h4>{t('Compare rewrite')}</h4>
          <div className="box-assistant-comparison">
            <div>
              <small>{t('Original')}</small>
              <pre>{run.material}</pre>
            </div>
            <div>
              <small>{t('Suggested rewrite')}</small>
              <pre>{replacement}</pre>
            </div>
          </div>
          <div className="box-assistant-actions">
            <button
              disabled={applied}
              onClick={() =>
                act(() => {
                  undo.current = applyInputReplacement(run.context.input, replacement)
                  setApplied(true)
                })
              }
            >
              {t(applied ? 'Applied' : 'Apply rewrite')}
            </button>
            <button
              disabled={!applied}
              onClick={() =>
                act(() => {
                  undo.current()
                  setApplied(false)
                })
              }
            >
              {t('Undo')}
            </button>
            <button
              onClick={() => {
                void copyTextWhenReady(() => replacement).catch(() =>
                  setError('Could not copy the result'),
                )
              }}
            >
              {t('Copy')}
            </button>
          </div>
        </>
      ) : reading?.error ? (
        <>
          <p className="box-assistant-note" role="status">
            {t(reading.error)}
          </p>
          <ConversationItem content={answer.text || text} type="answer" />
        </>
      ) : reading ? (
        <>
          <ConversationItem content={reading.guide} type="answer" />
          <div className="box-assistant-actions">
            <button
              disabled={!reading.annotations.some((item) => item.valid)}
              onClick={() =>
                act(() => {
                  cleanup.current?.()
                  if (marked) {
                    cleanup.current = null
                    setMarked(false)
                  } else {
                    cleanup.current = showAnnotations(
                      run.snapshot,
                      reading.annotations.filter((item) => item.valid),
                      resultId || run.id,
                    )
                    setMarked(true)
                  }
                })
              }
            >
              {t(marked ? 'Clear marks' : 'Show on page')}
            </button>
          </div>
          <ol className="box-assistant-annotations">
            {reading.annotations.map((item, index) => (
              <li key={index}>
                <blockquote>{item.quote}</blockquote>
                <p>{item.reason}</p>
                {item.valid ? (
                  <button onClick={() => act(() => revealAnnotation(run.snapshot, item))}>
                    {t('View source')}
                  </button>
                ) : (
                  <small className="box-assistant-error">{t(item.error)}</small>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <ConversationItem content={text} type="answer" />
      )}
    </div>
  )
}
AssistantResult.propTypes = {
  run: PropTypes.object.isRequired,
  text: PropTypes.string.isRequired,
  resultId: PropTypes.string,
}
