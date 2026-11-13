import { createEngineRuntime } from '../../src/engines/runtime.mjs'
import { createEngineStore } from '../../src/engines/store.mjs'
import { createNativeEngineAdapters } from '../../src/engines/adapters.mjs'
import { createCompletionCompatibility } from '../../src/engines/compat-completions.mjs'
import { forwardEngineBridgeFrame, engineBridgeFailure } from '../../src/engines/bridge-client.mjs'
import { ENGINE_BRIDGE_PROTOCOL } from '../../src/engines/contract.mjs'

// Controlled native provider with the production adapter/runtime/bridge path.
// Tests feed the actual native client's packets; no provider account is used.
export async function createProviderBridgeFixture({
  model = 'gpt-6-thinking',
  engineId = 'chatgptweb',
  images = [],
  projectId,
  contractVersion = 1,
  config: patch = {},
} = {}) {
  let session, receive, release
  const wire = [],
    data = {}
  const config = {
    apiServerEnabled: true,
    apiServerKeepHistory: true,
    chatgptWebEnabled: true,
    grokWebEnabled: true,
    geminiWebEnabled: true,
    ...patch,
  }
  const provider = {
    run: async (context) => {
      session = context.session
      await new Promise((resolve) => {
        release = resolve
        receive = (packet) => {
          context.port.postMessage(packet)
          if (packet.error || packet.done) resolve()
        }
      })
    },
  }
  const adapters = createNativeEngineAdapters({ providers: { [engineId]: provider } })
  const service = createEngineRuntime({
    adapters,
    store: createEngineStore({
      storage: {
        get: async (key) => ({ [key]: data[key] }),
        set: async (value) => Object.assign(data, structuredClone(value)),
      },
    }),
    getConfig: async () => structuredClone(config),
    setConfig: async (value) => Object.assign(config, value),
  })
  const completion = createCompletionCompatibility({
    service,
    adapters,
    getConfig: async () => config,
  })
  const frame = {
    type: 'request',
    id: 'request-1',
    command: {
      protocol: ENGINE_BRIDGE_PROTOCOL,
      method: 'compat.completion',
      runId: 'user-1',
      installationId: await service.installation(),
      payload: {
        model,
        messages: [{ role: 'user', content: 'hello' }],
        images,
        projectId,
        contractVersion,
      },
    },
  }
  const done = forwardEngineBridgeFrame(frame, async ({ data: command }) => {
    return {
      ok: true,
      value: await completion(command.payload, { kind: 'api', principal: 'gateway-api' }, command),
    }
  }).then(
    (value) => wire.push({ type: 'done', id: frame.id, ...value }),
    (error) => wire.push(engineBridgeFailure(frame, error)),
  )
  for (let i = 0; i < 100 && !session && !wire.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 1))
  if (!session) throw new Error(`Provider fixture did not start: ${JSON.stringify(wire)}`)
  return { session, wire, receive, done, service, adapters, release }
}
