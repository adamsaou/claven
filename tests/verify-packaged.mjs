/**
 * Drives the PACKAGED build, not the dev one.
 *
 * The packaging config skips the native rebuild, on the grounds that node-pty's
 * prebuilt binaries load in Electron unchanged. That claim is only worth
 * anything if the shipped app can actually open a shell, and the shipped app is
 * the one where node-pty lives outside the asar archive. So it gets checked
 * here rather than assumed.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

const APP = join(REPO, 'release', 'win-unpacked', 'Claven.exe')
const PORT = 9446
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const userData = await mkdtemp(join(tmpdir(), 'claven-packaged-'))
await writeFile(
  join(userData, 'session.json'),
  JSON.stringify({
    root: REPO,
    openPaths: [join(REPO, 'package.json')],
    activePath: join(REPO, 'package.json'),
    cursors: {},
    layout: null
  })
)

const child = spawn(APP, [`--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], {
  stdio: 'ignore'
})

let page = null
for (let i = 0; i < 80 && page === null; i += 1) {
  await sleep(500)
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null)
  const t = r ? await r.json().catch(() => []) : []
  page = t.find((x) => x.type === 'page') ?? null
}
if (page === null) {
  console.log('FAIL  the packaged app never opened a window')
  child.kill()
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 1
const pend = new Map()
const problems = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id) {
    pend.get(m.id)?.(m)
    pend.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    problems.push(m.params.exceptionDetails.exception?.description ?? 'exception')
  }
})
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = id++
    pend.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result
    ?.result?.value

await send('Runtime.enable')

let mounted = false
for (let i = 0; i < 60 && !mounted; i += 1) {
  await sleep(250)
  mounted = (await ev(`!!document.querySelector('.cm-content')`)) === true
}
console.log(`${mounted ? 'PASS' : 'FAIL'}  the packaged app opens and mounts the editor`)

const restored = await ev(`document.querySelector('.cm-content')?.textContent?.slice(0, 20) ?? ''`)
console.log(
  `${String(restored).includes('claven') ? 'PASS' : 'FAIL'}  it reads a file from disk  ${JSON.stringify(String(restored))}`
)

await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 })

let prompt = ''
for (let i = 0; i < 40 && !/PS |\$ |> /.test(prompt); i += 1) {
  await sleep(500)
  prompt = String((await ev(`document.querySelector('.xterm-rows')?.innerText ?? ''`)) ?? '')
}
console.log(
  `${/PS |\$ |> /.test(prompt) ? 'PASS' : 'FAIL'}  the packaged app spawns a real shell  ${JSON.stringify(prompt.replace(/\s+/g, ' ').slice(0, 70))}`
)

console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  no renderer exceptions  ${problems.slice(0, 2).join(' | ') || 'clean'}`)

ws.close()
child.kill()
process.exit(0)
