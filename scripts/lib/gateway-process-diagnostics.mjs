/* eslint-env node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Lifecycle events and bounded stack frames, with the exception message removed.
export function installGatewayProcessDiagnostics({
  directory,
  tokens = [],
  maxBytes = 1024 * 1024,
}) {
  const file = path.join(directory, 'gateway-process.log')
  const startedAt = Date.now()
  let warned = false
  const redact = (value) => {
    let text = String(value)
    for (const token of tokens) if (token) text = text.replaceAll(token, '[redacted]')
    return text
  }
  const writeConsole = (fd, line) => {
    try {
      fs.writeSync(fd, line)
    } catch {
      // A closed terminal/pipe must not make diagnostics a new fatal error.
    }
  }
  function record(event, fields = {}) {
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      event,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      ...fields,
    })}\n`
    writeConsole(1, line)
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      let size = 0
      try {
        size = fs.statSync(file).size
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (size + Buffer.byteLength(line) > maxBytes) {
        fs.rmSync(`${file}.1`, { force: true })
        fs.renameSync(file, `${file}.1`)
        fs.chmodSync(`${file}.1`, 0o600)
      }
      const fd = fs.openSync(file, 'a', 0o600)
      try {
        fs.fchmodSync(fd, 0o600)
        fs.writeSync(fd, line)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      if (!warned) {
        warned = true
        writeConsole(2, 'Gateway process log unavailable; lifecycle events use stdout only.\n')
      }
    }
  }

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    // Strip the whole message (including embedded newlines) before selecting
    // stack frames. Node still prints its original fatal diagnostic to stderr.
    let frames = []
    let name = 'Error'
    let code
    try {
      name = /^(?:Error|[A-Za-z]+Error)$/.test(error?.name) ? error.name : 'Error'
      code = /^(?:E[A-Z]+|ERR_[A-Z_]+)$/.test(error?.code) ? error.code : undefined
      const prefix = `${error.name}: ${error.message}`
      if (typeof error.stack === 'string' && error.stack.startsWith(prefix)) {
        frames = error.stack
          .slice(prefix.length)
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 8)
          .map((line) => redact(line.trim()).slice(0, 400))
      }
    } catch {
      // Exception metadata can itself be malformed; monitoring must not throw.
    }
    record('fatal', { origin, name: redact(name), code: code && redact(code), frames })
  })
  process.on('exit', (code) => record('exit', { code }))
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      record('signal', { signal })
      // The once listener has been removed, restoring Node's default action.
      // Re-raise instead of swallowing the signal or reporting a successful exit.
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exit(128 + os.constants.signals[signal])
      }
    })
  }
  record('starting', { node: process.version })
  return { file, listening: () => record('listening') }
}
