import { app, shell, dialog, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { registerHandlers, getDirtyCount } from './handlers'
import { stopLanguageServer } from './lsp'
import { killAllPtys, killPtysFor, livePtyCount } from './pty'
import { stopWatching } from './watcher'
import { cancelAllSearches } from './search'

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

    // Custom chrome. `titleBarOverlay` rather than `frame: false` with
    // hand-drawn buttons: Windows keeps drawing the real minimise/maximise/close
    // controls, so Snap Layouts still appear when you hover maximise, hit
    // testing is correct, and high-contrast and RTL system settings are honoured.
    // Hand-rolled controls break all four and are a permanent maintenance tax.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : {
          titleBarOverlay: {
            color: '#16191F', // surface-1
            symbolColor: '#E8E6E1', // ink
            height: 38 // must match --titlebar-h
          }
        }),
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

  /**
   * Guard the window close.
   *
   * A renderer cannot veto its own window closing, so main has to hold the
   * dirty count (pushed over app:setDirtyCount) and intercept here. Without
   * this, closing the window silently destroys every unsaved tab.
   */
  let forceClose = false
  window.on('close', (event) => {
    if (forceClose || isSmokeRun || getDirtyCount() === 0) return
    event.preventDefault()
    const count = getDirtyCount()
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        buttons: ['close anyway', 'cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${count} unsaved ${count === 1 ? 'file' : 'files'}`,
        detail: 'your changes will be lost if you close now.'
      })
      .then(({ response }) => {
        if (response === 0) {
          forceClose = true
          window.close()
        }
      })
  })

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

  // A window's shells belong to that window. Closing it takes them with it,
  // rather than leaving shells whose output has nowhere to go.
  //
  // The reference is captured now rather than read in the handler: by the time
  // `closed` fires the window is destroyed and reaching for `webContents`
  // throws.
  const contents = window.webContents
  window.on('closed', () => killPtysFor(contents))

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

const isSmokeRun = process.argv.includes('--smoke')

/**
 * A development build keeps its own profile.
 *
 * The single-instance lock is per user-data directory, and the app name is the
 * same either way, so without this `npm run dev` run while the installed Claven
 * is open does not start: it hands off to the running window and exits, which
 * looks exactly like the command doing nothing. Developing Claven inside Claven
 * is the whole dogfooding plan, so the two have to be able to run side by side.
 *
 * They would also share one session file, meaning a dev build crashing on a
 * half-written layout takes the editor you are working in down with it.
 *
 * Skipped when a profile was named on the command line, which is how the smoke
 * and drive suites isolate themselves. Overriding that here would put every
 * test run back in the shared profile.
 */
const hasNamedProfile = process.argv.some((argument) => argument.startsWith('--user-data-dir'))

if (isSmokeRun) {
  // Give the test run its own profile. Sharing userData with a running dev
  // instance makes both fight over the same disk cache, which buries the test
  // output in Chromium cache errors.
  app.setPath('userData', join(app.getPath('temp'), 'claven-smoke'))
}

if (!app.isPackaged && !isSmokeRun && !hasNamedProfile) {
  app.setPath('userData', join(app.getPath('appData'), 'claven-dev'))
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
    installMenu()
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

  /**
   * An orphaned language server is a few hundred megabytes held by a process
   * with nothing left to serve, and on Windows it outlives the app happily.
   *
   * The quit is deferred once, so the shells actually get killed. On Windows
   * node-pty ends a conpty's children by forking a helper and killing them when
   * it answers, which takes tens of milliseconds; a synchronous quit is gone
   * before that lands. The symptom is a dev server outliving the editor, still
   * holding its port, with nothing on screen to explain the next EADDRINUSE.
   */
  let shuttingDown = false
  app.on('before-quit', (event) => {
    stopLanguageServer()
    stopWatching()
    cancelAllSearches()
    if (shuttingDown || livePtyCount() === 0) return
    shuttingDown = true
    event.preventDefault()
    void killAllPtys().then(() => app.quit())
  })

  app.on('window-all-closed', () => {
    stopLanguageServer()
    stopWatching()
    cancelAllSearches()
    // macOS convention is to stay alive with no windows; everywhere else quits.
    // The shells are killed by the before-quit above rather than here, so the
    // wait happens once and in one place.
    if (process.platform !== 'darwin') app.quit()
    else void killAllPtys()
  })
}

/**
 * No menu bar on Windows and Linux — the command palette replaces it, and the
 * command centre in the title bar is what makes it discoverable.
 *
 * macOS is not a style choice. Electron always draws an application menu on
 * darwin, and the standard editing shortcuts are wired to menu *roles* — with
 * no Edit menu registering cut/copy/paste/selectAll, Cmd+C and Cmd+V do not
 * reliably reach the renderer. So darwin gets the minimum the OS requires and
 * nothing that duplicates the palette.
 */
function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
      { role: 'windowMenu' }
    ])
  )
}

/** Without this Windows groups the taskbar entry under "electron.app.Electron". */
function electronAppUserModelId(): void {
  if (process.platform === 'win32') app.setAppUserModelId('dev.claven.app')
}
