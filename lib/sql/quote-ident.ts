// Quote a possibly-qualified identifier (schema.table or table) only when
// Postgres actually requires it.
//
// Postgres needs identifiers quoted when they are:
//   - reserved words (select, from, user, table, …)
//   - mixed-case (unquoted idents are folded to lowercase)
//   - contain anything outside [a-z0-9_]
//   - start with a digit
//
// For everything else (`users`, `id`, `vms`, `kubeclusters`) bare is fine
// and a lot more readable. Quoting everything was visual noise the user
// rightly hated.

// Postgres reserved + non-reserved-but-quotable keyword list. Trimmed to the
// commonly-collisions; we err toward NOT quoting since the user can always
// alias if they hit a problem.
const RESERVED = new Set([
    "all", "analyse", "analyze", "and", "any", "array", "as", "asc",
    "asymmetric", "authorization", "between", "binary", "both", "case",
    "cast", "check", "collate", "collation", "column", "concurrently",
    "constraint", "create", "cross", "current_catalog", "current_date",
    "current_role", "current_schema", "current_time", "current_timestamp",
    "current_user", "default", "deferrable", "desc", "distinct", "do",
    "else", "end", "except", "false", "fetch", "for", "foreign", "freeze",
    "from", "full", "grant", "group", "having", "ilike", "in", "initially",
    "inner", "intersect", "into", "is", "isnull", "join", "lateral",
    "leading", "left", "like", "limit", "localtime", "localtimestamp",
    "natural", "not", "notnull", "null", "offset", "on", "only", "or",
    "order", "outer", "overlaps", "placing", "primary", "references",
    "returning", "right", "select", "session_user", "similar", "some",
    "symmetric", "system_user", "table", "tablesample", "then", "to",
    "trailing", "true", "union", "unique", "user", "using", "variadic",
    "verbose", "when", "where", "window", "with",
])

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/

function needsQuoting(part: string): boolean {
    if (!SAFE_IDENT.test(part)) return true
    if (RESERVED.has(part)) return true
    return false
}

function quotePart(part: string): string {
    if (needsQuoting(part)) {
        return `"${part.replace(/"/g, '""')}"`
    }
    return part
}

/**
 * Quote a possibly-qualified SQL identifier only when necessary.
 * Examples:
 *   "users"               → users
 *   "public.users"        → public.users
 *   "public.User"         → public."User"
 *   "k8s.cluster-id"      → k8s."cluster-id"
 *   "select"              → "select"        (reserved)
 */
export const quoteIdent = (name: string) =>
    name.split(".").map(quotePart).join(".")

/**
 * Strip surrounding double quotes from each part of a possibly-qualified
 * identifier so it's safe to render to a user. Multi-part identifiers like
 * `"public"."vms"` round-trip cleanly to `public.vms`.
 */
export function unquoteIdent(name: string): string {
    return name
        .split(".")
        .map((part) => part.replace(/^"(.*)"$/, "$1").replace(/""/g, '"'))
        .join(".")
}

/**
 * The display name we want for a fully-qualified table reference: strip
 * quotes, strip the `public.` prefix, but keep other schemas.
 */
export function displayTableName(name: string): string {
    const cleaned = unquoteIdent(name)
    return cleaned.replace(/^public\./, "")
}
