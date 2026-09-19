#!/usr/bin/env node
/* global process */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  conversationToMarkdown,
  formatLibraryConversation,
  listHistoryVolumeFiles,
  loadHistoryVolumes,
  searchConversationBodies,
  writeMergedHistoryVolume,
} from './lib/chatgpt-history-library.mjs'

const argv = process.argv.slice(2)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const viewerHtmlPath = join(scriptDir, 'chatgpt-history-viewer.html')

function printUsage() {
  console.log(`Browse ChatGPTBox history volume files locally.

Usage:
  node scripts/chatgpt-history-viewer.mjs <export-folder-or-files...>

Options:
  --port=18765
  --host=127.0.0.1
  --no-open
  --no-serve
  --merge-out=<file.json>
`)
}

function consumeFlag(name, fallback) {
  const prefix = `--${name}=`
  const exact = argv.find((item) => item === `--${name}`)
  if (exact) return argv[argv.indexOf(exact) + 1] || fallback
  const paired = argv.find((item) => item.startsWith(prefix))
  if (paired) return paired.slice(prefix.length)
  return fallback
}

function hasFlag(name) {
  return argv.includes(`--${name}`)
}

const PORT = Number.parseInt(consumeFlag('port', '18765'), 10)
const HOST = consumeFlag('host', '127.0.0.1')
const MERGE_OUT = consumeFlag('merge-out', '')
const consumedValueIndexes = new Set()
for (const [index, item] of argv.entries()) {
  if (item === '--port' || item === '--host' || item === '--merge-out') {
    consumedValueIndexes.add(index + 1)
  }
}
const targets = argv.filter(
  (item, index) => !item.startsWith('--') && !consumedValueIndexes.has(index),
)

if (targets.length === 0) {
  printUsage()
  process.exit(1)
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function publicLibrary(library) {
  return {
    exportId: library.exportId,
    summary: library.summary,
    conversations: library.conversations,
    volumes: library.volumes.map((volume) => ({
      filename: volume.filename,
      bytes: volume.bytes,
      exportId: volume.exportId,
      exportedAt: volume.exportedAt,
      schemaVersion: volume.schemaVersion,
      volume: volume.volume,
    })),
  }
}

function conversationIdFromPath(urlPath) {
  const match = urlPath.match(/^\/api\/conversations\/(.+?)(?:\.md)?$/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function main() {
  const resolvedTargets = targets.map((target) => resolve(target))
  const files = await listHistoryVolumeFiles(resolvedTargets)
  console.log(`Found ${files.length} history volume file(s)`)
  const library = await loadHistoryVolumes(files, {
    onProgress: ({ index, total, path, bytes }) => {
      const mb = (bytes / (1024 * 1024)).toFixed(1)
      console.log(`[${index + 1}/${total}] ${mb} MB  ${path}`)
    },
  })
  console.log(
    `Merged ${library.conversations.length} conversations, ${library.summary.snapshotCount} snapshots`,
  )

  if (MERGE_OUT) {
    const outputPath = resolve(MERGE_OUT)
    await writeMergedHistoryVolume(library, outputPath)
    console.log(`Wrote merged volume: ${outputPath}`)
  }

  if (hasFlag('no-serve')) return

  const html = await readFile(viewerHtmlPath, 'utf8')
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
        if (url.pathname === '/' || url.pathname === '/index.html') {
          text(res, 200, html, 'text/html; charset=utf-8')
          return
        }
        if (url.pathname === '/api/library') {
          json(res, 200, publicLibrary(library))
          return
        }
        if (url.pathname === '/api/search') {
          json(res, 200, searchConversationBodies(library.storage, url.searchParams.get('q') || ''))
          return
        }
        if (url.pathname.startsWith('/api/conversations/')) {
          const id = conversationIdFromPath(url.pathname)
          const formatted = formatLibraryConversation(library.storage, id, {
            think: url.searchParams.get('think') === '1',
          })
          if (url.pathname.endsWith('.md')) {
            text(res, 200, conversationToMarkdown(formatted), 'text/markdown; charset=utf-8')
            return
          }
          json(res, 200, formatted)
          return
        }
        text(res, 404, 'Not found')
      } catch (error) {
        text(res, 500, error?.message || String(error))
      }
    })()
  })

  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, resolveListen)
  })
  const href = `http://${HOST}:${PORT}/`
  console.log(`History viewer: ${href}`)
  if (!hasFlag('no-open') && process.platform === 'darwin') {
    execFile('open', [href], () => {})
  }
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
