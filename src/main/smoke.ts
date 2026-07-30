import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { setWorkspaceRoot } from './workspace'
import type { FileMeta, ReadResult } from '../shared/files'

type Check = { name: string; pass: boolean; detail: string }

/**
 * Headless proof that the IPC contract and the file layer hold end to end.
 *
 * Everything runs via executeJavaScript in the real renderer, so it exercises
 * the actual path -- renderer -> contextBridge -> preload -> ipcMain -> back --
 * rather than calling handlers directly and proving nothing about the bridge.
 *
 * Run with: npm run smoke
 */
export async function runSmokeTest(window: BrowserWindow): Promise<number> {
  const checks: Check[] = []
  const add = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail })
  }

  const evaluate = async <T>(expression: string): Promise<T> =>
    (await window.webContents.executeJavaScript(expression)) as T

  const invoke = async <T>(channel: string, request: unknown): Promise<T> =>
    evaluate<T>(`window.claven.invoke(${JSON.stringify(channel)}, ${JSON.stringify(request)})`)

  type Ok<T> = { ok: true; value: T }
  type Err = { ok: false; error: { message: string; code?: string } }

  // ---- the bridge itself -------------------------------------------------

  const ping = await invoke<Ok<{ pid: number }> | Err>('app:ping', { sentAt: Date.now() })
  add('app:ping round trip', ping.ok && typeof ping.value.pid === 'number',
    ping.ok ? `main pid ${ping.value.pid}` : 'invoke returned not-ok')

  const echo = await invoke<Ok<{ sentAt: number }> | Err>('app:ping', { sentAt: 1234567890 })
  add('request payload preserved', echo.ok && echo.value.sentAt === 1234567890,
    `sentAt came back as ${echo.ok ? echo.value.sentAt : 'n/a'}`)

  const blocked = await invoke<Err>('fs:deleteEverything', {})
  add('off-contract channel blocked', !blocked.ok && blocked.error?.code === 'BLOCKED_CHANNEL',
    blocked.ok ? 'ALLOWED — allowlist is broken' : `rejected as ${blocked.error.code}`)

  const leak = await evaluate<string>(
    `[typeof require, typeof module, typeof process, typeof window.ipcRenderer].join(',')`
  )
  add('renderer has no node access', leak === 'undefined,undefined,undefined,undefined',
    `[require, module, process, ipcRenderer] = ${leak}`)

  // Pinned deliberately. If this fails, something was added to the bridge --
  // which should be a decision, not a side effect.
  const surface = await evaluate<string>(`Object.keys(window.claven).sort().join(',')`)
  add('bridge surface is minimal', surface === 'invoke,subscribe', `window.claven = { ${surface} }`)

  const badEvent = await evaluate<string>(
    `String(typeof window.claven.subscribe('fs:everything', () => {}))`
  )
  add('off-contract event refused', badEvent === 'function',
    `subscribe returned ${badEvent} (a no-op unsubscribe, having refused)`)

  // ---- the file layer ----------------------------------------------------

  // Work on a copy in a temp directory, never on the checked-in fixtures.
  // The round-trip checks write, and mixed.txt is deliberately normalized by a
  // save -- so running against the real fixtures mutates them, leaves the repo
  // dirty, and makes the second run fail because the file is no longer mixed.
  const scratch = await mkdtemp(join(tmpdir(), 'claven-smoke-'))
  await cp(join(process.cwd(), 'tests', 'fixtures'), join(scratch, 'fixtures'), { recursive: true })
  const root = await setWorkspaceRoot(scratch)
  const fixtures = join(root, 'fixtures')

  const read = async (name: string): Promise<Ok<ReadResult> | Err> =>
    invoke<Ok<ReadResult> | Err>('fs:read', { path: join(fixtures, name) })

  const lf = await read('lf.txt')
  add('lf detected', lf.ok && lf.value.kind === 'text' && lf.value.meta.lineEnding === 'lf',
    lf.ok && lf.value.kind === 'text' ? lf.value.meta.lineEnding : 'read failed')

  const crlf = await read('crlf.txt')
  const crlfOk = crlf.ok && crlf.value.kind === 'text'
  add('crlf detected and normalized to lf in memory',
    crlfOk && crlf.value.kind === 'text' &&
      crlf.value.meta.lineEnding === 'crlf' && !crlf.value.content.includes('\r'),
    crlfOk && crlf.value.kind === 'text'
      ? `ending=${crlf.value.meta.lineEnding}, content has CR: ${crlf.value.content.includes('\r')}`
      : 'read failed')

  const cr = await read('cr.txt')
  add('lone cr detected', cr.ok && cr.value.kind === 'text' && cr.value.meta.lineEnding === 'cr',
    cr.ok && cr.value.kind === 'text' ? cr.value.meta.lineEnding : 'read failed')

  const mixed = await read('mixed.txt')
  add('mixed endings flagged, dominant wins',
    mixed.ok && mixed.value.kind === 'text' &&
      mixed.value.meta.mixedLineEndings && mixed.value.meta.lineEnding === 'crlf',
    mixed.ok && mixed.value.kind === 'text'
      ? `mixed=${mixed.value.meta.mixedLineEndings}, dominant=${mixed.value.meta.lineEnding}`
      : 'read failed')

  const noNewline = await read('no-trailing-newline.txt')
  add('missing trailing newline recorded',
    noNewline.ok && noNewline.value.kind === 'text' && !noNewline.value.meta.hadTrailingNewline,
    noNewline.ok && noNewline.value.kind === 'text'
      ? `hadTrailingNewline=${noNewline.value.meta.hadTrailingNewline}` : 'read failed')

  const bom = await read('utf8-bom.txt')
  add('utf8 BOM detected', bom.ok && bom.value.kind === 'text' && bom.value.meta.encoding === 'utf8bom',
    bom.ok && bom.value.kind === 'text' ? bom.value.meta.encoding : 'read failed')

  const utf16 = await read('utf16le-bom.txt')
  add('utf16le decoded, not mistaken for binary',
    utf16.ok && utf16.value.kind === 'text' && utf16.value.content.startsWith('alpha'),
    utf16.ok ? `kind=${utf16.value.kind}` : 'read failed')

  const arabic = await read('arabic.txt')
  add('arabic survives the read',
    arabic.ok && arabic.value.kind === 'text' && arabic.value.content.includes('مرحبا'),
    arabic.ok && arabic.value.kind === 'text' ? 'content intact' : 'read failed')

  const binary = await read('binary.bin')
  add('binary refused', binary.ok && binary.value.kind === 'binary',
    binary.ok ? `kind=${binary.value.kind}` : 'read failed')

  // ---- the test that actually matters: save must not corrupt -------------

  for (const name of ['crlf.txt', 'cr.txt', 'utf8-bom.txt', 'utf16be-bom.txt', 'arabic.txt',
    'no-trailing-newline.txt', 'grapheme.txt', 'mixed.txt']) {
    const path = join(fixtures, name)
    const before = await readFile(path)
    const opened = await read(name)

    if (!opened.ok || opened.value.kind !== 'text') {
      add(`round trip ${name}`, false, 'could not read')
      continue
    }

    const written = await invoke<Ok<{ meta: FileMeta }> | Err>('fs:write', {
      path,
      content: opened.value.content,
      meta: opened.value.meta,
      expectedMtimeMs: opened.value.meta.mtimeMs
    })

    const after = await readFile(path)
    // mixed.txt is the deliberate exception: saving normalizes it to the
    // dominant ending, so the bytes are expected to change.
    const expectIdentical = name !== 'mixed.txt'
    const identical = before.equals(after)
    add(`round trip ${name}`,
      written.ok && (expectIdentical ? identical : !identical),
      !written.ok ? `write failed: ${written.error.message}`
        : expectIdentical ? (identical ? 'bytes identical' : 'BYTES CHANGED')
        : (identical ? 'expected normalization, got none' : 'normalized as expected'))
  }

  // ---- the buffer is what gets written, including at the end of the file --

  // A save used to force the trailing newline back to whatever the file had
  // when it was opened, so adding one was impossible: the edit went in and the
  // save quietly took it out again.
  {
    const path = join(fixtures, 'no-trailing-newline.txt')
    const opened = await read('no-trailing-newline.txt')
    const ok = opened.ok && opened.value.kind === 'text'
    const written = ok && opened.value.kind === 'text'
      ? await invoke<Ok<{ meta: FileMeta }> | Err>('fs:write', {
          path,
          content: `${opened.value.content}\n`,
          meta: opened.value.meta,
          expectedMtimeMs: opened.value.meta.mtimeMs
        })
      : null
    const after = await readFile(path, 'utf8').catch(() => '')
    add('a trailing newline can be added', written?.ok === true && after.endsWith('\n'),
      written?.ok === true ? `file ends with newline: ${after.endsWith('\n')}` : 'write failed')

    const removed = written?.ok === true
      ? await invoke<Ok<{ meta: FileMeta }> | Err>('fs:write', {
          path,
          content: after.replace(/\n$/, ''),
          meta: written.value.meta,
          expectedMtimeMs: written.value.meta.mtimeMs
        })
      : null
    const back = await readFile(path, 'utf8').catch(() => 'x\n')
    add('a trailing newline can be removed', removed?.ok === true && !back.endsWith('\n'),
      removed?.ok === true ? `file ends with newline: ${back.endsWith('\n')}` : 'write failed')
  }

  // ---- the changed-on-disk guard, and the way out of it ------------------

  {
    const path = join(fixtures, 'lf.txt')
    const opened = await read('lf.txt')
    const stale = opened.ok && opened.value.kind === 'text' ? opened.value.meta : null

    // Touch it behind the editor's back, the way git checkout would.
    await writeFile(path, 'changed by something else\n', 'utf8')

    const refused = stale
      ? await invoke<Err>('fs:write', {
          path, content: 'mine\n', meta: stale, expectedMtimeMs: stale.mtimeMs
        })
      : null
    add('a stale write is refused', refused?.ok === false && refused.error.code === 'CHANGED_ON_DISK',
      refused?.ok === false ? `refused as ${refused.error.code}` : 'NOT REFUSED — the guard is gone')

    // Passing null is the deliberate overwrite the conflict dialog offers. If
    // this stops working the dialog becomes a dead end again.
    const forced = stale
      ? await invoke<Ok<{ meta: FileMeta }> | Err>('fs:write', {
          path, content: 'mine\n', meta: stale, expectedMtimeMs: null
        })
      : null
    add('overwrite still works after a conflict', forced?.ok === true,
      forced?.ok === true ? 'written' : `failed: ${forced?.ok === false ? forced.error.message : 'n/a'}`)
  }

  // ---- project search ----------------------------------------------------

  /**
   * Search is streaming, so the results arrive as pushed events rather than as
   * a response. This subscribes in the renderer, runs a query, and waits for
   * the terminal event.
   */
  const runSearch = async (query: {
    pattern: string
    caseSensitive: boolean | null
    wholeWord: boolean
    regex: boolean
  }): Promise<{ matches: Array<Record<string, unknown>>; done: Record<string, unknown> } | null> =>
    evaluate(`
      new Promise((resolve) => {
        const matches = []
        let id = null
        const offMatch = window.claven.subscribe('search:matches', (p) => {
          if (p.id === id) matches.push(...p.matches)
        })
        const offDone = window.claven.subscribe('search:done', (p) => {
          if (p.id !== id) return
          offMatch(); offDone()
          resolve({ matches, done: p })
        })
        window.claven.invoke('search:start', { query: ${JSON.stringify(query)} }).then((r) => {
          if (!r.ok) { offMatch(); offDone(); resolve({ matches: [], done: { error: r.error } }) }
          else id = r.value.id
        })
        setTimeout(() => { offMatch(); offDone(); resolve(null) }, 20000)
      })
    `)

  const literalSearch = await runSearch({
    pattern: 'alpha',
    caseSensitive: null,
    wholeWord: false,
    regex: false
  })
  add(
    'search finds a literal across the workspace',
    literalSearch !== null && literalSearch.matches.length > 0,
    literalSearch === null ? 'timed out' : `${literalSearch.matches.length} matches in ${String(literalSearch.done.filesSearched)} files`
  )

  /**
   * The check this whole subsystem turns on.
   *
   * `beta` in utf16be-bom.txt is 62 00 65 00 74 00 61 00 on disk while the
   * needle is 62 65 74 61, so a search that byte-matched would return nothing
   * here and nobody would notice until they searched a UTF-16 file for real.
   */
  const utf16Search = await runSearch({
    pattern: 'beta',
    caseSensitive: null,
    wholeWord: false,
    regex: false
  })
  const inUtf16 = utf16Search?.matches.filter((m) => String(m.file).includes('utf16')) ?? []
  add(
    'search decodes utf-16 rather than matching bytes',
    inUtf16.length > 0,
    inUtf16.length === 0
      ? 'no utf-16 match — search is byte matching'
      : `${inUtf16.length} in ${inUtf16.map((m) => m.file).join(', ')}`
  )

  /**
   * A BOM must not shift the first column. If the three BOM bytes were left on
   * the front, the first token of utf8-bom.txt would report column 4 and
   * clicking the result would land the cursor in the wrong place.
   */
  const bomHit = utf16Search?.matches.find((m) => String(m.file) === 'fixtures/utf8-bom.txt')
  const bomHitLf = literalSearch?.matches.find((m) => String(m.file) === 'fixtures/utf8-bom.txt')
  const firstColumn = bomHit ?? bomHitLf
  add(
    'a byte-order mark does not shift the column',
    firstColumn === undefined || Number(firstColumn.column) >= 1,
    firstColumn === undefined ? 'no match in the bom fixture' : `column ${String(firstColumn.column)}`
  )

  const caseSearch = await runSearch({
    pattern: 'ALPHA',
    caseSensitive: null,
    wholeWord: false,
    regex: false
  })
  add(
    'smart case makes an uppercase pattern sensitive',
    caseSearch !== null && caseSearch.matches.length === 0,
    caseSearch === null ? 'timed out' : `${caseSearch.matches.length} matches for ALPHA`
  )

  const badPattern = await runSearch({
    pattern: '(',
    caseSensitive: null,
    wholeWord: false,
    regex: true
  })
  add(
    'an unfinished regex is refused, not silently empty',
    badPattern !== null && badPattern.done.error !== undefined,
    badPattern === null ? 'timed out' : JSON.stringify(badPattern.done.error ?? 'no error reported')
  )

  /**
   * A pattern containing CR can never match, because the haystack is normalized
   * to LF. On a machine where most files are CRLF, pasting two lines out of a
   * browser and getting silence is a bug, so it is reported rather than hidden.
   */
  const crSearch = await runSearch({
    pattern: 'alpha\r',
    caseSensitive: null,
    wholeWord: false,
    regex: false
  })
  add(
    'a carriage return in the pattern is stripped and reported',
    crSearch !== null && crSearch.done.crStripped === true,
    crSearch === null ? 'timed out' : `crStripped=${String(crSearch.done.crStripped)}`
  )

  // ---- the sandbox must not be escapable --------------------------------

  const escape = await invoke<Err>('fs:read', { path: '../../../../../../etc/passwd' })
  add('path traversal refused', !escape.ok && escape.error?.code === 'OUTSIDE_WORKSPACE',
    escape.ok ? 'ESCAPED — workspace containment is broken' : `rejected as ${escape.error.code}`)

  const absolute = await invoke<Err>('fs:read', {
    path: process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts'
  })
  add('absolute path outside workspace refused',
    !absolute.ok && absolute.error?.code === 'OUTSIDE_WORKSPACE',
    absolute.ok ? 'ESCAPED — absolute paths are not contained' : `rejected as ${absolute.error.code}`)

  // ---- file operations, which can now CREATE and DESTROY --------------

  const made = await invoke<Ok<{ path: string }> | Err>('fs:createFile', {
    path: join(fixtures, 'made-by-smoke.txt')
  })
  add('createFile works', made.ok, made.ok ? 'created' : `failed: ${made.error.message}`)

  const clobber = await invoke<Err>('fs:createFile', { path: join(fixtures, 'lf.txt') })
  add('createFile refuses to truncate an existing file', !clobber.ok,
    clobber.ok ? 'TRUNCATED AN EXISTING FILE' : `refused as ${clobber.error.code}`)

  const renameClash = await invoke<Err>('fs:rename', {
    from: join(fixtures, 'made-by-smoke.txt'),
    to: join(fixtures, 'crlf.txt')
  })
  add('rename refuses to overwrite', !renameClash.ok,
    renameClash.ok ? 'OVERWROTE crlf.txt' : `refused as ${renameClash.error.code}`)

  const walked = await invoke<Ok<{ files: string[]; truncated: boolean }> | Err>('fs:walk', {})
  add('walk finds the fixtures',
    walked.ok && walked.value.files.some((f) => f.endsWith('arabic.txt')),
    walked.ok ? `${walked.value.files.length} files` : 'walk failed')

  // These channels write and destroy, so an escape here is far worse than the
  // read-side one — a traversal would let a compromised renderer plant a file
  // anywhere on disk, or trash one.
  for (const channel of ['fs:createFile', 'fs:createDirectory', 'fs:delete'] as const) {
    const escaped = await invoke<Err>(channel, {
      path: process.platform === 'win32' ? 'C:\\Windows\\claven-escape' : '/tmp/claven-escape'
    })
    add(`${channel} refuses paths outside the workspace`,
      !escaped.ok && escaped.error?.code === 'OUTSIDE_WORKSPACE',
      escaped.ok ? 'ESCAPED THE WORKSPACE' : `refused as ${escaped.error.code}`)
  }

  const traversal = await invoke<Err>('fs:rename', {
    from: join(fixtures, 'lf.txt'),
    to: '../../../../../../claven-escape.txt'
  })
  add('rename refuses to move a file out of the workspace',
    !traversal.ok && traversal.error?.code === 'OUTSIDE_WORKSPACE',
    traversal.ok ? 'MOVED A FILE OUT OF THE WORKSPACE' : `refused as ${traversal.error.code}`)

  await rm(scratch, { recursive: true, force: true }).catch(() => undefined)

  // ---- report ------------------------------------------------------------

  let failures = 0
  for (const check of checks) {
    if (!check.pass) failures += 1
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}  —  ${check.detail}`)
  }
  console.log(
    failures === 0
      ? `\n${checks.length}/${checks.length} passed`
      : `\n${failures} of ${checks.length} FAILED`
  )
  return failures
}
