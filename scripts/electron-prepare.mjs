import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist', 'electron', 'next')
const require = createRequire(import.meta.url)

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-next-build')
const useTurbopack = args.has('--turbopack')

if (!skipBuild) {
  const nextBin = require.resolve('next/dist/bin/next')
  await run(process.execPath, [nextBin, 'build', useTurbopack ? '--turbopack' : '--webpack'])
}

const standaloneDir = path.join(root, '.next', 'standalone')
const staticDir = path.join(root, '.next', 'static')
const publicDir = path.join(root, 'public')

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(outDir, { recursive: true })

// Copy the standalone server bundle (includes its own node_modules + server.js).
await fs.cp(standaloneDir, outDir, { recursive: true })

// Next standalone expects `.next/static` next to `server.js`.
await fs.mkdir(path.join(outDir, '.next'), { recursive: true })
await fs.cp(staticDir, path.join(outDir, '.next', 'static'), { recursive: true })

// Public assets (icons, etc).
await fs.cp(publicDir, path.join(outDir, 'public'), { recursive: true })

// Do not ship local secrets/state into the packaged app.
// Next's file-tracing can pull these in if they exist at build time.
try {
  const entries = await fs.readdir(outDir)
  await Promise.all(
    entries.map(async (name) => {
      const lower = name.toLowerCase()
      if (lower === '.env' || lower.startsWith('.env.')) {
        await fs.rm(path.join(outDir, name), { force: true })
        return
      }
      if (lower.endsWith('.sqlite') || lower.includes('.sqlite-') || lower.endsWith('.sqlite3')) {
        await fs.rm(path.join(outDir, name), { force: true })
      }
    }),
  )
} catch {
  // Best-effort cleanup only.
}

console.log(`Prepared Electron Next bundle at: ${path.relative(root, outDir)}`)
