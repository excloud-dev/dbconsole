import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const port = Number(process.env.ELECTRON_PORT ?? process.env.PORT ?? 3000)
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
        // eslint-disable-next-line no-await-in-loop
        const ok = await tryOnce()
        if (ok) return resolve()
        // eslint-disable-next-line no-await-in-loop
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

const next = spawn('npm', ['run', 'dev', '--', '-p', String(port)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
})

let electron = null

const cleanupAndExit = (code = 0) => {
  killTree(electron)
  killTree(next)
  process.exit(code)
}

process.on('SIGINT', () => cleanupAndExit(0))
process.on('SIGTERM', () => cleanupAndExit(0))

next.on('exit', (code) => {
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

