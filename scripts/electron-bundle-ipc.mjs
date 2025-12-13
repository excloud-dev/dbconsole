import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import * as esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const entry = path.join(root, 'electron', 'ipc.ts')
const outFile = path.join(root, 'dist', 'electron', 'ipc.cjs')

await fs.mkdir(path.dirname(outFile), { recursive: true })

const aliasPlugin = {
  name: 'alias-at',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, args.path.slice(2))

      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.cjs`,
        path.join(base, 'index.ts'),
        path.join(base, 'index.tsx'),
        path.join(base, 'index.js'),
        path.join(base, 'index.mjs'),
        path.join(base, 'index.cjs'),
      ]

      const resolved = candidates.find((p) => fsSync.existsSync(p))
      return { path: resolved ?? base }
    })
  },
}

await esbuild.build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  plugins: [aliasPlugin],
  external: [
    'electron',
    'better-sqlite3',
  ],
})

console.log(`Bundled Electron IPC module: ${path.relative(root, outFile)}`)
