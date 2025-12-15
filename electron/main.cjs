const { app, BrowserWindow, dialog, shell, Menu, protocol } = require('electron')
const fs = require('node:fs')
const { registerDesktopIpcHandlers } = require('./ipc-loader.cjs')
const { setupSqlFileOpen } = require('./sql-file-open.cjs')
const path = require('node:path')

const isDev = process.env.ELECTRON_DEV === '1' || !app.isPackaged
const isMac = process.platform === 'darwin'

// Ensure our custom scheme behaves like a normal secure origin (so things like localStorage work).
// IMPORTANT: Must be called before app is ready.
try {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        allowServiceWorkers: true,
        stream: true,
      },
    },
  ])
} catch (e) {
  console.error('Failed to register scheme privileges for app://', e)
}

let mainWindow = null
let sqlFileOpen = null

function getRendererUrl() {
  if (process.env.ELECTRON_RENDERER_URL) return process.env.ELECTRON_RENDERER_URL
  return 'http://127.0.0.1:5173'
}

function getRendererIndexFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'renderer', 'index.html')
  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')
}

function registerRendererProtocol() {
  // Use a custom scheme in packaged apps to avoid file:// module/CORS edge-cases that can cause a blank window.
  // This maps `app://...` to the packaged renderer directory.
  if (!app.isPackaged) return
  try {
    protocol.registerFileProtocol('app', (request, callback) => {
      const url = request.url.replace(/^app:\/\//, '')
      const withoutFragment = url.split('#')[0].split('?')[0]
      let rel = withoutFragment.length > 0 ? withoutFragment : 'index.html'
      if (rel.startsWith('/')) rel = rel.slice(1)
      // When index.html references "./assets/...", it resolves to "index.html/assets/...".
      // Normalize that to the renderer root so assets resolve correctly.
      if (rel.startsWith('index.html/')) rel = rel.slice('index.html/'.length)
      // Handle trailing slashes / directory-like URLs (e.g. app://index.html/).
      if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`

      let filePath = path.join(process.resourcesPath, 'renderer', rel)
      // If we somehow end up with a directory path, serve its index.html.
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }
      } catch { }
      callback({ path: filePath })
    })
  } catch (e) {
    console.error('Failed to register app:// protocol', e)
  }
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
      // NOTE: sandbox + file:// module scripts can be problematic in packaged builds (blank window).
      // We keep contextIsolation + no nodeIntegration for safety, but disable sandbox for reliability.
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Surface renderer failures instead of silently showing a blank window.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL })
    try {
      dialog.showErrorBox('DBConsole failed to load', `${errorDescription} (${errorCode})`)
    } catch { }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details)
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // Helps debug packaged-only issues without devtools.
    if (!app.isPackaged) return
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  win.webContents.once('did-finish-load', () => {
    // no-op (kept as a useful hook for future debug)
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

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
    // Prefer app:// in packaged builds to avoid file:// module loading issues.
    void win.loadURL('app://index.html')
  }

  return win
}

function installAppMenu() {
  const template = [
    ...(isMac
      ? [
        {
          label: app.name,
          submenu: [
            {
              label: 'About DBConsole',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:about')
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Check for Updates…',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:checkUpdates')
                }
              }
            },
            {
              label: 'Update Settings…',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:updateSettings')
                }
              }
            },
            { type: 'separator' },
            { role: 'quit' }
          ],
        },
      ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open SQL…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (sqlFileOpen) {
              await sqlFileOpen.openDialogAndSend()
            }
          },
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Do not include reload: this is an app, not a browser. (CmdOrCtrl+R)
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac ? [{ role: 'minimize' }, { role: 'zoom' }] : [{ role: 'minimize' }, { role: 'close' }],
    },
    ...(!isMac
      ? [
        {
          label: 'Help',
          submenu: [
            {
              label: 'About DBConsole',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:about')
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Check for Updates…',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:checkUpdates')
                }
              }
            },
            {
              label: 'Update Settings…',
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('dbconsole:menu:updateSettings')
                }
              }
            }
          ],
        },
      ]
      : []),
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Only enforce a single instance for packaged apps. In dev, this commonly causes
// `npm run electron:dev` to immediately exit if another DBConsole instance is open.
if (app.isPackaged) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      if (sqlFileOpen && Array.isArray(argv)) {
        sqlFileOpen.handleArgv(argv)
      }

      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createMainWindow()
        mainWindow.webContents.once('did-finish-load', () => {
          sqlFileOpen?.markRendererReady()
        })
        return
      }

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
    registerRendererProtocol()

    sqlFileOpen = setupSqlFileOpen({
      app,
      dialog,
      getMainWindow: () => mainWindow,
    })

    mainWindow = createMainWindow()
    mainWindow.webContents.once('did-finish-load', () => {
      sqlFileOpen?.markRendererReady()
    })
    installAppMenu()
  })
  .catch((err) => {
    console.error(err)
    void dialog.showErrorBox('DBConsole failed to start', err instanceof Error ? err.message : String(err))
    app.quit()
  })
