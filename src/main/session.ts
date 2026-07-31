import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Session } from '../shared/ipc'
import { parseLayout } from '../shared/layout'

/**
 * Session state — which folder was open, which tabs, where the cursor was.
 *
 * Stored in userData rather than localStorage for two reasons: it survives a
 * cleared renderer profile, and it is a plain JSON file a human can read or
 * delete when something goes wrong. Never the file *contents* — those live on
 * disk, and a session file that shadowed them would be a second source of
 * truth for your work.
 */
function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await readFile(sessionPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const session = parsed as Partial<Session>
    // Validated rather than trusted: a hand-edited or half-written file must
    // not crash startup, and losing a session is a much smaller failure than
    // failing to launch.
    if (!Array.isArray(session.openPaths)) return null
    return {
      root: typeof session.root === 'string' ? session.root : null,
      openPaths: session.openPaths.filter((path): path is string => typeof path === 'string'),
      activePath: typeof session.activePath === 'string' ? session.activePath : null,
      cursors: typeof session.cursors === 'object' && session.cursors !== null ? session.cursors : {},
      // Rejected whole rather than repaired if it does not make sense. Falling
      // back to one editor pane costs a drag; booting into a tree nobody
      // understands costs a window you cannot use.
      layout: parseLayout(session.layout)
    }
  } catch {
    return null
  }
}

export async function saveSession(session: Session): Promise<void> {
  const path = sessionPath()
  await mkdir(dirname(path), { recursive: true })
  // Same temp-then-rename as file saves: a crash mid-write would otherwise
  // leave truncated JSON, and the next launch would silently lose the session.
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(session, null, 2), 'utf8')
  await rename(temporary, path)
}
