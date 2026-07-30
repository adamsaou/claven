import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { emitTo } from './ipc'
import { getWorkspaceRoot } from './workspace'
import { classifyBytes, decodeText, normalizeToLf } from './textfile'
import { walkFiles, type WalkStats } from './walk'
import { MAX_TEXT_FILE_BYTES } from '../shared/files'
import {
  BATCH_MATCHES,
  BATCH_MS,
  MAX_LINE_LENGTH,
  MAX_MATCHES,
  PREVIEW_LEAD,
  PREVIEW_MAX,
  type SearchDone,
  type SearchMatch,
  type SearchQuery,
  type SearchSkipped
} from '../shared/search'

/**
 * Project-wide search.
 *
 * Two rules govern everything here, and both were arrived at by measuring
 * rather than by reasoning.
 *
 * **Decode, never byte-match.** `beta` in a UTF-16LE file is
 * `62 00 65 00 74 00 61 00` on disk while the needle is `62 65 74 61`, so a raw
 * `indexOf` misses every match in a UTF-16 file and is off by three in a file
 * with a BOM. So every file goes through the same `classifyBytes` and
 * `decodeText` that `fs:read` uses.
 *
 * **Close the handle before doing any work with the bytes.** Windows refuses to
 * rename over a file while any handle on it is open, and a save is a rename. The
 * natural shape, holding the descriptor across read, decode and scan, refused
 * roughly one save in five while a sweep was running, and presented as the
 * editor randomly declining to save.
 */

/** How many files are read at once. Main also serves the language server and the ptys. */
const READ_CONCURRENCY = 8

type Run = { controller: AbortController }

const runs = new Map<string, Run>()
let counter = 0

class BadPatternError extends Error {
  readonly code = 'BAD_PATTERN'
}

/**
 * Build the matcher.
 *
 * Synchronous and before the id is handed out, so a half-typed group is an
 * error the panel can show rather than a run that has to be cancelled.
 */
function compile(query: SearchQuery): { re: RegExp; crStripped: boolean } {
  let source = query.pattern
  let crStripped = false

  if (query.regex) {
    // Not stripped from a regex: a CR may be inside a character class or a
    // negation, where removing it would change the meaning. Flagged instead.
    crStripped = /\\r|\r/.test(source)
  } else {
    if (source.includes('\r')) {
      source = source.replace(/\r/g, '')
      crStripped = true
    }
    source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  if (query.wholeWord) {
    // Unicode-aware rather than \b, which treats a match inside an Arabic or
    // Cyrillic word as a word boundary and is therefore wrong for most of the
    // world's text.
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  }

  // Smart case tests for any uppercase letter, not just A-Z, so a pattern in
  // Greek or Cyrillic behaves the same way as one in Latin.
  const sensitive = query.caseSensitive ?? /\p{Lu}/u.test(query.pattern)
  const flags = sensitive ? 'gu' : 'giu'

  try {
    return { re: new RegExp(source, flags), crStripped }
  } catch (cause) {
    throw new BadPatternError(cause instanceof Error ? cause.message : 'invalid pattern')
  }
}

/** The matched line, trimmed and windowed so a 40,000 column hit is still usable. */
function preview(lineText: string, column: number): { preview: string; previewFrom: number } {
  const leading = lineText.length - lineText.trimStart().length
  if (lineText.length - leading <= PREVIEW_MAX) {
    return { preview: lineText.slice(leading), previewFrom: leading }
  }
  const from = Math.max(leading, column - 1 - PREVIEW_LEAD)
  return { preview: lineText.slice(from, from + PREVIEW_MAX), previewFrom: from }
}

function scan(
  file: string,
  text: string,
  re: RegExp,
  skipped: SearchSkipped,
  push: (match: SearchMatch) => boolean
): boolean {
  // Split on \n only, because the text is already normalized. A lone CR is a
  // line break here, which means line numbers agree with the editor's gutter
  // even where they disagree with git grep. The gutter is the one on screen.
  const lines = text.split('\n')
  let longLineSeen = false

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i]!
    if (lineText.length > MAX_LINE_LENGTH) {
      longLineSeen = true
      continue
    }
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(lineText)) !== null) {
      const column = match.index + 1
      // A zero-width match would otherwise report a hit on every character and
      // never advance. `\d*` mid-typing is legitimate, so the pattern is not
      // rejected, the empty hits are just not reported.
      if (match[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      const window = preview(lineText, column)
      if (!push({ file, line: i + 1, column, length: match[0].length, ...window })) return false
    }
  }
  if (longLineSeen) skipped.longLine += 1
  return true
}

export function startSearch(query: SearchQuery, sender: WebContents): { id: string } {
  const root = getWorkspaceRoot()
  if (root === null) {
    throw Object.assign(new Error('no workspace is open'), { code: 'NO_WORKSPACE' })
  }
  // Compiled before anything is allocated, so a bad pattern never leaves a run.
  const { re, crStripped } = compile(query)

  // Starting a run cancels the one before it. The renderer debounces, but a
  // debounce is not a guarantee and a contract that relies on the caller
  // remembering to cancel leaks the first time an error path skips it.
  cancelAllSearches()

  const id = `search-${++counter}`
  const controller = new AbortController()
  runs.set(id, { controller })

  void run(id, root, re, crStripped, controller.signal, sender)
  return { id }
}

async function run(
  id: string,
  root: string,
  re: RegExp,
  crStripped: boolean,
  signal: AbortSignal,
  sender: WebContents
): Promise<void> {
  const started = Date.now()
  const skipped: SearchSkipped = { binary: 0, tooLarge: 0, unreadable: 0, longLine: 0 }
  const walkStats: WalkStats = { skippedDirs: 0 }

  let filesSearched = 0
  let matchCount = 0
  let batch: SearchMatch[] = []
  let timer: NodeJS.Timeout | null = null
  let reason: SearchDone['reason'] = 'complete'

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    // Flushed even when empty, so a slow run with no hits still reports
    // progress instead of looking hung.
    emitTo(sender, 'search:matches', { id, matches: batch, filesSearched })
    batch = []
  }

  const push = (match: SearchMatch): boolean => {
    batch.push(match)
    matchCount += 1
    if (matchCount >= MAX_MATCHES) {
      reason = 'limit'
      return false
    }
    if (batch.length >= BATCH_MATCHES) flush()
    else if (timer === null) timer = setTimeout(flush, BATCH_MS)
    return true
  }

  /**
   * The whole body is wrapped so that `search:done` is guaranteed.
   *
   * `search:start` has already returned through the IPC handler, so its
   * try/catch is long gone and a throw in here would be an unhandled rejection
   * in main with the panel spinning forever. A streaming contract without a
   * terminal event is the one shape that cannot be debugged from the UI.
   */
  try {
    const files = walkFiles(root, walkStats)
    const iterator = files[Symbol.asyncIterator]()

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal.aborted) return
        const next = await iterator.next()
        if (next.done === true) return
        const file = next.value

        try {
          const handle = await open(join(root, file), 'r')
          let buffer: Buffer
          try {
            const stats = await handle.stat()
            if (stats.size > MAX_TEXT_FILE_BYTES) {
              skipped.tooLarge += 1
              continue
            }
            buffer = await handle.readFile({ signal })
          } finally {
            // Before classify, decode and scan. See the note at the top: this
            // line is the difference between search working and saves failing.
            await handle.close()
          }

          const classified = classifyBytes(buffer)
          if (classified.kind === 'binary') {
            skipped.binary += 1
            continue
          }
          filesSearched += 1
          const text = normalizeToLf(decodeText(classified.body, classified.encoding))
          if (!scan(file, text, re, skipped, push)) return
        } catch (cause) {
          // A cancelled read is not a failure. Everything else here is routine:
          // a file locked by another process, or one a git checkout removed
          // between the walk listing it and the read reaching it.
          if (signal.aborted) return
          const code = cause instanceof Error && 'code' in cause ? String(cause.code) : ''
          if (code !== 'ABORT_ERR') skipped.unreadable += 1
        }
      }
    }

    await Promise.all(Array.from({ length: READ_CONCURRENCY }, () => worker()))
    if (signal.aborted && reason === 'complete') reason = 'cancelled'
  } catch {
    reason = signal.aborted ? 'cancelled' : reason
  } finally {
    flush()
    runs.delete(id)
    emitTo(sender, 'search:done', {
      id,
      reason,
      filesSearched,
      matchCount,
      skipped,
      crStripped,
      elapsedMs: Date.now() - started
    })
  }
}

/** An unknown id is ignored: a cancel racing the end of a run is normal. */
export function cancelSearch(id: string): void {
  const existing = runs.get(id)
  if (existing === undefined) return
  runs.delete(id)
  existing.controller.abort()
}

export function cancelAllSearches(): void {
  for (const id of [...runs.keys()]) cancelSearch(id)
}
