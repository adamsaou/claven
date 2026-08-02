import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { setWorkspaceRoot } from './workspace'
import type { FileMeta, ReadResult } from '../shared/files'
import { lineChanges } from '../shared/linediff'
import {
  activateItem,
  addItem,
  defaultLayout,
  findPane,
  isPane,
  isSplit,
  itemsOfKind,
  MIN_FRACTION,
  moveItem,
  nextId,
  paneOfItem,
  panes,
  panesOfKind,
  parseLayout,
  removeItem,
  removePane,
  resetIds,
  resizeSplit,
  seedIds,
  splitPane,
  stripPanes,
  type LayoutNode,
  type Pane
} from '../shared/layout'

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
    unsaved?: Record<string, string>
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
   * An unsaved buffer answers for its file.
   *
   * Search reads disk, which is right for the thousands of files you are not
   * looking at and wrong for the one you are editing. Two halves: the buffer's
   * text is found, and the file's own text is not, because the buffer replaced
   * it rather than being searched alongside it.
   */
  const buffered = await runSearch({
    pattern: 'BUFFER_ONLY_SENTINEL',
    caseSensitive: null,
    wholeWord: false,
    regex: false,
    unsaved: { 'fixtures/lf.txt': 'BUFFER_ONLY_SENTINEL is not on disk\n' }
  })
  add(
    'search reads an unsaved buffer instead of the file',
    buffered !== null && buffered.matches.length === 1 &&
      String(buffered.matches[0]?.file) === 'fixtures/lf.txt',
    buffered === null ? 'timed out' : `${buffered.matches.length} match(es) in ${buffered.matches.map((m) => String(m.file)).join(', ') || 'nothing'}`
  )

  const shadowed = await runSearch({
    pattern: 'alpha',
    caseSensitive: null,
    wholeWord: false,
    regex: false,
    unsaved: { 'fixtures/lf.txt': 'nothing to see here\n' }
  })
  const shadowedHit = shadowed?.matches.some((m) => String(m.file) === 'fixtures/lf.txt') ?? true
  add(
    'the buffer replaces the file rather than being searched as well as it',
    shadowed !== null && !shadowedHit,
    shadowed === null ? 'timed out' : `lf.txt ${shadowedHit ? 'still matched from disk' : 'answered from the buffer'}`
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

  // ---- the layout tree ---------------------------------------------------
  //
  // Pure functions on plain data, which is exactly why they live in `shared`:
  // proving that collapsing a split works should not require driving a window.
  //
  // Files and terminals share every operation here, so most of these are
  // checked once against whichever kind reads more clearly and the pane-kind
  // rules are checked against both.

  resetIds()
  const base = defaultLayout()
  const editorId = base.id

  add('a fresh layout is one empty editor pane',
    isPane(base) && base.content.type === 'editors' && base.content.items.length === 0,
    isPane(base) ? `${base.content.type}, ${base.content.items.length} items` : 'not a pane')

  const withBottom = splitPane(base, editorId, 'bottom', {
    kind: 'pane',
    id: 't1',
    content: { type: 'terminals', items: ['a'], active: 'a' }
  })
  add('splitting a pane makes a split of two',
    isSplit(withBottom) && withBottom.direction === 'column' && withBottom.children.length === 2,
    isSplit(withBottom) ? `${withBottom.direction}, ${withBottom.children.length} children` : 'not a split')

  add('the new pane gets the smaller share',
    isSplit(withBottom) && (withBottom.sizes[1] ?? 1) < (withBottom.sizes[0] ?? 0),
    isSplit(withBottom) ? withBottom.sizes.map((s) => s.toFixed(2)).join(' / ') : 'n/a')

  // A second terminal to the right of the first, then a third to the right of
  // that: naively this nests two row splits inside each other.
  const twoWide = splitPane(withBottom, 't1', 'right', {
    kind: 'pane',
    id: 't2',
    content: { type: 'terminals', items: ['b'], active: 'b' }
  })
  const threeWide = splitPane(twoWide, 't2', 'right', {
    kind: 'pane',
    id: 't3',
    content: { type: 'terminals', items: ['c'], active: 'c' }
  })
  const row = (isSplit(threeWide) ? threeWide.children[1] : null) ?? null
  add('same-direction splits flatten instead of nesting',
    row !== null && isSplit(row) && row.children.length === 3 && row.children.every(isPane),
    row !== null && isSplit(row) ? `${row.children.length} children, nested: ${!row.children.every(isPane)}` : 'no row')

  add('flattening keeps the fractions summing to one',
    row !== null && isSplit(row) && Math.abs(row.sizes.reduce((sum, s) => sum + s, 0) - 1) < 1e-9,
    row !== null && isSplit(row) ? row.sizes.map((s) => s.toFixed(3)).join(' + ') : 'n/a')

  const closedOne = removeItem(threeWide, 'terminals', 'b')
  add('closing the last item in a pane removes the pane',
    panes(closedOne).length === 3 && findPane(closedOne, 't2') === null,
    `${panes(closedOne).length} panes left`)

  const closedAll = ['a', 'c'].reduce((tree, key) => removeItem(tree, 'terminals', key), closedOne)
  add('closing every terminal collapses back to the editor',
    isPane(closedAll) && closedAll.content.type === 'editors',
    isPane(closedAll) ? `single ${closedAll.content.type} pane` : 'still a split')

  const moved = moveItem(threeWide, 'terminals', 'c', { paneId: 't1', edge: 'center' })
  const host = paneOfItem(moved, 'terminals', 'c')
  add('an item dropped on a tab strip joins it',
    host?.id === 't1' && findPane(moved, 't3') === null,
    `c now lives in ${host?.id ?? 'nowhere'}`)

  add("dropping a pane's only item on itself does nothing",
    moveItem(withBottom, 'terminals', 'a', { paneId: 't1', edge: 'left' }) === withBottom,
    'move refused')

  add('a tab strip refuses the other kind',
    moveItem(withBottom, 'terminals', 'a', { paneId: editorId, edge: 'center' }) === withBottom,
    'move refused')

  const beside = moveItem(withBottom, 'terminals', 'a', { paneId: editorId, edge: 'right' })
  add('an edge takes the other kind, which is the point',
    paneOfItem(beside, 'terminals', 'a')?.id !== 't1' &&
      panesOfKind(beside, 'terminals').length === 1,
    `terminal landed in ${paneOfItem(beside, 'terminals', 'a')?.id ?? 'nowhere'}`)

  const hiddenTree = stripPanes(threeWide, 'terminals')
  add('hiding terminals leaves the editor alone in the tree',
    isPane(hiddenTree) && hiddenTree.id === editorId,
    isPane(hiddenTree) ? 'one editor pane' : 'still a split')

  add('hiding terminals does not lose them from the real layout',
    itemsOfKind(threeWide, 'terminals').join(',') === 'a,b,c',
    `layout still holds ${itemsOfKind(threeWide, 'terminals').join(',')}`)

  // ---- editor panes, which are the same thing with a different kind ------

  resetIds()
  const oneEditor = addItem(addItem(defaultLayout(), 'pane1', 'a.ts'), 'pane1', 'b.ts')
  add('opening a file activates it',
    isPane(oneEditor) && oneEditor.content.active === 'b.ts',
    isPane(oneEditor) ? `active is ${String(oneEditor.content.active)}` : 'not a pane')

  // Dragged to an edge, which is what the UI does. Splitting off an empty pane
  // and filling it afterwards is deliberately no longer possible: see
  // pruneEmptyPanes.
  const sideBySide = moveItem(oneEditor, 'editors', 'b.ts', { paneId: 'pane1', edge: 'right' })
  const secondPaneId = paneOfItem(sideBySide, 'editors', 'b.ts')?.id ?? ''
  add('a file can be dragged into another editor pane',
    secondPaneId !== '' && secondPaneId !== 'pane1' &&
      paneOfItem(sideBySide, 'editors', 'a.ts')?.id === 'pane1',
    `a.ts in ${paneOfItem(sideBySide, 'editors', 'a.ts')?.id ?? '?'}, b.ts in ${secondPaneId || '?'}`)

  add('the pane a file left falls back to what is still in it',
    findPane(sideBySide, 'pane1')?.content.active === 'a.ts',
    `pane1 shows ${String(findPane(sideBySide, 'pane1')?.content.active)}`)

  const closedSecond = removeItem(sideBySide, 'editors', 'b.ts')
  add('closing the last file in a second editor pane removes the pane',
    panesOfKind(closedSecond, 'editors').length === 1,
    `${panesOfKind(closedSecond, 'editors').length} editor pane(s) left`)

  // The last editor pane is the one thing that cannot go: without it there is
  // nowhere for the next file to open.
  const emptied = removeItem(closedSecond, 'editors', 'a.ts')
  add('the last editor pane survives losing its last file',
    panesOfKind(emptied, 'editors').length === 1 && itemsOfKind(emptied, 'editors').length === 0,
    `${panesOfKind(emptied, 'editors').length} pane, ${itemsOfKind(emptied, 'editors').length} files`)

  add('the last editor pane cannot be removed',
    removePane(emptied, panesOfKind(emptied, 'editors')[0]!.id) === emptied,
    'removePane refused')

  add('a second editor pane can be removed',
    panesOfKind(removePane(sideBySide, secondPaneId), 'editors').length === 1,
    'removePane allowed it')

  /**
   * The bug from the screenshot, in one line.
   *
   * Drag the only file out of the only editor pane. The pane it left is empty
   * at the instant it is judged, so it is spared as the last editor pane, and
   * then the drop creates a second one beside it. Nothing afterwards would ever
   * remove the empty one, and it sat there drawing a tab strip over nothing.
   */
  resetIds()
  const lonely = addItem(defaultLayout(), 'pane1', 'only.ts')
  const afterDrag = moveItem(lonely, 'editors', 'only.ts', { paneId: 'pane1', edge: 'right' })
  add('dragging the only file out of the only editor pane leaves no ghost',
    panesOfKind(afterDrag, 'editors').length === 1 &&
      itemsOfKind(afterDrag, 'editors').join(',') === 'only.ts',
    `${panesOfKind(afterDrag, 'editors').length} editor pane(s), holding ${itemsOfKind(afterDrag, 'editors').join(',') || 'nothing'}`)

  add('activating a file that is not open does nothing',
    activateItem(sideBySide, 'editors', 'nope.ts') === sideBySide,
    'activate refused')

  // ---- dividers and storage ----------------------------------------------

  const dragged = resizeSplit(withBottom, isSplit(withBottom) ? withBottom.id : '', 0, 0.8)
  add('dragging a divider keeps the pair summing to what it had',
    isSplit(dragged) && Math.abs((dragged.sizes[0] ?? 0) + (dragged.sizes[1] ?? 0) - 1) < 1e-9,
    isSplit(dragged) ? dragged.sizes.map((s) => s.toFixed(2)).join(' / ') : 'n/a')

  const squashed = resizeSplit(withBottom, isSplit(withBottom) ? withBottom.id : '', 0, 5)
  add("a divider cannot be dragged past a pane's minimum",
    isSplit(squashed) && (squashed.sizes[1] ?? 0) >= MIN_FRACTION - 1e-9,
    isSplit(squashed) ? `trailing pane at ${(squashed.sizes[1] ?? 0).toFixed(2)}` : 'n/a')

  add('a layout round trips through storage',
    JSON.stringify(parseLayout(JSON.parse(JSON.stringify(sideBySide)))) === JSON.stringify(sideBySide),
    'parse(stringify(x)) === x')

  add('a layout with no editor pane is rejected whole',
    parseLayout({ kind: 'pane', id: 'x', content: { type: 'terminals', items: ['a'], active: 'a' } }) === null,
    'parseLayout returned null')

  add('an empty terminal pane is rejected, an empty editor pane is not',
    parseLayout({ kind: 'pane', id: 'x', content: { type: 'terminals', items: [], active: null } }) === null &&
      parseLayout({ kind: 'pane', id: 'x', content: { type: 'editors', items: [], active: null } }) !== null,
    'one rejected, one kept')

  add('garbage in storage is rejected rather than repaired',
    parseLayout({ kind: 'pane', id: 'x' }) === null && parseLayout('nonsense') === null,
    'parseLayout returned null for both')

  // A restored layout brings ids with it, and the counter has to clear them or
  // the next pane created collides with one already on screen.
  resetIds()
  const restoredLayout = parseLayout(JSON.parse(JSON.stringify(threeWide)))
  if (restoredLayout !== null) seedIds(restoredLayout)
  const freshId = nextId('pane')
  add('ids restored from storage cannot collide with new ones',
    restoredLayout !== null &&
      findPane(restoredLayout, freshId) === null &&
      !itemsOfKind(restoredLayout, 'terminals').includes(freshId),
    `next id after restore was ${freshId}`)

  // ---- the layout tree, fuzzed -------------------------------------------
  //
  // The checks above prove the operations one at a time. This proves that no
  // SEQUENCE of them reaches a tree the UI cannot draw, which is a different
  // claim and the one that matters: a pane with an empty tab strip and nothing
  // under it is not something any single operation produces on purpose.
  //
  // Seeded, so a failure names the exact sequence that caused it rather than
  // being a thing that happened once on someone's machine.

  const invariantsOf = (root: LayoutNode): string[] => {
    const broken: string[] = []
    const ids = new Set<string>()
    const items = new Set<string>()

    const visit = (node: LayoutNode): void => {
      if (ids.has(node.id)) broken.push(`duplicate id ${node.id}`)
      ids.add(node.id)

      if (isPane(node)) {
        /**
         * A pane drawing a tab strip over nothing, which is what the bug
         * looked like on screen.
         *
         * An empty editor pane is legal on its own: it is the state you are in
         * with no files open. It is not legal alongside another editor pane,
         * because then it is a ghost nothing will ever remove.
         */
        if (node.content.items.length === 0) {
          if (node.content.type === 'terminals') broken.push(`empty terminal pane ${node.id}`)
          else if (panesOfKind(root, 'editors').length > 1) {
            broken.push(`empty editor pane ${node.id} alongside another`)
          }
        }
        if (node.content.active !== null && !node.content.items.includes(node.content.active)) {
          broken.push(`pane ${node.id} active ${node.content.active} is not one of its items`)
        }
        if (node.content.active === null && node.content.items.length > 0) {
          broken.push(`pane ${node.id} has items but nothing active`)
        }
        for (const item of node.content.items) {
          if (items.has(item)) broken.push(`${item} appears in two panes`)
          items.add(item)
        }
        return
      }

      if (node.children.length < 2) broken.push(`split ${node.id} has ${node.children.length} children`)
      if (node.sizes.length !== node.children.length) {
        broken.push(`split ${node.id} has ${node.sizes.length} sizes for ${node.children.length} children`)
      }
      const total = node.sizes.reduce((sum, size) => sum + size, 0)
      if (Math.abs(total - 1) > 1e-6) broken.push(`split ${node.id} sizes sum to ${total.toFixed(4)}`)
      if (node.sizes.some((size) => !(size > 0))) broken.push(`split ${node.id} has a non-positive size`)
      node.children.forEach(visit)
    }

    visit(root)
    if (panesOfKind(root, 'editors').length === 0) broken.push('no editor pane left')
    return broken
  }

  /** A tiny seeded generator. Deterministic beats random for a test that fails. */
  const generator = (seed: number): (() => number) => {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  const EDGES = ['left', 'right', 'top', 'bottom', 'center'] as const
  let fuzzFailure: string | null = null
  let sequences = 0
  let operations = 0

  for (let seed = 1; seed <= 200 && fuzzFailure === null; seed += 1) {
    const random = generator(seed)
    const pick = <T>(list: readonly T[]): T | undefined =>
      list.length === 0 ? undefined : list[Math.floor(random() * list.length)]

    resetIds()
    let tree: LayoutNode = defaultLayout()
    const history: string[] = []
    sequences += 1

    for (let step = 0; step < 40 && fuzzFailure === null; step += 1) {
      const allPanes = panes(tree)
      const files = itemsOfKind(tree, 'editors')
      const terminals = itemsOfKind(tree, 'terminals')
      const move = Math.floor(random() * 6)
      const before = tree
      operations += 1

      if (move === 0) {
        const pane = pick(panesOfKind(tree, 'editors'))
        if (pane === undefined) continue
        const file = `file${step}.ts`
        history.push(`addItem(${pane.id}, ${file})`)
        tree = addItem(tree, pane.id, file)
      } else if (move === 1) {
        const pane = pick(panesOfKind(tree, 'terminals'))
        if (pane === undefined) continue
        const key = `terminal${step}`
        history.push(`addItem(${pane.id}, ${key})`)
        tree = addItem(tree, pane.id, key)
      } else if (move === 2) {
        const kind = random() < 0.5 ? 'editors' : 'terminals'
        const item = pick(kind === 'editors' ? files : terminals)
        if (item === undefined) continue
        history.push(`removeItem(${kind}, ${item})`)
        tree = removeItem(tree, kind, item)
      } else if (move === 3) {
        const kind = random() < 0.5 ? 'editors' : 'terminals'
        const item = pick(kind === 'editors' ? files : terminals)
        const target = pick(allPanes)
        const edge = pick(EDGES)
        if (item === undefined || target === undefined || edge === undefined) continue
        history.push(`moveItem(${kind}, ${item}, ${target.id}, ${edge})`)
        tree = moveItem(tree, kind, item, { paneId: target.id, edge })
      } else if (move === 4) {
        const target = pick(allPanes)
        const edge = pick(['left', 'right', 'top', 'bottom'] as const)
        if (target === undefined || edge === undefined) continue
        const kind = random() < 0.5 ? 'editors' : 'terminals'
        const key = `${kind === 'editors' ? 'split' : 'shell'}${step}`
        const incoming: Pane =
          kind === 'editors'
            ? { kind: 'pane', id: nextId('pane'), content: { type: 'editors', items: [key], active: key } }
            : { kind: 'pane', id: nextId('pane'), content: { type: 'terminals', items: [key], active: key } }
        history.push(`splitPane(${target.id}, ${edge}, ${kind})`)
        tree = splitPane(tree, target.id, edge, incoming)
      } else {
        const target = pick(allPanes)
        if (target === undefined) continue
        history.push(`removePane(${target.id})`)
        tree = removePane(tree, target.id)
      }

      const broken = invariantsOf(tree)
      if (broken.length > 0) {
        fuzzFailure = `seed ${seed} step ${step}: ${broken.join('; ')}\n    after: ${history.slice(-6).join(' -> ')}`
      }
      // Unused, but keeps the intent explicit: an operation may legitimately be
      // a no-op, and that is not a failure.
      void before
    }
  }

  add('no sequence of layout operations reaches a tree the UI cannot draw',
    fuzzFailure === null,
    fuzzFailure ?? `${sequences} sequences, ${operations} operations, invariants held`)

  // ---- the line diff, for the gutter ------------------------------------
  //
  // Pure, so it is checked here rather than by driving a window. The gutter is
  // the most-glanced-at thing in an editor and the least deliberately looked
  // at, which is the combination that hides a wrong answer for months.

  const marks = (before: string | null, after: string): string =>
    lineChanges(before, after)
      .map((change) => `${change.line}${change.kind[0]}`)
      .join(' ')

  /** Built from an array so the test source has no escape sequences to get wrong. */
  const doc = (...lines: string[]): string => lines.join('\n') + '\n'

  add('an unchanged file has no marks',
    marks(doc('a', 'b', 'c'), doc('a', 'b', 'c')) === '',
    `marks: ${marks(doc('a', 'b', 'c'), doc('a', 'b', 'c')) || 'none'}`)

  add('a file with no baseline is entirely added',
    marks(null, doc('a', 'b')) === '1a 2a',
    marks(null, doc('a', 'b')))

  add('an inserted line is added, and only that line',
    marks(doc('a', 'c'), doc('a', 'b', 'c')) === '2a',
    marks(doc('a', 'c'), doc('a', 'b', 'c')))

  add('a changed line is modified, not added',
    marks(doc('a', 'b', 'c'), doc('a', 'B', 'c')) === '2m',
    marks(doc('a', 'b', 'c'), doc('a', 'B', 'c')))

  // Marked on the line the deleted text sat after, since there is no line left
  // to point at. See the note on LineChange.
  add('a deletion marks the line it sat after',
    marks(doc('a', 'b', 'c'), doc('a', 'c')) === '1r',
    marks(doc('a', 'b', 'c'), doc('a', 'c')))

  add('a deletion from the very top reports line one',
    marks(doc('a', 'b', 'c'), doc('b', 'c')) === '1r',
    marks(doc('a', 'b', 'c'), doc('b', 'c')))

  add('replacing one line with two is one modified and one added',
    marks(doc('a', 'b', 'c'), doc('a', 'B', 'B2', 'c')) === '2m 3a',
    marks(doc('a', 'b', 'c'), doc('a', 'B', 'B2', 'c')))

  add('a missing trailing newline is not a phantom last line',
    marks('a\nb', doc('a', 'b')) === '',
    `marks: ${marks('a\nb', doc('a', 'b')) || 'none'}`)

  add('an edit at the very first line is found',
    marks(doc('a', 'b'), doc('A', 'b')) === '1m',
    marks(doc('a', 'b'), doc('A', 'b')))

  // The case the prefix and suffix trimming exists for. One edit in a large
  // file must mark one line and must not walk the whole thing to say so.
  const big = doc(...Array.from({ length: 4000 }, (_, index) => `line ${index}`))
  const edited = big.replace('line 2000\n', 'line 2000 changed\n')
  const startedDiff = Date.now()
  const bigMarks = marks(big, edited)
  const bigTook = Date.now() - startedDiff
  add('one edit in a four thousand line file marks one line, quickly',
    bigMarks === '2001m' && bigTook < 250,
    `${bigMarks} in ${bigTook}ms`)

  /**
   * The CRLF case, which is the one that will actually happen.
   *
   * git hands back object database bytes, and this repo marks tests/fixtures
   * `-text binary` in .gitattributes, so those blobs keep the endings they were
   * committed with. Measured against the real bytes before this was fixed: a
   * CRLF baseline against its own unmodified buffer reported every line
   * modified, and a lone-CR baseline collapsed to one line.
   */
  add('a CRLF baseline against an LF buffer is not a whole-file change',
    marks('a\r\nb\r\nc\r\n', doc('a', 'b', 'c')) === '',
    `marks: ${marks('a\r\nb\r\nc\r\n', doc('a', 'b', 'c')) || 'none'}`)

  add('a lone-CR baseline is not one enormous line',
    marks('a\rb\rc\r', doc('a', 'b', 'c')) === '',
    `marks: ${marks('a\rb\rc\r', doc('a', 'b', 'c')) || 'none'}`)

  /**
   * Lines that vanish under a replacement must not be silent. Five lines
   * becoming one used to report a single modified line and say nothing about
   * the four that went.
   */
  add('lines lost to a shorter replacement are still reported',
    marks(doc('a', 'x1', 'x2', 'x3', 'b'), doc('a', 'y', 'b')) === '2m 2r',
    marks(doc('a', 'x1', 'x2', 'x3', 'b'), doc('a', 'y', 'b')))

  add('an equal-length replacement reports no loss',
    marks(doc('a', 'x', 'b'), doc('a', 'y', 'b')) === '2m',
    marks(doc('a', 'x', 'b'), doc('a', 'y', 'b')))

  // Empty and near-empty inputs, which is where an off-by-one hides.
  add('empty against empty is no change',
    marks('', '') === '',
    `marks: ${marks('', '') || 'none'}`)

  add('empty baseline against content is all added',
    marks('', doc('a', 'b')) === '1a 2a',
    marks('', doc('a', 'b')))

  add('content emptied is reported as removed',
    marks(doc('a', 'b'), '') === '1r',
    marks(doc('a', 'b'), ''))

  /**
   * No mark may point past the end of the buffer. A gutter asked to draw on a
   * line that does not exist is the failure that takes the editor down rather
   * than looking wrong, so it is checked over a spread of shapes rather than
   * one example.
   */
  const shapes: Array<[string, string]> = [
    [doc('a', 'b', 'c'), doc('a')],
    [doc('a', 'b', 'c'), ''],
    [doc('a'), doc('a', 'b', 'c')],
    [doc('a', 'b', 'c', 'd', 'e'), doc('e', 'd', 'c', 'b', 'a')],
    [doc('x', 'x', 'x', 'x'), doc('x', 'x', 'x')],
    [doc('a', 'b'), doc('b', 'a')],
    ['', ''],
    [doc('a'), '']
  ]
  let outOfRange: string | null = null
  for (const [before, after] of shapes) {
    const lines = after === '' ? 0 : after.split(/\r\n?|\n/).filter((_l, i, all) =>
      i < all.length - 1 || all[i] !== '').length
    for (const change of lineChanges(before, after)) {
      if (change.line < 1 || change.line > Math.max(1, lines)) {
        outOfRange = `${JSON.stringify(after)} has ${lines} lines, got a mark on ${change.line}`
        break
      }
    }
    if (outOfRange !== null) break
  }
  add('no mark ever points past the end of the buffer',
    outOfRange === null,
    outOfRange ?? `${shapes.length} shapes, every mark in range`)

  // ---- git, against a real throwaway repository --------------------------
  //
  // Run against actual git rather than a stub. Every interesting behaviour here
  // is a thing git does that the obvious command gets wrong, so a stub would
  // only ever confirm what I already believed.

  const repo = await mkdtemp(join(tmpdir(), 'claven-git-'))
  const git = (...args: string[]): Promise<{ code: number; out: string }> =>
    new Promise((resolve) => {
      // A committer identity is passed explicitly. `git commit` fails with
      // "Please tell me who you are" wherever user.name and user.email are
      // unset, which is most CI machines.
      const child = spawn(
        'git',
        ['-c', 'user.email=smoke@claven.dev', '-c', 'user.name=smoke', ...args],
        { cwd: repo, windowsHide: true }
      )
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', () => resolve({ code: -1, out: '' }))
      child.on('close', (code) =>
        resolve({ code: code ?? -1, out: Buffer.concat(chunks).toString('utf8') })
      )
    })

  await git('init', '--quiet')
  // Not assumed to be 'main'. init.defaultBranch is 'master' on this machine,
  // and asserting either name would be asserting a local config value.
  await git('checkout', '-q', '-B', 'smoke-branch')
  await writeFile(join(repo, 'tracked.txt'), 'one\ntwo\nthree\n')
  // Committed with CRLF and marked binary, so git stores the CR bytes verbatim.
  // This is the case that made every line of an unmodified file read as changed.
  await writeFile(join(repo, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n')
  await writeFile(join(repo, '.gitattributes'), 'crlf.txt -text\n')
  await git('add', '-A')
  await git('commit', '--quiet', '-m', 'first')
  await writeFile(join(repo, 'untracked.txt'), 'never committed\n')

  await setWorkspaceRoot(repo)

  const info = await invoke<Ok<{ isRepo: boolean; branch: string | null }> | Err>('git:info', {})
  add('git:info reports the branch of a real repo',
    info.ok && info.value.isRepo && info.value.branch === 'smoke-branch',
    info.ok ? `isRepo=${info.value.isRepo}, branch=${String(info.value.branch)}` : 'invoke failed')

  type Baseline = { state: string; content?: string }
  const baselineOf = async (name: string): Promise<Baseline | null> => {
    const result = await invoke<Ok<Baseline> | Err>('git:baseline', { path: join(repo, name) })
    return result.ok ? result.value : null
  }

  const tracked = await baselineOf('tracked.txt')
  add('a tracked file has its committed text as a baseline',
    tracked?.state === 'tracked' && tracked.content === 'one\ntwo\nthree\n',
    `${String(tracked?.state)}: ${JSON.stringify(tracked?.content ?? null)}`)

  const untracked = await baselineOf('untracked.txt')
  add('an untracked file is untracked, not an error and not empty',
    untracked?.state === 'untracked',
    String(untracked?.state))

  const missing = await baselineOf('does-not-exist.txt')
  add('a path git has never heard of is untracked rather than a failure',
    missing?.state === 'untracked',
    String(missing?.state))

  /**
   * The one that matters.
   *
   * `git cat-file` returns object database bytes with no filter applied, so a
   * file marked `-text` keeps the CRLF it was committed with. The editor buffer
   * is always LF. Without normalising the baseline in main, an untouched file
   * shows every line modified, and a whole file lit up looks like a fetch bug
   * rather than an encoding one.
   */
  const crlfBaseline = await baselineOf('crlf.txt')
  add('a CRLF baseline comes back normalised to LF',
    crlfBaseline?.state === 'tracked' && crlfBaseline.content === 'one\ntwo\nthree\n',
    JSON.stringify(crlfBaseline?.content ?? null))

  const crlfRead = await invoke<Ok<ReadResult> | Err>('fs:read', { path: join(repo, 'crlf.txt') })
  const crlfBuffer = crlfRead.ok && crlfRead.value.kind === 'text' ? crlfRead.value.content : ''
  add('an unmodified CRLF file shows no changes at all',
    crlfBaseline?.state === 'tracked' &&
      lineChanges(crlfBaseline.content ?? null, crlfBuffer).length === 0,
    `${lineChanges(crlfBaseline?.content ?? null, crlfBuffer).length} marks on an untouched file`)

  // A directory must not come back holding some file's contents. Without the
  // guard, `ls-tree -r` returns every blob underneath and the first record gets
  // silently treated as the answer.
  const directory = await baselineOf('.')
  add('a directory has no baseline rather than a wrong one',
    directory?.state === 'none' || directory?.state === 'untracked',
    `${String(directory?.state)}${directory?.content === undefined ? '' : ' WITH CONTENT'}`)

  // And a workspace that is not a repo says so instead of failing.
  const plain = await mkdtemp(join(tmpdir(), 'claven-nogit-'))
  await writeFile(join(plain, 'a.txt'), 'hello\n')
  await setWorkspaceRoot(plain)
  const noRepo = await invoke<Ok<{ isRepo: boolean; branch: string | null }> | Err>('git:info', {})
  add('a workspace that is not a repo reports so quietly',
    noRepo.ok && !noRepo.value.isRepo && noRepo.value.branch === null,
    noRepo.ok ? `isRepo=${noRepo.value.isRepo}` : 'invoke failed')

  await rm(repo, { recursive: true, force: true }).catch(() => undefined)
  await rm(plain, { recursive: true, force: true }).catch(() => undefined)
  // Deliberately not restored to `scratch`: that directory was removed earlier
  // in this run, and setWorkspaceRoot realpaths, so pointing at it throws
  // ENOENT and takes the whole suite down after every check has passed.

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
