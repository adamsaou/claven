import { BrowserWindow, dialog } from 'electron'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { handle, assertEveryChannelHandled } from './ipc'
import { getWorkspaceRoot, resolveInsideWorkspace, setWorkspaceRoot } from './workspace'
import { readTextFile, writeTextFile } from './textfile'
import type { DirEntry } from '../shared/files'

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
    return { root: await setWorkspaceRoot(picked) }
  })

  handle('workspace:current', () => ({ root: getWorkspaceRoot() }))

  handle('fs:list', async (request) => {
    const directory = await resolveInsideWorkspace(request.path)
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

    return { entries }
  })

  handle('fs:read', async (request) => readTextFile(await resolveInsideWorkspace(request.path)))

  handle('fs:write', async (request) => {
    const path = await resolveInsideWorkspace(request.path)
    const meta = await writeTextFile(path, request.content, request.meta, request.expectedMtimeMs)
    return { meta }
  })

  // Startup fails here rather than leaving a renderer call hanging forever.
  assertEveryChannelHandled()
}
