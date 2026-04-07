// Convert a SchemaGraph into a Mermaid `erDiagram` source string.
//
// Mermaid is the v0.7 default renderer for the schema graph. The `erDiagram`
// type is well-suited to FK-based ER drawings: it auto-lays out boxes per
// table and renders relationship lines between them. Identifier sanitization
// is critical — Mermaid's parser is allergic to dots, dashes, and reserved
// words in identifiers.
//
// The renderer is intentionally swappable: we expose the SchemaGraph → string
// transform here, the React component renders that string. If we ever switch
// to React Flow + elkjs, only the component needs to change.

import type { SchemaGraph, TableRef } from '@/lib/schema-introspection'

/**
 * Sanitize a SQL identifier so it's safe to use as a Mermaid entity name. We
 * collapse dots into underscores, strip anything that isn't [A-Za-z0-9_], and
 * prefix with `t_` if the result starts with a digit (Mermaid identifiers
 * must start with a letter or underscore).
 */
export function sanitizeIdent(raw: string): string {
    let s = raw.replace(/\./g, '_').replace(/[^A-Za-z0-9_]/g, '_')
    if (!s) s = 'unnamed'
    if (/^[0-9]/.test(s)) s = `t_${s}`
    return s
}

/** Sanitize a column data type for Mermaid (no spaces, no parens). */
export function sanitizeType(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'unknown'
}

function tableId(t: TableRef): string {
    return sanitizeIdent(`${t.schema}.${t.name}`)
}

/**
 * Render the given SchemaGraph as a Mermaid `erDiagram` string.
 *
 * Options:
 * - `maxColumnsPerTable`: cap how many columns we draw per table to keep big
 *   tables from blowing up the layout. Defaults to 12; tables with more get
 *   a "(N more…)" sentinel row.
 * - `includeViews`: whether to include views/matviews in the diagram.
 *   Defaults to false because views muddy the FK story.
 */
export function schemaGraphToMermaidErDiagram(
    graph: SchemaGraph,
    opts: { maxColumnsPerTable?: number; includeViews?: boolean } = {},
): string {
    const maxCols = opts.maxColumnsPerTable ?? 12
    const includeViews = opts.includeViews ?? false

    const wantedTables: TableRef[] = includeViews
        ? graph.relations.map((r) => ({ schema: r.schema, name: r.name }))
        : graph.tables

    if (wantedTables.length === 0) {
        return 'erDiagram\n    EMPTY {\n        string note "No tables in this database"\n    }\n'
    }

    const lines: string[] = ['erDiagram']

    // Index columns by qualified table name for fast lookup.
    const colsByTable = new Map<string, typeof graph.columns>()
    for (const col of graph.columns) {
        const key = `${col.table.schema}.${col.table.name}`
        const list = colsByTable.get(key) ?? []
        list.push(col)
        colsByTable.set(key, list)
    }

    // PK lookup so we can mark PK columns inline.
    const pkSet = new Set<string>()
    for (const pk of graph.primaryKeys) {
        pkSet.add(`${pk.table.schema}.${pk.table.name}.${pk.columnName}`)
    }
    // FK lookup so we can mark FK columns inline.
    const fkSet = new Set<string>()
    for (const fk of graph.foreignKeys) {
        fkSet.add(`${fk.from.schema}.${fk.from.name}.${fk.fromColumn}`)
    }

    for (const t of wantedTables) {
        const id = tableId(t)
        const cols = colsByTable.get(`${t.schema}.${t.name}`) ?? []

        lines.push(`    ${id} {`)
        const shown = cols.slice(0, maxCols)
        for (const c of shown) {
            const colKey = `${t.schema}.${t.name}.${c.name}`
            const isPk = pkSet.has(colKey)
            const isFk = fkSet.has(colKey)
            const tags = [isPk && 'PK', isFk && 'FK'].filter(Boolean).join(',')
            const colName = sanitizeIdent(c.name)
            const type = sanitizeType(c.dataType)
            lines.push(`        ${type} ${colName}${tags ? ` "${tags}"` : ''}`)
        }
        if (cols.length > maxCols) {
            lines.push(`        string _more "+${cols.length - maxCols} more"`)
        }
        lines.push('    }')
    }

    // Relationships. We use `}o--||` (many-to-one) for FKs since each FK
    // points from a child row to a parent PK. Mermaid will dedupe a label.
    const seenEdges = new Set<string>()
    for (const fk of graph.foreignKeys) {
        const from = tableId(fk.from)
        const to = tableId(fk.to)
        const edgeKey = `${from}->${to}:${fk.fromColumn}->${fk.toColumn}`
        if (seenEdges.has(edgeKey)) continue
        seenEdges.add(edgeKey)
        const label = sanitizeIdent(`${fk.fromColumn}_${fk.toColumn}`)
        lines.push(`    ${from} }o--|| ${to} : "${label}"`)
    }

    return lines.join('\n') + '\n'
}
