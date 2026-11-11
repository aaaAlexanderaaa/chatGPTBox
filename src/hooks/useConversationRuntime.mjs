// Conversation runtime state machine.
//
// Extracted from ConversationCard/index.jsx (architecture plan step 4). Owns
// the conversation state that is independent of rendering: the running session,
// the rendered Q/A/error items, the answer-ready gate, and the inbound-message
// → state reducer. It deliberately contains NO browser transport — the
// component passes a `send` function (port.postMessage / Bing foreground fake
// port) which the retry path calls. This keeps the state machine unit-testable
// without a browser.
//
// The pure reducer logic (applyInbound / updateLastAnswer / popMatchedRetryRecord
// / formatErrorMessage) lives in ./conversation-runtime-reducers.mjs and is
// tested directly; this hook wraps it in React state.

import { useCallback, useRef, useState } from 'react'
import {
  applyInbound,
  formatErrorMessage,
  popMatchedRetryRecord,
  updateLastAnswer,
} from './conversation-runtime-reducers.mjs'
import { ConversationItemData } from '../components/ConversationCard/conversation-item.mjs'

// Re-exported so callers can import everything from the hook entry point.
export { formatErrorMessage }

/**
 * Conversation runtime hook.
 *
 * @param {object} opts
 * @param {object} opts.initialSession     Initial session object.
 * @param {(key: string) => string} opts.t i18next translate fn.
 * @param {boolean} [opts.hasInitialQuestion] Whether an initial question is pending.
 */
export function useConversationRuntime({ initialSession, t, hasInitialQuestion = false }) {
  const [state, setState] = useState({
    session: initialSession,
    isReady: !hasInitialQuestion,
    items: [],
  })
  const { items } = state
  const setSession = useCallback(
    (update) =>
      setState((previous) => {
        const session = typeof update === 'function' ? update(previous.session) : update
        return session === previous.session ? previous : { ...previous, session }
      }),
    [],
  )
  const setIsReady = useCallback(
    (update) =>
      setState((previous) => {
        const isReady = typeof update === 'function' ? update(previous.isReady) : update
        return isReady === previous.isReady ? previous : { ...previous, isReady }
      }),
    [],
  )
  const setItems = useCallback(
    (update) =>
      setState((previous) => {
        const next = typeof update === 'function' ? update(previous.items) : update
        return next === previous.items ? previous : { ...previous, items: next }
      }),
    [],
  )
  // Mirror of `items` for use inside async callbacks that shouldn't capture
  // stale item state. Updated on every render so the inbound-message / retry
  // reducers always read the latest committed items (mirrors the original
  // useEffect in ConversationCard that ran after every render).
  const itemsRef = useRef(items)
  itemsRef.current = items

  /**
   * Replace or append-to the last answer/error item.
   * @param {string} value
   * @param {boolean} appended  If true, concatenate to existing content.
   * @param {'answer'|'error'} newType
   * @param {boolean} done
   */
  const updateAnswer = useCallback(
    (value, appended, newType, done = false) => {
      setItems((old) => updateLastAnswer(old, value, appended, newType, done))
    },
    [setItems],
  )

  // Seed the item list from a session's persisted records (used on mount and
  // when switching sessions).
  const hydrateFromSession = useCallback(
    (nextSession, loadingPlaceholder) => {
      if (!nextSession.conversationRecords || nextSession.conversationRecords.length === 0) {
        setItems(
          loadingPlaceholder
            ? [new ConversationItemData('answer', loadingPlaceholder, false, true)]
            : [],
        )
        return
      }
      const ret = []
      for (const record of nextSession.conversationRecords) {
        ret.push(new ConversationItemData('question', record.question, true))
        ret.push(new ConversationItemData('answer', record.answer, true))
      }
      setItems(ret)
    },
    [setItems],
  )

  /**
   * Apply an inbound port message to the runtime state. Returns void; the
   * state updates happen via the setters. Delegates to the pure applyInbound
   * reducer so the same logic is unit-tested without React.
   */
  const dispatchInbound = useCallback(
    (msg) => {
      setState((previous) => applyInbound(previous, msg, t))
    },
    [t],
  )

  /**
   * Build a retry function for the given session. The caller supplies `send`,
   * the transport function ({session, stop} => Promise), so the state machine
   * stays transport-agnostic. The retry:
   *   1. shows the loading placeholder
   *   2. identifies the completed exchange without removing durable history
   *   3. re-sends with a replacement target committed only by a successful producer
   */
  const buildRetry = useCallback(
    (retrySession, send) => async () => {
      const prepared = {
        ...retrySession,
        conversationRecords: [...(retrySession.conversationRecords || [])],
      }
      const originalRecords = [...prepared.conversationRecords]
      const target = originalRecords.at(-1)
      popMatchedRetryRecord(prepared, itemsRef.current)
      const retryReplacement =
        prepared.conversationRecords.length < originalRecords.length
          ? {
              index: originalRecords.length - 1,
              question: target.question,
              answer: target.answer,
            }
          : retrySession.retryReplacement || null
      const newSession = {
        ...retrySession,
        conversationRecords: originalRecords,
        isRetry: true,
        appendRetryRecord: true,
        retryReplacement,
      }
      updateAnswer(`<p class="gpt-loading">${t('Waiting for response...')}</p>`, false, 'answer')
      setIsReady(false)
      setSession(newSession)
      try {
        await send({ stop: true })
        return await send({ session: newSession })
      } catch (e) {
        dispatchInbound({ error: e.message || String(e) })
        return false
      }
    },
    [t, updateAnswer, dispatchInbound, setIsReady, setSession],
  )

  return {
    state,
    setSession,
    itemsRef,
    actions: {
      updateAnswer,
      hydrateFromSession,
      dispatchInbound,
      buildRetry,
      setIsReady,
      setItems,
    },
  }
}
