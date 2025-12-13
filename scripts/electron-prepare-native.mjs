import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const { rebuild } = require('@electron/rebuild')
const electronVersion = require('electron/package.json').version

const nativeDir = path.join(root, 'dist', 'electron', 'native')
// Note: electron-builder's file copy filter always excludes a *root* `node_modules` directory.
// To ship native deps as `extraResources`, keep them under `deps/node_modules/*` instead.
const nativeDepsDir = path.join(nativeDir, 'deps')
const nativeNodeModules = path.join(nativeDepsDir, 'node_modules')

const rootPkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const betterSqlite3Version =
  rootPkg?.dependencies?.['better-sqlite3'] ??
  rootPkg?.devDependencies?.['better-sqlite3'] ??
  null

async function copyModule(name) {
  const src = path.join(root, 'node_modules', name)
  const dst = path.join(nativeNodeModules, name)
  await fs.rm(dst, { recursive: true, force: true })
  await fs.cp(src, dst, { recursive: true })
}

// Ensure we don't keep stale artifacts around (wrong ABI / wrong folder layout).
await fs.rm(nativeDir, { recursive: true, force: true })
await fs.mkdir(nativeNodeModules, { recursive: true })

// electron-rebuild expects a package.json at buildPath.
await fs.writeFile(
  path.join(nativeDepsDir, 'package.json'),
  JSON.stringify(
    {
      name: 'dbconsole-electron-native',
      private: true,
      version: '0.0.0',
      description: 'Electron-only native dependencies for DBConsole',
      dependencies: betterSqlite3Version ? { 'better-sqlite3': betterSqlite3Version } : {},
    },
    null,
    2,
  ),
)

// Copy native modules into an Electron-only node_modules tree so rebuilding
// doesn't break the Node.js (web) dev server.
// Note: we also copy runtime JS deps that better-sqlite3 expects to resolve via `node_modules`
// (in production `Resources/native/deps` is not an ancestor of the app's `app.asar.unpacked/node_modules`).
for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
  await copyModule(name)
}

await rebuild({
  buildPath: nativeDepsDir,
  electronVersion,
  force: true,
  onlyModules: ['better-sqlite3'],
})

console.log(`Prepared Electron native modules at: ${path.relative(root, nativeDepsDir)}`)
