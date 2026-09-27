/* eslint-env node */
import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const parent = path.resolve(root, '../browser-extensions')
const destination = path.join(parent, 'chatgptbox')

async function main() {
  // Refuse to replace a symlink or an unrelated folder.
  const existing = await lstat(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (existing) {
    if (!existing.isDirectory()) throw new Error(`Not a directory: ${destination}`)
    const installed = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'))
    const expected = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'))
    if (installed.name !== expected.name) {
      throw new Error(`Destination contains a different extension: ${destination}`)
    }
  }

  const build = spawnSync(process.execPath, ['build.mjs', '--production'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) throw new Error(`Build failed (${build.signal || build.status})`)

  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(path.join(parent, '.chatgptbox-install-'))
  const next = path.join(staging, 'next')
  const backup = path.join(staging, 'previous')
  try {
    await cp(path.join(root, 'build/chromium'), next, { recursive: true })
    if (existing) await rename(destination, backup)
    try {
      await rename(next, destination)
    } catch (error) {
      if (existing) await rename(backup, destination)
      throw error
    }
  } catch (error) {
    // Keep staging on failure so any previous installation can be recovered.
    console.error(`Installation files retained at: ${staging}`)
    throw error
  }
  await rm(staging, { recursive: true, force: true })
  console.log(`\nExtension installed: ${destination}`)
  console.log('Reload ChatGPTBox on your browser extensions page to apply the update.')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
