export type CoreErrorBody = {
    error: string
    issues?: unknown
}

export class CoreError extends Error {
    readonly status: number
    readonly body: CoreErrorBody

    constructor(status: number, body: CoreErrorBody) {
        super(body.error)
        this.name = 'CoreError'
        this.status = status
        this.body = body
    }
}

export function isCoreError(err: unknown): err is CoreError {
    return err instanceof CoreError
}

// ---------------------------------------------------------------------------
// QueryError — rich, classified error for failed queries.
//
// pg's `DatabaseError` carries a lot of useful fields (code, position, hint,
// detail, where, schema/table/column). We propagate them all the way to the
// renderer so the error display can show actionable information instead of a
// flat message string.
// ---------------------------------------------------------------------------

export type QueryErrorClassification =
    | 'timeout'
    | 'syntax'
    | 'permission'
    | 'connection'
    | 'safety'
    | 'not_found'
    | 'unknown'

export type QueryErrorBody = {
    error: string
    classification: QueryErrorClassification
    code?: string
    severity?: string
    hint?: string
    detail?: string
    where?: string
    schema?: string
    table?: string
    column?: string
    position?: string
    dataType?: string
    constraint?: string
    routine?: string
}

export class QueryError extends Error {
    readonly body: QueryErrorBody

    constructor(body: QueryErrorBody) {
        super(body.error)
        this.name = 'QueryError'
        this.body = body
    }
}

export function isQueryError(err: unknown): err is QueryError {
    return err instanceof QueryError
}

// Postgres SQLSTATE prefix → classification.
// See https://www.postgresql.org/docs/current/errcodes-appendix.html
function classifyByCode(code: string | undefined): QueryErrorClassification {
    if (!code) return 'unknown'
    if (code === '57014') return 'timeout' // query_canceled (statement_timeout)
    // 42xxx — Syntax Error or Access Rule Violation
    if (code === '42501') return 'permission' // insufficient_privilege
    if (code === '42P01') return 'not_found' // undefined_table
    if (code === '42703') return 'not_found' // undefined_column
    if (code === '42883') return 'not_found' // undefined_function
    if (code === '3D000') return 'not_found' // invalid_catalog_name
    if (code === '3F000') return 'not_found' // invalid_schema_name
    if (code.startsWith('42')) return 'syntax'
    // 08xxx — Connection Exception, 57Pxx — Operator Intervention (shutdown etc.)
    if (code.startsWith('08') || code.startsWith('57P')) return 'connection'
    // 53xxx — Insufficient Resources
    if (code.startsWith('53')) return 'connection'
    return 'unknown'
}

function classifyByMessage(message: string): QueryErrorClassification {
    const m = message.toLowerCase()
    if (m.includes('timeout') || m.includes('canceled') || m.includes('cancelled')) return 'timeout'
    if (m.includes('permission') || m.includes('not allowed') || m.includes('read-only')) return 'permission'
    if (m.includes('connection') || m.includes('econn') || m.includes('etimedout')) return 'connection'
    return 'unknown'
}

// Build a QueryError from any thrown value. Accepts pg DatabaseError instances
// (duck-typed via the `code`/`severity` fields) and falls back to message-based
// classification for everything else.
export function toQueryError(
    err: unknown,
    overrides: Partial<QueryErrorBody> = {},
): QueryError {
    if (err instanceof QueryError) return err

    const anyErr = err as Record<string, unknown> | null | undefined
    const message =
        (anyErr && typeof anyErr.message === 'string' && anyErr.message) ||
        (typeof err === 'string' ? err : 'Query failed')

    const code = typeof anyErr?.code === 'string' ? (anyErr.code as string) : undefined
    let classification: QueryErrorClassification = code
        ? classifyByCode(code)
        : classifyByMessage(message)
    if (classification === 'unknown' && code) classification = classifyByMessage(message)

    const body: QueryErrorBody = {
        error: message,
        classification,
        code,
        severity: typeof anyErr?.severity === 'string' ? (anyErr.severity as string) : undefined,
        hint: typeof anyErr?.hint === 'string' ? (anyErr.hint as string) : undefined,
        detail: typeof anyErr?.detail === 'string' ? (anyErr.detail as string) : undefined,
        where: typeof anyErr?.where === 'string' ? (anyErr.where as string) : undefined,
        schema: typeof anyErr?.schema === 'string' ? (anyErr.schema as string) : undefined,
        table: typeof anyErr?.table === 'string' ? (anyErr.table as string) : undefined,
        column: typeof anyErr?.column === 'string' ? (anyErr.column as string) : undefined,
        position: typeof anyErr?.position === 'string' ? (anyErr.position as string) : undefined,
        dataType: typeof anyErr?.dataType === 'string' ? (anyErr.dataType as string) : undefined,
        constraint: typeof anyErr?.constraint === 'string' ? (anyErr.constraint as string) : undefined,
        routine: typeof anyErr?.routine === 'string' ? (anyErr.routine as string) : undefined,
        ...overrides,
    }

    return new QueryError(body)
}

// HTTP status to use when returning a QueryError over the wire.
export function statusForQueryError(body: QueryErrorBody): number {
    switch (body.classification) {
        case 'permission':
            return 403
        case 'not_found':
            return 404
        case 'timeout':
            return 504
        case 'connection':
            return 503
        case 'safety':
        case 'syntax':
        case 'unknown':
        default:
            return 400
    }
}
