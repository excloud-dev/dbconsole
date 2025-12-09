import { Pool } from 'pg'
import type { ServerDbConnection } from '@/lib/connections'

// Global pool cache to avoid creating too many Postgres connections
// during dev hot reload or under light concurrency.

declare global {
    var __dbconsolePgPools: Map<string, Pool> | undefined
}

const globalPools = globalThis.__dbconsolePgPools ?? new Map<string, Pool>()
if (!globalThis.__dbconsolePgPools) {
    globalThis.__dbconsolePgPools = globalPools
}

export function getPoolForConnection(conn: ServerDbConnection): Pool {
    let pool = globalPools.get(conn.id)
    if (!pool) {
        pool = new Pool({
            connectionString: conn.url,
            statement_timeout: 10_000,
            query_timeout: 10_000,
            idleTimeoutMillis: 30_000,
            max: 10,
        })
        globalPools.set(conn.id, pool)
    }
    return pool
}
