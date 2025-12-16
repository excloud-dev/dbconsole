// Helpers to enforce read-only SQL and basic safety constraints

const READONLY_PREFIXES = ['select', 'with']

// Match whole keywords only (word boundaries) so we don't reject identifiers like
// "created_at" or "updated_at". The previous substring check blocked perfectly
// valid SELECTs because it saw "create" inside "created_at" and "update" inside
// "updated_at".
const FORBIDDEN_PATTERN = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|comment)\b/i
const LIMIT_CLAUSE_PATTERN = /\blimit\b\s+(all\b|\d+|\$\d+|:\w+|\?|\()/i

export function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim()
}

export function isReadOnlySql(sql: string): boolean {
    const trimmed = sql.trim()
    if (!trimmed) return false

    // Disallow multiple statements separated by ';'
    const statements = trimmed.split(';').filter((s) => s.trim().length > 0)
    if (statements.length > 1) return false

    const first = statements[0].trim().toLowerCase()

    if (!READONLY_PREFIXES.some((p) => first.startsWith(p))) return false

    // Reject if any forbidden keyword appears as a standalone token
    if (FORBIDDEN_PATTERN.test(first)) return false

    return true
}

export function hasLimitClause(sql: string): boolean {
    const normalized = normalizeSql(sql)
    return LIMIT_CLAUSE_PATTERN.test(normalized)
}
