export const getChatSystemPromptBase = async () => {
  return `You are a helpful, creative, clever, and very friendly assistant. You are familiar with various languages in the world.`
}

export const getCompletionPromptBase = async () => {
  return (
    `The following is a conversation with an AI assistant.` +
    `The assistant is helpful, creative, clever, and very friendly. The assistant is familiar with various languages in the world.\n\n` +
    `Human: Hello, who are you?\n` +
    `AI: I am an AI assistant. How can I help you today?\n`
  )
}

export const getCustomApiPromptBase = async () => {
  return `I am a helpful, creative, clever, and very friendly assistant. I am familiar with various languages in the world.`
}

export function setAbortController(port, onStop, onDisconnect) {
  const controller = new AbortController()
  const messageListener = (msg) => {
    if (msg.stop) {
      port.onMessage.removeListener(messageListener)
      console.debug('stop generating')
      port.postMessage({ done: true, outcome: 'stopped' })
      controller.abort()
      if (onStop) onStop()
    }
  }
  port.onMessage.addListener(messageListener)

  const disconnectListener = () => {
    port.onDisconnect.removeListener(disconnectListener)
    console.debug('port disconnected')
    controller.abort()
    if (onDisconnect) onDisconnect()
  }
  port.onDisconnect.addListener(disconnectListener)

  const cleanController = () => {
    try {
      port.onMessage.removeListener(messageListener)
      port.onDisconnect.removeListener(disconnectListener)
    } catch (e) {
      // ignore
    }
  }

  return { controller, cleanController, messageListener, disconnectListener }
}

function retryReplacementIndex(session, question = session.question) {
  const records = session.conversationRecords || []
  const target = session.retryReplacement
  const index = target?.index
  if (
    session.isRetry &&
    session.appendRetryRecord === true &&
    Number.isInteger(index) &&
    index >= 0 &&
    index === records.length - 1 &&
    target.question === question &&
    records[index]?.question === target.question &&
    records[index]?.answer === target.answer
  )
    return index
  return -1
}

// Provider context may omit the answer being regenerated. Durable history
// keeps it until a successful producer calls pushRecord with its replacement.
export function getRequestConversationRecords(session) {
  const records = session.conversationRecords || []
  return retryReplacementIndex(session) >= 0 ? records.slice(0, -1) : records
}

export function pushRecord(session, question, answer) {
  const recordLength = session.conversationRecords.length
  let lastRecord
  if (recordLength > 0) lastRecord = session.conversationRecords[recordLength - 1]

  const replacementIndex = retryReplacementIndex(session, question)
  if (replacementIndex >= 0) {
    session.conversationRecords[replacementIndex] = { question, answer }
  } else if (
    session.isRetry &&
    !session.appendRetryRecord &&
    lastRecord &&
    lastRecord.question === question
  )
    lastRecord.answer = answer
  else session.conversationRecords.push({ question: question, answer: answer })
  delete session.retryReplacement
}

// Transport closure and a usable final answer are separate facts.
export function completionOutcome(reason) {
  return reason === 'stop' || reason === 'end_turn' || reason === 'stop_sequence'
    ? 'completed'
    : 'incomplete'
}
