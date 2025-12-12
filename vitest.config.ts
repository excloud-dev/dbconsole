import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig(() => {
  /**
   * In this environment, access to `.env` can be restricted (EPERM) during test runs.
   * Vitest uses Vite's env loading by default, which attempts to read `.env`.
   * Point env loading at `./tests` while running under Vitest to keep tests hermetic.
   */
  const isVitest = process.env.VITEST === 'true' || process.env.VITEST === '1'

  return {
    // Only affects Vite's env file loading (not process.env you set in setupFiles).
    envDir: isVitest ? path.resolve(__dirname, 'tests') : __dirname,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      setupFiles: ['./tests/setup-env.ts'],
      globals: true,
      environment: 'node',
      // Avoid forking worker processes in restricted environments (kill EPERM).
      pool: 'threads',
    },
  }
})
