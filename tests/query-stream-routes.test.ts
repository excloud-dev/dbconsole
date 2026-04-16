import { beforeEach, describe, it, expect } from 'vitest'
import { POST as openPOST } from '@/app/api/query/stream/open/route'
import { POST as nextPOST } from '@/app/api/query/stream/next/route'
import { POST as closePOST } from '@/app/api/query/stream/close/route'
import { getMetaDb, insertUiConnection } from '@/lib/meta-db'
import { invalidateConnectionsCache } from '@/lib/connections'

const READONLY_CONN_ID = 'stream-readonly-conn'
const WRITABLE_CONN_ID = 'stream-writable-conn'

function makeJsonRequest(url: string, body: unknown) {
    return new Request(url, {
        method: 'POST',
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
        label: readOnly ? 'Readonly Stream' : 'Writable Stream',
        host: '127.0.0.1',
        port: 1,
        database: 'nodb',
        username: 'nouser',
        password: 'nopass',
        readOnly,
    })
    invalidateConnectionsCache()
}

describe('API /api/query/stream/open', () => {
    beforeEach(() => {
        resetMetaDb()
        seedConnection(READONLY_CONN_ID, true)
        seedConnection(WRITABLE_CONN_ID, false)
    })

    it('400s on missing query payload', async () => {
        const res = await openPOST(makeJsonRequest('http://localhost/api/query/stream/open', {}))
        expect(res.status).toBe(400)
    })

    it('rejects write SQL with classification=safety on a readonly connection', async () => {
        const res = await openPOST(
            makeJsonRequest('http://localhost/api/query/stream/open', {
                query: { kind: 'raw', sql: 'DELETE FROM users', connectionId: READONLY_CONN_ID },
            }),
        )
        expect(res.status).toBe(400)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('safety')
    })

    it('does NOT raise a safety error for write SQL when the connection allows writes', async () => {
        const res = await openPOST(
            makeJsonRequest('http://localhost/api/query/stream/open', {
                query: { kind: 'raw', sql: 'DELETE FROM users', connectionId: WRITABLE_CONN_ID },
            }),
        )
        const body = (await res.json()) as { classification?: string }
        expect(body.classification).not.toBe('safety')
    })

    it('rejects unknown connection with not_found', async () => {
        const res = await openPOST(
            makeJsonRequest('http://localhost/api/query/stream/open', {
                query: { kind: 'raw', sql: 'SELECT 1', connectionId: 'nope-xyz' },
            }),
        )
        expect(res.status).toBe(404)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('not_found')
    })
})

describe('API /api/query/stream/next', () => {
    it('400s on missing streamId', async () => {
        const res = await nextPOST(makeJsonRequest('http://localhost/api/query/stream/next', {}))
        expect(res.status).toBe(400)
    })

    it('404s on unknown streamId', async () => {
        const res = await nextPOST(
            makeJsonRequest('http://localhost/api/query/stream/next', { streamId: 'no-such-stream' }),
        )
        expect(res.status).toBe(404)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('not_found')
    })
})

describe('API /api/query/stream/close', () => {
    it('400s on missing streamId', async () => {
        const res = await closePOST(makeJsonRequest('http://localhost/api/query/stream/close', {}))
        expect(res.status).toBe(400)
    })

    it('treats closing an unknown stream as a no-op (200)', async () => {
        const res = await closePOST(
            makeJsonRequest('http://localhost/api/query/stream/close', { streamId: 'no-such-stream' }),
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { streamId: string; rowsSent: number }
        expect(body.streamId).toBe('no-such-stream')
        expect(body.rowsSent).toBe(0)
    })
})
