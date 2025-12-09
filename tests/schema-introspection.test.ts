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
})
