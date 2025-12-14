import { describe, it, expect, beforeEach } from 'vitest'
import { POST as pullPOST } from '@/app/api/sync/named-queries/pull/route'
import { POST as pushPOST, GET as versionGET } from '@/app/api/sync/named-queries/push/route'
import { deriveSyncChainKeys } from '@/lib/secrets/sync-phrase'
import { getMetaDb } from '@/lib/meta-db'

function resetMetaDb() {
    const db = getMetaDb()
    db.exec('DELETE FROM dbconsole_sync_named_queries;')
}

function makeReq(url: string, method: string, token?: string, body?: unknown): Request {
    const headers: Record<string, string> = {}
    if (token) headers['x-dbconsole-sync-token'] = token
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    return new Request(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    })
}

describe('API /api/sync/named-queries', () => {
    beforeEach(() => {
        resetMetaDb()
    })

    it('pull returns empty snapshot when chain does not exist', async () => {
        const { authToken } = deriveSyncChainKeys('test phrase')
        const res = await pullPOST(makeReq('http://localhost/api/sync/named-queries/pull', 'POST', authToken))
        expect(res.status).toBe(200)
        const body = (await res.json()) as { version: number; ciphertextB64: string | null }
        expect(body.version).toBe(0)
        expect(body.ciphertextB64).toBe(null)
    })

    it('push creates chain at baseVersion=0 and pull returns ciphertext', async () => {
        const { authToken } = deriveSyncChainKeys('test phrase')

        const push1 = await pushPOST(
            makeReq('http://localhost/api/sync/named-queries/push', 'POST', authToken, {
                baseVersion: 0,
                ciphertextB64: 'ciphertext-1',
            }),
        )
        expect(push1.status).toBe(200)
        const pushBody1 = (await push1.json()) as { version: number }
        expect(pushBody1.version).toBe(1)

        const pull = await pullPOST(makeReq('http://localhost/api/sync/named-queries/pull', 'POST', authToken))
        expect(pull.status).toBe(200)
        const pullBody = (await pull.json()) as { version: number; ciphertextB64: string | null }
        expect(pullBody.version).toBe(1)
        expect(pullBody.ciphertextB64).toBe('ciphertext-1')
    })

    it('push returns 409 on version mismatch and includes current ciphertext', async () => {
        const { authToken } = deriveSyncChainKeys('test phrase')

        await pushPOST(
            makeReq('http://localhost/api/sync/named-queries/push', 'POST', authToken, {
                baseVersion: 0,
                ciphertextB64: 'ciphertext-1',
            }),
        )

        const conflict = await pushPOST(
            makeReq('http://localhost/api/sync/named-queries/push', 'POST', authToken, {
                baseVersion: 0,
                ciphertextB64: 'ciphertext-2',
            }),
        )

        expect(conflict.status).toBe(409)
        const body = (await conflict.json()) as { currentVersion: number; ciphertextB64: string | null }
        expect(body.currentVersion).toBe(1)
        expect(body.ciphertextB64).toBe('ciphertext-1')
    })

    it('push updates chain when baseVersion matches', async () => {
        const { authToken } = deriveSyncChainKeys('test phrase')

        await pushPOST(
            makeReq('http://localhost/api/sync/named-queries/push', 'POST', authToken, {
                baseVersion: 0,
                ciphertextB64: 'ciphertext-1',
            }),
        )

        const push2 = await pushPOST(
            makeReq('http://localhost/api/sync/named-queries/push', 'POST', authToken, {
                baseVersion: 1,
                ciphertextB64: 'ciphertext-2',
            }),
        )

        expect(push2.status).toBe(200)
        const body = (await push2.json()) as { version: number }
        expect(body.version).toBe(2)

        const v = await versionGET(makeReq('http://localhost/api/sync/named-queries/push', 'GET', authToken))
        expect(v.status).toBe(200)
        const vBody = (await v.json()) as { version: number }
        expect(vBody.version).toBe(2)
    })

    it('missing token returns 401', async () => {
        const res = await pullPOST(makeReq('http://localhost/api/sync/named-queries/pull', 'POST'))
        expect(res.status).toBe(401)
    })
})
