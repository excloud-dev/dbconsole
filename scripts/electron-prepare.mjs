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

async function createMinimalAppPackageJson() {
  const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw)

  // Create minimal package.json with only Electron runtime dependencies
  // The IPC bundle includes all other dependencies, so we only need better-sqlite3
  // (which is external and requires native compilation)
  const minimalPkg = {
    name: pkg.name,
    version: pkg.version,
    main: 'electron/main.cjs',
    dependencies: {
      'better-sqlite3': pkg.dependencies['better-sqlite3'],
    },
  }

  const appDir = path.join(root, 'dist', 'electron', 'app')
  await fs.mkdir(appDir, { recursive: true })
  // Update package.json (may already exist from postinstall)
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(minimalPkg, null, 2)}\n`
  )
}

async function copyAppFiles() {
  const appDir = path.join(root, 'dist', 'electron', 'app')

  // Copy electron files into app directory
  // electron-builder will use this as the app directory
  const electronSrc = path.join(root, 'electron')
  const electronDest = path.join(appDir, 'electron')
  await fs.cp(electronSrc, electronDest, { recursive: true })

  // Copy build-info.json and ipc.cjs into app directory
  const distElectron = path.join(root, 'dist', 'electron')
  await fs.copyFile(
    path.join(distElectron, 'build-info.json'),
    path.join(appDir, 'build-info.json')
  )
  await fs.copyFile(
    path.join(distElectron, 'ipc.cjs'),
    path.join(appDir, 'ipc.cjs')
  )
}

await writeBuildInfo()

// Create minimal app directory with package.json containing only Electron runtime deps
await createMinimalAppPackageJson()

if (!skipNative) {
  // Build Electron-ABI native deps into `dist/electron/native/deps` (packaged as `Resources/native/deps`).
  await run('npm', ['run', 'electron:prepare-native'])
}

// Bundle Electron IPC handlers (transport-agnostic core backend for desktop IPC).
// Set NODE_ENV=production to disable sourcemaps in release builds
const bundleEnv = { ...process.env, NODE_ENV: 'production' }
await run(process.execPath, [path.join(root, 'scripts', 'electron-bundle-ipc.mjs')], { env: bundleEnv })

if (!skipRendererBuild) {
  // Vite automatically sets NODE_ENV=production for 'vite build'
  await run('npm', ['run', 'renderer:build'])
}

// Copy all files into app directory after builds complete
await copyAppFiles()

console.log('Prepared Electron artifacts: native deps, IPC bundle, renderer build')
