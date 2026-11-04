/* eslint-env node */
// Run a synthetic 300 MiB file export in an isolated, heap-limited process.
import webpack from 'webpack'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgptbox-backup-resources-'))
try {
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      context: root,
      target: 'node',
      mode: 'development',
      devtool: false,
      entry: path.join(root, 'tests/fixtures/history-backup-resource-probe.mjs'),
      output: { path: output, filename: 'probe.cjs', chunkFilename: '[name].cjs' },
      resolve: {
        extensions: ['.mjs', '.js'],
        alias: {
          'webextension-polyfill': path.join(root, 'tests/__stubs__/webextension-polyfill.mjs'),
        },
      },
      optimization: { minimize: false },
    })
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || stats?.hasErrors() || closeError)
          reject(error || closeError || new Error(stats.toString({ all: false, errors: true })))
        else resolve()
      })
    })
  })
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=128', path.join(output, 'probe.cjs')],
    {
      encoding: 'utf8',
      timeout: 30000,
    },
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Backup resource probe exited with ${result.status}`)
} finally {
  await fs.rm(output, { recursive: true, force: true })
}
