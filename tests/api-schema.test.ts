import { describe, it, expect } from 'vitest'
import { GET as schemaGET } from '@/app/api/schema/route'

const hasTestPg = !!process.env.DBCONSOLE_TEST_PG_URL
const itMaybe = hasTestPg ? it : it.skip

describe('API /api/schema', () => {
    it('returns 400 when connectionId is missing', async () => {
        const req = new Request('http://localhost/api/schema')
        const res = await schemaGET(req)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toBe('connectionId is required')
    })

    itMaybe('returns a schema graph when connectionId is provided', async () => {
        const req = new Request('http://localhost/api/schema?connectionId=test-pg')
        const res = await schemaGET(req)
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
            tables: unknown[]
            columns: unknown[]
            foreignKeys: unknown[]
        }

        expect(Array.isArray(body.tables)).toBe(true)
        expect(Array.isArray(body.columns)).toBe(true)
        expect(Array.isArray(body.foreignKeys)).toBe(true)
    })
})
