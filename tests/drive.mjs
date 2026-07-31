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
/**
 * Owned by the watcher check alone.
 *
 * Sharing a file with the editing checks meant it arrived dirty, the silent
 * reload was correctly refused, and that read as the watcher being broken when
 * it was working exactly as designed.
 */
const watched = join(workspace, 'watched.txt')
/**
 * Never opened as a tab, so its buffer cannot diverge from disk.
 *
 * Search reads what is on disk. Clicking a hit in a file with unsaved edits
 * would open the buffer and land the cursor on a line number that only exists
 * in the file as saved, which is a real limitation rather than a test artifact.
 */
const haystack = join(workspace, 'haystack.txt')
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
await writeFile(watched, 'untouched\n')
await writeFile(
  haystack,
  ['first', 'second', 'third', 'NEEDLE_ON_LINE_FOUR', 'fifth'].join('\n') + '\n'
)

// Seeded rather than clicked: opening a folder means a native dialog, and CDP
// cannot reach one.
await writeFile(
  join(userData, 'session.json'),
  JSON.stringify(
    { root: workspace, openPaths: [a, b, ts, watched], activePath: a, cursors: {} },
    null,
    2
  )
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
add(
  'the session restores every tab',
  tabs === 'a.txt,b.txt,typed.ts,watched.txt',
  `tabs = ${tabs}`
)

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
 * Two editing gestures that were silently absent.
 *
 * `allowMultipleSelections` defaults to false, so ctrl+d was bound to "select
 * next occurrence" and could not physically produce a second one. Neither
 * failure showed up as an error, which is why both are pinned here.
 */
await clickTab('b.txt')
await sleep(300)
await focusEditor()
/**
 * Two things this check got wrong before it got them right, both of them
 * correct behaviour being mistaken for a bug.
 *
 * `Input.insertText` looks like a paste, and auto-closing deliberately does
 * not fire on paste. So the bracket is typed as a key event.
 *
 * And auto-closing only fires when the next character is whitespace, the end
 * of the line, or a closing bracket. Typing `(` directly in front of a word
 * correctly inserts just the one character, which is what VS Code does too.
 * Hence the jump to the end of the document first.
 */
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
await sleep(200)
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: '(',
  code: 'Digit9',
  text: '(',
  unmodifiedText: '9',
  modifiers: 8, // shift
  windowsVirtualKeyCode: 57
})
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '(', code: 'Digit9', modifiers: 8, windowsVirtualKeyCode: 57 })
await sleep(400)
const bracketed = await text()
add(
  'brackets close themselves',
  bracketed.endsWith('()'),
  JSON.stringify(bracketed.slice(-12))
)

// Select the first "bravo", then ctrl+d to add the next occurrence as a
// second selection range.
await evaluate(`
  (() => {
    const line = document.querySelector('.cm-content')
    const range = document.createRange()
    const node = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode()
    return true
  })()
`)
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.insertText', { text: 'dup\ndup\ndup\n' })
await sleep(300)
// Put the cursor on the first "dup", select the word, then ctrl+d twice.
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
for (let i = 0; i < 3; i += 1) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 })
  await sleep(200)
}
const cursors = await evaluate(`document.querySelectorAll('.cm-cursor').length`)
add('multiple cursors are possible', (cursors ?? 0) >= 2, `${cursors} cursors drawn`)

await clickTab('typed.ts')
await sleep(300)

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

/**
 * The rest of what the language server connection is supposed to provide.
 *
 * These shipped bundled with the connection and were published as working
 * before anyone had driven them. Checking them turned that from a claim into
 * a fact, which is the only reason this section exists.
 */

/** Screen position of a piece of text in the editor, for mouse events. */
const locate = (text, occurrence = 0) =>
  evaluate(`
    (() => {
      const root = document.querySelector('.cm-content')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node, seen = 0
      while ((node = walker.nextNode())) {
        const index = node.textContent.indexOf(${JSON.stringify(text)})
        if (index === -1) continue
        if (seen++ < ${occurrence}) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + ${text.length})
        const box = range.getBoundingClientRect()
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      }
      return null
    })()
  `)

// A program with a definition and a use of it, so there is something to hover
// over and somewhere to jump to.
await focusEditor()
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
await send('Input.insertText', {
  text: 'export function greet(person: string): string {\n  return "hello " + person\n}\n\nconst message = greet("world")\n'
})
// The server has to reparse before any of this means anything.
await sleep(3500)

// ---- hover -------------------------------------------------------------
const hoverSpot = await locate('greet', 1)
let hoverText = null
if (hoverSpot !== null) {
  for (let i = 0; i < 12 && hoverText === null; i += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverSpot.x, y: hoverSpot.y })
    await sleep(700)
    const found = await evaluate(`document.querySelector('.cm-tooltip-hover')?.textContent ?? null`)
    if (typeof found === 'string' && found.trim().length > 0) hoverText = found.trim()
  }
}
add(
  'hover reports a type',
  hoverText !== null && /greet|string/.test(hoverText),
  hoverText === null ? 'no tooltip appeared' : hoverText.slice(0, 70)
)

// ---- go to definition --------------------------------------------------
// Click the *use* of greet on the last line, then F12 should land on the
// definition up on line 1.
// Get the hover tooltip out of the way first. It is sitting directly over the
// text we are about to click, and it swallowed the click on the first attempt,
// which then read as "go to definition is broken".
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
await sleep(800)

const usageSpot = await locate('greet', 1)
let clickedAt = ''
let keyArrived = false
let definitionLine = null
if (usageSpot !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: usageSpot.x, y: usageSpot.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: usageSpot.x, y: usageSpot.y, button: 'left', clickCount: 1 })
  await sleep(500)
  clickedAt = (await evaluate(`document.querySelector('footer .tabular-nums')?.textContent ?? ''`)).trim()

  // Watch for the key arriving, so a failure distinguishes "the binding did
  // not fire" from "the jump did not happen".
  await evaluate(`
    window.__f12 = false
    document.addEventListener('keydown', (e) => { if (e.key === 'F12') window.__f12 = true }, true)
    true
  `)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F12', code: 'F12', windowsVirtualKeyCode: 123, nativeVirtualKeyCode: 123 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F12', code: 'F12', windowsVirtualKeyCode: 123, nativeVirtualKeyCode: 123 })
  await sleep(300)
  keyArrived = await evaluate(`window.__f12 === true`)
  for (let i = 0; i < 12 && definitionLine === null; i += 1) {
    await sleep(600)
    const now = (await evaluate(`document.querySelector('footer .tabular-nums')?.textContent ?? ''`)).trim()
    if (now !== clickedAt) definitionLine = now
  }
}
// Asserted separately so a failure says which half broke: the click that puts
// the cursor on the symbol, or the jump itself.
add('clicking puts the cursor on the use of greet', /ln 5,/.test(clickedAt), clickedAt || 'no reading')
add(
  'go to definition moves the cursor',
  definitionLine !== null && /ln 1,/.test(definitionLine),
  definitionLine === null
    ? `cursor stayed at ${clickedAt || 'unknown'} (F12 reached the page: ${keyArrived})`
    : definitionLine
)

// ---- completion --------------------------------------------------------
await focusEditor()
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
await sleep(300)
await send('Input.insertText', { text: '\ngre' })
let completion = null
for (let i = 0; i < 15 && completion === null; i += 1) {
  await sleep(700)
  const found = await evaluate(
    `document.querySelector('.cm-tooltip-autocomplete')?.textContent ?? null`
  )
  if (typeof found === 'string' && found.includes('greet')) completion = found.trim()
}
add(
  'completion offers a symbol from the project',
  completion !== null,
  completion === null ? 'no autocomplete containing "greet"' : completion.slice(0, 60)
)

/**
 * M4: a real shell, running a real command.
 *
 * Typed rather than injected, and the marker is echoed back by the shell
 * itself, so a pass means the whole path worked: keystrokes to the pty, the
 * shell's output back over the push channel, and xterm rendering it.
 */
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 })

let terminalPresent = false
for (let i = 0; i < 20 && !terminalPresent; i += 1) {
  await sleep(500)
  terminalPresent = (await evaluate(`!!document.querySelector('.xterm-screen')`)) === true
}
add('ctrl+j opens a terminal', terminalPresent, terminalPresent ? 'xterm mounted' : 'no terminal appeared')

/**
 * Type a command into one terminal and press Enter.
 *
 * Enter is dispatched inside the page rather than through CDP. xterm decides
 * what to send the shell from `keyCode` on the keydown event. A `\r` inside
 * inserted text never produces a keydown at all, and CDP's own key events did
 * not produce one xterm recognised as Enter, so the command just sat on the
 * prompt line unsent.
 *
 * Terminals are addressed by index rather than by what is on their screen, so
 * that every caller drives one exactly the same way. When one of these checks
 * passes and another fails, the difference then has to be the terminal rather
 * than the typing.
 */
const typeIntoTerminal = async (index, command) => {
  await evaluate(`document.querySelectorAll('.xterm-helper-textarea')[${index}]?.focus(), true`)
  await sleep(300)
  await send('Input.insertText', { text: command })
  await sleep(400)
  return await evaluate(`
    (() => {
      const target = document.querySelectorAll('.xterm-helper-textarea')[${index}]
      if (target === undefined) return false
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
      })
      Object.defineProperty(event, 'keyCode', { get: () => 13 })
      Object.defineProperty(event, 'which', { get: () => 13 })
      target.dispatchEvent(event)
      return true
    })()
  `)
}

let shellOutput = null
if (terminalPresent) {
  // Wait for a prompt before typing, or the keystrokes go to a shell that has
  // not finished starting and are silently dropped.
  await sleep(2500)
  /**
   * One command, doing two jobs, because the harness only gets one.
   *
   * `Input.insertText` reliably reaches a terminal the first time and reliably
   * does not the second: the text lands in xterm's hidden textarea and is never
   * consumed. That is CDP and xterm disagreeing about how typed text arrives,
   * not anything Claven does, and it is not worth working around twice.
   *
   * So the marker the check below looks for and the counter the layout checks
   * need both come from this one line. The sleep keeps the counter quiet until
   * the marker has been read, so its output cannot scroll the marker away.
   */
  await typeIntoTerminal(
    0,
    'echo CLAVEN_TERMINAL_WORKS; Start-Sleep 3; 1..600 | % { "CLAVENHB$_"; Start-Sleep 1 }'
  )
  for (let i = 0; i < 25 && shellOutput === null; i += 1) {
    await sleep(700)
    const screen = await evaluate(
      `document.querySelector('.xterm-rows')?.innerText ?? ''`
    )
    // Twice: once as the echoed keystrokes, once as the command's output.
    if (typeof screen === 'string' && (screen.match(/CLAVEN_TERMINAL_WORKS/g) ?? []).length >= 2) {
      shellOutput = 'shell echoed the marker back'
    }
  }
}
add(
  'the shell runs a command and returns output',
  shellOutput !== null,
  shellOutput ?? `no output. rows were: ${JSON.stringify((await evaluate(`document.querySelector('.xterm-rows')?.innerText ?? ''`) ?? '').replace(/\s+/g, ' ').slice(0, 160))}`
)

/**
 * The first shell is now talking to itself, one line a second.
 *
 * The layout checks need to know whether a moved terminal's shell is still the
 * same live process. Typing at it afterwards would be testing xterm's keyboard
 * handling as much as anything else, so instead it says something on its own:
 * if the number is still climbing after the pane has been dragged across the
 * window, nothing behind it was restarted.
 */
const heartbeat = async () => {
  // Whitespace stripped first: the pane ends up a third of the window wide, and
  // a wrap would otherwise split a marker across two lines and hide it.
  const screens = await evaluate(`
    Array.from(document.querySelectorAll('.xterm-rows'))
      .map((n) => n.innerText).join(' ').replace(/\\s+/g, '')
  `)
  const seen = String(screens ?? '').match(/CLAVENHB(\d+)/g) ?? []
  return seen.reduce((highest, hit) => Math.max(highest, Number(hit.slice(8))), 0)
}

/**
 * A second terminal is a second shell, not a second view of the first.
 *
 * Checked by counting xterm instances rather than tabs: a tab strip that
 * renders two entries pointing at one shell would look identical and be
 * useless.
 */
await evaluate(`document.querySelector('[aria-label="new terminal"]')?.click(), true`)
let shells = 0
for (let i = 0; i < 20 && shells < 2; i += 1) {
  await sleep(500)
  shells = (await evaluate(`document.querySelectorAll('.xterm-screen').length`)) ?? 0
}
add('a second terminal is a second shell', shells === 2, `${shells} xterm instance(s)`)

// The first terminal's scrollback has to survive being switched away from and
// back, or a second terminal costs you the first one.
await evaluate(`
  Array.from(document.querySelectorAll('[aria-label^="close terminal"]'))
    .length > 1 ? true : false
`)
const firstTabButtons = await evaluate(
  `document.querySelectorAll('[aria-label^="close terminal"]').length`
)
add('each terminal has its own close control', firstTabButtons === 2, `${firstTabButtons} close buttons`)

/**
 * The claim the split layout exists to make: a terminal can be moved without
 * being restarted.
 *
 * React unmounts a component when it moves to a different parent, and an
 * unmounted TerminalView kills its shell. So this is not a cosmetic check.
 * A layout where dragging a terminal silently restarts it is worse than no
 * dragging at all, and the failure is invisible in a screenshot: the pane
 * arrives in the right place, with a fresh prompt and your build gone.
 *
 * Dispatched as real DragEvents in the page rather than through CDP's drag
 * interception, which needs Input.setInterceptDrags and gives no more coverage
 * of our own handlers than this does.
 */
const paneKinds = async () =>
  (await evaluate(
    `Array.from(document.querySelectorAll('[data-pane]')).map((n) => n.dataset.paneKind)`
  )) ?? []

const editorPaneId = await evaluate(
  `document.querySelector('[data-pane-kind="editor"]')?.dataset.pane ?? null`
)
const panesBefore = await paneKinds()

const draggedKey = await evaluate(`
  (() => {
    const tab = document.querySelector('[data-terminal-tab]')
    if (tab === null) return null
    tab.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: new DataTransfer()
    }))
    return tab.dataset.terminalTab
  })()
`)
await sleep(400)

// Four percent in from the left edge, which is inside the 25% band that means
// "split here" rather than "add a tab".
const droppedOn = await evaluate(`
  (() => {
    const zone = document.querySelector('[data-drop-pane="${editorPaneId}"]')
    if (zone === null) return null
    const box = zone.getBoundingClientRect()
    const at = {
      bubbles: true, cancelable: true, dataTransfer: new DataTransfer(),
      clientX: Math.round(box.left + box.width * 0.04),
      clientY: Math.round(box.top + box.height / 2)
    }
    zone.dispatchEvent(new DragEvent('dragover', at))
    zone.dispatchEvent(new DragEvent('drop', at))
    return true
  })()
`)
await sleep(700)

const panesAfter = await paneKinds()
add(
  'dragging a terminal to an edge splits the pane it landed on',
  droppedOn === true && panesAfter.length === panesBefore.length + 1,
  `${panesBefore.length} panes before, ${panesAfter.length} after (${panesAfter.join(', ')})`
)

// Asserted against where the boxes actually are, not against the serialised
// tree. A layout that stores correctly and draws in the wrong place is broken,
// and only one of those two things is what anyone looks at.
const beside = await evaluate(`
  (() => {
    const editor = document.querySelector('[data-pane-kind="editor"]')
    const terminal = document.querySelector('[data-pane-kind="terminals"]')
    if (editor === null || terminal === null) return null
    const a = editor.getBoundingClientRect()
    const b = terminal.getBoundingClientRect()
    return { leftOf: b.right <= a.left + 2, sharesRows: b.top < a.bottom && a.top < b.bottom }
  })()
`)
add(
  'the terminal ends up beside the editor, not under it',
  beside !== null && beside.leftOf === true && beside.sharesRows === true,
  beside === null ? 'panes not found' : `left of editor: ${beside.leftOf}, same rows: ${beside.sharesRows}`
)

// Nothing was unmounted: the counter started before the drag is still on
// screen. A terminal that was torn down and rebuilt would have come back with
// an empty buffer and a fresh prompt.
let beatsAfterMove = 0
for (let i = 0; i < 20 && beatsAfterMove === 0; i += 1) {
  await sleep(700)
  beatsAfterMove = await heartbeat()
}
add(
  'the moved terminal keeps what was on it',
  beatsAfterMove > 0,
  beatsAfterMove > 0 ? `still counting, at ${beatsAfterMove}` : 'the buffer was empty after the move'
)

// And the shell behind it is still the same live process, not a corpse still
// painted on screen. Nothing is typed at it: the counter either advances on its
// own or the process is gone.
await sleep(4000)
const beatsLater = await heartbeat()
add(
  'the shell behind a moved terminal is still running',
  beatsAfterMove > 0 && beatsLater > beatsAfterMove,
  `counter went ${beatsAfterMove} -> ${beatsLater} across four seconds`
)

/**
 * Ctrl+J hides terminals. It must not close them.
 *
 * With panes free to sit anywhere there is no "panel" left to toggle, so the
 * shortcut means "off screen" instead. If it quietly killed the shells, the
 * long-running thing you pressed it to get out of the way of would be the exact
 * thing it destroyed.
 */
const pressToggle = async () => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 })
  await sleep(700)
}

await pressToggle()
const whileHidden = await evaluate(`
  JSON.stringify({
    panes: document.querySelectorAll('[data-pane-kind="terminals"]').length,
    shells: document.querySelectorAll('.xterm-screen').length
  })
`)
const hiddenState = JSON.parse(String(whileHidden ?? '{}'))
add(
  'ctrl+j takes terminals off screen without closing them',
  hiddenState.panes === 0 && hiddenState.shells === 2,
  `${hiddenState.panes} terminal pane(s) drawn, ${hiddenState.shells} shell(s) still mounted`
)

await pressToggle()
let beatsAfterHiding = 0
for (let i = 0; i < 20 && beatsAfterHiding <= beatsLater; i += 1) {
  await sleep(700)
  beatsAfterHiding = await heartbeat()
}
add(
  'a hidden terminal was still running while it was away',
  beatsAfterHiding > beatsLater,
  `counter reached ${beatsAfterHiding}, up from ${beatsLater}`
)

/**
 * An external change to an open file.
 *
 * a.txt has been edited in the buffer by earlier checks, so b.txt is used: it
 * needs to be clean for the silent reload to be the correct behaviour.
 *
 * Written from this process, which is genuinely outside the editor, so this
 * exercises the real path rather than a simulated event.
 */
await clickTab('watched.txt')
await sleep(500)
await writeFile(watched, 'CHANGED BY SOMETHING ELSE\n')
let reloaded = null
for (let i = 0; i < 20 && reloaded === null; i += 1) {
  await sleep(500)
  const shown = await text()
  if (typeof shown === 'string' && shown.startsWith('CHANGED BY SOMETHING ELSE')) {
    reloaded = shown.slice(0, 30)
  }
}
add(
  'an external change reloads a clean file',
  reloaded !== null,
  reloaded ?? `still showing ${JSON.stringify((await text() ?? '').slice(0, 30))}`
)

/**
 * And the case that makes a watcher worth having rather than annoying: the
 * editor's own save must not look like an external change. If it did, every
 * ctrl+s would announce that the file had changed underneath you.
 */
await focusEditor()
await send('Input.insertText', { text: 'mine ' })
await sleep(300)
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
await sleep(3000)
const afterSave = await evaluate(`document.querySelector('footer .ms-auto')?.textContent ?? ''`)
add(
  'the editor own save is not reported as an external change',
  !/changed on disk/.test(afterSave),
  JSON.stringify(afterSave.trim().slice(0, 50))
)

/**
 * Project search, through the panel.
 *
 * The smoke suite already proves the engine, including the UTF-16 case. This
 * checks the parts only the renderer can get wrong: that the activity bar now
 * exists at all, that streamed batches land in the list, and that clicking a
 * hit opens the file and moves the cursor onto it.
 */
const activityBar = await evaluate(`!!document.querySelector('nav[aria-label="views"]')`)
add(
  'the activity bar appears now there are two containers',
  activityBar === true,
  activityBar === true ? 'rendered' : 'still null'
)

await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 10, key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 10, key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 })
await sleep(600)
const panelOpen = await evaluate(`!!document.querySelector('nav[aria-label="search"] input')`)
add('ctrl+shift+f opens the search panel', panelOpen === true, panelOpen === true ? 'open' : 'not open')

if (panelOpen === true) {
  await evaluate(`document.querySelector('nav[aria-label="search"] input')?.focus(), true`)
  // A string that exists in exactly one of the fixture files, so the count is
  // predictable and a stray match would show up as a wrong number.
  await send('Input.insertText', { text: 'NEEDLE_ON_LINE_FOUR' })

  let footer = ''
  for (let i = 0; i < 25 && !/match/.test(footer); i += 1) {
    await sleep(600)
    footer = String(
      (await evaluate(`document.querySelector('nav[aria-label="search"] .border-t')?.textContent ?? ''`)) ?? ''
    )
  }
  add('search reports what it found', /match/.test(footer), footer.slice(0, 80) || 'no footer')

  const hits = await evaluate(
    `document.querySelectorAll('nav[aria-label="search"] button[data-selected]').length`
  )
  add('results appear in the panel', (hits ?? 0) > 0, `${hits} rows`)

  // Click the last row, which is a match rather than a file header, and check
  // the status bar lands on line 4 of haystack.txt, where the needle is.
  const opened = await evaluate(`
    (() => {
      const rows = document.querySelectorAll('nav[aria-label="search"] button[data-selected]')
      const row = rows[rows.length - 1]
      if (row === undefined) return false
      row.click()
      return true
    })()
  `)
  let cursorAt = ''
  if (opened === true) {
    for (let i = 0; i < 15 && !/ln 4/.test(cursorAt); i += 1) {
      await sleep(500)
      cursorAt = String(
        (await evaluate(`document.querySelector('footer .tabular-nums')?.textContent ?? ''`)) ?? ''
      ).trim()
    }
  }
  add(
    'clicking a hit opens the file at that line',
    /ln 4/.test(cursorAt),
    cursorAt || 'cursor did not move'
  )
}

/**
 * Clicking the container you are already looking at closes the sidebar.
 *
 * The activity bar is the only way to close it with the mouse, and an icon that
 * does nothing when the thing it opens is already open is a dead control.
 */
const clickContainer = (label) =>
  evaluate(
    `document.querySelector('nav[aria-label="views"] button[aria-label="${label}"]')?.click(), true`
  )

await clickContainer('search')
await sleep(400)
const closed = await evaluate(`
  JSON.stringify({
    panel: !!document.querySelector('nav[aria-label="search"] input'),
    lit: !!document.querySelector('nav[aria-label="views"] [aria-current="page"]')
  })
`)
const closedState = JSON.parse(String(closed ?? '{}'))
add(
  'clicking the open container closes the sidebar',
  closedState.panel === false && closedState.lit === false,
  `panel drawn: ${closedState.panel}, a container still lit: ${closedState.lit}`
)

await clickContainer('explorer')
await sleep(400)
const reopened = await evaluate(`!!document.querySelector('nav[aria-label="files"]')`)
add(
  'clicking another container opens it again',
  reopened === true,
  reopened === true ? 'the tree came back' : 'the sidebar stayed closed'
)

add('the renderer logged nothing', problems.length === 0, problems.slice(0, 3).join(' | ') || 'clean')

/**
 * Unsaved work must survive a crash.
 *
 * The app is killed, not quit, so nothing gets a chance to flush on the way
 * out. That is the whole point: a clean shutdown proves nothing about a power
 * cut, and the flush-on-exit version of this feature passes a graceful test
 * and loses your work in the case it exists for.
 */
await clickTab('watched.txt')
await sleep(400)
await focusEditor()
await send('Input.insertText', { text: 'UNSAVED_SURVIVES_A_CRASH ' })
// Longer than the 700ms backup debounce, so the write has happened.
await sleep(1800)

socket.close()
child.kill('SIGKILL')
await sleep(1500)

const second = spawn(
  ELECTRON,
  ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT + 1}`],
  { cwd: REPO, stdio: ['ignore', 'ignore', 'ignore'] }
)

let secondPage = null
for (let i = 0; i < 60 && secondPage === null; i += 1) {
  await sleep(500)
  const response = await fetch(`http://127.0.0.1:${PORT + 1}/json/list`).catch(() => null)
  const targets = response ? await response.json().catch(() => []) : []
  secondPage = targets.find((target) => target.type === 'page') ?? null
}

let survived = null
let restoredPanes = 0
let restoredShells = 0
if (secondPage !== null) {
  const socket2 = new WebSocket(secondPage.webSocketDebuggerUrl)
  await new Promise((resolve) => socket2.addEventListener('open', resolve))
  let id2 = 1
  const pending2 = new Map()
  socket2.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      pending2.get(message.id)?.(message)
      pending2.delete(message.id)
    }
  })
  const send2 = (method, params = {}) =>
    new Promise((resolve) => {
      const id = id2++
      pending2.set(id, resolve)
      socket2.send(JSON.stringify({ id, method, params }))
    })
  const evaluate2 = async (expression) =>
    (await send2('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result?.result?.value

  for (let i = 0; i < 40 && survived === null; i += 1) {
    await sleep(500)
    const shown = await evaluate2(`
      (() => {
        const tab = Array.from(document.querySelectorAll('main .max-w-48'))
          .find((n) => n.textContent === 'watched.txt')
        if (tab === undefined) return null
        tab.closest('div')?.querySelector('button')?.click()
        return document.querySelector('.cm-content')?.textContent ?? null
      })()
    `)
    if (typeof shown === 'string' && shown.includes('UNSAVED_SURVIVES_A_CRASH')) {
      survived = shown.slice(0, 40)
    }
  }
  // The layout is chrome, so losing it is survivable, but it is also the thing
  // you spent a minute arranging. It comes back with fresh shells in the panes
  // they were in.
  for (let i = 0; i < 30 && restoredPanes < 3; i += 1) {
    await sleep(500)
    restoredPanes = (await evaluate2(`document.querySelectorAll('[data-pane]').length`)) ?? 0
  }
  for (let i = 0; i < 30 && restoredShells < 2; i += 1) {
    await sleep(500)
    restoredShells = (await evaluate2(`document.querySelectorAll('.xterm-screen').length`)) ?? 0
  }

  socket2.close()
}
second.kill()

add(
  'unsaved edits survive being killed',
  survived !== null,
  survived ?? 'the edit was gone after the restart'
)

add(
  'the layout comes back after a restart',
  restoredPanes === 3,
  `${restoredPanes} panes restored`
)

add(
  'restored terminal panes get their shells back',
  restoredShells === 2,
  `${restoredShells} shell(s) started`
)

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
