import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
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

  const surface = await evaluate<string>(`Object.keys(window.claven).sort().join(',')`)
  add('bridge surface is minimal', surface === 'invoke', `window.claven = { ${surface} }`)

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
