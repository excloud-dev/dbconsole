// Helpers to enforce read-only SQL and basic safety constraints.
//
// SECURITY NOTE: this is the last line of defense before user-supplied SQL
// reaches the Postgres pool. Bugs here turn dbconsole into a write-capable
// surface. When changing this file, ALWAYS also extend tests/sql-safety.test.ts
// with the bypass you considered.

const READONLY_PREFIXES = ['select', 'with']

// Match whole keywords only (word boundaries) so we don't reject identifiers
// like "created_at" or "updated_at".
//
// We only need to list keywords that could be smuggled past the SELECT/WITH
// prefix check via a CTE (`WITH x AS (DELETE …) SELECT …`) or subquery, plus
// `MERGE` (PG15+ DML form) which can appear inside `WITH RECURSIVE`. Common
// column names like `set`, `lock`, `do`, `commit`, `cluster`, `copy`, `call`,
// `refresh` are intentionally NOT in this list — they would false-positive
// on legitimate read queries.
const FORBIDDEN_PATTERN = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|comment|merge|vacuum|reindex|prepare|deallocate)\b/i

// `SELECT … INTO newtable` is a DDL form (creates a new table from the result).
// Postgres also has `SELECT … INTO TEMP/TEMPORARY/UNLOGGED newtable`. The
// `STRICT` form (`SELECT INTO var FROM …`) only exists inside PL/pgSQL bodies
// and isn't reachable from a top-level statement, so we don't need to handle it.
const SELECT_INTO_PATTERN = /\bselect\b[\s\S]*?\binto\s+(?:temp(?:orary)?\s+|unlogged\s+)?[a-zA-Z_"][\w".]*\s/i

const LIMIT_CLAUSE_PATTERN = /\blimit\b\s+(all\b|\d+|\$\d+|:\w+|\?|\()/i

export function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim()
}

/**
 * Strip SQL comments (-- line and /* block *\/) while preserving content
 * inside string literals. Returns a sanitized copy that's safe to scan for
 * forbidden keywords.
 *
 * Without this step, attackers can hide DML inside comments:
 *   `SELECT 1 -- ; DELETE FROM users`
 *   `SELECT /` + `* DELETE *` + `/ 1`
 * The string-literal preservation matters because we don't want to strip
 * comment-looking sequences inside `'a -- b'` or `'a /* b *` + `/ c'`.
 */
export function stripSqlComments(sql: string): string {
    let out = ''
    let i = 0
    let inSingle = false
    let inDouble = false
    let inDollar: string | null = null // active $tag$ marker, or null

    while (i < sql.length) {
        const ch = sql[i]
        const next = sql[i + 1]

        // Inside a dollar-quoted string?
        if (inDollar) {
            if (sql.startsWith(inDollar, i)) {
                out += inDollar
                i += inDollar.length
                inDollar = null
                continue
            }
            out += ch
            i++
            continue
        }

        // Inside a single-quoted string?
        if (inSingle) {
            out += ch
            if (ch === "'" && sql[i - 1] !== '\\') {
                // Postgres also escapes by doubling: '' inside a string.
                if (next === "'") {
                    out += next
                    i += 2
                    continue
                }
                inSingle = false
            }
            i++
            continue
        }

        // Inside a double-quoted identifier?
        if (inDouble) {
            out += ch
            if (ch === '"') inDouble = false
            i++
            continue
        }

        // Detect dollar-quote opener: $tag$
        if (ch === '$') {
            const tagMatch = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i))
            if (tagMatch) {
                inDollar = tagMatch[0]
                out += inDollar
                i += inDollar.length
                continue
            }
        }

        // Detect line comment.
        if (ch === '-' && next === '-') {
            // Skip until newline (newline preserved so line numbers stay sane).
            i += 2
            while (i < sql.length && sql[i] !== '\n') i++
            // Replace the comment with a single space so adjacent tokens
            // don't accidentally fuse: "DELETE--c\nFROM" → "DELETE FROM".
            out += ' '
            continue
        }

        // Detect block comment. Postgres allows nested block comments.
        if (ch === '/' && next === '*') {
            i += 2
            let depth = 1
            while (i < sql.length && depth > 0) {
                if (sql[i] === '/' && sql[i + 1] === '*') {
                    depth++
                    i += 2
                } else if (sql[i] === '*' && sql[i + 1] === '/') {
                    depth--
                    i += 2
                } else {
                    i++
                }
            }
            out += ' '
            continue
        }

        if (ch === "'") inSingle = true
        else if (ch === '"') inDouble = true

        out += ch
        i++
    }

    return out
}

/**
 * Split a string on top-level semicolons (i.e. ignoring semicolons inside
 * string literals, identifiers, dollar-quoted blocks, and block comments).
 * Used to enforce the no-multi-statement rule. Comments must be stripped
 * BEFORE calling this — see {@link isReadOnlySql}.
 */
export function splitTopLevelStatements(sql: string): string[] {
    const parts: string[] = []
    let buf = ''
    let inSingle = false
    let inDouble = false
    let inDollar: string | null = null

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i]

        if (inDollar) {
            if (sql.startsWith(inDollar, i)) {
                buf += inDollar
                i += inDollar.length - 1
                inDollar = null
                continue
            }
            buf += ch
            continue
        }

        if (inSingle) {
            buf += ch
            if (ch === "'" && sql[i - 1] !== '\\') {
                if (sql[i + 1] === "'") {
                    buf += "'"
                    i++
                    continue
                }
                inSingle = false
            }
            continue
        }

        if (inDouble) {
            buf += ch
            if (ch === '"') inDouble = false
            continue
        }

        if (ch === '$') {
            const tagMatch = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i))
            if (tagMatch) {
                inDollar = tagMatch[0]
                buf += inDollar
                i += inDollar.length - 1
                continue
            }
        }

        if (ch === "'") {
            inSingle = true
            buf += ch
            continue
        }
        if (ch === '"') {
            inDouble = true
            buf += ch
            continue
        }

        if (ch === ';') {
            if (buf.trim().length > 0) parts.push(buf)
            buf = ''
            continue
        }

        buf += ch
    }

    if (buf.trim().length > 0) parts.push(buf)
    return parts
}

export function isReadOnlySql(sql: string): boolean {
    const trimmed = sql.trim()
    if (!trimmed) return false

    // Strip comments BEFORE any keyword/structure check, otherwise an attacker
    // can hide DML behind `--` or `/* */`.
    const sanitized = stripSqlComments(trimmed).trim()
    if (!sanitized) return false

    // Disallow multiple statements separated by top-level ';'.
    const statements = splitTopLevelStatements(sanitized)
    if (statements.length > 1) return false
    if (statements.length === 0) return false

    const first = statements[0].trim().toLowerCase()

    if (!READONLY_PREFIXES.some((p) => first.startsWith(p))) return false

    // Reject if any forbidden keyword appears as a standalone token.
    // CTE-wrapped DML (e.g. `WITH x AS (DELETE FROM t RETURNING *) SELECT …`)
    // gets caught here because the inner DELETE/UPDATE/INSERT is still a
    // standalone keyword in the sanitized text.
    if (FORBIDDEN_PATTERN.test(first)) return false

    // Reject `SELECT … INTO newtable` which is DDL disguised as a SELECT.
    // The `INTO` keyword between SELECT and FROM is the giveaway.
    if (SELECT_INTO_PATTERN.test(first)) return false

    return true
}

export function hasLimitClause(sql: string): boolean {
    const normalized = normalizeSql(sql)
    return LIMIT_CLAUSE_PATTERN.test(normalized)
}
