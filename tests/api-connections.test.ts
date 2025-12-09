import { describe, it, expect, beforeEach } from 'vitest'
import { GET as connectionsGET, POST as connectionsPOST } from '@/app/api/connections/route'
import { PUT as connectionPUT, DELETE as connectionDELETE } from '@/app/api/connections/[id]/route'
import { POST as testConnectionPOST } from '@/app/api/connections/test/route'
import { getMetaDb } from '@/lib/meta-db'
import { invalidateConnectionsCache } from '@/lib/connections'

const hasTestPg = !!process.env.DBCONSOLE_TEST_PG_URL
const itMaybe = hasTestPg ? it : it.skip

function resetMetaDb() {
    const db = getMetaDb()
    db.exec('DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs;')
    invalidateConnectionsCache()
}

function makeJsonRequest(url: string, method: string, body: unknown) {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

describe('API /api/connections', () => {
    beforeEach(() => {
        resetMetaDb()
    })

    it('POST creates a new UI connection and GET lists it', async () => {
        const createReq = makeJsonRequest('http://localhost/api/connections', 'POST', {
            label: 'Test Conn',
            host: 'localhost',
            port: 5432,
            database: 'postgres',
            username: 'postgres',
            password: 'secret',
            readOnly: true,
        })

        const createRes = await connectionsPOST(createReq)
        expect(createRes.status).toBe(201)
        const created = (await createRes.json()) as {
            id: string
            label: string
            host?: string
            port?: number
            database?: string
            username?: string
            readOnly: boolean
        }

        expect(created.id).toBeTruthy()
        expect(created.label).toBe('Test Conn')
        expect(created.host).toBe('localhost')
        expect(created.port).toBe(5432)
        expect(created.database).toBe('postgres')
        expect(created.username).toBe('postgres')
        expect(created.readOnly).toBe(true)

        const listRes = await connectionsGET()
        expect(listRes.status).toBe(200)
        const list = (await listRes.json()) as Array<{ id: string; label: string }>
        const found = list.find((c) => c.id === created.id)
        expect(found).toBeTruthy()
        expect(found?.label).toBe('Test Conn')
    })

    it('POST with invalid payload returns 400', async () => {
        const badReq = makeJsonRequest('http://localhost/api/connections', 'POST', {
            // missing required fields like host, database, username, password
            label: '',
        })

        const res = await connectionsPOST(badReq)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toBe('Invalid connection payload')
    })

    it('PUT updates an existing UI connection', async () => {
        // First create a connection via POST
        const createReq = makeJsonRequest('http://localhost/api/connections', 'POST', {
            label: 'Original',
            host: 'localhost',
            port: 5432,
            database: 'postgres',
            username: 'postgres',
            password: 'secret',
            readOnly: true,
        })

        const createRes = await connectionsPOST(createReq)
        const created = (await createRes.json()) as { id: string }

        const updateReq = makeJsonRequest(`http://localhost/api/connections/${created.id}`, 'PUT', {
            label: 'Updated Label',
        })

        const updateRes = await connectionPUT(updateReq, { params: { id: created.id } })
        expect(updateRes.status).toBe(200)
        const updated = (await updateRes.json()) as { id: string; label: string }
        expect(updated.id).toBe(created.id)
        expect(updated.label).toBe('Updated Label')
    })

    it('DELETE removes an existing UI connection', async () => {
        const createReq = makeJsonRequest('http://localhost/api/connections', 'POST', {
            label: 'To Delete',
            host: 'localhost',
            port: 5432,
            database: 'postgres',
            username: 'postgres',
            password: 'secret',
            readOnly: true,
        })

        const createRes = await connectionsPOST(createReq)
        const created = (await createRes.json()) as { id: string }

        const deleteReq = new Request(`http://localhost/api/connections/${created.id}`, {
            method: 'DELETE',
        })

        const deleteRes = await connectionDELETE(deleteReq, { params: { id: created.id } })
        expect(deleteRes.status).toBe(200)
        const body = (await deleteRes.json()) as { success?: boolean }
        expect(body.success).toBe(true)

        const listRes = await connectionsGET()
        const list = (await listRes.json()) as Array<{ id: string }>
        expect(list.find((c) => c.id === created.id)).toBeUndefined()
    })

    itMaybe('POST /api/connections/test verifies real Postgres connectivity', async () => {
        const url = process.env.DBCONSOLE_TEST_PG_URL!
        const u = new URL(url)

        const req = makeJsonRequest('http://localhost/api/connections/test', 'POST', {
            label: 'Test PG',
            host: u.hostname,
            port: u.port ? Number(u.port) : 5432,
            database: u.pathname.replace(/^\//, ''),
            username: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password),
            readOnly: true,
        })

        const res = await testConnectionPOST(req)
        const body = (await res.json()) as { ok?: boolean; error?: string }
        expect(body.ok).toBe(true)
    })
})
