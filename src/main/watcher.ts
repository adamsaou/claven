import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emit } from './ipc'

/**
 * Notices when a file open in the editor changes underneath it.
 *
 * Until this existed the mtime guard in textfile.ts was the only detection
 * there was, which meant you found out that `git pull` had moved the ground
 * under you at the moment you tried to save, having already typed for twenty
 * minutes against a stale copy.
 *
 * Directories are watched rather than files. A file watcher follows the inode,
 * and Claven's own saves are a temp file renamed over the original, so a
 * per-file watch stops firing after the first save. Watching the parent and
 * filtering by name survives that, and it is also what survives the same trick
 * done by every other editor and by git itself.
 */

/** What the renderer believes is on disk, keyed by path. */
let expected = new Map<string, number>()
/** One watcher per distinct parent directory, not per file. */
const watchers = new Map<string, FSWatcher>()
/** Coalesces the burst of events a single write produces. */
const pending = new Map<string, NodeJS.Timeout>()

const SETTLE_MS = 120

async function check(path: string): Promise<void> {
  const baseline = expected.get(path)
  if (baseline === undefined) return

  const stats = await stat(path).catch(() => null)
  // Gone is not "changed on disk". Deleting a file is handled by the tree, and
  // reporting it here would race a rename and report a change to a file that
  // no longer exists.
  if (stats === null) return

  // The same tolerance textfile.ts uses, because some filesystems round mtime
  // to the second and a sub-second write would otherwise look like no change.
  if (Math.abs(stats.mtimeMs - baseline) <= 1) return

  // Updated before emitting, so a second event in the same burst does not
  // report the same change twice.
  expected.set(path, stats.mtimeMs)
  emit('file:changed-on-disk', { path, mtimeMs: stats.mtimeMs })
}

function schedule(path: string): void {
  const existing = pending.get(path)
  if (existing !== undefined) clearTimeout(existing)
  pending.set(
    path,
    setTimeout(() => {
      pending.delete(path)
      void check(path)
    }, SETTLE_MS)
  )
}

/**
 * Replace the watch list.
 *
 * The renderer sends the paths it has open together with the mtime it believes
 * each one has, which is the mtime its own last read or write returned. Main
 * deliberately does not keep its own baseline: it would then have to know which
 * writes came from the editor and which did not, and every save would look like
 * an external change.
 */
export function setWatchedFiles(files: Array<{ path: string; mtimeMs: number }>): void {
  expected = new Map(files.map((file) => [file.path, file.mtimeMs]))

  const wanted = new Set(files.map((file) => dirname(file.path)))

  for (const [directory, watcher] of watchers) {
    if (wanted.has(directory)) continue
    watcher.close()
    watchers.delete(directory)
  }

  for (const directory of wanted) {
    if (watchers.has(directory)) continue
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        if (filename === null) {
          // Some platforms report a change without saying what changed. Check
          // everything tracked in this directory rather than ignoring it.
          for (const path of expected.keys()) {
            if (dirname(path) === directory) schedule(path)
          }
          return
        }
        for (const path of expected.keys()) {
          if (dirname(path) === directory && path.endsWith(String(filename))) schedule(path)
        }
      })
      // A watch on a directory that vanishes emits an error rather than
      // throwing. Dropping it is right: the tree handles the deletion.
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(directory)
      })
      watchers.set(directory, watcher)
    } catch {
      // Unwatchable directory, for instance a network path that just went away.
      // Losing change detection is a degradation, not a failure worth surfacing.
    }
  }
}

/** Called before quit. `persistent: false` already lets the process exit, but
 *  an open handle on a directory can keep it locked on Windows. */
export function stopWatching(): void {
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  expected.clear()
}
