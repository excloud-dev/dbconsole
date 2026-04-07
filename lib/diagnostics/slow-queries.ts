// Slow query insight via pg_stat_statements.
//
// pg_stat_statements is a contrib extension that records normalized statement
// fingerprints with cumulative timing info. We surface the top-N slow queries
// for a given connection so a user can drill into "what's actually expensive
// on this database right now" without leaving dbconsole.
//
// This is read-only by definition (we just SELECT from the catalog view), so
// it does NOT need to go through `runQuery` / `isReadOnlySql`. We use the
// shared pool and short-circuit if the extension isn't installed.

import { getConnectionById } from '@/lib/connections'
import { getPoolForConnection } from '@/lib/pg-pool'
import { QueryError, toQueryError } from '@/lib/core/errors'

export type SlowQuerySort = 'mean_time' | 'total_time' | 'calls' | 'rows'

export type SlowQueryRow = {
    queryId: string
    query: string
    calls: number
    totalTimeMs: number
    meanTimeMs: number
    minTimeMs: number
    maxTimeMs: number
    stddevTimeMs: number
    rows: number
    sharedBlksHit: number
    sharedBlksRead: number
}

export type SlowQueryResult =
    | {
          installed: true
          rows: SlowQueryRow[]
          sort: SlowQuerySort
          limit: number
      }
    | {
          installed: false
          /** SQL the user can run as a superuser to install the extension. */
          installSnippet: string
      }

const SORT_COLUMN: Record<SlowQuerySort, string> = {
    mean_time: 'mean_exec_time',
    total_time: 'total_exec_time',
    calls: 'calls',
    rows: 'rows',
}

export async function fetchSlowQueries(
    connectionId: string,
    opts: { sort?: SlowQuerySort; limit?: number } = {},
): Promise<SlowQueryResult> {
    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new QueryError({ error: 'Connection not found', classification: 'not_found' })
    }
    const pool = getPoolForConnection(conn, { mode: 'shared' })

    try {
        const ext = await pool.query<{ installed: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS installed",
        )
        if (!ext.rows[0]?.installed) {
            return {
                installed: false,
                installSnippet: 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;',
            }
        }

        const sort: SlowQuerySort = opts.sort ?? 'mean_time'
        const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), 500)
        const orderBy = SORT_COLUMN[sort]

        // Use a parameter for LIMIT but not for ORDER BY (which can't be
        // parameterized). The ORDER BY column is whitelisted by SORT_COLUMN
        // above so this is not an injection vector.
        const rows = await pool.query(
            `SELECT
                queryid::text AS query_id,
                query,
                calls,
                total_exec_time,
                mean_exec_time,
                min_exec_time,
                max_exec_time,
                stddev_exec_time,
                rows,
                shared_blks_hit,
                shared_blks_read
             FROM pg_stat_statements
             WHERE query NOT LIKE '%pg_stat_statements%'
             ORDER BY ${orderBy} DESC NULLS LAST
             LIMIT $1`,
            [limit],
        )

        const mapped: SlowQueryRow[] = rows.rows.map((r: any) => ({
            queryId: String(r.query_id),
            query: String(r.query ?? ''),
            calls: Number(r.calls ?? 0),
            totalTimeMs: Number(r.total_exec_time ?? 0),
            meanTimeMs: Number(r.mean_exec_time ?? 0),
            minTimeMs: Number(r.min_exec_time ?? 0),
            maxTimeMs: Number(r.max_exec_time ?? 0),
            stddevTimeMs: Number(r.stddev_exec_time ?? 0),
            rows: Number(r.rows ?? 0),
            sharedBlksHit: Number(r.shared_blks_hit ?? 0),
            sharedBlksRead: Number(r.shared_blks_read ?? 0),
        }))

        return { installed: true, rows: mapped, sort, limit }
    } catch (err) {
        throw toQueryError(err)
    }
}
