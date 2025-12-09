import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
    test: {
        setupFiles: ['./tests/setup-env.ts'],
        globals: true,
        environment: 'node',
    },
})
