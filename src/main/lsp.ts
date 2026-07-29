import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { emit } from './ipc'
import { getWorkspaceRoot } from './workspace'
import type { LspState } from '../shared/ipc'

/**
 * The language server, and the pipe to it.
 *
 * Main owns the process and the wire format. It does not parse a single
 * JSON-RPC request: @codemirror/lsp-client in the renderer owns the protocol,
 * and a main process that also understood requests would be a second
 * implementation to keep in step with the first. Everything here is framing and
 * lifecycle.
 */

let server: ChildProcess | null = null
let state: LspState = 'stopped'

function setState(next: LspState, detail?: string): void {
  state = next
  emit('lsp:status', detail === undefined ? { state: next } : { state: next, detail })
}

export function getLspState(): LspState {
  return state
}

/**
 * TypeScript's own language server.
 *
 * Not typescript-language-server. That wrapper drives `tsserver.js`, and
 * TypeScript 7 is the Go rewrite — its lib/ directory contains tsc.js and
 * getExePath.js and nothing else. The wrapper exits during initialize with
 * "Could not find a valid TypeScript installation", because the file it needs
 * genuinely is not there. TypeScript 7 instead ships its own LSP server inside
 * the native binary, which is the one thing guaranteed to agree with what
 * `npm run typecheck` does.
 *
 * The path is derived the same way typescript/lib/getExePath.js derives it.
 * That file is not in the package's `exports`, so it cannot be imported — and
 * its own header notes that VS Code duplicates this logic too, so duplicating
 * it is the sanctioned approach rather than a shortcut.
 *
 * Note for packaging: once electron-builder is set up this path lands inside
 * app.asar, and a child process cannot be spawned from an archive. It will
 * need an asarUnpack entry then. Nothing packages yet, so this is a note
 * rather than a workaround for a problem that does not exist.
 */
function serverExecutable(): string {
  const require = createRequire(import.meta.url)
  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`
  const manifest = require.resolve(`${platformPackage}/package.json`)
  return join(dirname(manifest), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
}

/**
 * LSP framing: `Content-Length: N\r\n\r\n` then exactly N **bytes** of JSON.
 *
 * Bytes, not characters, which is the whole reason this works on a Buffer
 * rather than a string. Decoding first and counting `length` would be correct
 * for ASCII and wrong for every file with an accent or an emoji in it, and the
 * failure is not a clean error — the parser slides half a character and every
 * subsequent message in the stream is garbage.
 */
function createParser(onMessage: (message: string) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)

  return (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk])

    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const header = buffer.subarray(0, headerEnd).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (match?.[1] === undefined) {
        // Unparseable header. Dropping just this header would resynchronise
        // onto a body and produce nonsense, so the stream is abandoned.
        setState('failed', 'malformed header from the language server')
        buffer = Buffer.alloc(0)
        return
      }

      const length = Number.parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      // The whole body has not arrived yet. Wait for more, keeping what we have.
      if (buffer.length < bodyStart + length) return

      onMessage(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'))
      buffer = buffer.subarray(bodyStart + length)
    }
  }
}

export function startLanguageServer(): LspState {
  if (server !== null) return state
  if (getWorkspaceRoot() === null) {
    setState('failed', 'no workspace is open')
    return state
  }

  setState('starting')

  try {
    /**
     * A native binary, so it is spawned directly — no Node, no interpreter,
     * nothing to be the wrong version. `--stdio` is required: without it the
     * server refuses with "only stdio is supported" and exits 1, because the
     * default expects a named pipe.
     */
    server = spawn(serverExecutable(), ['--lsp', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (cause) {
    setState('failed', cause instanceof Error ? cause.message : String(cause))
    return state
  }

  const parse = createParser((message) => emit('lsp:message', { message }))
  server.stdout?.on('data', parse)

  // The server's stderr is its log, not its errors. Kept off the wire and on
  // the console, where it is useful when something is wrong and ignorable
  // otherwise.
  server.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text.length > 0) console.error(`[lsp] ${text}`)
  })

  server.on('error', (error) => {
    setState('failed', error.message)
    server = null
  })

  server.on('exit', (code, signal) => {
    server = null
    // A clean exit after we asked it to stop is not a failure.
    if (state === 'stopped') return
    setState('failed', `language server exited (${signal ?? code ?? 'unknown'})`)
  })

  setState('running')
  return state
}

/**
 * Frame and write.
 *
 * Starts the server if it is not up yet, rather than refusing. The renderer's
 * LSP client sends `initialize` the moment it is constructed, which is during
 * the render that opens the file — so it reliably beats the `lsp:start` call
 * made by the effect that runs after that render. Racing the renderer into
 * getting its own ordering right is not a fight worth having when starting on
 * demand is both correct and idempotent.
 */
export function sendToLanguageServer(message: string): void {
  if (server === null) startLanguageServer()
  if (server?.stdin === null || server?.stdin === undefined) {
    throw Object.assign(new Error('the language server is not running'), { code: 'LSP_DOWN' })
  }
  const body = Buffer.from(message, 'utf8')
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
  server.stdin.write(body)
}

/**
 * Stop the server. Called when the workspace changes and before quit — an
 * orphaned language server is a process holding a few hundred megabytes with
 * nothing left to serve.
 */
export function stopLanguageServer(): void {
  if (server === null) {
    setState('stopped')
    return
  }
  const child = server
  server = null
  setState('stopped')
  child.kill()
}
