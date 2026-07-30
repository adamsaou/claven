import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Unsaved edits, kept where a crash cannot take them.
 *
 * `session.ts` says, correctly, that file contents never go in the session:
 * they live on disk and a second copy would be a second source of truth for
 * your work. Unsaved edits are the exact inverse of that. They exist in one
 * place only, a renderer's memory, and a power cut or a crash is the difference
 * between twenty minutes of work and none.
 *
 * So this stores only what is dirty, deletes it the moment it is saved, and
 * never shadows a clean file.
 *
 * One file per buffer rather than one big document, because a single JSON file
 * has to be rewritten in full on every keystroke burst, and because a corrupt
 * write then loses every buffer instead of one.
 */

type Buffer_ = { path: string; content: string; mtimeMs: number }

function directory(): string {
  return join(app.getPath('userData'), 'buffers')
}

/**
 * Named by a hash rather than by the path.
 *
 * A path contains separators and a colon on Windows, is frequently longer than
 * a filename may be, and is case-insensitive on one platform and not on
 * another. The hash sidesteps all of it, and the real path is stored inside the
 * file where it does not have to survive a filesystem.
 */
function nameFor(path: string): string {
  return `${createHash('sha1').update(path).digest('hex')}.json`
}

/**
 * Replace the whole set.
 *
 * The renderer sends every dirty buffer it has, and anything not in that list
 * is deleted. Sending the whole set rather than deltas means a missed "this one
 * is clean now" message cannot leave a stale backup behind, which would restore
 * edits the user had already saved and then changed their mind about.
 */
export async function syncBuffers(buffers: Buffer_[]): Promise<void> {
  const dir = directory()
  await mkdir(dir, { recursive: true })

  const wanted = new Map(buffers.map((buffer) => [nameFor(buffer.path), buffer]))

  const existing = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    existing
      .filter((name) => name.endsWith('.json') && !wanted.has(name))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined))
  )

  await Promise.all(
    [...wanted].map(async ([name, buffer]) => {
      // Temp then rename, the same reason a file save does it: a crash midway
      // through would otherwise leave truncated JSON, and the next launch would
      // silently drop the buffer it was trying to protect.
      const target = join(dir, name)
      const temporary = `${target}.tmp`
      await writeFile(temporary, JSON.stringify(buffer), 'utf8')
      await rename(temporary, target)
    })
  )
}

/** Everything that was unsaved when the app last stopped. */
export async function restoreBuffers(): Promise<Buffer_[]> {
  const dir = directory()
  const names = await readdir(dir).catch(() => [] as string[])

  const loaded = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const parsed: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'))
          if (typeof parsed !== 'object' || parsed === null) return null
          const buffer = parsed as Partial<Buffer_>
          // Validated rather than trusted. A half-written or hand-edited file
          // must not crash startup: losing one buffer beats failing to launch.
          if (typeof buffer.path !== 'string' || typeof buffer.content !== 'string') return null
          return {
            path: buffer.path,
            content: buffer.content,
            mtimeMs: typeof buffer.mtimeMs === 'number' ? buffer.mtimeMs : 0
          }
        } catch {
          return null
        }
      })
  )
  return loaded.filter((buffer): buffer is Buffer_ => buffer !== null)
}
