export function parseChatgptConversationReference(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error('Enter a conversation ID or ChatGPT conversation link')
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text)
    if (!['chatgpt.com', 'chat.openai.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('Use a ChatGPT conversation link containing /c/')
    }
    const match = url.pathname.match(/\/c\/([^/]+)\/?$/)
    if (!match) throw new Error('Use a ChatGPT conversation link containing /c/')
    return decodeURIComponent(match[1])
  }
  if (/[\s/?#]/.test(text)) throw new Error('Enter a conversation ID or ChatGPT conversation link')
  return text
}

export function buildConversationExportFilename(conversation, extension) {
  const title =
    String(conversation?.title || 'conversation')
      // File names cannot contain control characters or path delimiters.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .trim()
      .slice(0, 80) || 'conversation'
  const id = String(conversation?.conversationId || '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 8)
  return `chatgptbox-${title}${id ? `-${id}` : ''}.${extension}`
}

export function conversationToMarkdown(conversation) {
  const title = conversation?.title || 'Untitled'
  const lines = [`# ${title}`, '']
  if (conversation?.conversationId) lines.push(`- ID: \`${conversation.conversationId}\``)
  if (conversation?.defaultModel) lines.push(`- Model: ${conversation.defaultModel}`)
  if (conversation?.createTime) lines.push(`- Created: ${conversation.createTime}`)
  if (conversation?.updateTime) lines.push(`- Updated: ${conversation.updateTime}`)
  lines.push('')
  if (conversation?.history?.scope === 'current_branch') {
    lines.push('_This backup contains the current conversation branch._', '')
  }
  if (conversation?.history?.complete === false) {
    lines.push('_History is incomplete: earlier messages have not been downloaded._', '')
  }
  if (conversation?.missingSnapshot) {
    lines.push('_This conversation is in the list index but has no cached body._')
    return `${lines.join('\n')}\n`
  }
  for (const message of conversation?.messages || []) {
    const heading = message.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${heading}`)
    if (message.thoughtDurationLabel) lines.push(`_${message.thoughtDurationLabel}_`)
    lines.push('', message.text || '', '')
  }
  return `${lines.join('\n').trim()}\n`
}
