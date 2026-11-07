/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const moduleUrl = new URL('../scripts/lib/gateway-process-diagnostics.mjs', import.meta.url).href
const fixtures = []
const fakeSecret = 'diagnostic-private-test-token'

function run(code, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-process-log-'))
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    `import { installGatewayProcessDiagnostics } from ${JSON.stringify(moduleUrl)}
     import fs from 'node:fs'
     ${
       options.unwritable ? "fs.writeFileSync(process.argv[1] + '/blocked', 'not a directory')" : ''
     }
     const diagnostics = installGatewayProcessDiagnostics({
       directory: process.argv[1]${options.unwritable ? " + '/blocked'" : ''},
       tokens: [${JSON.stringify(fakeSecret)}], maxBytes: ${options.maxBytes || 1048576}
     })
     ${code}`,
    directory,
  ])
  const fixture = { child, directory, stdout: '', stderr: '' }
  fixtures.push(fixture)
  child.stdout.on('data', (chunk) => (fixture.stdout += String(chunk)))
  child.stderr.on('data', (chunk) => (fixture.stderr += String(chunk)))
  fixture.finished = once(child, 'close')
  return fixture
}

function records(fixture) {
  return fs
    .readFileSync(path.join(fixture.directory, 'gateway-process.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
      fixture.child.kill('SIGKILL')
      await fixture.finished
    }
    fs.rmSync(fixture.directory, { recursive: true, force: true })
  }
})

describe('gateway process diagnostics', () => {
  it.each([
    [
      'uncaughtException',
      `setImmediate(() => { throw new TypeError(${JSON.stringify(
        fakeSecret + '\n at forged (/sensitive:1:2)',
      )}) })`,
    ],
    ['unhandledRejection', `Promise.reject(new TypeError(${JSON.stringify(fakeSecret)}))`],
  ])('records %s while retaining Node fatal exit behavior', async (origin, code) => {
    const fixture = run(code)
    const [exitCode, signal] = await fixture.finished
    expect(exitCode).toBe(1)
    expect(signal).toBeNull()
    const events = records(fixture)
    expect(events).toEqual([
      expect.objectContaining({ event: 'starting', pid: fixture.child.pid }),
      expect.objectContaining({ event: 'fatal', origin, name: 'TypeError' }),
      expect.objectContaining({ event: 'exit', code: 1 }),
    ])
    expect(events[1].frames.length).toBeGreaterThan(0)
    const log = JSON.stringify(events) + fixture.stdout
    expect(log).not.toContain(fakeSecret)
    expect(log).not.toContain('forged')
    // Original Node stderr is intentionally unchanged and must be redacted
    // before sharing. Only the new lifecycle log excludes exception messages.
    expect(fixture.stderr).toContain(fakeSecret)
  })

  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM', 'SIGHUP'])(
    'records %s and still terminates with that signal',
    async (signal) => {
      const fixture = run('setInterval(() => {}, 1000)')
      await new Promise((resolve, reject) => {
        fixture.child.stdout.on('data', () => {
          if (fixture.stdout.includes('"event":"starting"')) resolve()
        })
        fixture.child.once('error', reject)
        fixture.child.once('exit', () => reject(new Error(fixture.stderr)))
      })
      fixture.child.kill(signal)
      const [exitCode, exitSignal] = await fixture.finished
      expect(exitCode).toBeNull()
      expect(exitSignal).toBe(signal)
      expect(records(fixture)).toContainEqual(
        expect.objectContaining({ event: 'signal', signal, pid: fixture.child.pid }),
      )
    },
  )

  it('bounds log rotation and retains private permissions', async () => {
    const fixture = run('for (let index = 0; index < 30; index++) diagnostics.listening()', {
      maxBytes: 1024,
    })
    expect((await fixture.finished)[0]).toBe(0)
    for (const name of ['gateway-process.log', 'gateway-process.log.1']) {
      const stat = fs.statSync(path.join(fixture.directory, name))
      expect(stat.size).toBeLessThanOrEqual(1024)
      if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600)
    }
    expect(records(fixture).at(-1)).toMatchObject({ event: 'exit', code: 0 })
  })

  it('keeps running and warns once when the log cannot be written', async () => {
    const fixture = run('diagnostics.listening()', { unwritable: true })
    expect((await fixture.finished)[0]).toBe(0)
    expect(fixture.stdout).toContain('"event":"listening"')
    expect(fixture.stdout).toContain('"event":"exit"')
    expect(fixture.stderr.match(/process log unavailable/g)).toHaveLength(1)
  })
})
