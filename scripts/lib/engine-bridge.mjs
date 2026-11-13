import { ENGINE_BRIDGE_PROTOCOL, EngineError } from '../../src/engines/contract.mjs'
import { legacyControlForAction } from '../../src/engines/legacy-protocol.mjs'

export function buildEngineBridgeFrame(message, identity) {
  if (identity?.engineProtocol !== ENGINE_BRIDGE_PROTOCOL || !identity.installationId)
    throw new EngineError(
      'ENGINE_NOT_READY',
      'Update and reconnect the extension bridge before dispatching engine operations.',
    )
  const role = message.callerRole || 'api'
  let command
  if (message.type === 'request') {
    const { model, messages, thinkingEffort, images, projectId, contractVersion } = message
    command = {
      method: 'compat.completion',
      payload: { model, messages, thinkingEffort, images, projectId, contractVersion },
    }
  } else if (message.action === 'engine.request') command = message.payload
  else {
    const legacy = legacyControlForAction(message.action)
    if (!legacy)
      throw new EngineError('OPERATION_NOT_IMPLEMENTED', 'Unknown compatibility interface.')
    command = {
      method: 'compat.control',
      payload: { type: legacy.message, data: message.payload || {} },
    }
  }
  const installationId = command.installationId || message.installationId || identity.installationId
  if (installationId !== identity.installationId)
    throw new EngineError(
      'CONTEXT_UNAVAILABLE',
      'The original extension installation is no longer connected.',
    )
  return {
    type: message.type,
    id: message.id,
    command: {
      ...command,
      protocol: ENGINE_BRIDGE_PROTOCOL,
      role,
      runId: command.runId || message.operationId || message.payload?.operationId || message.id,
      installationId,
    },
  }
}
