// Follow the website's conversation/messages pagination. Cached snapshots keep
// the native messages and page_info fields; no separate chunk format is needed.
export const CHATGPT_WEB_CONVERSATION_PAGE_TURNS = 10

export function getChatgptWebConversationHistoryInfo(conversation = {}) {
  const paginated = Array.isArray(conversation?.messages)
  return {
    complete: paginated
      ? conversation.page_info?.has_previous_page === false
      : conversation?.page_info?.has_previous_page !== true,
    scope: paginated ? 'current_branch' : 'conversation_tree',
    nextCursor:
      conversation?.page_info?.has_previous_page === true
        ? conversation.page_info.start_cursor || null
        : null,
    loadedMessageCount: paginated
      ? conversation.messages.length
      : Object.values(conversation?.mapping || {}).filter((node) => node?.message).length,
  }
}

function validatePage(page, conversationId) {
  if (!Array.isArray(page?.messages) || typeof page?.page_info?.has_previous_page !== 'boolean') {
    throw new Error('ChatGPT conversation page is missing messages or page_info.')
  }
  if (page.conversation_id && page.conversation_id !== conversationId) {
    throw new Error('ChatGPT conversation page belongs to a different conversation.')
  }
  const ids = new Set()
  for (const message of page.messages) {
    if (
      typeof message?.id !== 'string' ||
      !message.id ||
      ids.has(message.id) ||
      message.id === `paginated-root:${conversationId}`
    ) {
      throw new Error('ChatGPT conversation page contains a missing or duplicate message ID.')
    }
    ids.add(message.id)
  }
  if (
    page.page_info.has_previous_page &&
    (typeof page.page_info.start_cursor !== 'string' || !page.page_info.start_cursor)
  ) {
    throw new Error('ChatGPT conversation page is missing its previous-page cursor.')
  }
}

function prependConversationPage(snapshot, page) {
  const existingIds = new Set(snapshot.messages.map((message) => message.id))
  const incomingMessages = new Map(page.messages.map((message) => [message.id, message]))
  return {
    ...snapshot,
    messages: [
      ...page.messages.filter((message) => !existingIds.has(message.id)),
      ...snapshot.messages.map((message) => incomingMessages.get(message.id) || message),
    ],
    page_info: {
      ...snapshot.page_info,
      has_previous_page: page.page_info.has_previous_page,
      start_cursor: page.page_info.start_cursor,
    },
    safe_urls: [...new Set([...(snapshot.safe_urls || []), ...(page.safe_urls || [])])],
    blocked_urls: [...new Set([...(snapshot.blocked_urls || []), ...(page.blocked_urls || [])])],
  }
}

export async function loadChatgptWebConversationPages({
  conversationId,
  includeMessageId,
  fetchPage,
  snapshot = null,
  onSnapshot = async () => {},
  shouldAbort,
  restartOnInvalidCursor = true,
}) {
  const path = `/backend-api/conversations/${encodeURIComponent(conversationId)}`
  const query = {
    num_turns: String(CHATGPT_WEB_CONVERSATION_PAGE_TURNS),
    include_has_versions: 'true',
  }
  const throwIfAborted = async () => {
    if (shouldAbort && (await shouldAbort())) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
  }
  await throwIfAborted()
  if (!snapshot) {
    try {
      snapshot = await fetchPage(
        `${path}?${new URLSearchParams({
          ...query,
          ...(includeMessageId ? { include_message_id: includeMessageId } : {}),
        })}`,
      )
    } catch (error) {
      // Older/custom endpoints may only implement the singular full-tree API.
      // Never fall back after a 502, timeout, auth failure, or a later-page error.
      if (![404, 405].includes(error?.status) || error?.code === 'conversation_not_found')
        throw error
      snapshot = await fetchPage(`/backend-api/conversation/${encodeURIComponent(conversationId)}`)
    }
    if (snapshot?.mapping && !Array.isArray(snapshot.messages)) {
      await onSnapshot(snapshot)
      return snapshot
    }
    snapshot = { ...snapshot, conversation_id: snapshot?.conversation_id || conversationId }
    validatePage(snapshot, conversationId)
    await onSnapshot(snapshot)
  } else {
    validatePage(snapshot, conversationId)
  }

  const cursors = new Set()
  while (snapshot.page_info.has_previous_page) {
    await throwIfAborted()
    const cursor = snapshot.page_info.start_cursor
    if (cursors.has(cursor)) throw new Error('ChatGPT conversation cursor did not advance.')
    cursors.add(cursor)
    let page
    try {
      page = await fetchPage(
        `${path}/messages?${new URLSearchParams({ before: cursor, ...query })}`,
      )
    } catch (error) {
      // The website restarts from the newest page when the server expires a
      // cursor. Permit one restart, with the same native loading sequence.
      if (
        restartOnInvalidCursor &&
        error?.status === 400 &&
        (error.code === 'invalid_cursor' || error.message === 'invalid_cursor')
      ) {
        return await loadChatgptWebConversationPages({
          conversationId,
          includeMessageId,
          fetchPage,
          onSnapshot,
          shouldAbort,
          restartOnInvalidCursor: false,
        })
      }
      throw error
    }
    validatePage(page, conversationId)
    if (page.page_info.has_previous_page && cursors.has(page.page_info.start_cursor)) {
      throw new Error('ChatGPT conversation cursor did not advance.')
    }
    snapshot = prependConversationPage(snapshot, page)
    await onSnapshot(snapshot)
  }
  return snapshot
}
