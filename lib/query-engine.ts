import { getConnectionById } from '@/lib/connections'
import { getNamedQuery, logQueryRun, type LogQueryRunInput } from '@/lib/meta-db'
import { getPoolForConnection, type PoolMode } from '@/lib/pg-pool'
import { isReadOnlySql, normalizeSql } from '@/lib/sql/safety'

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
    rows: Record<string, unknown>[]
    rowCount: number
    durationMs: number
    totalCount?: number
}

type ParameterizedSql = { text: string; values: unknown[] }

export async function runQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult> {
    const start = Date.now()

    let sql: string
    // A best-effort copy of the user's query _before_ we wrap it (e.g. for pagination).
    // We use it later to recover table qualifiers when Postgres strips tableIDs in subqueries.
    let userSql: string | undefined
    let values: unknown[] = []
    let connectionId: string
    let poolMode: PoolMode | undefined
    let scopeKey: string | undefined
    let kind: LogQueryRunInput['kind']
    let namedQueryId: string | undefined

    if (input.kind === 'raw') {
        sql = input.sql
        userSql = input.originalSql ?? input.sql
        connectionId = input.connectionId
        poolMode = input.poolMode
        scopeKey = input.scopeKey
        values = input.params ?? []
        kind = 'raw'
    } else {
        const nq = getNamedQuery(input.queryId)
        if (!nq) {
            throw new Error('Named query not found')
        }
        const connId = input.connectionId ?? nq.defaultConnectionId
        if (!connId) {
            throw new Error('No connection specified for named query')
        }
        connectionId = connId
        poolMode = input.poolMode
        scopeKey = input.scopeKey
        kind = 'named'
        namedQueryId = nq.id

        const paramSql = applyNamedQueryParams(nq.sqlTemplate, input.params)
        sql = paramSql.text
        userSql = input.originalSql ?? paramSql.text
        values = paramSql.values
    }

    const trimmed = sql.trim()
    if (!isReadOnlySql(trimmed)) {
        throw new Error('Only read-only SELECT / WITH queries are allowed')
    }

    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new Error('Connection not found')
    }

    const pool = getPoolForConnection(conn, { mode: poolMode, scopeKey })

    const normalized = normalizeSql(trimmed)
    const sourceSql = userSql ?? normalized
    const executableSql = applyLimitOffset(normalized, input.limit, input.offset)

    let rows: any[] = []
    let totalCount: number | undefined
    let columns: string[] = []
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
            // Disambiguate duplicates by qualifying with table alias (preferred) or schema.table; fall back to suffix.
            const tableOids = Array.from(new Set(fields.map((f) => f.tableID).filter((oid) => oid && oid > 0)))
            const tableNameByOid: Record<number, string> = {}
            if (tableOids.length > 0) {
                const lookup = await pool.query(
                    `SELECT c.oid, n.nspname, c.relname
                     FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.oid = ANY($1::oid[])`,
                    [tableOids],
                )
                for (const r of lookup.rows) {
                    tableNameByOid[Number(r.oid)] = `${r.nspname}.${r.relname}`
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
    } catch (err: any) {
        status = 'error'
        errorMessage = err?.message || 'Query failed'
        throw err
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

    const limitedRows = rows.slice(0, 5000)

    return {
        columns,
        rows: limitedRows,
        rowCount: limitedRows.length,
        durationMs: Date.now() - start,
        totalCount,
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

export function applyNamedQueryParams(template: string, params: Record<string, unknown>): ParameterizedSql {
    // Optional parameter handling:
    // - If a param is missing/empty, we neutralize simple predicates that reference it
    //   (e.g., "col = :p" / "col LIKE :p" / "col IN (:p)") by replacing them with 1=1.
    // - We then replace remaining :param occurrences with $1, $2... and collect values.

    let workingSql = template

    const isEmptyParam = (val: unknown) =>
        val === undefined || val === null || (typeof val === 'string' && val.trim() === '')

    // First pass: remove predicates for empty params
    for (const [name, val] of Object.entries(params)) {
        if (!isEmptyParam(val)) continue

        const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
        const patterns = [
            new RegExp(`([\\w."\\\`]+)\\s*=\\s*:${escaped}(::[\\w]+)?`, 'gi'),
            new RegExp(`:${escaped}\\s*=\\s*([\\w."\\\`]+)`, 'gi'),
            new RegExp(`([\\w."\\\`]+)\\s+(?:ILIKE|LIKE)\\s*:${escaped}`, 'gi'),
            new RegExp(`([\\w."\\\`]+)\\s+IN\\s*\\(\\s*:${escaped}\\s*\\)`, 'gi'),
        ]
        for (const pat of patterns) {
            workingSql = workingSql.replace(pat, '1=1')
        }
        // Also remove the param so it won't be substituted
        delete (params as any)[name]
    }

    // Match :param only when it's not part of an identifier/hex chunk (e.g., MAC 00:11:22:aa:bb:cc).
    // We require the char before ':' to be start or a non-word char.
    const placeholderRegex = /(^|[^0-9A-Za-z_]):([a-zA-Z_][a-zA-Z0-9_]*)/g
    const seen = new Map<string, number>()
    const values: unknown[] = []

    let index = 0
    const text = workingSql.replace(placeholderRegex, (_match, prefix: string, name: string) => {
        const key = name as string
        let existing = seen.get(key)
        if (existing === undefined) {
            existing = ++index
            seen.set(key, existing)
            values.push(coerceParamValue(params[key]))
        }
        return `${prefix}$${existing}`
    })

    return { text, values }
}

function coerceParamValue(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' && value.trim() === '') return null
    if (typeof value === 'number' || typeof value === 'bigint') return value
    if (typeof value === 'boolean') return value
    // Everything else as string
    return String(value)
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
