// Cursor-based result streaming.
//
// The bounded `runQuery` path materializes everything into memory and clips at
// DBCONSOLE_MAX_ROWS. For results that legitimately exceed that cap (a multi-
// million row export, an unbounded analytics query) we open a server-side
// cursor and let the client pull rows in batches.
//
// Lifecycle (one stream = one transaction = one checked-out client):
//
//     openStream  → BEGIN
//                   SET LOCAL statement_timeout = 0
//                   SET LOCAL idle_in_transaction_session_timeout = 0
//                   DECLARE _dbc_<id> NO SCROLL CURSOR FOR <user sql>
//                   FETCH FORWARD <batch> FROM _dbc_<id>      [first batch]
//                   → returns { streamId, columns, rows, hasMore }
//
//     fetchNext  → FETCH FORWARD <batch> FROM _dbc_<id>
//                  → returns { rows, hasMore }
//
//     closeStream → CLOSE _dbc_<id>; ROLLBACK; release()
//
// We hold the pg client checked out for the entire stream's lifetime so the
// pool's idle timeout can't yank it mid-cursor. A periodic GC sweeps streams
// that haven't been touched in DBCONSOLE_STREAM_IDLE_TIMEOUT_MS (default 5min).
// On GC eviction the cursor is closed, the transaction rolled back, and the
// client released.
//
// Safety: the same `isReadOnlySql` guard the bounded path uses applies here
// too — write SQL never reaches DECLARE.

import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

import { getConnectionById } from '@/lib/connections'
import { logQueryRun, type LogQueryRunInput } from '@/lib/meta-db'
import { getPoolForConnection } from '@/lib/pg-pool'
import { isReadOnlySql, normalizeSql } from '@/lib/sql/safety'
import { QueryError, toQueryError } from '@/lib/core/errors'
import { prepareQuery, type PreparedQuery } from '@/lib/query-prep'
import type { NamedQueryInput, RawQueryInput } from '@/lib/query-engine'

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_GC_INTERVAL_MS = 30 * 1000 // 30 seconds
const DEFAULT_BATCH_SIZE = 1000
const MAX_BATCH_SIZE = 10_000

function readEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) return fallback
    return n
}

function idleTimeoutMs(): number {
    return readEnvNumber('DBCONSOLE_STREAM_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
}

type StreamState = {
    id: string
    cursorName: string
    client: PoolClient
    columns: string[]
    columnTypes: number[]
    connectionId: string
    namedQueryId?: string
    kind: LogQueryRunInput['kind']
    sql: string
    rowsSent: number
    createdAt: number
    lastTouchedAt: number
    closing: boolean
}

declare global {
    var __dbconsoleStreams: Map<string, StreamState> | undefined
    var __dbconsoleStreamGc: NodeJS.Timeout | undefined
}

const streams: Map<string, StreamState> = globalThis.__dbconsoleStreams ?? new Map()
if (!globalThis.__dbconsoleStreams) globalThis.__dbconsoleStreams = streams

function ensureGcRunning(): void {
    if (globalThis.__dbconsoleStreamGc) return
    const handle = setInterval(() => {
        const now = Date.now()
        const cutoff = now - idleTimeoutMs()
        for (const [id, state] of streams) {
            if (state.lastTouchedAt < cutoff && !state.closing) {
                // Fire-and-forget eviction; closeStream handles its own errors.
                void closeStream(id, { reason: 'idle-timeout' }).catch(() => undefined)
            }
        }
    }, DEFAULT_GC_INTERVAL_MS)
    if (typeof handle.unref === 'function') handle.unref()
    globalThis.__dbconsoleStreamGc = handle
}

function makeCursorName(id: string): string {
    // Cursor identifiers must be valid SQL idents. Use a deterministic prefix
    // and the hex portion of the UUID (no dashes) so the name fits the
    // identifier rules.
    return `_dbc_${id.replace(/-/g, '')}`
}

function rowsAsObjects(rows: unknown[][], columns: string[]): Record<string, unknown>[] {
    return rows.map((row) => {
        const obj: Record<string, unknown> = {}
        for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i]
        return obj
    })
}

function clampBatchSize(requested: number | undefined): number {
    if (!Number.isFinite(requested) || requested === undefined) return DEFAULT_BATCH_SIZE
    const n = Math.floor(requested)
    if (n <= 0) return DEFAULT_BATCH_SIZE
    if (n > MAX_BATCH_SIZE) return MAX_BATCH_SIZE
    return n
}

export type StreamOpenResult = {
    streamId: string
    columns: string[]
    columnTypes: number[]
    rows: Record<string, unknown>[]
    rowsSent: number
    hasMore: boolean
    batchSize: number
}

export type StreamNextResult = {
    streamId: string
    rows: Record<string, unknown>[]
    rowsSent: number
    hasMore: boolean
}

export type StreamCloseResult = {
    streamId: string
    rowsSent: number
}

export async function openStream(
    input: RawQueryInput | NamedQueryInput,
    opts: { batchSize?: number } = {},
): Promise<StreamOpenResult> {
    ensureGcRunning()
    const start = Date.now()

    let prep: PreparedQuery
    try {
        prep = prepareQuery(input)
    } catch (err) {
        throw toQueryError(err)
    }

    const trimmed = prep.sql.trim()
    if (!isReadOnlySql(trimmed)) {
        throw new QueryError({
            error: 'Only read-only SELECT / WITH queries are allowed',
            classification: 'safety',
        })
    }

    const conn = getConnectionById(prep.connectionId)
    if (!conn) {
        throw new QueryError({ error: 'Connection not found', classification: 'not_found' })
    }

    // Streams use the existing pool but check out a dedicated client and
    // disable statement_timeout / idle_in_transaction_session_timeout for the
    // duration of the transaction. We don't need a separate pool mode because
    // the client is held checked-out for the entire stream's lifetime, so the
    // pool's idle eviction can't reach it.
    const pool = getPoolForConnection(conn, { mode: prep.poolMode ?? 'shared', scopeKey: prep.scopeKey })

    const id = randomUUID()
    const cursorName = makeCursorName(id)
    const normalized = normalizeSql(trimmed)
    const batchSize = clampBatchSize(opts.batchSize)

    let client: PoolClient | undefined
    try {
        client = await pool.connect()
        await client.query('BEGIN')
        await client.query('SET LOCAL statement_timeout = 0')
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 0')

        // DECLARE expects the SQL inline; values are bound by the FETCH path
        // via a separate prepare. The cleanest way to bind parameters to a
        // cursor is via `DECLARE … CURSOR FOR <text>` with values supplied to
        // pool.query. The pg driver handles the binding for us.
        await client.query({
            text: `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${normalized}`,
            values: prep.values,
        })

        const fetched = await client.query({
            text: `FETCH FORWARD ${batchSize} FROM ${cursorName}`,
            rowMode: 'array',
        })

        const fields = fetched.fields ?? []
        const columns = fields.map((f) => f.name || 'column')
        const columnTypes = fields.map((f) => f.dataTypeID)
        const rows = rowsAsObjects((fetched.rows ?? []) as unknown[][], columns)
        const hasMore = rows.length === batchSize

        const state: StreamState = {
            id,
            cursorName,
            client,
            columns,
            columnTypes,
            connectionId: prep.connectionId,
            namedQueryId: prep.namedQueryId,
            kind: prep.kind,
            sql: normalized,
            rowsSent: rows.length,
            createdAt: start,
            lastTouchedAt: Date.now(),
            closing: false,
        }
        streams.set(id, state)

        // Best-effort log of the stream open as a query run; the recorded row
        // count keeps growing as fetchNext appends, so we only log here for the
        // initial batch and rely on closeStream to update the final count via
        // a separate log entry.
        try {
            logQueryRun({
                kind: prep.kind,
                namedQueryId: prep.namedQueryId,
                connectionId: prep.connectionId,
                sql: normalized,
                rowsReturned: rows.length,
                durationMs: Date.now() - start,
                status: 'ok',
            })
        } catch (e) {
            console.error('Failed to log stream open', e)
        }

        return { streamId: id, columns, columnTypes, rows, rowsSent: rows.length, hasMore, batchSize }
    } catch (err) {
        // Make sure we don't leak the checked-out client.
        if (client) {
            try {
                await client.query('ROLLBACK')
            } catch {
                // ignore
            }
            try {
                client.release(true)
            } catch {
                // ignore
            }
        }
        throw toQueryError(err)
    }
}

export async function fetchNext(
    streamId: string,
    opts: { batchSize?: number } = {},
): Promise<StreamNextResult> {
    const state = streams.get(streamId)
    if (!state) {
        throw new QueryError({ error: 'Stream not found or already closed', classification: 'not_found' })
    }
    if (state.closing) {
        throw new QueryError({ error: 'Stream is closing', classification: 'not_found' })
    }

    const batchSize = clampBatchSize(opts.batchSize)
    state.lastTouchedAt = Date.now()

    try {
        const fetched = await state.client.query({
            text: `FETCH FORWARD ${batchSize} FROM ${state.cursorName}`,
            rowMode: 'array',
        })
        const rows = rowsAsObjects((fetched.rows ?? []) as unknown[][], state.columns)
        state.rowsSent += rows.length
        const hasMore = rows.length === batchSize
        return { streamId, rows, rowsSent: state.rowsSent, hasMore }
    } catch (err) {
        // On any FETCH error the cursor is effectively dead — tear down the
        // stream so the user has to re-open.
        await closeStream(streamId, { reason: 'fetch-error' }).catch(() => undefined)
        throw toQueryError(err)
    }
}

export async function closeStream(
    streamId: string,
    opts: { reason?: 'user' | 'idle-timeout' | 'fetch-error' } = {},
): Promise<StreamCloseResult> {
    const state = streams.get(streamId)
    if (!state) {
        return { streamId, rowsSent: 0 }
    }
    if (state.closing) {
        return { streamId, rowsSent: state.rowsSent }
    }
    state.closing = true

    try {
        try {
            await state.client.query(`CLOSE ${state.cursorName}`)
        } catch {
            // The cursor may already be invalid (e.g. server-side error). Ignore.
        }
        try {
            await state.client.query('ROLLBACK')
        } catch {
            // Ignore — the transaction may have aborted itself.
        }
    } finally {
        try {
            // `release(true)` discards the client back to the pool with the
            // hint that it should be torn down rather than reused. Safer for
            // streams that may have left the connection in an odd state.
            state.client.release(opts.reason === 'idle-timeout' || opts.reason === 'fetch-error')
        } catch {
            // ignore
        }
        streams.delete(streamId)
    }

    return { streamId, rowsSent: state.rowsSent }
}

/** @internal — exposed for tests / shutdown hooks. */
export function getStreamCountForTests(): number {
    return streams.size
}

/** @internal — exposed for tests. */
export function __resetStreamRegistryForTests(): void {
    streams.clear()
    if (globalThis.__dbconsoleStreamGc) {
        clearInterval(globalThis.__dbconsoleStreamGc)
        globalThis.__dbconsoleStreamGc = undefined
    }
}
