import {
  EngineError,
  EngineMethod,
  serializeEngineError,
  validateEngineRequest,
} from '../../src/engines/contract.mjs'

export async function handleEngineHttp(req, res, url, { call, readBody, begin, ledger, replay }) {
  const engine = /^\/engines\/([^/]+)(?:\/(models|runs|conversations)(?:\/([^/]+))?)?$/.exec(
    url.pathname,
  )
  const run = /^\/runs\/([^/]+)(?:\/(recover|cancel))?$/.exec(url.pathname)
  if (url.pathname !== '/engines' && !engine && !run) return false
  const respond = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'x-should-retry': 'false' })
    res.end(JSON.stringify(value))
  }
  let operation
  try {
    let command
    if (url.pathname === '/engines' && req.method === 'GET') command = { method: EngineMethod.List }
    else if (run) {
      const runId = decodeURIComponent(run[1])
      if (req.method === 'GET' && !run[2])
        command = { method: EngineMethod.Read, payload: { runId } }
      else if (req.method === 'POST' && run[2])
        command = {
          method: run[2] === 'recover' ? EngineMethod.Recover : EngineMethod.Cancel,
          payload: { runId },
        }
    } else if (engine) {
      const engineId = decodeURIComponent(engine[1])
      if (engine[2] === 'models' && req.method === 'GET')
        command = {
          method: EngineMethod.Models,
          payload: { engineId, query: { refresh: url.searchParams.get('refresh') === 'true' } },
        }
      else if (engine[2] === 'conversations' && req.method === 'GET')
        command = {
          method: engine[3] ? EngineMethod.ReadConversation : EngineMethod.ListConversations,
          payload: {
            engineId,
            query: {
              ...Object.fromEntries(url.searchParams),
              ...(engine[3] ? { ref: decodeURIComponent(engine[3]) } : {}),
              publicProfile: true,
            },
          },
        }
      else if (engine[2] === 'runs' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req))
        if (body.engineId !== undefined && body.engineId !== engineId)
          throw new EngineError('INVALID_REQUEST', 'Path and body engine IDs must match.')
        const request = validateEngineRequest({ ...body, engineId })
        const started = begin(req, `/${req.engineCallerRole || 'api'}${url.pathname}`, request, {
          requireIdempotencyKey: true,
        })
        if (started.kind !== 'new') {
          replay(res, started)
          return true
        }
        operation = started.record
        res.setHeader('X-Operation-Id', operation.operationId)
        command = {
          method: EngineMethod.Invoke,
          payload: request,
          runId: operation.operationId,
          ...(operation.installationId ? { installationId: operation.installationId } : {}),
        }
      }
    }
    if (!command) {
      respond(405, {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Unsupported engine method.',
          submission: 'not_attempted',
        },
      })
      return true
    }
    const value = await call(command, req.engineCallerRole || 'api', operation)
    if (operation) ledger.complete(operation, value)
    respond(operation ? 202 : 200, value)
  } catch (error) {
    if (operation) {
      if (error.dispatched === false || error.submission === 'not_attempted')
        ledger.abort(operation)
      else ledger.ambiguous(operation, error)
    }
    const serialized = serializeEngineError(
      error instanceof SyntaxError || error instanceof URIError
        ? new EngineError('INVALID_REQUEST', 'Invalid JSON or path encoding.')
        : error,
    )
    respond(serialized.status || 500, {
      error: serialized,
      ...(operation ? { runId: operation.operationId } : {}),
    })
  }
  return true
}
