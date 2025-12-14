const { app, BrowserWindow, dialog, shell } = require('electron')
const { registerDesktopIpcHandlers } = require('./ipc-loader.cjs')
const path = require('node:path')

const isDev = process.env.ELECTRON_DEV === '1' || !app.isPackaged

let mainWindow = null

function getRendererUrl() {
  if (process.env.ELECTRON_RENDERER_URL) return process.env.ELECTRON_RENDERER_URL
  return 'http://127.0.0.1:5173'
}

function getRendererIndexFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'renderer', 'index.html')
  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')
}

function setDefaultDesktopEnv() {
  // Ensure the metadata SQLite DB ends up somewhere writable on macOS.
  if (!process.env.DBCONSOLE_META_SQLITE_PATH) {
    const dbPath = path.join(app.getPath('userData'), 'dbconsole-meta.sqlite')
    process.env.DBCONSOLE_META_SQLITE_PATH = dbPath
  }

  // Always use a dedicated Electron-only native deps tree for better-sqlite3:
  // - Dev: `dist/electron/native/deps` (built by `npm run electron:prepare-native`)
  // - Prod: packaged under `Resources/native/deps`
  if (!process.env.DBCONSOLE_ELECTRON_NATIVE_DIR) {
    const nativeDir = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'deps')
      : path.join(app.getAppPath(), 'dist', 'electron', 'native', 'deps')
    process.env.DBCONSOLE_ELECTRON_NATIVE_DIR = nativeDir
  }

  // Keep the embedded server private to the local machine by default.
  if (!process.env.BIND_HOST) {
    process.env.BIND_HOST = '127.0.0.1'
  }
  if (!process.env.HOSTNAME) {
    process.env.HOSTNAME = '127.0.0.1'
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Keep new-window navigations in the system browser.
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl === win.webContents.getURL()) return
    event.preventDefault()
    void shell.openExternal(targetUrl)
  })

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' })
  } else if (process.env.DBCONSOLE_OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  if (isDev) {
    void win.loadURL(getRendererUrl())
  } else {
    void win.loadFile(getRendererIndexFile())
  }
  return win
}

// Only enforce a single instance for packaged apps. In dev, this commonly causes
// `npm run electron:dev` to immediately exit if another DBConsole instance is open.
if (app.isPackaged) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length > 0) return
  mainWindow = createMainWindow()
})

app
  .whenReady()
  .then(async () => {
    setDefaultDesktopEnv()
    registerDesktopIpcHandlers(app)

    mainWindow = createMainWindow()
  })
  .catch((err) => {
    console.error(err)
    void dialog.showErrorBox('DBConsole failed to start', err instanceof Error ? err.message : String(err))
    app.quit()
  })
