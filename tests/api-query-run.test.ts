import { describe, it, expect, beforeEach } from 'vitest'
import { POST as queryRunPOST } from '@/app/api/query/run/route'
import { getMetaDb, insertUiConnection } from '@/lib/meta-db'
import { invalidateConnectionsCache } from '@/lib/connections'

const hasTestPg = !!process.env.DBCONSOLE_TEST_PG_URL
const itMaybe = hasTestPg ? it : it.skip

const READONLY_CONN_ID = 'test-readonly-conn'
const WRITABLE_CONN_ID = 'test-writable-conn'

function makeJsonRequest(url: string, method: string, body: unknown) {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

function resetMetaDb() {
    const db = getMetaDb()
    db.exec(
        'DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs; DELETE FROM dbconsole_query_tombstones; DELETE FROM dbconsole_settings; DELETE FROM dbconsole_sync_named_queries;',
    )
    invalidateConnectionsCache()
}

function seedConnection(id: string, readOnly: boolean) {
    insertUiConnection({
        id,
        label: readOnly ? 'Readonly Test' : 'Writable Test',
        // Nonexistent host — intentional: the safety gate must fire (or not fire)
        // before we ever try to actually connect to Postgres.
        host: '127.0.0.1',
        port: 1,
        database: 'nodb',
        username: 'nouser',
        password: 'nopass',
        readOnly,
    })
    invalidateConnectionsCache()
}

describe('API /api/query/run', () => {
    beforeEach(() => {
        resetMetaDb()
        seedConnection(READONLY_CONN_ID, true)
        seedConnection(WRITABLE_CONN_ID, false)
    })

    it('returns 400 for an invalid payload', async () => {
        const badReq = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            // missing required fields like kind/sql
        })

        const res = await queryRunPOST(badReq)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toBe('Invalid query payload')
    })

    it('returns a classified safety error for write SQL on a readonly connection', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'DELETE FROM users',
            connectionId: READONLY_CONN_ID,
        })
        const res = await queryRunPOST(req)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string; classification: string }
        expect(body.classification).toBe('safety')
        expect(body.error).toMatch(/read-only/i)
    })

    it('returns a classified safety error for CTE-wrapped DML on a readonly connection', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone',
            connectionId: READONLY_CONN_ID,
        })
        const res = await queryRunPOST(req)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('safety')
    })

    it('returns a classified safety error for SELECT INTO newtable on a readonly connection', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'SELECT * INTO new_users FROM users',
            connectionId: READONLY_CONN_ID,
        })
        const res = await queryRunPOST(req)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('safety')
    })

    it('returns a classified safety error for comment-hidden DML on a readonly connection', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'SELECT 1 -- harmless\n; DELETE FROM users',
            connectionId: READONLY_CONN_ID,
        })
        const res = await queryRunPOST(req)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('safety')
    })

    it('does NOT raise a safety error for write SQL when the connection allows writes', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'DELETE FROM users',
            connectionId: WRITABLE_CONN_ID,
        })
        const res = await queryRunPOST(req)
        const body = (await res.json()) as { classification?: string }
        // The safety gate must not reject — the query falls through to pool
        // execution instead, which will fail with a connection/execution error
        // against the fake host. The important assertion is the absence of
        // `safety` classification.
        expect(body.classification).not.toBe('safety')
    })

    it('returns a classified not_found when the connection id is unknown', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'SELECT 1',
            connectionId: 'definitely-not-a-real-connection-id-xyz',
        })
        const res = await queryRunPOST(req)
        expect(res.status).toBe(404)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('not_found')
    })

    itMaybe('executes a simple raw SELECT against the test Postgres connection', async () => {
        const req = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            kind: 'raw',
            sql: 'SELECT 1 AS x',
            connectionId: 'test-pg',
        })

        const res = await queryRunPOST(req)
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
            columns: string[]
            rows: Array<Record<string, unknown>>
            rowCount: number
            durationMs: number
        }

        expect(Array.isArray(body.columns)).toBe(true)
        expect(Array.isArray(body.rows)).toBe(true)
        expect(body.rowCount).toBeGreaterThan(0)
        expect(body.rows[0]?.x ?? body.rows[0]?.X).toBe(1)
    })
})
