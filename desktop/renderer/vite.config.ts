import { defineConfig } from 'vite'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')

export default defineConfig({
    root: __dirname,
    base: './',
    resolve: {
        alias: {
            '@': repoRoot,
        },
    },
    esbuild: {
        jsx: 'automatic',
    },
    build: {
        outDir: path.resolve(repoRoot, 'dist', 'renderer'),
        emptyOutDir: true,
        sourcemap: process.env.NODE_ENV !== 'production',
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
    },
})

