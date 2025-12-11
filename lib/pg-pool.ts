import { Pool } from 'pg'
import type { ServerDbConnection } from '@/lib/connections'

export type PoolMode = 'single' | 'shared' | 'per-scope'

type PoolKey = string

// Global pool cache to avoid creating too many Postgres connections
// during dev hot reload or under light concurrency.

declare global {
    // eslint-disable-next-line no-var
    var __dbconsolePgPools: Map<PoolKey, Pool> | undefined
}

const globalPools = globalThis.__dbconsolePgPools ?? new Map<PoolKey, Pool>()
if (!globalThis.__dbconsolePgPools) {
    globalThis.__dbconsolePgPools = globalPools
}

function buildPoolKey(connId: string, mode: PoolMode, scopeKey?: string): PoolKey {
    switch (mode) {
        case 'single':
            return `single:${connId}`
        case 'per-scope':
            return `scope:${connId}:${scopeKey ?? 'default'}`
        case 'shared':
        default:
            return `shared:${connId}`
    }
}

function poolMaxSize(mode: PoolMode): number {
    switch (mode) {
        case 'single':
            return 1
        case 'per-scope':
            return 1
        case 'shared':
        default:
            return 10
    }
}

// Narrow pool key to its connection id segment (text between the first and
// optional second colon). Returns null if the key does not follow the expected
// `<mode>:<connId>[:<scope>]` format.
function extractConnIdFromKey(key: PoolKey): string | null {
    const firstColon = key.indexOf(':')
    if (firstColon === -1) return null

    const remainder = key.slice(firstColon + 1)
    const secondColon = remainder.indexOf(':')
    return secondColon === -1 ? remainder : remainder.slice(0, secondColon)
}

type PoolOptions = {
    mode?: PoolMode
    scopeKey?: string
}

export function getPoolForConnection(conn: ServerDbConnection, opts: PoolOptions = {}): Pool {
    const mode: PoolMode = opts.mode ?? 'shared'
    const key = buildPoolKey(conn.id, mode, opts.scopeKey)
    let pool = globalPools.get(key)
    if (!pool) {
        pool = new Pool({
            connectionString: conn.url,
            statement_timeout: 10_000,
            query_timeout: 10_000,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            application_name: 'dbconsole',
            max: poolMaxSize(mode),
        })
        globalPools.set(key, pool)
    }
    return pool
}

export async function closePoolsForConnection(connId: string): Promise<void> {
    const matches: PoolKey[] = []
    for (const [key] of globalPools) {
        const keyConnId = extractConnIdFromKey(key)
        if (keyConnId === connId) {
            matches.push(key)
        }
    }

    for (const key of matches) {
        const pool = globalPools.get(key)
        if (!pool) continue

        await pool.end().catch(() => {})
        globalPools.delete(key)
    }
}

export async function closeAllPools(): Promise<void> {
    const closers: Promise<unknown>[] = []
    for (const [key, pool] of globalPools) {
        closers.push(
            pool
                .end()
                .catch(() => {})
                .finally(() => globalPools.delete(key)),
        )
    }
    await Promise.all(closers)
}

export async function closePool(connId: string, mode: PoolMode, scopeKey?: string): Promise<void> {
    const key = buildPoolKey(connId, mode, scopeKey)
    const pool = globalPools.get(key)
    if (!pool) return
    await pool.end().catch(() => {})
    globalPools.delete(key)
}
