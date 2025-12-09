// Helpers to enforce read-only SQL and basic safety constraints

const READONLY_PREFIXES = ['select', 'with']
const FORBIDDEN_KEYWORDS = [
    'insert',
    'update',
    'delete',
    'alter',
    'drop',
    'truncate',
    'create',
    'grant',
    'revoke',
    'comment',
]

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

    const lower = first

    if (FORBIDDEN_KEYWORDS.some((kw) => lower.includes(kw))) return false

    return true
}
