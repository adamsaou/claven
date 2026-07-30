import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/**
 * Walk every file under a root, lazily.
 *
 * Extracted from the `fs:walk` handler so quick-open and search share one
 * definition of "which files are in this project". Two walkers would drift, and
 * the drift shows up as a file quick-open can find and search cannot.
 *
 * A generator rather than an array because search reads files as it goes and
 * should start producing results before the tree has been fully enumerated.
 * Quick-open collects it into an array, which is what it wanted anyway.
 */

/** Directories never worth walking. Kept identical to the tree's hidden set. */
export const SKIP = new Set([
  '.git', 'node_modules', 'out', 'dist', '.vite', '.venv', '__pycache__',
  'build', '.gradle', '.idea', 'target', 'vendor', '.next', 'coverage'
])

export type WalkStats = {
  /** Symlinked or junctioned directories the walk refused to descend into. */
  skippedDirs: number
}

/**
 * Yields workspace-relative, forward-slash paths.
 *
 * Symlinked directories are never followed. A link pointing at a parent turns
 * the walk into an infinite loop, and on Windows a junction into another drive
 * would quietly take the search outside the workspace the sandbox exists to
 * contain.
 */
export async function* walkFiles(root: string, stats: WalkStats): AsyncGenerator<string> {
  const queue: string[] = [root]

  while (queue.length > 0) {
    const directory = queue.shift()
    if (directory === undefined) break
    // An unreadable directory is routine, not exceptional: a permissions-denied
    // folder should not end the walk.
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue
      if (SKIP.has(entry.name)) continue
      const full = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) {
          stats.skippedDirs += 1
          continue
        }
        queue.push(full)
      } else if (entry.isFile()) {
        yield relative(root, full).split(sep).join('/')
      }
    }
  }
}
