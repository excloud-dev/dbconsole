const path = require('node:path')
const fs = require('node:fs')

function resolveIpcBundlePath(app) {
  // In packaged app, ipc.cjs is in the app root
  // In dev, it's in dist/electron/ipc.cjs relative to project root
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'ipc.cjs')
  }
  return path.join(app.getAppPath(), 'dist', 'electron', 'ipc.cjs')
}

function registerDesktopIpcHandlers(app) {
  const bundlePath = resolveIpcBundlePath(app)
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`IPC bundle not found: ${bundlePath}`)
  }

  try {
    const mod = require(bundlePath)
    if (!mod || typeof mod.registerDesktopIpcHandlers !== 'function') {
      throw new Error(`IPC bundle loaded but missing registerDesktopIpcHandlers(): ${bundlePath}`)
    }
    mod.registerDesktopIpcHandlers()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to load IPC bundle (${bundlePath}): ${msg}`)
  }
}

module.exports = { registerDesktopIpcHandlers }
