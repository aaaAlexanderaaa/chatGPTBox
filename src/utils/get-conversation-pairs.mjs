export function getConversationPairs(records, isCompletion, options = {}) {
  const systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt.trim() : ''
  let pairs
  if (isCompletion) {
    pairs = ''
    if (systemPrompt) pairs += 'System: ' + systemPrompt + '\n'
    for (const record of records) {
      pairs += 'Human: ' + record.question + '\nAI: ' + record.answer + '\n'
    }
  } else {
    pairs = []
    if (systemPrompt) pairs.push({ role: 'system', content: systemPrompt })
    for (const record of records) {
      pairs.push({ role: 'user', content: record['question'] })
      pairs.push({ role: 'assistant', content: record['answer'] })
    }
  }

  return pairs
}
