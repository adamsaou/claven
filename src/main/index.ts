import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerHandlers } from './handlers'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    // Obsidian, per brand/BRAND.md — this is what you see before first paint.
    backgroundColor: '#0F1115',
    autoHideMenuBar: true,
    // Dev only, deliberately. A packaged build takes its icon from the
    // executable on Windows and from the desktop entry on Linux, both of which
    // electron-builder writes; setting it here would be ignored there anyway.
    // In dev there is no executable to inherit from, so without this you stare
    // at Electron's default atom in the taskbar all day.
    ...(isDev
      ? {
          icon: join(
            app.getAppPath(),
            'build',
            process.platform === 'win32' ? 'icon.ico' : 'icon.png'
          )
        }
      : {}),
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

const isSmokeRun = process.argv.includes('--smoke')

if (isSmokeRun) {
  // Give the test run its own profile. Sharing userData with a running dev
  // instance makes both fight over the same disk cache, which buries the test
  // output in Chromium cache errors.
  app.setPath('userData', join(app.getPath('temp'), 'claven-smoke'))
}

// A second instance would fight over the same workspace state later on.
//
// The smoke run is deliberately exempt. It is a test process, not a second
// editor, and applying the lock meant that leaving `npm run dev` open made
// `npm run smoke` exit 0 without running a single assertion -- a test harness
// that silently passes is worse than one that fails.
if (!isSmokeRun && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(async () => {
    electronAppUserModelId()
    registerHandlers()
    const window = createWindow()

    if (isSmokeRun) {
      const { runSmokeTest } = await import('./smoke')
      if (window.webContents.isLoading()) {
        await new Promise<void>((resolve) =>
          window.webContents.once('did-finish-load', () => resolve())
        )
      }
      const failures = await runSmokeTest(window).catch((error: unknown) => {
        console.error('smoke run threw:', error)
        return 1
      })
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
