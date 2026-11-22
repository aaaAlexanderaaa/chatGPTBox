/* eslint-env node */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const home = os.homedir()
const dataDir = path.join(home, '.chatgptbox')
const agentsDir = path.join(home, 'Library/LaunchAgents')
const services = ['api', 'mcp'].map((name) => ({
  name,
  label: `local.chatgptbox.${name}`,
  file: path.join(agentsDir, `local.chatgptbox.${name}.plist`),
}))
const domain = `gui/${process.getuid?.()}`

function run(command, args, optional = false) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0 && !optional) {
    throw new Error(`${command} ${args.join(' ')}: ${result.stderr.trim() || result.status}`)
  }
  return result
}

const launchctl = (args, optional = false) => run('/bin/launchctl', args, optional)
const target = (service) => `${domain}/${service.label}`
const loaded = (service) => launchctl(['print', target(service)], true).status === 0

function readPlist(service) {
  if (!fs.existsSync(service.file)) return null
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', service.file]).stdout)
}

function argument(plist, name, fallback) {
  const args = plist?.ProgramArguments || []
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}

function xml(value) {
  if (Array.isArray(value)) return `<array>${value.map(xml).join('')}</array>`
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
  if (typeof value === 'number') return `<integer>${value}</integer>`
  if (typeof value === 'object') {
    return `<dict>${Object.entries(value)
      .map(([key, entry]) => `<key>${escapeXml(key)}</key>${xml(entry)}`)
      .join('')}</dict>`
  }
  return `<string>${escapeXml(value)}</string>`
}

function escapeXml(value) {
  return String(value).replace(
    /[<>&"']/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]),
  )
}

async function checkPort(port, host, servicePid) {
  if (servicePid) {
    const listeners = run(
      '/usr/sbin/lsof',
      ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      true,
    )
    const pids = listeners.stdout.trim().split(/\s+/)
    // Reconfiguration may replace our own listener, but never another process.
    if (listeners.status === 0 && pids.every((pid) => pid === servicePid)) return
  }
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', () =>
      reject(
        new Error(`Port ${port} is occupied or unavailable; stop its owner before installing.`),
      ),
    )
    server.listen(port, host, resolve)
  })
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

function start(service) {
  if (!fs.existsSync(service.file)) throw new Error(`Run services install first: ${service.file}`)
  launchctl(['enable', target(service)])
  if (!loaded(service)) launchctl(['bootstrap', domain, service.file])
}

async function unload(service) {
  if (!loaded(service)) return
  launchctl(['bootout', target(service)])
  // bootout can return while the old registration is still being removed.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!loaded(service)) return
    await setTimeout(100)
  }
  throw new Error(`Service did not unload within 10 seconds: ${service.label}`)
}

async function stop(service) {
  launchctl(['disable', target(service)])
  await unload(service)
}

function status() {
  for (const service of services) {
    const result = launchctl(['print', target(service)], true)
    const state = result.stdout.match(/^\s*state = (.+)$/m)?.[1] || 'not loaded'
    const pid = result.stdout.match(/^\s*pid = (\d+)$/m)?.[1]
    console.log(`${service.label}: ${state}${pid ? ` (PID ${pid})` : ''}`)
    console.log(`  ${service.file}`)
    console.log(`  Logs: ${dataDir}/${service.name}-service.{out,err}.log`)
  }
}

async function install(options) {
  const old = services.map(readPlist)
  const host = options['--host'] || argument(old[0], '--host', '127.0.0.1')
  const apiPort = Number(options['--api-port'] || argument(old[0], '--port', '18081'))
  const mcpPort = Number(options['--mcp-port'] || argument(old[1], '--port', '18082'))
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Host must be 127.0.0.1 or 0.0.0.0')
  if (
    ![apiPort, mcpPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536) ||
    apiPort === mcpPort
  ) {
    throw new Error('API and MCP ports must be distinct integers between 1 and 65535')
  }
  for (const name of ['gateway-api-token', 'gateway-bridge-token', 'mcp-token']) {
    const file = path.join(dataDir, name)
    if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').trim()) {
      throw new Error(`Missing or empty ${name}; initialize API and MCP manually first`)
    }
  }
  for (const [index, service] of services.entries()) {
    const port = index === 0 ? apiPort : mcpPort
    const current = launchctl(['print', target(service)], true)
    const servicePid = current.stdout.match(/^\s*pid = (\d+)$/m)?.[1]
    await checkPort(port, host, servicePid)
  }
  fs.mkdirSync(agentsDir, { recursive: true })
  for (const [index, service] of services.entries()) {
    const args = old[index]?.ProgramArguments?.slice(2) || []
    for (const flag of ['--host', '--port', '--gateway-port', '--data-dir']) {
      const position = args.indexOf(flag)
      if (position >= 0) args.splice(position, 2)
    }
    args.push(
      '--host',
      host,
      '--port',
      String(index === 0 ? apiPort : mcpPort),
      '--data-dir',
      dataDir,
    )
    if (index === 1) args.push('--gateway-port', String(apiPort))
    const plist = {
      Label: service.label,
      ProgramArguments: [
        process.execPath,
        path.join(root, `scripts/${service.name}-server.mjs`),
        ...args,
      ],
      WorkingDirectory: root,
      RunAtLoad: true,
      KeepAlive: true,
      ThrottleInterval: 10,
      Umask: 0o077,
      StandardOutPath: path.join(dataDir, `${service.name}-service.out.log`),
      StandardErrorPath: path.join(dataDir, `${service.name}-service.err.log`),
    }
    const staging = `${service.file}.tmp`
    fs.writeFileSync(
      staging,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${xml(
        plist,
      )}</plist>\n`,
      { mode: 0o600 },
    )
    run('/usr/bin/plutil', ['-lint', staging])
    await unload(service)
    fs.renameSync(staging, service.file)
    start(service)
  }
  console.log(`Installed API ${host}:${apiPort}, MCP ${host}:${mcpPort}`)
  status()
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('These login services require macOS')
  if (process.getuid() === 0) throw new Error('Run as your login user, without sudo')
  const [action = 'status', ...args] = process.argv.slice(2)
  if (['--help', '-h', 'help'].includes(action)) {
    console.log(
      'Usage: npm run services -- install|start|stop|restart|status|uninstall\nInstall options: --host 127.0.0.1|0.0.0.0 --api-port 18081 --mcp-port 18082',
    )
    return
  }
  if (!['install', 'start', 'stop', 'restart', 'status', 'uninstall'].includes(action)) {
    throw new Error(`Unknown action: ${action}`)
  }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (
      action !== 'install' ||
      !['--host', '--api-port', '--mcp-port'].includes(flag) ||
      !args[index + 1]
    ) {
      throw new Error(`Invalid option: ${flag}; see services --help`)
    }
    options[flag] = args[index + 1]
  }
  if (action === 'install') return install(options)
  if (action === 'status') return status()
  if (['stop', 'uninstall'].includes(action)) {
    for (const service of [...services].reverse()) {
      await stop(service)
      if (action === 'uninstall') fs.rmSync(service.file, { force: true })
    }
  } else {
    for (const service of services) {
      const wasLoaded = loaded(service)
      start(service)
      if (action === 'restart' && wasLoaded) launchctl(['kickstart', '-k', target(service)])
    }
  }
  status()
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
