export type ApiErrorBody = { error?: string; issues?: unknown } | unknown

export class ApiError extends Error {
    readonly status: number
    readonly body: ApiErrorBody

    constructor(message: string, status: number, body: ApiErrorBody) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.body = body
    }
}

import type { QueryErrorBody as _QueryErrorBody } from '@/lib/core/errors'

/**
 * Returns the rich {@link QueryErrorBody} carried by an {@link ApiError} when
 * the failed request was a query. Falls back to `null` for plain string-only
 * errors so call sites can handle both shapes uniformly.
 */
export function asQueryErrorBody(err: unknown): _QueryErrorBody | null {
    if (!(err instanceof ApiError)) return null
    const body = err.body as Record<string, unknown> | null | undefined
    if (!body || typeof body !== 'object') return null
    if (typeof body.classification !== 'string') return null
    if (typeof body.error !== 'string') return null
    return body as unknown as _QueryErrorBody
}

function isDesktopRuntime(): boolean {
    return typeof window !== 'undefined' && !!window.dbconsole?.isDesktop
}

async function parseJsonSafe(res: Response): Promise<unknown> {
    try {
        return await res.json()
    } catch {
        return null
    }
}

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    })

    if (res.ok) {
        return (await parseJsonSafe(res)) as T
    }

    const body = await parseJsonSafe(res)
    const message =
        body && typeof body === 'object' && 'error' in (body as any) && typeof (body as any).error === 'string'
            ? String((body as any).error)
            : `Request failed (${res.status})`
    throw new ApiError(message, res.status, body)
}

async function ipcInvoke<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (e: any) {
        const status = typeof e?.status === 'number' ? e.status : 500
        const body = e?.body
        const message = typeof e?.message === 'string' ? e.message : 'Request failed'
        throw new ApiError(message, status, body)
    }
}

export type AppInfo = {
    version: string
    buildSha?: string
    buildTime?: string
    platform?: string
    arch?: string
    runtime?: { electron?: string; node?: string; chrome?: string }
}

export type ConnectionDraft = {
    label: string
    host: string
    port: number | string
    database: string
    username: string
    password: string
    readOnly?: boolean
}

export type ClientConnectionMeta = {
    id: string
    label: string
    kind: 'postgres'
    from: 'env' | 'ui'
    readOnly: boolean
    host?: string
    port?: number
    database?: string
    username?: string
}

export type PoolMode = 'single' | 'shared' | 'per-scope'

export type ReleasePoolsPayload = {
    connectionId: string
    poolMode?: PoolMode
    scopeKey?: string
}

export type QueryParamDef = {
    name: string
    type: 'string' | 'number' | 'boolean'
    defaultValue?: string
}

export type ClientNamedQuery = {
    id: string
    name: string
    description?: string
    sqlTemplate: string
    params: QueryParamDef[]
    defaultConnectionId?: string
}

export type SyncerSettings = {
    remoteUrl: string | null
    hasPhrase: boolean
    syncDeletions: boolean
}

export type NamedQuerySyncResolution =
    | { conflictKey: string; action: 'keep-remote' }
    | { conflictKey: string; action: 'keep-local' }
    | { conflictKey: string; action: 'rename-local'; newName: string }

export type NamedQuerySyncOkResult = {
    status: 'ok'
    remoteVersion: number
    pushed: boolean
    newRemoteVersion?: number
}

export type RelationKind = 'table' | 'view' | 'matview'
export type RelationRef = { schema: string; name: string; kind: RelationKind }

export type IndexInfo = {
    table: { schema: string; name: string }
    name: string
    isUnique: boolean
    isPrimary: boolean
    columns: string[]
    definition: string
}

export type TriggerInfo = {
    table: { schema: string; name: string }
    name: string
    timing: string
    events: string[]
    definition: string
}

export type RoutineInfo = {
    schema: string
    name: string
    kind: 'function' | 'procedure' | 'aggregate' | 'window'
    language: string
    returnType?: string
    argsSignature: string
}

export type SchemaGraph = {
    tables: { schema: string; name: string }[]
    relations: RelationRef[]
    columns: {
        table: { schema: string; name: string }
        name: string
        dataType: string
        isNullable: boolean
        defaultValue?: string | null
        isIdentity?: boolean
        identityGeneration?: string | null
        isGenerated?: boolean
        generationExpression?: string | null
    }[]
    foreignKeys: {
        from: { schema: string; name: string }
        fromColumn: string
        to: { schema: string; name: string }
        toColumn: string
    }[]
    primaryKeys: { table: { schema: string; name: string }; columnName: string }[]
    indexes: IndexInfo[]
    triggers: TriggerInfo[]
    routines: RoutineInfo[]
}

export type QueryResult = {
    columns: string[]
    columnTypes: number[]
    rows: Record<string, unknown>[]
    rowCount: number
    durationMs: number
    totalCount?: number
    truncated: boolean
    truncatedAt: number
    requestedLimit?: number
}

export type StreamOpenResult = {
    streamId: string
    columns: string[]
    columnTypes: number[]
    rows: Record<string, unknown>[]
    rowsSent: number
    hasMore: boolean
    batchSize: number
}

export type StreamNextResult = {
    streamId: string
    rows: Record<string, unknown>[]
    rowsSent: number
    hasMore: boolean
}

export type StreamCloseResult = {
    streamId: string
    rowsSent: number
}

export type SlowQuerySort = 'mean_time' | 'total_time' | 'calls' | 'rows'

export type SlowQueryRow = {
    queryId: string
    query: string
    calls: number
    totalTimeMs: number
    meanTimeMs: number
    minTimeMs: number
    maxTimeMs: number
    stddevTimeMs: number
    rows: number
    sharedBlksHit: number
    sharedBlksRead: number
}

export type SlowQueryResult =
    | { installed: true; rows: SlowQueryRow[]; sort: SlowQuerySort; limit: number }
    | { installed: false; installSnippet: string }

export type QueryHistoryStatus = 'ok' | 'error' | 'timeout'
export type QueryHistoryKind = 'raw' | 'named'

export type QueryHistoryRow = {
    id: number
    kind: QueryHistoryKind
    namedQueryId?: string
    connectionId: string
    userId?: string
    sql: string
    rowsReturned?: number
    durationMs?: number
    status: QueryHistoryStatus
    errorMessage?: string
    createdAt: string
}

export type QueryHistoryFilter = {
    connectionId?: string
    status?: QueryHistoryStatus
    kind?: QueryHistoryKind
    from?: string
    to?: string
    search?: string
    limit?: number
    offset?: number
}

export type QueryHistoryResult = {
    rows: QueryHistoryRow[]
    total: number
    hasMore: boolean
}

export type { QueryErrorBody, QueryErrorClassification } from '@/lib/core/errors'

export type RawQueryPayload = {
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

export type NamedQueryPayload = {
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

export const apiClient = {
    app: {
        info: (opts: { signal?: AbortSignal } = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<AppInfo>(() => window.dbconsole!.api.app.info())
            return http<AppInfo>('/api/app-info', { method: 'GET', signal: opts.signal })
        },
    },
    shortcuts: {
        get: () => {
            if (isDesktopRuntime()) return ipcInvoke(() => window.dbconsole!.api.shortcuts.get())
            return http('/api/shortcuts', { method: 'GET' })
        },
        set: (payload: any) => {
            if (isDesktopRuntime()) return ipcInvoke(() => window.dbconsole!.api.shortcuts.set(payload))
            return http('/api/shortcuts', { method: 'POST', body: JSON.stringify(payload) })
        },
    },
    connections: {
        list: (opts: { signal?: AbortSignal } = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta[]>(() => window.dbconsole!.api.connections.list())
            return http<ClientConnectionMeta[]>('/api/connections', { method: 'GET', signal: opts.signal })
        },
        create: (draft: ConnectionDraft) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta>(() => window.dbconsole!.api.connections.create(draft))
            return http<ClientConnectionMeta>('/api/connections', { method: 'POST', body: JSON.stringify(draft) })
        },
        update: (id: string, patch: Partial<ConnectionDraft>) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta>(() => window.dbconsole!.api.connections.update(id, patch))
            return http<ClientConnectionMeta>(`/api/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
        },
        delete: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<{ success: true }>(() => window.dbconsole!.api.connections.delete(id))
            return http<{ success: true }>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
        },
        test: (draft: ConnectionDraft) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: boolean; error?: string; issues?: unknown }>(() => window.dbconsole!.api.connections.test(draft))
            return http<{ ok: boolean; error?: string; issues?: unknown }>('/api/connections/test', { method: 'POST', body: JSON.stringify(draft) })
        },
        releasePools: (payload: ReleasePoolsPayload) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: true }>(() => window.dbconsole!.api.connections.releasePools(payload))
            return http<{ ok: true }>('/api/connections/release', { method: 'POST', body: JSON.stringify(payload) })
        },
    },
    namedQueries: {
        list: (opts: { signal?: AbortSignal } = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery[]>(() => window.dbconsole!.api.namedQueries.list())
            return http<ClientNamedQuery[]>('/api/named-queries', { method: 'GET', signal: opts.signal })
        },
        get: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => window.dbconsole!.api.namedQueries.get(id))
            return http<ClientNamedQuery>(`/api/named-queries/${encodeURIComponent(id)}`, { method: 'GET' })
        },
        save: (payload: Omit<ClientNamedQuery, 'id'> & { id?: string }) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => window.dbconsole!.api.namedQueries.save(payload))
            return http<ClientNamedQuery>('/api/named-queries', { method: 'POST', body: JSON.stringify(payload) })
        },
        update: (id: string, patch: Partial<Omit<ClientNamedQuery, 'id'>>) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => window.dbconsole!.api.namedQueries.update(id, patch))
            return http<ClientNamedQuery>(`/api/named-queries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
        },
        delete: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: true }>(() => window.dbconsole!.api.namedQueries.delete(id))
            return http<{ ok: true }>(`/api/named-queries?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        },
    },
    schema: {
        load: (connectionId: string) => {
            if (isDesktopRuntime()) return ipcInvoke<SchemaGraph>(() => window.dbconsole!.api.schema.load(connectionId))
            return http<SchemaGraph>(`/api/schema?connectionId=${encodeURIComponent(connectionId)}`, { method: 'GET' })
        },
    },
    query: {
        run: (payload: RawQueryPayload | NamedQueryPayload) => {
            if (isDesktopRuntime()) return ipcInvoke<QueryResult>(() => window.dbconsole!.api.query.run(payload))
            return http<QueryResult>('/api/query/run', { method: 'POST', body: JSON.stringify(payload) })
        },
        stream: {
            open: (payload: { query: RawQueryPayload | NamedQueryPayload; batchSize?: number }) => {
                if (isDesktopRuntime()) return ipcInvoke<StreamOpenResult>(() => window.dbconsole!.api.query.stream.open(payload))
                return http<StreamOpenResult>('/api/query/stream/open', { method: 'POST', body: JSON.stringify(payload) })
            },
            next: (payload: { streamId: string; batchSize?: number }) => {
                if (isDesktopRuntime()) return ipcInvoke<StreamNextResult>(() => window.dbconsole!.api.query.stream.next(payload))
                return http<StreamNextResult>('/api/query/stream/next', { method: 'POST', body: JSON.stringify(payload) })
            },
            close: (payload: { streamId: string }) => {
                if (isDesktopRuntime()) return ipcInvoke<StreamCloseResult>(() => window.dbconsole!.api.query.stream.close(payload))
                return http<StreamCloseResult>('/api/query/stream/close', { method: 'POST', body: JSON.stringify(payload) })
            },
        },
    },
    diagnostics: {
        slowQueries: (payload: { connectionId: string; sort?: SlowQuerySort; limit?: number }) => {
            if (isDesktopRuntime()) return ipcInvoke<SlowQueryResult>(() => window.dbconsole!.api.diagnostics.slowQueries(payload) as Promise<SlowQueryResult>)
            const params = new URLSearchParams({ connectionId: payload.connectionId })
            if (payload.sort) params.set('sort', payload.sort)
            if (payload.limit !== undefined) params.set('limit', String(payload.limit))
            return http<SlowQueryResult>(`/api/diagnostics/slow-queries?${params.toString()}`, { method: 'GET' })
        },
    },
    history: {
        list: (payload: QueryHistoryFilter = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<QueryHistoryResult>(() => window.dbconsole!.api.history.list(payload) as Promise<QueryHistoryResult>)
            const params = new URLSearchParams()
            if (payload.connectionId) params.set('connectionId', payload.connectionId)
            if (payload.status) params.set('status', payload.status)
            if (payload.kind) params.set('kind', payload.kind)
            if (payload.from) params.set('from', payload.from)
            if (payload.to) params.set('to', payload.to)
            if (payload.search) params.set('search', payload.search)
            if (payload.limit !== undefined) params.set('limit', String(payload.limit))
            if (payload.offset !== undefined) params.set('offset', String(payload.offset))
            const qs = params.toString()
            return http<QueryHistoryResult>(`/api/query/history${qs ? `?${qs}` : ''}`, { method: 'GET' })
        },
    },
    syncer: {
        settings: {
            get: () => {
                if (isDesktopRuntime()) return ipcInvoke<SyncerSettings>(() => window.dbconsole!.api.syncer.settings.get())
                return http<SyncerSettings>('/api/syncer/settings', { method: 'GET' })
            },
            set: (payload: { clear?: boolean; remoteUrl?: string; syncPhrase?: string; syncDeletions?: boolean }) => {
                if (isDesktopRuntime()) return ipcInvoke<{ ok: true }>(() => window.dbconsole!.api.syncer.settings.set(payload))
                return http<{ ok: true }>('/api/syncer/settings', { method: 'POST', body: JSON.stringify(payload) })
            },
        },
        namedQueries: {
            sync: (payload: { resolutions?: NamedQuerySyncResolution[] } = {}) => {
                if (isDesktopRuntime()) return ipcInvoke<NamedQuerySyncOkResult>(() => window.dbconsole!.api.syncer.namedQueries.sync(payload))
                return http<NamedQuerySyncOkResult>('/api/syncer/named-queries', { method: 'POST', body: JSON.stringify(payload) })
            },
        },
    },
}
