import { defineConfig } from 'vite'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')

export default defineConfig({
    root: __dirname,
    base: './',
    plugins: [
        {
            name: 'strip-use-client-directive',
            enforce: 'pre',
            apply: 'build',
            transform(code, id) {
                // Many dependencies (and our shared components) include Next.js/RSC-only directives.
                // For the desktop renderer build (Vite), strip them to avoid noisy warnings.
                if (!/\.(mjs|cjs|js|ts|tsx|jsx)$/.test(id)) return null

                // Only strip directive prologue lines at the very top of the file.
                // Handles both single and double quotes.
                const next = code.replace(
                    /^\s*(?:['"]use client['"];\s*|['"]use client['"]\s*\n|['"]use server['"];\s*|['"]use server['"]\s*\n)+/,
                    '',
                )
                if (next === code) return null
                return { code: next, map: null }
            },
        },
    ],
    resolve: {
        alias: {
            '@': repoRoot,
        },
    },
    esbuild: {
        jsx: 'automatic',
        // Silence noisy warnings from bundling Next.js-style `"use client"` directives in the desktop renderer.
        // These directives are harmless here and are only meaningful to Next.js/RSC.
        logOverride: {
            directives: 'silent',
        },
    },
    build: {
        outDir: path.resolve(repoRoot, 'dist', 'renderer'),
        emptyOutDir: true,
        // Sourcemaps aren't useful in packaged builds and cause confusing sourcemap warnings in output.
        sourcemap: false,
        // The default warning threshold is 500kB. Our renderer includes heavy libs (CodeMirror, Radix, TanStack).
        // We still split chunks, but keep the warning threshold more realistic for a desktop app.
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                // Split large dependencies into stable vendor chunks to reduce the main entry chunk size.
                manualChunks(id) {
                    if (!id.includes('node_modules')) return
                    if (id.includes('@codemirror') || id.includes('@lezer')) return 'vendor-codemirror'
                    if (id.includes('@radix-ui')) return 'vendor-radix'
                    if (id.includes('@tanstack')) return 'vendor-tanstack'
                    if (id.includes('cmdk')) return 'vendor-cmdk'
                    if (id.includes('lucide-react')) return 'vendor-icons'
                    return 'vendor'
                },
            },
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
    },
})

