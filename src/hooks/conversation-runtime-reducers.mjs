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
  copy[index] = new ConversationItemData(newType, appended ? copy[index].content + value : value)
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

  if (msg.answer) {
    items = updateLastAnswer(items, msg.answer, false, 'answer')
  }
  if (msg.session) {
    session = msg.done ? { ...msg.session, isRetry: false } : msg.session
  }
  if (msg.done) {
    items = updateLastAnswer(items, '', true, 'answer', true)
    isReady = true
  }
  if (msg.error) {
    const formatted = formatErrorMessage(msg.error, t)
    const lastItem = items.length > 0 ? items[items.length - 1] : null
    if (lastItem && (lastItem.content.includes('gpt-loading') || lastItem.type === 'error')) {
      items = updateLastAnswer(items, formatted, false, 'error')
    } else {
      items = [...items, new ConversationItemData('error', formatted)]
    }
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
    lastItem?.done &&
    items.length > 1 &&
    secondToLast &&
    lastRecord.question === secondToLast.content
  ) {
    records.pop()
  }
  return records
}
