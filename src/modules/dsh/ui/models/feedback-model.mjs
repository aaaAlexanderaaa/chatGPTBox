const FEEDBACK_SUBMIT = new Set(['feedback.submit', '/feedback.submit'])

function entryMatches(entry) {
  if (typeof entry === 'string') return FEEDBACK_SUBMIT.has(entry)
  if (!entry || typeof entry !== 'object') return false
  return (
    FEEDBACK_SUBMIT.has(entry.name) ||
    FEEDBACK_SUBMIT.has(entry.line) ||
    FEEDBACK_SUBMIT.has(entry.id)
  )
}

/** True when command.list-shaped rows include feedback.submit. */
export function feedbackSubmitListed(commands) {
  if (!Array.isArray(commands)) return false
  return commands.some(entryMatches)
}
