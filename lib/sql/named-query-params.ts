export type ParameterizedSql = { text: string; values: unknown[] }

export function applyNamedQueryParams(template: string, params: Record<string, unknown>): ParameterizedSql {
    // Optional parameter handling:
    // - If a param is missing/empty, we neutralize simple predicates that reference it
    //   (e.g., "col = :p" / "col LIKE :p" / "col IN (:p)") by replacing them with 1=1.
    // - We then replace remaining :param occurrences with $1, $2... and collect values.

    let workingSql = template

    const isEmptyParam = (val: unknown) =>
        val === undefined || val === null || (typeof val === 'string' && val.trim() === '')

    // Avoid mutating the caller's object (important for React state + request payload reuse).
    const filteredParams: Record<string, unknown> = { ...params }

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
        delete filteredParams[name]
    }

    workingSql = cleanupTrivialPredicates(workingSql)

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
            values.push(coerceParamValue(filteredParams[key]))
        }
        return `${prefix}$${existing}`
    })

    return { text, values }
}

export function cleanupTrivialPredicates(sql: string): string {
    let cleaned = sql

    // Collapse parenthesized 1=1
    cleaned = cleaned.replace(/\(\s*1\s*=\s*1\s*\)/gi, '1=1')

    // Remove AND-linked neutral predicates
    cleaned = cleaned.replace(/\bWHERE\s+1\s*=\s*1\s+AND\b/gi, 'WHERE')
    cleaned = cleaned.replace(/\bAND\s+1\s*=\s*1\b/gi, '')
    cleaned = cleaned.replace(/\b1\s*=\s*1\s+AND\b/gi, '')

    // If WHERE is left with only 1=1, drop it entirely
    cleaned = cleaned.replace(/\bWHERE\s+1\s*=\s*1\b/gi, '')

    return cleaned
}

function coerceParamValue(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' && value.trim() === '') return null
    if (typeof value === 'number' || typeof value === 'bigint') return value
    if (typeof value === 'boolean') return value
    // Everything else as string
    return String(value)
}
