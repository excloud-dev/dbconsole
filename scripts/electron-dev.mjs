import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Prepare Electron-only native modules (keeps Node.js dev server working).
const prepareNative = spawn('npm', ['run', 'electron:prepare-native'], {
  cwd: root,
  stdio: 'inherit',
})

await new Promise((resolve, reject) => {
  prepareNative.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`electron:prepare-native failed (${code ?? 'null'})`))))
  prepareNative.on('error', reject)
})

// Bundle IPC handlers for Electron main (loads TS core backend).
const bundleIpc = spawn('node', ['scripts/electron-bundle-ipc.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

await new Promise((resolve, reject) => {
  bundleIpc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`IPC bundling failed (${code ?? 'null'})`))))
  bundleIpc.on('error', reject)
})

const port = Number(process.env.ELECTRON_RENDERER_PORT ?? 5173)
const devUrl = `http://127.0.0.1:${port}`

function electronBinPath() {
  const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron'
  return path.join(root, 'node_modules', '.bin', bin)
}

function waitForHttpOk(url, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
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

  return new Promise((resolve, reject) => {
    const loop = async () => {
      while (Date.now() < deadline) {
        const ok = await tryOnce()
        if (ok) return resolve()
        await new Promise((r) => setTimeout(r, intervalMs))
      }
      reject(new Error(`Timed out waiting for server: ${url}`))
    }
    void loop()
  })
}

function killTree(proc) {
  if (!proc || proc.killed) return
  proc.kill('SIGTERM')
}

const renderer = spawn('npm', ['run', 'renderer:dev', '--', '--port', String(port), '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
})

let electron = null

const cleanupAndExit = (code = 0) => {
  killTree(electron)
  killTree(renderer)
  process.exit(code)
}

process.on('SIGINT', () => cleanupAndExit(0))
process.on('SIGTERM', () => cleanupAndExit(0))

renderer.on('exit', (code) => {
  if (electron) return
  cleanupAndExit(code ?? 1)
})

await waitForHttpOk(devUrl)

electron = spawn(electronBinPath(), ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_DEV: '1',
    ELECTRON_RENDERER_URL: devUrl,
  },
})

electron.on('exit', (code) => cleanupAndExit(code ?? 0))
