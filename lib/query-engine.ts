import { getConnectionById } from '@/lib/connections'
import { getNamedQuery, logQueryRun, type LogQueryRunInput } from '@/lib/meta-db'
import { getPoolForConnection } from '@/lib/pg-pool'
import { isReadOnlySql, normalizeSql } from '@/lib/sql/safety'

export type RawQueryInput = {
    kind: 'raw'
    sql: string
    connectionId: string
}

export type NamedQueryInput = {
    kind: 'named'
    queryId: string
    params: Record<string, unknown>
    connectionId?: string
}

export type QueryResult = {
    columns: string[]
    rows: Record<string, unknown>[]
    rowCount: number
    durationMs: number
}

export async function runQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult> {
    const start = Date.now()

    let sql: string
    let connectionId: string
    let kind: LogQueryRunInput['kind']
    let namedQueryId: string | undefined

    if (input.kind === 'raw') {
        sql = input.sql
        connectionId = input.connectionId
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
        kind = 'named'
        namedQueryId = nq.id

        sql = applyNamedQueryParams(nq.sqlTemplate, input.params)
    }

    const trimmed = sql.trim()
    if (!isReadOnlySql(trimmed)) {
        throw new Error('Only read-only SELECT / WITH queries are allowed')
    }

    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new Error('Connection not found')
    }

    const pool = getPoolForConnection(conn)

    const normalized = normalizeSql(trimmed)

    let rows: any[] = []
    let columns: string[] = []
    let status: LogQueryRunInput['status'] = 'ok'
    let errorMessage: string | undefined

    try {
        const result = await pool.query(normalized)
        rows = result.rows ?? []
        columns = result.fields?.map((f) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : [])
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
            sql: normalized,
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
    }
}

function applyNamedQueryParams(template: string, params: Record<string, unknown>): string {
    let sql = template
    for (const [key, value] of Object.entries(params)) {
        const safeValue = coerceParamValue(value)
        const pattern = new RegExp(`:${key}\\b`, 'g')
        sql = sql.replace(pattern, safeValue)
    }
    return sql
}

function coerceParamValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

    const str = String(value)
    const escaped = str.replace(/'/g, "''")
    return `'${escaped}'`
}
