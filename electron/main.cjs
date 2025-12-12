const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const isDev = process.env.ELECTRON_DEV === '1' || !app.isPackaged

let mainWindow = null
let nextServerProc = null
let nextServerUrl = null

function getRendererUrl() {
  if (process.env.ELECTRON_RENDERER_URL) return process.env.ELECTRON_RENDERER_URL
  return 'http://127.0.0.1:3000'
}

function getNextStandaloneDir() {
  if (process.env.ELECTRON_NEXT_DIR) return process.env.ELECTRON_NEXT_DIR
  if (app.isPackaged) return path.join(process.resourcesPath, 'next')
  return path.join(app.getAppPath(), 'dist', 'electron', 'next')
}

function setDefaultDesktopEnv() {
  // Ensure the metadata SQLite DB ends up somewhere writable on macOS.
  if (!process.env.DBCONSOLE_META_SQLITE_PATH) {
    const dbPath = path.join(app.getPath('userData'), 'dbconsole-meta.sqlite')
    process.env.DBCONSOLE_META_SQLITE_PATH = dbPath
  }

  // Keep the embedded server private to the local machine by default.
  if (!process.env.BIND_HOST) {
    process.env.BIND_HOST = '127.0.0.1'
  }
  if (!process.env.HOSTNAME) {
    process.env.HOSTNAME = '127.0.0.1'
  }
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => {
        if (!addr || typeof addr === 'string') return reject(new Error('Failed to allocate port'))
        resolve(addr.port)
      })
    })
  })
}

async function waitForHttpOk(url, { timeoutMs = 25_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs

  const tryOnce = () =>
    new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(2_500, () => {
        req.destroy()
        resolve(false)
      })
    })

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryOnce()
    if (ok) return
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for server: ${url}`)
}

async function startNextStandaloneServer() {
  const nextDir = getNextStandaloneDir()
  const serverJs = path.join(nextDir, 'server.js')
  const port = await getAvailablePort()

  const env = {
    ...process.env,
    // Run Electron as Node for the server process.
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    BIND_HOST: process.env.BIND_HOST ?? '127.0.0.1',
    HOSTNAME: process.env.HOSTNAME ?? '127.0.0.1',
  }

  const child = spawn(process.execPath, [serverJs], {
    cwd: nextDir,
    env,
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (code === 0) return
    if (signal === 'SIGTERM' || signal === 'SIGINT') return
    console.error(`Next server exited (${code ?? 'null'} / ${signal ?? 'null'})`)
  })

  const url = `http://127.0.0.1:${port}`
  await waitForHttpOk(url)

  nextServerProc = child
  nextServerUrl = url
}

function createMainWindow(url) {
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
  }

  void win.loadURL(url)
  return win
}

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length > 0) return
  const url = nextServerUrl ?? getRendererUrl()
  mainWindow = createMainWindow(url)
})

app.on('before-quit', () => {
  if (nextServerProc && !nextServerProc.killed) {
    nextServerProc.kill('SIGTERM')
  }
})

app
  .whenReady()
  .then(async () => {
    setDefaultDesktopEnv()

    if (isDev) {
      nextServerUrl = getRendererUrl()
    } else {
      await startNextStandaloneServer()
    }

    mainWindow = createMainWindow(nextServerUrl)
  })
  .catch((err) => {
    console.error(err)
    void dialog.showErrorBox('DBConsole failed to start', err instanceof Error ? err.message : String(err))
    app.quit()
  })

