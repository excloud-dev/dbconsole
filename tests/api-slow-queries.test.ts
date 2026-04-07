import { describe, it, expect } from 'vitest'
import { GET as slowQueriesGET } from '@/app/api/diagnostics/slow-queries/route'

function makeGetRequest(url: string) {
    return new Request(url, { method: 'GET' })
}

describe('API /api/diagnostics/slow-queries', () => {
    it('400s when connectionId is missing', async () => {
        const res = await slowQueriesGET(makeGetRequest('http://localhost/api/diagnostics/slow-queries'))
        expect(res.status).toBe(400)
    })

    it('400s when sort is invalid', async () => {
        const res = await slowQueriesGET(
            makeGetRequest('http://localhost/api/diagnostics/slow-queries?connectionId=foo&sort=bogus'),
        )
        expect(res.status).toBe(400)
    })

    it('returns not_found when connection id is unknown', async () => {
        const res = await slowQueriesGET(
            makeGetRequest('http://localhost/api/diagnostics/slow-queries?connectionId=def-not-real-xyz'),
        )
        expect(res.status).toBe(404)
        const body = (await res.json()) as { classification: string }
        expect(body.classification).toBe('not_found')
    })
})
