import { spawn, type IPty } from 'node-pty'
import { emit } from './ipc'
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

type Session = { pty: IPty; disposed: boolean }

const sessions = new Map<string, Session>()
let counter = 0

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

export function startPty(cols: number, rows: number): { id: string } {
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

  const session: Session = { pty, disposed: false }
  sessions.set(id, session)

  pty.onData((data) => emit('pty:data', { id, data }))
  pty.onExit(({ exitCode }) => {
    session.disposed = true
    sessions.delete(id)
    emit('pty:exit', { id, code: exitCode })
  })

  return { id }
}

export function writePty(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
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
  sessions.delete(id)
  try {
    session.pty.kill()
  } catch {
    /* Already gone. */
  }
}

/** Called before quit. A surviving shell keeps the app's process tree alive. */
export function killAllPtys(): void {
  for (const id of [...sessions.keys()]) killPty(id)
}
