import { BrowserWindow, dialog, shell } from 'electron'
import { mkdir, open as openFile, readdir, rename, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { handle, emit, assertEveryChannelHandled } from './ipc'
import { getWorkspaceRoot, resolveInsideWorkspace, setWorkspaceRoot } from './workspace'
import { readTextFile, writeTextFile } from './textfile'
import { loadSession, saveSession } from './session'
import { sendToLanguageServer, startLanguageServer, stopLanguageServer } from './lsp'
import { killPty, resizePty, setPtyPaused, startPty, writePty } from './pty'
import { setWatchedFiles } from './watcher'
import { restoreBuffers, syncBuffers } from './buffers'
import { cancelAllSearches, cancelSearch, startSearch } from './search'
import { walkFiles, type WalkStats } from './walk'
import type { DirEntry } from '../shared/files'

/** Quick-open stops here. A tree this size means the ignore list is wrong. */
const WALK_LIMIT = 50_000

/** How many dirty tabs the renderer last reported. Guards the window close. */
let dirtyCount = 0
export function getDirtyCount(): number {
  return dirtyCount
}

async function entriesIn(directory: string): Promise<DirEntry[]> {
  const dirents = await readdir(directory, { withFileTypes: true })
  const entries: DirEntry[] = dirents.map((dirent) => ({
    name: dirent.name,
    path: join(directory, dirent.name),
    kind: dirent.isDirectory() ? 'directory' : 'file',
    isSymlink: dirent.isSymbolicLink()
  }))
  // Directories first, then case-insensitive by name. localeCompare keeps
  // accented and non-Latin filenames in a sane order rather than by code point.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return entries
}

export function registerHandlers(): void {
  handle('app:ping', (request) => ({
    sentAt: request.sentAt,
    receivedAt: Date.now(),
    pid: process.pid,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8
    }
  }))

  handle('workspace:open', async (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    const picked = result.canceled ? undefined : result.filePaths[0]
    if (picked === undefined) return { root: getWorkspaceRoot() }

    // The old server was initialised against the old root and cannot be told
    // to move. Stopping it here means the next file opened starts a fresh one
    // pointed at the right project, rather than one quietly resolving imports
    // against a directory the user has left.
    stopLanguageServer()
    cancelAllSearches()

    const root = await setWorkspaceRoot(picked)
    // Pushed as well as returned: the invoke result only reaches the caller,
    // and every panel needs to know the root changed.
    emit('workspace:changed', { root })
    return { root }
  })

  handle('workspace:current', () => ({ root: getWorkspaceRoot() }))

  handle('fs:list', async (request) => ({
    entries: await entriesIn(await resolveInsideWorkspace(request.path))
  }))

  handle('fs:read', async (request) => readTextFile(await resolveInsideWorkspace(request.path)))

  handle('fs:write', async (request) => {
    const path = await resolveInsideWorkspace(request.path)
    const meta = await writeTextFile(path, request.content, request.meta, request.expectedMtimeMs)
    return { meta }
  })

  handle('fs:createFile', async (request) => {
    const path = await resolveInsideWorkspace(request.path)
    // wx fails if it exists — creating a file must never truncate one.
    const handle_ = await openFile(path, 'wx')
    await handle_.close()
    emit('fs:invalidate', { path: dirname(path) })
    return { path }
  })

  handle('fs:createDirectory', async (request) => {
    const path = await resolveInsideWorkspace(request.path)
    await mkdir(path)
    emit('fs:invalidate', { path: dirname(path) })
    return { path }
  })

  handle('fs:rename', async (request) => {
    const from = await resolveInsideWorkspace(request.from)
    const to = await resolveInsideWorkspace(request.to)
    // Windows rename overwrites silently; check first so a rename cannot eat
    // an existing file.
    const clash = await stat(to).catch(() => null)
    if (clash !== null) {
      throw Object.assign(new Error(`"${request.to}" already exists`), { code: 'EEXIST' })
    }
    await rename(from, to)
    emit('fs:invalidate', { path: dirname(from) })
    if (dirname(to) !== dirname(from)) emit('fs:invalidate', { path: dirname(to) })
    return { path: to }
  })

  handle('fs:delete', async (request) => {
    const path = await resolveInsideWorkspace(request.path)
    // Trash, not unlink. An editor should not have an unrecoverable delete.
    await shell.trashItem(path)
    emit('fs:invalidate', { path: dirname(path) })
    return {}
  })

  handle('fs:reveal', async (request) => {
    shell.showItemInFolder(await resolveInsideWorkspace(request.path))
    return {}
  })

  handle('fs:walk', async () => {
    const root = getWorkspaceRoot()
    if (root === null) return { files: [], truncated: false }

    // The same walker search uses. Two implementations would drift, and the
    // drift shows up as a file quick-open can find and search cannot.
    const stats: WalkStats = { skippedDirs: 0 }
    const files: string[] = []
    let truncated = false
    for await (const file of walkFiles(root, stats)) {
      files.push(file)
      if (files.length >= WALK_LIMIT) {
        truncated = true
        break
      }
    }
    return { files, truncated }
  })

  handle('dialog:confirmDiscard', async (request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['save', "don't save", 'cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `save changes to ${request.name}?`,
      detail: "your changes will be lost if you don't save them."
    }
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return { action: (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel' }
  })

  handle('dialog:resolveConflict', async (request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['overwrite', 'discard mine and reload', 'cancel'],
      // Cancel is the default: both other answers destroy one version of the
      // file, and neither is obviously the right one from here.
      defaultId: 2,
      cancelId: 2,
      message: `${request.name} changed on disk`,
      detail: 'it was modified outside claven since you opened it.'
    }
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return { action: (['overwrite', 'reload', 'cancel'] as const)[response] ?? 'cancel' }
  })

  handle('app:setDirtyCount', (request) => {
    dirtyCount = request.count
    return {}
  })

  handle('session:load', async () => {
    const session = await loadSession()
    // Restoring the workspace root here means the tree and quick-open work
    // immediately on launch, without waiting for the renderer to ask.
    if (session?.root != null) {
      await setWorkspaceRoot(session.root).catch(() => undefined)
    }
    return { session }
  })

  handle('session:save', async (request) => {
    await saveSession(request.session)
    return {}
  })

  handle('lsp:start', () => ({ state: startLanguageServer() }))

  handle('lsp:send', (request) => {
    sendToLanguageServer(request.message)
    return {}
  })

  // The sender is passed through so a shell's output goes to the window that
  // asked for it. `emit` broadcasts, and the contents of your shell is not
  // something to send to every window that happens to be open.
  handle('pty:start', (request, event) => startPty(request.cols, request.rows, event.sender))

  handle('pty:write', (request) => {
    writePty(request.id, request.data)
    return {}
  })

  handle('pty:resize', (request) => {
    resizePty(request.id, request.cols, request.rows)
    return {}
  })

  handle('pty:kill', (request) => {
    killPty(request.id)
    return {}
  })

  handle('pty:setPaused', (request) => {
    setPtyPaused(request.id, request.paused)
    return {}
  })

  handle('buffer:sync', async (request) => {
    await syncBuffers(request.buffers)
    return {}
  })

  handle('buffer:restore', async () => ({ buffers: await restoreBuffers() }))

  handle('watch:files', (request) => {
    setWatchedFiles(request.files)
    return {}
  })

  handle('search:start', (request, event) => startSearch(request.query, event.sender))

  handle('search:cancel', (request) => {
    cancelSearch(request.id)
    return {}
  })

  // Startup fails here rather than leaving a renderer call hanging forever.
  assertEveryChannelHandled()
}
