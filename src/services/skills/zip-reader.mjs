const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 4 * 1024 * 1024
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024

function findEndOfCentralDirectory(view) {
  // EOCD min size is 22 bytes, and the comment can be up to 65535 bytes.
  const minOffset = Math.max(0, view.byteLength - 22 - 65535)
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return {
        offset,
        centralDirectorySize: view.getUint32(offset + 12, true),
        centralDirectoryOffset: view.getUint32(offset + 16, true),
      }
    }
  }
  throw new Error('Invalid ZIP: end of central directory record not found')
}

function decodeFileName(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

function normalizeZipPath(path) {
  const normalized = String(path || '')
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
  if (!normalized || normalized.startsWith('/')) return null
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) return null
  return normalized
}

async function inflateRaw(compressedBytes, maxOutputBytes, fileName = 'entry') {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('ZIP deflate is not supported in this browser runtime')
  }
  const normalizedLimit = Number.isFinite(maxOutputBytes)
    ? Math.max(1, Math.floor(maxOutputBytes))
    : MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES
  const stream = new Response(compressedBytes).body.pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let totalBytes = 0
  let readResult

  while (!(readResult = await reader.read()).done) {
    const chunk = readResult.value
    totalBytes += chunk.byteLength
    if (totalBytes > normalizedLimit) {
      await reader.cancel()
      throw new Error(`ZIP entry exceeds uncompressed size limit for ${fileName}`)
    }
    chunks.push(chunk)
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const view = new DataView(arrayBuffer)
  const eocd = findEndOfCentralDirectory(view)
  let cursor = eocd.centralDirectoryOffset
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize
  const entries = []
  let totalUncompressedBytes = 0

  while (cursor < end) {
    const signature = view.getUint32(cursor, true)
    if (signature !== 0x02014b50) {
      throw new Error('Invalid ZIP: malformed central directory')
    }

    const compressionMethod = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    const fileNameStart = cursor + 46
    const rawName = decodeFileName(bytes.slice(fileNameStart, fileNameStart + fileNameLength))
    const fileName = normalizeZipPath(rawName)

    if (fileName && !fileName.endsWith('/')) {
      if (uncompressedSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`ZIP entry exceeds allowed size for ${fileName}`)
      }
      if (totalUncompressedBytes + uncompressedSize > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP archive exceeds total uncompressed size limit')
      }

      if (localHeaderOffset + 30 > view.byteLength) {
        throw new Error(`Invalid ZIP: truncated local header for ${fileName}`)
      }
      const localSig = view.getUint32(localHeaderOffset, true)
      if (localSig !== 0x04034b50) {
        throw new Error(`Invalid ZIP: bad local header for ${fileName}`)
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      if (dataStart + compressedSize > bytes.byteLength) {
        throw new Error(`Invalid ZIP: truncated data for ${fileName}`)
      }
      const compressed = bytes.slice(dataStart, dataStart + compressedSize)

      const remainingArchiveBudget = MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES - totalUncompressedBytes
      const maxEntryBudget = Math.min(MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES, remainingArchiveBudget)
      if (maxEntryBudget <= 0) {
        throw new Error('ZIP archive exceeds total uncompressed size limit')
      }

      let data
      if (compressionMethod === 0) {
        if (compressed.byteLength > maxEntryBudget) {
          throw new Error(`ZIP entry exceeds allowed size for ${fileName}`)
        }
        data = compressed
      } else if (compressionMethod === 8) {
        data = await inflateRaw(compressed, maxEntryBudget, fileName)
      } else {
        throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for ${fileName}`)
      }

      if (data.byteLength > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`ZIP entry exceeds allowed size for ${fileName}`)
      }
      if (totalUncompressedBytes + data.byteLength > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP archive exceeds total uncompressed size limit')
      }
      if (data.byteLength !== uncompressedSize) {
        throw new Error(`Invalid ZIP: uncompressed size mismatch for ${fileName}`)
      }

      totalUncompressedBytes += data.byteLength
      entries.push({ path: fileName, bytes: data })
    }

    cursor = fileNameStart + fileNameLength + extraLength + commentLength
  }

  return entries
}
