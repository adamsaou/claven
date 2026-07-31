import { spawn, type IPty } from 'node-pty'
import type { WebContents } from 'electron'
import { emitTo } from './ipc'
import { getWorkspaceRoot } from './workspace'

/**
 * Pseudo-terminals. The first native module in the tree.
 *
 * node-pty ships prebuilt binaries built against N-API, so it loads in
 * Electron without a rebuild and without a compiler on the machine. That was
 * checked before any of this was written, because if it had not been true the
 * getting-started page would have had to grow a paragraph about Visual Studio
 * Build Tools.
 *
 * Sessions are keyed by id from the start even though the UI opens exactly one.
 * Adding an id to a live IPC contract later is the retrofit this file exists to
 * avoid.
 */

type Session = {
  pty: IPty
  /** Who asked for it. Shell output goes to that window and no other. */
  owner: WebContents
  disposed: boolean
  /** Output read from the shell but not yet sent, waiting for the next flush. */
  buffered: string[]
  flush: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, Session>()
let counter = 0

/**
 * How long output is allowed to pile up before it is sent.
 *
 * One `webContents.send` per chunk is what this used to do, and a chatty
 * command produces thousands of them a second: a structured clone and a
 * renderer wakeup each. `search:matches` already batches for exactly this
 * reason and says so in the contract. Sixteen milliseconds is one frame, which
 * is as often as the terminal can visibly change anyway.
 */
const FLUSH_MS = 16

/**
 * What to run. `$SHELL` and `ComSpec` are what the OS itself thinks the user's
 * shell is, so they are preferred over anything hardcoded. PowerShell rather
 * than cmd on Windows: it is what ships, and cmd cannot do most of what anyone
 * types into a terminal in 2026.
 */
function defaultShell(): string {
  if (process.platform === 'win32') {
    // Deliberately not COMSPEC. That variable is always cmd.exe on Windows, so
    // reading it means the comment above and the behaviour below disagree,
    // which is exactly what happened the first time this ran. PowerShell ships
    // with every supported Windows and can do the things people actually type.
    return 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

function flush(id: string, session: Session): void {
  session.flush = null
  if (session.buffered.length === 0) return
  const data = session.buffered.join('')
  session.buffered.length = 0
  emitTo(session.owner, 'pty:data', { id, data })
}

/**
 * What to call it in a tab. The executable's stem, so `powershell.exe` reads as
 * `powershell` and `/bin/bash` as `bash`.
 */
function shellName(shell: string): string {
  const base = shell.split(/[\\/]/).pop() ?? shell
  return base.replace(/\.(exe|cmd|bat)$/i, '')
}

export function startPty(
  cols: number,
  rows: number,
  owner: WebContents
): { id: string; shell: string } {
  const id = `pty-${++counter}`
  const shell = defaultShell()

  const pty = spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(cols, 1),
    rows: Math.max(rows, 1),
    // Opens where the work is. Falling back to home rather than to wherever
    // the app happened to be launched from, which for a packaged build is
    // somewhere nobody wants to be.
    cwd: getWorkspaceRoot() ?? process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    env: process.env as Record<string, string>
  })

  const session: Session = { pty, owner, disposed: false, buffered: [], flush: null }
  sessions.set(id, session)

  /**
   * node-pty rethrows socket errors when nobody is listening.
   *
   * `windowsTerminal.js` and `unixTerminal.js` both do
   * `if (this.listeners('error').length < 2) throw err`, from inside a socket
   * event handler. In the main process that is an uncaught exception, which
   * takes the whole editor with it: every terminal, the language server, and
   * every unsaved buffer that has not reached the 700ms backup yet. A shell
   * having a bad day must not be able to do that.
   *
   * Typed loosely because `IPty` does not declare the EventEmitter surface it
   * inherits, and reaching for it is the point.
   */
  const emitter = pty as unknown as { on?: (event: string, listener: (error: unknown) => void) => void }
  emitter.on?.('error', (error) => {
    if (session.disposed) return
    const message = error instanceof Error ? error.message : String(error)
    emitTo(session.owner, 'pty:data', { id, data: `\r\n\x1b[31m[terminal error: ${message}]\x1b[0m\r\n` })
  })

  pty.onData((data) => {
    session.buffered.push(data)
    if (session.flush === null) session.flush = setTimeout(() => flush(id, session), FLUSH_MS)
  })

  pty.onExit(({ exitCode }) => {
    session.disposed = true
    // Anything still buffered is the last thing the command printed before it
    // died, which is usually the thing worth reading.
    if (session.flush !== null) clearTimeout(session.flush)
    flush(id, session)
    sessions.delete(id)
    emitTo(session.owner, 'pty:exit', { id, code: exitCode })
  })

  return { id, shell: shellName(shell) }
}

export function writePty(id: string, data: string): void {
  // Validated rather than trusted. An unchecked value reaches
  // `Buffer.from(data, encoding)` inside node-pty and throws, which surfaces as
  // a terminal that silently ignores every keystroke.
  if (typeof data !== 'string' || data.length === 0) return
  sessions.get(id)?.pty.write(data)
}

/** Stop or resume reading from the shell. See `pty:setPaused` in the contract. */
export function setPtyPaused(id: string, paused: boolean): void {
  const session = sessions.get(id)
  if (session === undefined || session.disposed) return
  try {
    if (paused) session.pty.pause()
    else session.pty.resume()
  } catch {
    /* The process exited between the check and the call. */
  }
}

/**
 * Resize. Silently ignored for a session that has gone: a resize racing a
 * shell exit is normal, not an error worth surfacing to the user.
 */
export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (session === undefined || session.disposed) return
  try {
    session.pty.resize(Math.max(cols, 1), Math.max(rows, 1))
  } catch {
    /* The process exited between the check and the call. */
  }
}

export function killPty(id: string): void {
  const session = sessions.get(id)
  if (session === undefined) return
  session.disposed = true
  if (session.flush !== null) clearTimeout(session.flush)
  try {
    session.pty.kill()
  } catch {
    /* Already gone. */
  } finally {
    // Deleted last, not first. On Windows a kill issued before the shell's
    // first output is deferred until it arrives, and dropping the reference
    // beforehand meant a kill that never ran could never be retried either.
    sessions.delete(id)
  }
}

/** Every shell a window owns. Called when that window goes away. */
export function killPtysFor(owner: WebContents): void {
  for (const [id, session] of [...sessions]) {
    if (session.owner === owner) killPty(id)
  }
}

/**
 * Called before quit. A surviving shell keeps the app's process tree alive.
 *
 * Returns a promise the quit path waits on. On Windows, node-pty kills a
 * conpty's child processes by forking a helper and killing them when it
 * answers, which takes tens of milliseconds. A synchronous quit is gone before
 * that lands, and the classic symptom is a dev server surviving the editor and
 * holding its port, with nothing on screen to explain the next EADDRINUSE.
 */
export async function killAllPtys(): Promise<void> {
  for (const id of [...sessions.keys()]) killPty(id)
  await new Promise((resolve) => setTimeout(resolve, 250))
}

/** How many shells are alive. Used by the quit path to skip the wait when there are none. */
export function livePtyCount(): number {
  return sessions.size
}
