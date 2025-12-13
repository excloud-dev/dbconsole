import fs from 'node:fs'
import path from 'node:path'

// Use a dedicated SQLite file per Vitest worker so parallel test files don't contend.
const workerId =
    process.env.VITEST_WORKER_ID ??
    process.env.VITEST_POOL_ID ??
    String(process.pid)

const testDbPath = path.join(process.cwd(), 'tests', `dbconsole-meta-test.${workerId}.sqlite`)

try {
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
} catch {
    // ignore
}

try {
    fs.unlinkSync(testDbPath)
} catch {
    // ignore if it doesn't exist
}

process.env.DBCONSOLE_META_SQLITE_PATH = testDbPath

// If a Postgres URL is provided, wire it into the env connections JSON for tests.
if (process.env.DBCONSOLE_TEST_PG_URL) {
    process.env.DBCONSOLE_CONNECTIONS_JSON = JSON.stringify([
        {
            id: 'test-pg',
            label: 'Test Postgres',
            url: process.env.DBCONSOLE_TEST_PG_URL,
            readOnly: true,
        },
    ])
}
