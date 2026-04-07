import { describe, it, expect } from 'vitest'
import { schemaGraphToMermaidErDiagram, sanitizeIdent, sanitizeType } from '@/lib/schema-graph/mermaid'
import type { SchemaGraph } from '@/lib/schema-introspection'

function makeGraph(partial: Partial<SchemaGraph>): SchemaGraph {
    return {
        tables: [],
        relations: [],
        columns: [],
        foreignKeys: [],
        primaryKeys: [],
        indexes: [],
        triggers: [],
        routines: [],
        ...partial,
    }
}

describe('sanitizeIdent', () => {
    it('replaces dots with underscores', () => {
        expect(sanitizeIdent('public.users')).toBe('public_users')
    })
    it('strips special characters', () => {
        expect(sanitizeIdent('weird-name!')).toBe('weird_name_')
    })
    it('prefixes leading digits with t_', () => {
        expect(sanitizeIdent('1stTable')).toBe('t_1stTable')
    })
    it('returns "unnamed" for empty input', () => {
        expect(sanitizeIdent('')).toBe('unnamed')
    })
})

describe('sanitizeType', () => {
    it('strips spaces and parens', () => {
        expect(sanitizeType('character varying(255)')).toBe('character_varying_255_')
    })
    it('caps long types at 40 chars', () => {
        const long = 'x'.repeat(60)
        expect(sanitizeType(long).length).toBeLessThanOrEqual(40)
    })
})

describe('schemaGraphToMermaidErDiagram', () => {
    it('returns an EMPTY entity when there are no tables', () => {
        const out = schemaGraphToMermaidErDiagram(makeGraph({}))
        expect(out).toContain('erDiagram')
        expect(out).toContain('EMPTY {')
    })

    it('emits one entity per table with its columns', () => {
        const graph = makeGraph({
            tables: [
                { schema: 'public', name: 'users' },
                { schema: 'public', name: 'orders' },
            ],
            relations: [
                { schema: 'public', name: 'users', kind: 'table' },
                { schema: 'public', name: 'orders', kind: 'table' },
            ],
            columns: [
                { table: { schema: 'public', name: 'users' }, name: 'id', dataType: 'integer', isNullable: false },
                { table: { schema: 'public', name: 'users' }, name: 'email', dataType: 'text', isNullable: false },
                { table: { schema: 'public', name: 'orders' }, name: 'id', dataType: 'integer', isNullable: false },
                { table: { schema: 'public', name: 'orders' }, name: 'user_id', dataType: 'integer', isNullable: false },
            ],
            primaryKeys: [
                { table: { schema: 'public', name: 'users' }, columnName: 'id' },
                { table: { schema: 'public', name: 'orders' }, columnName: 'id' },
            ],
            foreignKeys: [
                {
                    from: { schema: 'public', name: 'orders' },
                    fromColumn: 'user_id',
                    to: { schema: 'public', name: 'users' },
                    toColumn: 'id',
                },
            ],
        })

        const out = schemaGraphToMermaidErDiagram(graph)
        expect(out).toContain('public_users {')
        expect(out).toContain('public_orders {')
        // PK marker on users.id
        expect(out).toMatch(/integer id "PK"/)
        // FK marker on orders.user_id
        expect(out).toMatch(/integer user_id "FK"/)
        // Relationship line
        expect(out).toContain('public_orders }o--|| public_users')
    })

    it('truncates tables wider than maxColumnsPerTable and adds a sentinel', () => {
        const cols = Array.from({ length: 20 }, (_, i) => ({
            table: { schema: 'public', name: 'wide' },
            name: `col_${i}`,
            dataType: 'text',
            isNullable: true,
        }))
        const graph = makeGraph({
            tables: [{ schema: 'public', name: 'wide' }],
            relations: [{ schema: 'public', name: 'wide', kind: 'table' }],
            columns: cols,
        })

        const out = schemaGraphToMermaidErDiagram(graph, { maxColumnsPerTable: 5 })
        expect(out).toContain('"+15 more"')
    })

    it('skips views and matviews unless includeViews is set', () => {
        const graph = makeGraph({
            tables: [{ schema: 'public', name: 't1' }],
            relations: [
                { schema: 'public', name: 't1', kind: 'table' },
                { schema: 'public', name: 'v1', kind: 'view' },
                { schema: 'public', name: 'mv1', kind: 'matview' },
            ],
        })

        const without = schemaGraphToMermaidErDiagram(graph)
        expect(without).toContain('public_t1')
        expect(without).not.toContain('public_v1')

        const withViews = schemaGraphToMermaidErDiagram(graph, { includeViews: true })
        expect(withViews).toContain('public_v1')
        expect(withViews).toContain('public_mv1')
    })
})
