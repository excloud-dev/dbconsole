import { describe, it, expect, beforeEach } from 'vitest'
import { getMetaDb, insertUiConnection, listUiConnections, upsertNamedQuery, listNamedQueries, type QueryParamDef } from '@/lib/meta-db'

describe('meta-db SQLite helpers', () => {
    beforeEach(() => {
        const db = getMetaDb()
        db.exec(
            'DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs; DELETE FROM dbconsole_query_tombstones; DELETE FROM dbconsole_settings; DELETE FROM dbconsole_sync_named_queries;',
        )
    })

    it('inserts and lists UI connections', () => {
        const created = insertUiConnection({
            id: 'test-conn-1',
            label: 'Test Connection',
            host: 'localhost',
            port: 5432,
            database: 'postgres',
            username: 'postgres',
            password: 'secret',
            readOnly: true,
        })

        expect(created.id).toBe('test-conn-1')
        expect(created.label).toBe('Test Connection')
        expect(created.host).toBe('localhost')
        expect(created.port).toBe(5432)
        expect(created.database).toBe('postgres')
        expect(created.username).toBe('postgres')
        expect(created.readOnly).toBe(true)

        const rows = listUiConnections()
        expect(rows).toHaveLength(1)
        const row = rows[0]
        expect(row.id).toBe('test-conn-1')
        expect(row.label).toBe('Test Connection')
        expect(row.host).toBe('localhost')
        expect(row.port).toBe(5432)
    })

    it('saves and retrieves named queries with params', () => {
        const params: QueryParamDef[] = [
            { name: 'userId', type: 'number', defaultValue: '1' },
            { name: 'active', type: 'boolean', defaultValue: 'true' },
        ]

        const saved = upsertNamedQuery({
            name: 'Test Query',
            description: 'A simple test query',
            sqlTemplate: 'SELECT * FROM users WHERE id = :userId AND active = :active',
            params,
            defaultConnectionId: 'test-conn-1',
        })

        expect(saved.id).toBeTruthy()
        expect(saved.name).toBe('Test Query')
        expect(saved.sqlTemplate).toContain('SELECT * FROM users')

        const all = listNamedQueries()
        expect(all).toHaveLength(1)
        const row = all[0]
        expect(row.name).toBe('Test Query')
        const parsedParams = JSON.parse(row.paramsJson) as QueryParamDef[]
        expect(parsedParams).toHaveLength(2)
        expect(parsedParams[0].name).toBe('userId')
    })
})
