import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function initAppDir() {
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
  await fs.writeFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(minimalPkg, null, 2)}\n`
  )
}

initAppDir().catch((err) => {
  console.error('Failed to initialize Electron app directory:', err)
  process.exit(1)
})

