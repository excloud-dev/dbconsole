import { getConnectionById } from '@/lib/connections'
import { logQueryRun, type LogQueryRunInput } from '@/lib/meta-db'
import { getPoolForConnection, type PoolMode } from '@/lib/pg-pool'
import { resolveTableNames } from '@/lib/pg-pool-cache'
import { isReadOnlySql, normalizeSql } from '@/lib/sql/safety'
import { QueryError, toQueryError } from '@/lib/core/errors'
import { prepareQuery } from '@/lib/query-prep'

// Hard cap on rows materialized into a single bounded query response. Beyond
// this users should switch to streaming. Configurable via DBCONSOLE_MAX_ROWS;
// defaults to 5000 to preserve historical behavior.
const DEFAULT_MAX_ROWS = 5000
function readMaxRows(): number {
    const raw = process.env.DBCONSOLE_MAX_ROWS
    if (!raw) return DEFAULT_MAX_ROWS
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ROWS
    return n
}

export type RawQueryInput = {
    kind: 'raw'
    sql: string
    originalSql?: string
    connectionId: string
    poolMode?: PoolMode
    scopeKey?: string
    params?: unknown[]
    limit?: number
    offset?: number
    includeCount?: boolean
}

export type NamedQueryInput = {
    kind: 'named'
    queryId: string
    params: Record<string, unknown>
    originalSql?: string
    connectionId?: string
    poolMode?: PoolMode
    scopeKey?: string
    limit?: number
    offset?: number
    includeCount?: boolean
}

export type QueryResult = {
    columns: string[]
    /**
     * Postgres type OIDs for each column, in the same order as `columns`.
     * Used by the data grid to pick rich renderers (jsonb tree, array chips,
     * range formatter, etc.) without re-querying pg_type. Populated from
     * result.fields[i].dataTypeID.
     */
    columnTypes: number[]
    rows: Record<string, unknown>[]
    rowCount: number
    durationMs: number
    totalCount?: number
    /** True when the result was clipped to fit `truncatedAt` rows. */
    truncated: boolean
    /** The cap that produced the truncation (i.e. the number of rows actually returned). */
    truncatedAt: number
    /** The user-supplied LIMIT, if any. Helps the UI explain *why* a result was capped. */
    requestedLimit?: number
}

export { applyNamedQueryParams } from '@/lib/sql/named-query-params'

export async function runQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult> {
    const start = Date.now()

    const prep = prepareQuery(input)
    const sql = prep.sql
    const userSql = prep.originalSqlHint
    const values = prep.values
    const connectionId = prep.connectionId
    const poolMode: PoolMode | undefined = prep.poolMode
    const scopeKey = prep.scopeKey
    const kind: LogQueryRunInput['kind'] = prep.kind
    const namedQueryId = prep.namedQueryId

    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new QueryError({
            error: 'Connection not found',
            classification: 'not_found',
        })
    }

    const trimmed = sql.trim()
    if (conn.readOnly && !isReadOnlySql(trimmed)) {
        throw new QueryError({
            error: 'Only read-only SELECT / WITH queries are allowed on this connection',
            classification: 'safety',
        })
    }

    const pool = getPoolForConnection(conn, { mode: poolMode, scopeKey })

    const normalized = normalizeSql(trimmed)
    const sourceSql = userSql ?? normalized
    const executableSql = applyLimitOffset(normalized, input.limit, input.offset)

    let rows: any[] = []
    let totalCount: number | undefined
    let columns: string[] = []
    let columnTypes: number[] = []
    let status: LogQueryRunInput['status'] = 'ok'
    let errorMessage: string | undefined

    try {
        if (input.includeCount) {
            const countRes = await pool.query({
                text: `SELECT COUNT(*) as count FROM (\n${normalized}\n) as q`,
                values,
            })
            totalCount = Number(countRes.rows?.[0]?.count ?? 0)
        }

        const result = await pool.query({ text: executableSql, values, rowMode: 'array' })
        const fields = result.fields ?? []

        // Capture pg type OIDs in column order so the renderer can pick rich
        // formatters (jsonb tree, array chips, …) without re-querying pg_type.
        columnTypes = fields.map((f) => f.dataTypeID ?? 0)

        // Quick path: no duplicate column names
        const baseNames = fields.map((f) => f.name || 'column')
        const hasDupes = new Set(baseNames).size !== baseNames.length

        if (!hasDupes) {
            columns = baseNames
            rows = (result.rows ?? []).map((rowAny: any) => {
                const obj: Record<string, unknown> = {}
                const isArray = Array.isArray(rowAny)
                for (let i = 0; i < columns.length; i++) {
                    obj[columns[i]] = isArray ? rowAny[i] : rowAny[fields[i].name]
                }
                return obj
            })
        } else {
            // Disambiguate duplicates by qualifying with table alias (preferred)
            // or schema.table; fall back to suffix. The OID → name lookup goes
            // through a per-pool LRU so repeated dup-column queries don't hit
            // pg_class on every run (see lib/pg-pool-cache.ts).
            const tableOids = Array.from(new Set(fields.map((f) => f.tableID).filter((oid): oid is number => !!oid && oid > 0)))
            const tableNameByOid: Record<number, string> = {}
            if (tableOids.length > 0) {
                const resolved = await resolveTableNames(pool, tableOids)
                for (const [oid, entry] of resolved) {
                    tableNameByOid[oid] = entry.qualified
                }
            }

            const aliasMap = parseAliases(sourceSql) // map table name -> alias used in query
            const selectMeta = extractSelectMeta(sourceSql)

            // Build map of bases that truly collide
            const baseCounts = baseNames.reduce((acc, b) => acc.set(b, (acc.get(b) ?? 0) + 1), new Map<string, number>())
            const dupBases = new Set(Array.from(baseCounts.entries()).filter(([, c]) => c > 1).map(([b]) => b))

            const dedupedColumns: string[] = []
            const used = new Map<string, number>()

            fields.forEach((f, idx) => {
                const base = f.name || 'column' // preserves user AS aliases
                const mustQualify = dupBases.has(base)

                let qualifier: string | null = null

                // 1) Prefer accurate tableID -> alias/table name when available
                if (mustQualify && f.tableID && tableNameByOid[f.tableID]) {
                    const full = tableNameByOid[f.tableID]
                    const baseTable = full.split('.').pop() || full
                    const lowerFull = full.toLowerCase()
                    const lowerBase = baseTable.toLowerCase()
                    qualifier = aliasMap.get(lowerFull) ?? aliasMap.get(lowerBase) ?? baseTable
                }

                // 2) If tableID is missing (common when we wrap queries for pagination),
                //    fall back to parsing the user's SELECT list to recover the qualifier.
                if (!qualifier && mustQualify && selectMeta && selectMeta[idx]?.qualifier) {
                    qualifier = selectMeta[idx]?.qualifier ?? null
                }

                let label: string
                if (mustQualify && qualifier) {
                    label = `${qualifier}.${base}`
                } else if (mustQualify) {
                    label = base
                } else {
                    label = base
                }

                // Ensure uniqueness even after qualification
                const seen = used.get(label) ?? 0
                used.set(label, seen + 1)
                if (seen > 0) {
                    label = `${label}_${seen + 1}`
                }

                dedupedColumns.push(label)
            })

            columns = dedupedColumns

            rows = (result.rows ?? []).map((rowAny: any) => {
                const obj: Record<string, unknown> = {}
                const isArray = Array.isArray(rowAny)
                for (let i = 0; i < columns.length; i++) {
                    obj[columns[i]] = isArray ? rowAny[i] : rowAny[fields[i].name]
                }
                return obj
            })
        }
    } catch (err: unknown) {
        status = 'error'
        const qe = toQueryError(err)
        errorMessage = qe.body.error
        throw qe
    } finally {
        const durationMs = Date.now() - start
            const logInput: LogQueryRunInput = {
                kind,
                namedQueryId,
                connectionId,
                sql: executableSql,
                rowsReturned: rows.length,
                durationMs,
                status,
                errorMessage,
            }
        try {
            logQueryRun(logInput)
        } catch (e) {
            console.error('Failed to log query run', e)
        }
    }

    const maxRows = readMaxRows()
    const truncated = rows.length > maxRows
    const limitedRows = truncated ? rows.slice(0, maxRows) : rows

    return {
        columns,
        columnTypes,
        rows: limitedRows,
        rowCount: limitedRows.length,
        durationMs: Date.now() - start,
        totalCount,
        truncated,
        truncatedAt: maxRows,
        requestedLimit: input.limit,
    }
}

export function applyLimitOffset(sql: string, limit?: number, offset?: number): string {
    if (limit === undefined && offset === undefined) return sql
    const safeLimit = limit !== undefined ? Math.max(0, Math.floor(limit)) : undefined
    const safeOffset = offset !== undefined ? Math.max(0, Math.floor(offset)) : 0

    // Wrap with newlines so trailing single-line comments don't eat the closing paren.
    const wrapped = `SELECT * FROM (\n${sql}\n) as q`

    if (safeLimit === undefined) {
        return `${wrapped} OFFSET ${safeOffset}`
    }
    return `${wrapped} LIMIT ${safeLimit} OFFSET ${safeOffset}`
}

// Parse table aliases from simple FROM / JOIN clauses.
// Returns map of lowercased "schema.table" -> alias used in SQL.
function parseAliases(sql: string): Map<string, string> {
    const map = new Map<string, string>()
    const regex = /\b(from|join)\s+([a-zA-Z0-9_"`.]+)(?:\s+(?:as\s+)?([a-zA-Z_][\w]*))?/gi
    let m: RegExpExecArray | null
    while ((m = regex.exec(sql))) {
        const tableRef = m[2]?.replace(/["`]/g, '')
        const alias = m[3]
        const aliasLower = alias?.toLowerCase()
        // Ignore false positives where the captured "alias" is actually a keyword continuing the JOIN/FROM clause.
        const banned = new Set(['on', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'where', 'group', 'order', 'limit', 'offset', 'having'])
        if (tableRef && alias && !banned.has(aliasLower ?? '')) {
            map.set(tableRef.toLowerCase(), alias)
        }
    }
    return map
}

// Extract SELECT list metadata (qualifier + base) to help disambiguate duplicate column names
// when Postgres strips tableIDs (e.g., after wrapping in a subquery for pagination).
// This is intentionally lightweight; it is not a full SQL parser but works for common SELECT lists.
function extractSelectMeta(sql: string): { qualifier: string | null; base: string | null }[] {
    const selectMatch = sql.match(/select\s+([\s\S]+?)\s+from\s/iu)
    if (!selectMatch) return []

    const selectBody = selectMatch[1]
    const items = splitTopLevel(selectBody)

    return items.map((item) => {
        const cleaned = item.trim()

        // Drop trailing alias (with or without AS) to inspect the source expression
        let expr = cleaned
        const asMatch = cleaned.match(/\s+as\s+([^\s,]+)$/i)
        if (asMatch) {
            expr = cleaned.slice(0, asMatch.index).trim()
        } else {
            // alias without AS (space separated) — grab last token if it isn't a function call
            const tokens = cleaned.split(/\s+/)
            if (tokens.length > 1) {
                expr = tokens.slice(0, -1).join(' ')
            }
        }

        // Try to find qualifier.column pattern at the tail of the expression
        const pathMatch = expr.match(/([a-zA-Z0-9_"`]+)\.([a-zA-Z0-9_"`]+)$/)
        if (pathMatch) {
            const qualifier = stripQuotes(pathMatch[1])
            const base = stripQuotes(pathMatch[2])
            return { qualifier, base }
        }

        // If no qualifier, try simple identifier
        const identMatch = expr.match(/([a-zA-Z0-9_"`]+)$/)
        return { qualifier: null, base: identMatch ? stripQuotes(identMatch[1]) : null }
    })
}

function splitTopLevel(selectBody: string): string[] {
    const parts: string[] = []
    let start = 0
    let depth = 0
    let inSingle = false
    let inDouble = false
    let inBacktick = false

    const pushPart = (end: number) => {
        const segment = selectBody.slice(start, end).trim()
        if (segment) parts.push(segment)
        start = end + 1
    }

    for (let i = 0; i < selectBody.length; i++) {
        const ch = selectBody[i]
        const prev = i > 0 ? selectBody[i - 1] : ''

        if (ch === "'" && prev !== '\\' && !inDouble && !inBacktick) inSingle = !inSingle
        else if (ch === '"' && prev !== '\\' && !inSingle && !inBacktick) inDouble = !inDouble
        else if (ch === '`' && prev !== '\\' && !inSingle && !inDouble) inBacktick = !inBacktick

        if (inSingle || inDouble || inBacktick) continue

        if (ch === '(') depth++
        else if (ch === ')' && depth > 0) depth--

        if (ch === ',' && depth === 0) {
            pushPart(i)
        }
    }

    // Push remainder
    const tail = selectBody.slice(start).trim()
    if (tail) parts.push(tail)

    return parts
}

function stripQuotes(id: string): string {
    return id.replace(/^(["`])(.*)\1$/, '$2')
}
