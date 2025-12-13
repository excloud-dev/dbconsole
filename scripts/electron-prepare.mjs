import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
const skipRendererBuild = args.has('--skip-renderer-build')
const skipNative = args.has('--skip-native')

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })
  if (res.status !== 0) return ''
  return String(res.stdout ?? '').trim()
}

async function writeBuildInfo() {
  const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw)

  const fullSha =
    (process.env.DBCONSOLE_BUILD_SHA ?? process.env.GITHUB_SHA ?? '').trim() || capture('git', ['rev-parse', 'HEAD'])
  const shortSha =
    (process.env.DBCONSOLE_BUILD_SHA_SHORT ?? '').trim() ||
    (fullSha ? fullSha.slice(0, 12) : '') ||
    capture('git', ['rev-parse', '--short', 'HEAD'])

  const buildTime = (process.env.DBCONSOLE_BUILD_TIME ?? '').trim() || new Date().toISOString()

  const buildInfo = {
    version: typeof pkg?.version === 'string' ? pkg.version : '0.0.0',
    sha: fullSha || undefined,
    shaShort: shortSha || undefined,
    time: buildTime,
  }

  const outDir = path.join(root, 'dist', 'electron')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`)
}

await writeBuildInfo()

if (!skipNative) {
  // Build Electron-ABI native deps into `dist/electron/native/deps` (packaged as `Resources/native/deps`).
  await run('npm', ['run', 'electron:prepare-native'])
}

// Bundle Electron IPC handlers (transport-agnostic core backend for desktop IPC).
await run(process.execPath, [path.join(root, 'scripts', 'electron-bundle-ipc.mjs')])

if (!skipRendererBuild) {
  await run('npm', ['run', 'renderer:build'])
}

console.log('Prepared Electron artifacts: native deps, IPC bundle, renderer build')
