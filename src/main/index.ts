import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { handle, assertEveryChannelHandled } from './ipc'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    webPreferences: {
      // The renderer gets no Node access whatsoever. Everything it needs comes
      // through the preload's single `invoke`. These are Electron's defaults on
      // current versions, but they are set explicitly because a future refactor
      // silently flipping one of them is a serious regression, and an explicit
      // line is something a reviewer can object to.
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // Claven will open real project files; a compromised renderer should not
      // be able to read arbitrary paths through file:// fetches.
      webSecurity: true
    }
  })

  // Avoid the white flash before first paint.
  window.once('ready-to-show', () => window.show())

  // Nothing in-app should ever navigate the window itself. Links open in the
  // user's browser; navigation attempts are refused.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
    if (!allowed || !url.startsWith(allowed)) event.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

function registerHandlers(): void {
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

  // Startup fails here rather than leaving a renderer call hanging forever.
  assertEveryChannelHandled()
}

// A second instance would fight over the same workspace state later on.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(async () => {
    electronAppUserModelId()
    registerHandlers()
    const window = createWindow()

    if (process.argv.includes('--smoke')) {
      const { runSmokeTest } = await import('./smoke')
      await new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()))
      const failures = await runSmokeTest(window)
      app.exit(failures === 0 ? 0 : 1)
      return
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  app.on('window-all-closed', () => {
    // macOS convention is to stay alive with no windows; everywhere else quits.
    if (process.platform !== 'darwin') app.quit()
  })
}

/** Without this Windows groups the taskbar entry under "electron.app.Electron". */
function electronAppUserModelId(): void {
  if (process.platform === 'win32') app.setAppUserModelId('dev.claven.app')
}
