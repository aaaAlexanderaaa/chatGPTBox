// Only this historical error is known to precede opening the page transport.
// Delta parsing failures, lost acknowledgements and timeouts may follow a POST.
const LEGACY_RUNTIME_ERROR =
  'The loaded ChatGPT page runtime is not supported. Refresh the proxy tab and check for a ChatGPTBox protocol update.'

export function isLegacyChatgptNotDispatchedOperation(record) {
  return (
    record?.state === 'ambiguous' &&
    typeof record.error === 'string' &&
    record.error.replace(/^Uncaught Error: /, '') === LEGACY_RUNTIME_ERROR
  )
}

export function respondChatgptNotDispatched(res, ledger, operation, result) {
  if (result?.dispatched !== false) return false
  ledger.abort(operation)
  res.writeHead(503, { 'Content-Type': 'application/json', 'x-should-retry': 'false' })
  res.end(
    JSON.stringify({
      error: {
        message: result.error || 'ChatGPT Web verification failed before sending the question.',
        code: result.code || 'chatgpt_not_dispatched',
        type: 'server_error',
        dispatched: false,
        retryable: false,
      },
    }),
  )
  return true
}
