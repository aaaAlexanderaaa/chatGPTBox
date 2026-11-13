import { ENGINE_BRIDGE_PROTOCOL } from '../../src/engines/contract.mjs'
import { legacyControlForMessage } from '../../src/engines/legacy-protocol.mjs'

export async function announceEngineBridge(bridge) {
  bridge.send(
    JSON.stringify({
      type: 'bridge_config',
      engineProtocol: ENGINE_BRIDGE_PROTOCOL,
      installationId: 'fixture-installation',
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
}
// Existing legacy HTTP assertions keep their payload vocabulary while their
// mock extension consumes the same versioned protocol as the real bridge.
export function decodeCompatibilityFrame(frame) {
  if (!frame.command) return frame
  if (frame.command.protocol !== ENGINE_BRIDGE_PROTOCOL)
    throw new Error('Unexpected bridge protocol')
  if (frame.command.method === 'compat.completion') return { ...frame, ...frame.command.payload }
  if (frame.command.method === 'compat.control') {
    const control = legacyControlForMessage(frame.command.payload.type)
    if (!control) throw new Error('Unknown compatibility message')
    return { ...frame, action: control.action, payload: frame.command.payload.data }
  }
  return frame
}
