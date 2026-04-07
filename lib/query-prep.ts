// Shared input handling for the bounded `runQuery` path and the streaming
// `openStream` path. Both consume the same `RawQueryInput | NamedQueryInput`
// shapes from the IPC layer; pulling the common prep here keeps the two paths
// from drifting (e.g. one applying named-query params and the other not).

import { getNamedQuery } from '@/lib/meta-db'
import { QueryError } from '@/lib/core/errors'
import { applyNamedQueryParams } from '@/lib/sql/named-query-params'
import type { NamedQueryInput, RawQueryInput } from '@/lib/query-engine'
import type { PoolMode } from '@/lib/pg-pool'

export type PreparedQuery = {
    /** The SQL to execute. Already has named-query params substituted. */
    sql: string
    values: unknown[]
    connectionId: string
    poolMode?: PoolMode
    scopeKey?: string
    kind: 'raw' | 'named'
    namedQueryId?: string
    /**
     * The user-visible SQL string (before pagination wrapping). Used by the
     * dup-column resolver to recover qualifiers when Postgres strips tableIDs
     * from wrapped subqueries.
     */
    originalSqlHint: string
}

export function prepareQuery(input: RawQueryInput | NamedQueryInput): PreparedQuery {
    if (input.kind === 'raw') {
        return {
            sql: input.sql,
            values: input.params ?? [],
            connectionId: input.connectionId,
            poolMode: input.poolMode,
            scopeKey: input.scopeKey,
            kind: 'raw',
            originalSqlHint: input.originalSql ?? input.sql,
        }
    }

    const nq = getNamedQuery(input.queryId)
    if (!nq) {
        throw new QueryError({ error: 'Named query not found', classification: 'not_found' })
    }

    const connectionId = input.connectionId ?? nq.defaultConnectionId
    if (!connectionId) {
        throw new QueryError({
            error: 'No connection specified for named query',
            classification: 'not_found',
        })
    }

    const paramSql = applyNamedQueryParams(nq.sqlTemplate, input.params)
    return {
        sql: paramSql.text,
        values: paramSql.values,
        connectionId,
        poolMode: input.poolMode,
        scopeKey: input.scopeKey,
        kind: 'named',
        namedQueryId: nq.id,
        originalSqlHint: input.originalSql ?? paramSql.text,
    }
}
