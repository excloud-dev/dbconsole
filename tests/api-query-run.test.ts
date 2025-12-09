import { describe, it, expect } from 'vitest'
import { POST as queryRunPOST } from '@/app/api/query/run/route'

const hasTestPg = !!process.env.DBCONSOLE_TEST_PG_URL
const itMaybe = hasTestPg ? it : it.skip

function makeJsonRequest(url: string, method: string, body: unknown) {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

describe('API /api/query/run', () => {
    it('returns 400 for an invalid payload', async () => {
        const badReq = makeJsonRequest('http://localhost/api/query/run', 'POST', {
            // missing required fields like kind/sql
        })

        const res = await queryRunPOST(badReq)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toBe('Invalid query payload')
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
