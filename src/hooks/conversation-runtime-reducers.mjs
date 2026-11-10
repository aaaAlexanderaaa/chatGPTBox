// Pure state-reducer helpers for the conversation runtime.
//
// These functions are extracted from useConversationRuntime so the core
// state-machine logic — answer streaming, error mapping, retry record-popping
// — is unit-testable without a React component tree or a DOM. The hook calls
// into them; they hold no React state and produce no side effects beyond the
// values they return.

import { findLastIndex } from 'lodash-es'
// Import isSafari directly from its leaf module rather than the utils barrel,
// so this pure-reducer file doesn't pull the full config/models graph into
// every test that exercises it.
import { isSafari } from '../utils/is-safari.mjs'
import { ConversationItemData } from '../components/ConversationCard/conversation-item.mjs'

// Map a raw upstream error code/string to the localized HTML the user sees.
export function formatErrorMessage(error, t) {
  switch (error) {
    case 'UNAUTHORIZED':
      return (
        `${t('UNAUTHORIZED')}<br>${t('Please login at https://chatgpt.com first')}${
          isSafari() ? `<br>${t('Then open https://chatgpt.com/api/auth/session')}` : ''
        }<br>${t('And refresh this page or type you question again')}` +
        `<br><br>${t(
          'Consider creating an api key at https://platform.openai.com/account/api-keys',
        )}`
      )
    case 'CLOUDFLARE':
      return (
        `${t('OpenAI Security Check Required')}<br>${
          isSafari()
            ? t('Please open https://chatgpt.com/api/auth/session')
            : t('Please open https://chatgpt.com')
        }<br>${t('And refresh this page or type you question again')}` +
        `<br><br>${t(
          'Consider creating an api key at https://platform.openai.com/account/api-keys',
        )}`
      )
    default: {
      let formattedError = error
      if (typeof error === 'string' && error.trimStart().startsWith('{')) {
        try {
          formattedError = JSON.stringify(JSON.parse(error), null, 2)
        } catch {
          /* keep raw */
        }
      }
      return t(formattedError)
    }
  }
}

/**
 * Replace (or append to) the last answer/error item in `items`. Returns a new
 * array; returns the input array unchanged if there is no answer/error item to
 * update.
 *
 * @param {ConversationItemData[]} items
 * @param {string} value
 * @param {boolean} appended  If true, concatenate to the existing content.
 * @param {'answer'|'error'} newType
 * @param {boolean} done
 * @returns {ConversationItemData[]}
 */
export function updateLastAnswer(items, value, appended, newType, done = false) {
  const index = findLastIndex(items, (v) => v.type === 'answer' || v.type === 'error')
  if (index === -1) return items
  const copy = [...items]
  copy[index] = Object.assign(
    new ConversationItemData(newType, appended ? copy[index].content + value : value),
    { ...copy[index], type: newType, content: appended ? copy[index].content + value : value },
  )
  if (items[index].done && !done) {
    delete copy[index].outcome
    delete copy[index].finalContent
  }
  copy[index].done = done
  return copy
}

/**
 * Apply an inbound port message to the conversation state and return the
 * resulting { items, session, isReady } snapshot. Pure: the caller owns the
 * state machine and re-feeds the returned snapshot on the next message.
 *
 * @param {object} prev        { items, session, isReady }
 * @param {object} msg         { answer?, session?, done?, error? }
 * @param {(k: string) => string} t
 * @returns {{ items: ConversationItemData[], session: object, isReady: boolean }}
 */
export function applyInbound(prev, msg, t) {
  let items = prev.items
  let session = prev.session
  let isReady = prev.isReady
  if (msg.preparing === true || msg.started === true) {
    const index = findLastIndex(items, (v) => v.type === 'answer' || v.type === 'error')
    if (index >= 0) {
      items = [...items]
      const item = { ...items[index], done: false }
      if (msg.preparing === true) {
        item.type = 'answer'
        item.content = `<p class="gpt-loading">${t('Waiting for response...')}</p>`
      }
      delete item.outcome
      delete item.finalContent
      items[index] = item
    }
    isReady = false
  }
  const previousIndex = findLastIndex(items, (v) => v.type === 'answer' || v.type === 'error')
  const previousItem = items[previousIndex]
  if (previousItem?.done) return prev

  // Only an explicit new send/retry resets a terminal state.
  // A late terminal frame may contain answer text as well as done.
  if (typeof msg.answer === 'string') {
    items = updateLastAnswer(items, msg.answer, false, 'answer')
  }
  if (msg.session) {
    session = msg.done ? { ...msg.session, isRetry: false } : msg.session
  }
  if (msg.done || Object.hasOwn(msg, 'finalContent')) {
    const index = findLastIndex(items, (v) => v.type === 'answer' || v.type === 'error')
    if (index >= 0) {
      items = [...items]
      const item = { ...items[index] }
      if (Object.hasOwn(msg, 'finalContent')) item.finalContent = msg.finalContent
      if (msg.done) {
        item.done = true
        // A trailing transport ack cannot turn failure/Stop into success.
        if (!item.outcome || item.outcome === 'completed')
          item.outcome = item.type === 'error' ? 'failed' : msg.outcome || 'completed'
      }
      items[index] = item
    }
    if (msg.done) isReady = true
  }
  if (msg.error) {
    const formatted = formatErrorMessage(msg.error, t)
    const answerIndex = findLastIndex(items, (item) => item.type === 'answer')
    if (answerIndex >= 0) {
      items = [...items]
      items[answerIndex] = { ...items[answerIndex], done: true, outcome: 'failed' }
    }
    const lastItem = items.length > 0 ? items[items.length - 1] : null
    if (lastItem && (lastItem.content.includes('gpt-loading') || lastItem.type === 'error')) {
      items = updateLastAnswer(items, formatted, false, 'error', true)
    } else {
      items = [...items, new ConversationItemData('error', formatted, true)]
    }
    items[items.length - 1] = { ...items[items.length - 1], outcome: 'failed' }
    isReady = true
  }

  return { items, session, isReady }
}

/**
 * Pop the last conversation record if the rendered items exactly mirror the
 * last Q/A exchange (so a retry doesn't duplicate it). Mutates and returns the
 * session's conversationRecords array.
 *
 * @param {object} session
 * @param {ConversationItemData[]} items
 * @returns {object[]} the (possibly shortened) conversationRecords
 */
export function popMatchedRetryRecord(session, items) {
  const records = session?.conversationRecords
  if (!records || records.length === 0) return records || []
  const lastRecord = records[records.length - 1]
  const lastItem = items[items.length - 1]
  const secondToLast = items[items.length - 2]
  if (
    lastItem?.type === 'answer' &&
    lastItem?.done &&
    (!lastItem.outcome || lastItem.outcome === 'completed') &&
    items.length > 1 &&
    secondToLast?.type === 'question' &&
    lastRecord.question === secondToLast.content &&
    (lastRecord.answer === lastItem.content ||
      (typeof lastItem.finalContent === 'string' && lastRecord.answer === lastItem.finalContent))
  ) {
    records.pop()
  }
  return records
}
