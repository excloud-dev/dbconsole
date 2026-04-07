// Derive a short, identifying label from a piece of SQL.
//
// Tabs default to "Query 1", "Query 2", … which is useless once you have more
// than three tabs open. Once the user starts typing actual SQL, we replace
// the default with a smart label like:
//
//     "users WHERE id = 42"
//     "orders JOIN payments"
//     "WITH active SELECT *"
//
// The user's manual rename always wins (Tab.userRenamed). This function is
// intentionally lightweight — it's not a SQL parser, just enough regex to
// pull out the parts of the query that the user is most likely to recognize.

import { stripSqlComments } from '@/lib/sql/safety'

const MAX_LABEL_LEN = 40

/**
 * Derive a one-line label from a SQL string. Returns null if the SQL is
 * empty or so unusual that we'd produce something less informative than
 * the existing default.
 */
export function deriveTabLabel(sql: string): string | null {
    if (!sql || !sql.trim()) return null

    const cleaned = stripSqlComments(sql).replace(/\s+/g, ' ').trim()
    if (!cleaned) return null

    // 1. Pull the first FROM <table> we can find.
    const fromMatch = cleaned.match(/\bfrom\s+([a-zA-Z_"][\w".]*)/i)
    let head: string | null = fromMatch ? unquote(fromMatch[1]) : null

    // 2. If we have a WHERE clause, append the first equality literal as
    //    "WHERE col = value". Helps disambiguate "users WHERE id=1" from
    //    "users WHERE id=2".
    let tail: string | null = null
    const whereMatch = cleaned.match(/\bwhere\s+([\s\S]+)$/i)
    if (whereMatch) {
        const wherePart = whereMatch[1]
        const eqMatch = wherePart.match(/([a-zA-Z_"][\w".]*)\s*=\s*([^\s,)]+)/)
        if (eqMatch) {
            tail = `${unquote(eqMatch[1])} = ${stripQuotes(eqMatch[2])}`
        }
    }

    // 3. If we have a JOIN, prefer the joined table over WHERE — it tells
    //    you more about what the query is doing.
    const joinMatch = cleaned.match(/\bjoin\s+([a-zA-Z_"][\w".]*)/i)
    if (joinMatch && head) {
        const joined = unquote(joinMatch[1])
        return truncate(`${head} ⋈ ${joined}`)
    }

    if (head && tail) {
        return truncate(`${head} · ${tail}`)
    }
    if (head) {
        return truncate(head)
    }

    // 4. Fallback: starts with WITH (CTE) or VALUES — surface that.
    if (/^with\b/i.test(cleaned)) {
        const withMatch = cleaned.match(/^with\s+(?:recursive\s+)?([a-zA-Z_"][\w]*)/i)
        if (withMatch) return truncate(`WITH ${unquote(withMatch[1])}`)
        return 'WITH …'
    }
    if (/^values\b/i.test(cleaned)) return 'VALUES …'

    return null
}

function truncate(s: string): string {
    if (s.length <= MAX_LABEL_LEN) return s
    return s.slice(0, MAX_LABEL_LEN - 1) + '…'
}

function unquote(ident: string): string {
    return ident.replace(/^"(.*)"$/, '$1').replace(/^public\./, '')
}

function stripQuotes(literal: string): string {
    return literal.replace(/^['"](.*)['"]$/, '$1')
}
