import { open, rename, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  LINE_ENDING_CHARS,
  MAX_TEXT_FILE_BYTES,
  type FileMeta,
  type LineEnding,
  type ReadResult,
  type TextEncoding
} from '../shared/files'

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf])
const BOM_UTF16LE = Buffer.from([0xff, 0xfe])
const BOM_UTF16BE = Buffer.from([0xfe, 0xff])

/** git's heuristic: a NUL in the first 8000 bytes means binary. */
const BINARY_SNIFF_BYTES = 8000

function detectBom(buffer: Buffer): { encoding: TextEncoding; offset: number } {
  if (buffer.subarray(0, 3).equals(BOM_UTF8)) return { encoding: 'utf8bom', offset: 3 }
  if (buffer.subarray(0, 2).equals(BOM_UTF16LE)) return { encoding: 'utf16le', offset: 2 }
  if (buffer.subarray(0, 2).equals(BOM_UTF16BE)) return { encoding: 'utf16be', offset: 2 }
  return { encoding: 'utf8', offset: 0 }
}

/** Byte-swap in place for UTF-16BE, which Node cannot decode directly. */
function swap16(buffer: Buffer): Buffer {
  const copy = Buffer.from(buffer)
  copy.swap16()
  return copy
}

function decode(body: Buffer, encoding: TextEncoding): string {
  switch (encoding) {
    case 'utf16le':
      return body.toString('utf16le')
    case 'utf16be':
      return swap16(body).toString('utf16le')
    default:
      return body.toString('utf8')
  }
}

function encode(text: string, encoding: TextEncoding): Buffer {
  switch (encoding) {
    case 'utf8bom':
      return Buffer.concat([BOM_UTF8, Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([BOM_UTF16LE, Buffer.from(text, 'utf16le')])
    case 'utf16be':
      return Buffer.concat([BOM_UTF16BE, swap16(Buffer.from(text, 'utf16le'))])
    default:
      return Buffer.from(text, 'utf8')
  }
}

/**
 * Count each ending independently. A file is "mixed" when more than one kind
 * appears, and the dominant one is what a save will write.
 */
function detectLineEnding(text: string): { lineEnding: LineEnding; mixed: boolean } {
  let crlf = 0
  let lf = 0
  let cr = 0

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\r') {
      if (text[i + 1] === '\n') {
        crlf += 1
        i += 1
      } else {
        cr += 1
      }
    } else if (char === '\n') {
      lf += 1
    }
  }

  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  // No line breaks at all: the choice is arbitrary and cannot be observed.
  if (kinds === 0) return { lineEnding: 'lf', mixed: false }

  const dominant: LineEnding = crlf >= lf && crlf >= cr ? 'crlf' : lf >= cr ? 'lf' : 'cr'
  return { lineEnding: dominant, mixed: kinds > 1 }
}

/** Everything becomes LF inside the editor; FileMeta remembers what to restore. */
function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function denormalizeFromLf(text: string, lineEnding: LineEnding): string {
  if (lineEnding === 'lf') return text
  return text.replace(/\n/g, LINE_ENDING_CHARS[lineEnding])
}

export async function readTextFile(path: string): Promise<ReadResult> {
  const stats = await stat(path)

  if (stats.size > MAX_TEXT_FILE_BYTES) {
    return { kind: 'too-large', path, size: stats.size, limit: MAX_TEXT_FILE_BYTES }
  }

  const handle = await open(path, 'r')
  let buffer: Buffer
  try {
    buffer = await handle.readFile()
  } finally {
    await handle.close()
  }

  const { encoding, offset } = detectBom(buffer)
  const body = buffer.subarray(offset)

  // UTF-16 text is full of legitimate NUL bytes, so the binary sniff only makes
  // sense once a UTF-16 BOM has been ruled out.
  if (encoding === 'utf8' || encoding === 'utf8bom') {
    const sniff = body.subarray(0, BINARY_SNIFF_BYTES)
    if (sniff.includes(0)) return { kind: 'binary', path, size: stats.size }
  }

  const raw = decode(body, encoding)
  const { lineEnding, mixed } = detectLineEnding(raw)
  const content = normalizeToLf(raw)

  return {
    kind: 'text',
    content,
    meta: {
      path,
      encoding,
      lineEnding,
      mixedLineEndings: mixed,
      hadTrailingNewline: content.endsWith('\n'),
      mtimeMs: stats.mtimeMs,
      size: stats.size
    }
  }
}

class ChangedOnDiskError extends Error {
  readonly code = 'CHANGED_ON_DISK'
  constructor(path: string) {
    super(`"${basename(path)}" changed on disk since it was opened`)
  }
}

/**
 * Write atomically: temp file in the same directory, fsync, then rename over.
 *
 * Same directory matters -- rename is only atomic within a filesystem, so a temp
 * in the OS temp dir would silently degrade to copy-then-delete. fsync before
 * rename matters because otherwise a crash can leave the rename durable and the
 * contents not, which is how you lose a file while appearing to have saved it.
 */
export async function writeTextFile(
  path: string,
  content: string,
  meta: FileMeta,
  expectedMtimeMs: number | null
): Promise<FileMeta> {
  if (expectedMtimeMs !== null) {
    const current = await stat(path).catch(() => null)
    // Compared with a tolerance: some filesystems round mtime to the second.
    if (current && Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
      throw new ChangedOnDiskError(path)
    }
  }

  let text = content
  if (meta.hadTrailingNewline && !text.endsWith('\n')) text += '\n'
  else if (!meta.hadTrailingNewline && text.endsWith('\n')) text = text.slice(0, -1)

  const bytes = encode(denormalizeFromLf(text, meta.lineEnding), meta.encoding)

  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }

  const stats = await stat(path)
  return { ...meta, path, mtimeMs: stats.mtimeMs, size: stats.size }
}
