import { describe, it, expect, beforeEach } from 'vitest'
import { GET as listNamedQueriesGET, POST as namedQueriesPOST } from '@/app/api/named-queries/route'
import {
    GET as namedQueryGET,
    PUT as namedQueryPUT,
    DELETE as namedQueryDELETE,
} from '@/app/api/named-queries/[id]/route'
import { getMetaDb } from '@/lib/meta-db'

function resetMetaDb() {
    const db = getMetaDb()
    db.exec('DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs;')
}

function makeJsonRequest(url: string, method: string, body: unknown) {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

describe('API /api/named-queries', () => {
    beforeEach(() => {
        resetMetaDb()
    })

    it('GET returns an empty list when no queries exist', async () => {
        const res = await listNamedQueriesGET()
        expect(res.status).toBe(200)
        const list = (await res.json()) as unknown[]
        expect(Array.isArray(list)).toBe(true)
        expect(list.length).toBe(0)
    })

    it('POST creates, GET reads, PUT updates, and DELETE removes a named query', async () => {
        const createReq = makeJsonRequest('http://localhost/api/named-queries', 'POST', {
            name: 'Users by status',
            description: 'List users filtered by active flag',
            sqlTemplate: 'SELECT * FROM users WHERE active = :active',
            params: [{ name: 'active', type: 'boolean', defaultValue: 'true' }],
        })

        const createRes = await namedQueriesPOST(createReq)
        expect(createRes.status).toBe(200)
        const created = (await createRes.json()) as {
            id: string
            name: string
            description?: string
            sqlTemplate: string
            params: Array<{ name: string; type: string; defaultValue?: string }>
        }

        expect(created.id).toBeTruthy()
        expect(created.name).toBe('Users by status')
        expect(created.params).toHaveLength(1)

        // GET by id
        const getRes = await namedQueryGET(new Request(`http://localhost/api/named-queries/${created.id}`), {
            params: { id: created.id },
        })
        expect(getRes.status).toBe(200)
        const fetched = (await getRes.json()) as typeof created
        expect(fetched.id).toBe(created.id)
        expect(fetched.sqlTemplate).toContain('FROM users')

        // PUT update
        const updateReq = makeJsonRequest(`http://localhost/api/named-queries/${created.id}`, 'PUT', {
            description: 'Updated description',
        })
        const updateRes = await namedQueryPUT(updateReq, { params: { id: created.id } })
        expect(updateRes.status).toBe(200)
        const updated = (await updateRes.json()) as typeof created
        expect(updated.description).toBe('Updated description')

        // DELETE
        const deleteRes = await namedQueryDELETE(
            new Request(`http://localhost/api/named-queries/${created.id}`, { method: 'DELETE' }),
            { params: { id: created.id } },
        )
        expect(deleteRes.status).toBe(200)
        const deleteBody = (await deleteRes.json()) as { success?: boolean }
        expect(deleteBody.success).toBe(true)

        // Subsequent GET should 404
        const getAfterDelete = await namedQueryGET(
            new Request(`http://localhost/api/named-queries/${created.id}`),
            { params: { id: created.id } },
        )
        expect(getAfterDelete.status).toBe(404)
    })

    it('POST with invalid payload returns 400', async () => {
        const badReq = makeJsonRequest('http://localhost/api/named-queries', 'POST', {
            // missing name and sqlTemplate
            description: 'no name or sql',
            params: [],
        })

        const res = await namedQueriesPOST(badReq)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toBe('Invalid named query payload')
    })
})
