import { describe, it, expect } from 'vitest'
import { loadSchemaGraph } from '@/lib/schema-introspection'

const hasTestPg = !!process.env.DBCONSOLE_TEST_PG_URL

const itMaybe = hasTestPg ? it : it.skip

describe('schema-introspection', () => {
    itMaybe('loads a schema graph for the test Postgres connection', async () => {
        const graph = await loadSchemaGraph('test-pg')

        expect(graph).toBeTruthy()
        expect(Array.isArray(graph.tables)).toBe(true)
        expect(Array.isArray(graph.columns)).toBe(true)
        expect(Array.isArray(graph.foreignKeys)).toBe(true)
    })

    itMaybe('exposes the object browser extensions on the schema graph', async () => {
        const graph = await loadSchemaGraph('test-pg')

        // New aggregate fields added in Phase 2.2 — even on a fresh database they
        // should be arrays (possibly empty), never undefined.
        expect(Array.isArray(graph.relations)).toBe(true)
        expect(Array.isArray(graph.indexes)).toBe(true)
        expect(Array.isArray(graph.triggers)).toBe(true)
        expect(Array.isArray(graph.routines)).toBe(true)

        // Every base table from `tables` should appear in `relations` with kind=table.
        for (const t of graph.tables) {
            const match = graph.relations.find(
                (r) => r.schema === t.schema && r.name === t.name && r.kind === 'table',
            )
            expect(match).toBeTruthy()
        }
    })
})
