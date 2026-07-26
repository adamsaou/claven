import { realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

/**
 * The workspace root is the only thing standing between the renderer and the
 * whole filesystem.
 *
 * Every fs handler routes its path through resolveInsideWorkspace. The renderer
 * is sandboxed and context-isolated, but a bug in the renderer -- or eventually
 * a compromised AI agent, an extension, or a language server -- must not turn
 * into "read any file on the machine". This is cheap now and unretrofittable
 * later.
 */
let root: string | null = null

export function getWorkspaceRoot(): string | null {
  return root
}

export async function setWorkspaceRoot(directory: string): Promise<string> {
  // realpath so that a symlinked root compares correctly against realpathed children.
  root = await realpath(resolve(directory))
  return root
}

/** Windows paths are case-insensitive; the containment check has to agree. */
function forCompare(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

class OutsideWorkspaceError extends Error {
  readonly code = 'OUTSIDE_WORKSPACE'
  constructor(path: string) {
    super(`refused: "${path}" is outside the workspace`)
  }
}

class NoWorkspaceError extends Error {
  readonly code = 'NO_WORKSPACE'
  constructor() {
    super('no workspace is open')
  }
}

/**
 * Resolve a renderer-supplied path, refusing anything that escapes the root.
 *
 * Symlinks are resolved before the check, so a link inside the workspace
 * pointing at /etc/shadow is refused rather than followed. For paths that do
 * not exist yet -- saving a new file -- the parent directory is resolved
 * instead, which must itself exist and be inside the root.
 */
export async function resolveInsideWorkspace(candidate: string): Promise<string> {
  if (root === null) throw new NoWorkspaceError()

  const absolute = resolve(root, candidate)

  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    // Not on disk yet. Validate via the parent, which must exist.
    const realParent = await realpath(dirname(absolute)).catch(() => {
      throw new OutsideWorkspaceError(candidate)
    })
    real = join(realParent, basename(absolute))
  }

  const rootCmp = forCompare(root)
  const realCmp = forCompare(real)
  const prefix = rootCmp.endsWith(sep) ? rootCmp : rootCmp + sep

  if (realCmp !== rootCmp && !realCmp.startsWith(prefix)) {
    throw new OutsideWorkspaceError(candidate)
  }
  return real
}
