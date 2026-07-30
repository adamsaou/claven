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

/**
 * Is this text, and if so how is it encoded.
 *
 * Exported so that project search shares this exact judgement rather than
 * making its own. An independent binary sniff would find matches in files
 * `fs:read` then refuses to open, which is a result row that cannot be clicked.
 * Sharing the function makes the two agree by construction instead of by
 * someone remembering to keep them in step.
 */
export type Classification =
  | { kind: 'text'; encoding: TextEncoding; body: Buffer }
  | { kind: 'binary' }

export function classifyBytes(buffer: Buffer): Classification {
  const { encoding, offset } = detectBom(buffer)
  const body = buffer.subarray(offset)

  // UTF-16 text is full of legitimate NUL bytes, so the sniff only makes sense
  // once a UTF-16 BOM has been ruled out. Same order as readTextFile.
  if (encoding === 'utf8' || encoding === 'utf8bom') {
    if (body.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'binary' }
  }
  return { kind: 'text', encoding, body }
}

export function decodeText(body: Buffer, encoding: TextEncoding): string {
  return decode(body, encoding)
}

/** Exported for search, which needs offsets in the same space the editor uses. */
export { normalizeToLf }

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

  // The same judgement project search uses, on purpose. See classifyBytes.
  const classified = classifyBytes(buffer)
  if (classified.kind === 'binary') return { kind: 'binary', path, size: stats.size }
  const { encoding, body } = classified

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

/**
 * Rename, retrying while the destination is briefly locked.
 *
 * On Windows a rename over an existing file is `MoveFileExW` with
 * REPLACE_EXISTING, and Windows refuses it while any process holds a handle on
 * the destination. Plenty of things hold one for a few milliseconds: Defender,
 * the search indexer, OneDrive, a backup agent, and anything else that reads
 * files in the background.
 *
 * The failure is nastier than it looks. `EPERM` is not `CHANGED_ON_DISK`, so the
 * conflict dialog is skipped, the save reports an error nobody can act on, and
 * the tab silently stays dirty. It reads as "claven randomly refuses to save"
 * and nothing connects it to whatever was reading the file.
 *
 * Roughly 200ms of retries, then the real error. Narrowing our own window is not
 * sufficient on its own, because the process holding the handle is usually not
 * this one.
 */
async function renameWithRetry(temporary: string, path: string): Promise<void> {
  const RETRYABLE = ['EPERM', 'EACCES', 'EBUSY']
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, path)
      return
    } catch (cause) {
      const code = cause instanceof Error && 'code' in cause ? String(cause.code) : ''
      if (attempt >= 6 || !RETRYABLE.includes(code)) throw cause
      await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)))
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

  /**
   * The buffer is written as-is. There used to be a step here that forced the
   * trailing newline back to whatever the file had when it was opened, which
   * preserved nothing the buffer would not have preserved anyway — and made it
   * impossible to add a final newline to a file that lacked one, or remove one
   * from a file that had it. The edit went in, the save silently undid it.
   */
  const bytes = encode(denormalizeFromLf(content, meta.lineEnding), meta.encoding)

  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }

  const stats = await stat(path)
  return { ...meta, path, mtimeMs: stats.mtimeMs, size: stats.size }
}
