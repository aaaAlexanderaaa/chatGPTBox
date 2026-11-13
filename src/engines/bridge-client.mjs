import { ENGINE_BRIDGE_PROTOCOL, EngineError, serializeEngineError } from './contract.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'

// Transport projection only. This code has no provider, model or finality rules.
export async function forwardEngineBridgeFrame(frame, sendMessage) {
  const command = frame?.command
  if (!command || command.protocol !== ENGINE_BRIDGE_PROTOCOL)
    throw new EngineError(
      'INVALID_REQUEST',
      'Update the gateway and extension together: incompatible engine bridge protocol.',
    )
  const reply = await sendMessage({ type: RuntimeMessage.EngineBridgeRequest, data: command })
  if (!reply)
    throw new EngineError(
      'RESULT_UNCERTAIN',
      'The background runtime disconnected; inspect the original run before starting another request.',
      { runId: command.runId, submission: 'possibly_submitted' },
    )
  if (!reply.ok)
    throw Object.assign(new Error(reply.error?.message || 'Engine operation failed.'), reply.error)
  return reply.value
}

export function engineBridgeFailure(frame, error) {
  const engineError = serializeEngineError(error)
  return {
    type: frame.type === 'request' ? 'error' : 'control_error',
    id: frame.id,
    error: engineError.message,
    engineError,
    ...(engineError.submission === 'not_attempted' ? { dispatched: false } : {}),
  }
}

// Short status messages keep observation independent of one long MV3 callback.
export async function observeEngineBridgeRun(
  frame,
  receipt,
  sendMessage,
  {
    timeoutMs = 7200000,
    pollMs = 2000,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {},
) {
  const deadline = now() + timeoutMs
  let run = receipt
  while (now() < deadline) {
    if (run.phase === 'settled') {
      if (run.outcome === 'completed' && run.result?.content?.trim())
        return { answer: run.result.content, format: run.result.format, runId: run.runId }
      throw new EngineError(
        run.error?.code ||
          (run.outcome === 'completed' ? 'RESULT_UNAVAILABLE' : 'RESULT_UNCERTAIN'),
        run.error?.message || 'The engine ended without an available verified final result.',
        { runId: run.runId, submission: run.submission },
      )
    }
    await delay(pollMs)
    run = await forwardEngineBridgeFrame(
      {
        ...frame,
        command: { ...frame.command, method: 'runs.read', payload: { runId: receipt.runId } },
      },
      sendMessage,
    )
  }
  throw new EngineError(
    'RESULT_UNCERTAIN',
    'Observation timed out; read the same run to continue.',
    { runId: receipt.runId, submission: 'possibly_submitted' },
  )
}
