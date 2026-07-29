/**
 * Drives the real window over the DevTools protocol.
 *
 * `npm run smoke` proves the main process and the IPC contract. It cannot see
 * the renderer, so every UI regression so far has been found by hand — which
 * means found late, or not at all. This opens the actual app, restores a
 * session into a throwaway workspace, and clicks and types at it.
 *
 * No dependencies: node has fetch and WebSocket, and CDP is a JSON protocol.
 *
 * Run with: npm run drive
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 9333
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = join(
  REPO,
  'node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : 'electron'
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const checks = []
const add = (name, pass, detail) => checks.push({ name, pass, detail })

// A temp workspace and a temp profile. The profile matters for more than
// hygiene: the single-instance lock is per user-data directory, so this runs
// happily alongside an open `npm run dev`.
const workspace = await mkdtemp(join(tmpdir(), 'claven-drive-ws-'))
const userData = await mkdtemp(join(tmpdir(), 'claven-drive-ud-'))

const a = join(workspace, 'a.txt')
const b = join(workspace, 'b.txt')
const ts = join(workspace, 'typed.ts')
const lines = (word) => Array.from({ length: 8 }, (_, i) => `${word} line ${i}`).join('\n') + '\n'
await writeFile(a, lines('alpha'))
await writeFile(b, lines('bravo'))

// A real project for the language server to reason about. It needs a tsconfig
// to treat the file as part of anything.
await writeFile(
  join(workspace, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true, target: 'esnext', module: 'esnext' } }, null, 2)
)
// Valid on disk. The error is typed in later, and never saved — which is the
// whole point of the check.
await writeFile(ts, 'export const count: number = 1\n')

// Seeded rather than clicked: opening a folder means a native dialog, and CDP
// cannot reach one.
await writeFile(
  join(userData, 'session.json'),
  JSON.stringify({ root: workspace, openPaths: [a, b, ts], activePath: a, cursors: {} }, null, 2)
)

const child = spawn(
  ELECTRON,
  ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`],
  { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stderr.on('data', (data) => {
  const text = String(data)
  if (!text.includes('DevTools listening')) process.stderr.write(`[main] ${text}`)
})

const cleanup = async (code) => {
  child.kill()
  await sleep(300)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  process.exit(code)
}

let page = null
for (let i = 0; i < 60 && page === null; i += 1) {
  await sleep(500)
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null)
  const targets = response ? await response.json().catch(() => []) : []
  page = targets.find((target) => target.type === 'page') ?? null
}
if (page === null) {
  console.error('the window never opened — nothing to drive')
  await cleanup(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve))

let nextId = 1
const pending = new Map()
/** Anything the renderer complained about while we were driving it. */
const problems = []

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    pending.get(message.id)?.(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    report(message.params.exceptionDetails.exception?.description ?? 'exception')
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    report(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
  }
})

/**
 * Electron's own sandbox bootstrap, not Claven's code.
 *
 * Attaching a debugger creates an extra renderer, and its internal bundle
 * intermittently fails to read startup data before the real window has
 * finished initialising. It appears on roughly half of runs, in a file nobody
 * here wrote, and never with any user-visible effect.
 *
 * Matched narrowly on purpose: the check exists to catch the application
 * logging errors, and a broad filter would eventually swallow one of those.
 */
const ELECTRON_INTERNAL = /sandboxed_renderer\.bundle\.js|preloadScripts.*binding\.startupData/

function report(text) {
  if (!ELECTRON_INTERNAL.test(text)) problems.push(text)
}

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  return response.result?.result?.value
}

await send('Runtime.enable')

let mounted = false
for (let i = 0; i < 40 && !mounted; i += 1) {
  await sleep(250)
  mounted = (await evaluate(`!!document.querySelector('.cm-content')`)) === true
}
if (!mounted) {
  console.error('the editor never mounted')
  console.error(await evaluate(`document.body.innerHTML.slice(0, 1000)`))
  await cleanup(1)
}

const text = () => evaluate(`document.querySelector('.cm-content').textContent`)
const focusEditor = () => evaluate(`document.querySelector('.cm-content').focus(), true`)
const clickTab = (name) =>
  evaluate(
    `Array.from(document.querySelectorAll('main button'))
       .find((button) => button.textContent.trim() === ${JSON.stringify(name)})?.click(), true`
  )

const tabs = await evaluate(
  `Array.from(document.querySelectorAll('main .max-w-48')).map((n) => n.textContent).join(',')`
)
add('the session restores every tab', tabs === 'a.txt,b.txt,typed.ts', `tabs = ${tabs}`)

await focusEditor()
await send('Input.insertText', { text: 'TYPED-' })
await sleep(200)
const typed = await text()
add('typing reaches the document', typed.startsWith('TYPED-'), typed.slice(0, 24))

await clickTab('b.txt')
await sleep(250)
const other = await text()
add('switching tabs shows the other file', other.startsWith('bravo'), other.slice(0, 24))

await clickTab('a.txt')
await sleep(250)
const returned = await text()
add('switching back keeps the edit', returned.startsWith('TYPED-'), returned.slice(0, 24))

/**
 * The check this file was written for.
 *
 * The editor used to carry a React `key` on the file path, so every tab switch
 * remounted CodeMirror and threw away its history. You would switch away to
 * check something, come back, press ctrl+z and nothing would happen.
 */
await focusEditor()
for (const type of ['rawKeyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', {
    type,
    modifiers: 2, // ctrl
    key: 'z',
    code: 'KeyZ',
    windowsVirtualKeyCode: 90,
    nativeVirtualKeyCode: 90
  })
}
await sleep(300)
const undone = await text()
add('undo survives a tab switch', !undone.startsWith('TYPED-'), undone.slice(0, 24))

/**
 * M3's definition of done, in one check: a TypeScript error squiggles without
 * saving.
 *
 * Everything about it is deliberate. The file is valid on disk and the error is
 * typed into the buffer, so a pass cannot be explained by the server having
 * read the file. And it waits for the squiggle to appear rather than sleeping a
 * fixed time, because a cold TypeScript program can take a few seconds and a
 * fixed sleep would either be flaky or slow.
 */
await clickTab('typed.ts')
await sleep(600)
await focusEditor()
// Select all, then replace the whole file with a version the compiler cannot
// accept: a string assigned to a `number`.
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.insertText', { text: "export const count: number = 'not a number'\n" })

let squiggle = null
for (let i = 0; i < 40 && squiggle === null; i += 1) {
  await sleep(1000)
  const found = await evaluate(`
    (() => {
      const mark = document.querySelector('.cm-lintRange-error')
      if (mark === null) return null
      return mark.textContent
    })()
  `)
  if (typeof found === 'string') squiggle = found
}
add(
  'a typescript error squiggles without saving',
  squiggle !== null,
  squiggle === null ? 'no diagnostic after 40s' : `underlined ${JSON.stringify(squiggle)}`
)

add('the renderer logged nothing', problems.length === 0, problems.slice(0, 3).join(' | ') || 'clean')

let failures = 0
for (const check of checks) {
  if (!check.pass) failures += 1
  console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}  —  ${check.detail}`)
}
console.log(
  failures === 0 ? `\n${checks.length}/${checks.length} passed` : `\n${failures} of ${checks.length} FAILED`
)

socket.close()
await cleanup(failures === 0 ? 0 : 1)
