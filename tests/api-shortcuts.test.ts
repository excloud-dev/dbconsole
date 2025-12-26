import { beforeEach, describe, expect, it } from 'vitest'
import { GET as shortcutsGET, POST as shortcutsPOST } from '@/app/api/shortcuts/route'
import { getMetaDb } from '@/lib/meta-db'
import { getShortcutsKeymap } from '@/lib/core/shortcuts-settings'

function resetMetaDb() {
    const db = getMetaDb()
    db.exec(
        'DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs; DELETE FROM dbconsole_query_tombstones; DELETE FROM dbconsole_settings; DELETE FROM dbconsole_sync_named_queries;',
    )
}

function makeJsonRequest(url: string, method: string, body: unknown) {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

describe('API /api/shortcuts', () => {
    beforeEach(() => {
        resetMetaDb()
    })

    it('GET returns version and overrides maps', async () => {
        const res = await shortcutsGET()
        expect(res.status).toBe(200)
        const body = (await res.json()) as any
        expect(body.version).toBe(1)
        expect(body.overrides).toBeTruthy()
        expect(typeof body.overrides.web).toBe('object')
        expect(typeof body.overrides.desktop).toBe('object')
    })

    it('POST can set a binding override', async () => {
        const setReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            runtime: 'web',
            commandId: 'query.run',
            binding: 'Ctrl+Enter',
        })
        const setRes = await shortcutsPOST(setReq)
        expect(setRes.status).toBe(200)

        const stored = getShortcutsKeymap('web')
        expect(stored['query.run']).toBe('Ctrl+Enter')
    })

    it('POST can disable and re-enable while preserving the binding', async () => {
        // First set a binding.
        const setReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            runtime: 'web',
            commandId: 'query.run',
            binding: 'Ctrl+Enter',
        })
        expect((await shortcutsPOST(setReq)).status).toBe(200)

        // Disable.
        const disableReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            runtime: 'web',
            commandId: 'query.run',
            disabled: true,
        })
        expect((await shortcutsPOST(disableReq)).status).toBe(200)

        const afterDisable = getShortcutsKeymap('web')
        expect(afterDisable['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: true })

        // Re-enable.
        const enableReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            runtime: 'web',
            commandId: 'query.run',
            disabled: false,
        })
        expect((await shortcutsPOST(enableReq)).status).toBe(200)

        const afterEnable = getShortcutsKeymap('web')
        expect(afterEnable['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: false })
    })

    it('POST can replace overrides for a runtime using object entries', async () => {
        const setReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            overrides: {
                web: {
                    'query.run': { binding: 'Ctrl+Enter', disabled: true },
                },
            },
        })

        const res = await shortcutsPOST(setReq)
        expect(res.status).toBe(200)

        const stored = getShortcutsKeymap('web')
        expect(stored['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: true })
    })

    it('POST returns 400 for invalid payload', async () => {
        const badReq = makeJsonRequest('http://localhost/api/shortcuts', 'POST', {
            runtime: 'web',
            commandId: 'query.run',
            binding: '',
        })
        const res = await shortcutsPOST(badReq)
        expect(res.status).toBe(400)
    })
})
