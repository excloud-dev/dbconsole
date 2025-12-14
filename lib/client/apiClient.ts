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

function isDesktopRuntime(): boolean {
    return typeof window !== 'undefined' && !!(window as any).dbconsole?.isDesktop
}

function getDesktopApiOrThrow(): any {
    const api = typeof window !== 'undefined' ? (window as any).dbconsole?.api : undefined
    if (!api) {
        throw new ApiError('Desktop API not available (preload missing or failed to load)', 500, {
            error: 'Desktop API not available (preload missing or failed to load)',
        })
    }
    return api
}

function getDesktopIpcFnOrThrow(path: string[], fallbackPaths: string[][] = []): (...args: any[]) => Promise<unknown> {
    const api = getDesktopApiOrThrow()
    const allPaths = [path, ...fallbackPaths]

    for (const p of allPaths) {
        let cur: any = api
        for (const key of p) cur = cur?.[key]
        if (typeof cur === 'function') return cur
    }

    const variants = allPaths.map((p) => `api.${p.join('.')}`).join(' or ')
    throw new ApiError(`Desktop API mismatch: expected ${variants}`, 500, {
        error: `Desktop API mismatch: expected ${variants}`,
    })
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

export type SchemaGraph = {
    tables: { schema: string; name: string }[]
    columns: { table: { schema: string; name: string }; name: string; dataType: string; isNullable: boolean }[]
    foreignKeys: {
        from: { schema: string; name: string }
        fromColumn: string
        to: { schema: string; name: string }
        toColumn: string
    }[]
    primaryKeys: { table: { schema: string; name: string }; columnName: string }[]
}

export type QueryResult = {
    columns: string[]
    rows: Record<string, unknown>[]
    rowCount: number
    durationMs: number
    totalCount?: number
}

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
            if (isDesktopRuntime()) return ipcInvoke<AppInfo>(() => (window as any).dbconsole.api.app.info())
            return http<AppInfo>('/api/app-info', { method: 'GET', signal: opts.signal })
        },
    },
    connections: {
        list: (opts: { signal?: AbortSignal } = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta[]>(() => (window as any).dbconsole.api.connections.list())
            return http<ClientConnectionMeta[]>('/api/connections', { method: 'GET', signal: opts.signal })
        },
        create: (draft: ConnectionDraft) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta>(() => (window as any).dbconsole.api.connections.create(draft))
            return http<ClientConnectionMeta>('/api/connections', { method: 'POST', body: JSON.stringify(draft) })
        },
        update: (id: string, patch: Partial<ConnectionDraft>) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientConnectionMeta>(() => (window as any).dbconsole.api.connections.update(id, patch))
            return http<ClientConnectionMeta>(`/api/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
        },
        delete: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<{ success: true }>(() => (window as any).dbconsole.api.connections.delete(id))
            return http<{ success: true }>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
        },
        test: (draft: ConnectionDraft) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: boolean; error?: string; issues?: unknown }>(() => (window as any).dbconsole.api.connections.test(draft))
            return http<{ ok: boolean; error?: string; issues?: unknown }>('/api/connections/test', { method: 'POST', body: JSON.stringify(draft) })
        },
        releasePools: (payload: ReleasePoolsPayload) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: true }>(() => (window as any).dbconsole.api.connections.releasePools(payload))
            return http<{ ok: true }>('/api/connections/release', { method: 'POST', body: JSON.stringify(payload) })
        },
    },
    namedQueries: {
        list: (opts: { signal?: AbortSignal } = {}) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery[]>(() => (window as any).dbconsole.api.namedQueries.list())
            return http<ClientNamedQuery[]>('/api/named-queries', { method: 'GET', signal: opts.signal })
        },
        get: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => (window as any).dbconsole.api.namedQueries.get(id))
            return http<ClientNamedQuery>(`/api/named-queries/${encodeURIComponent(id)}`, { method: 'GET' })
        },
        save: (payload: Omit<ClientNamedQuery, 'id'> & { id?: string }) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => (window as any).dbconsole.api.namedQueries.save(payload))
            return http<ClientNamedQuery>('/api/named-queries', { method: 'POST', body: JSON.stringify(payload) })
        },
        update: (id: string, patch: Partial<Omit<ClientNamedQuery, 'id'>>) => {
            if (isDesktopRuntime()) return ipcInvoke<ClientNamedQuery>(() => (window as any).dbconsole.api.namedQueries.update(id, patch))
            return http<ClientNamedQuery>(`/api/named-queries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
        },
        delete: (id: string) => {
            if (isDesktopRuntime()) return ipcInvoke<{ ok: true }>(() => (window as any).dbconsole.api.namedQueries.delete(id))
            return http<{ ok: true }>(`/api/named-queries?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        },
    },
    schema: {
        load: (connectionId: string) => {
            if (isDesktopRuntime()) return ipcInvoke<SchemaGraph>(() => (window as any).dbconsole.api.schema.load(connectionId))
            return http<SchemaGraph>(`/api/schema?connectionId=${encodeURIComponent(connectionId)}`, { method: 'GET' })
        },
    },
    query: {
        run: (payload: RawQueryPayload | NamedQueryPayload) => {
            if (isDesktopRuntime()) return ipcInvoke<QueryResult>(() => (window as any).dbconsole.api.query.run(payload))
            return http<QueryResult>('/api/query/run', { method: 'POST', body: JSON.stringify(payload) })
        },
    },
    syncer: {
        settings: {
            get: () => {
                if (isDesktopRuntime()) {
                    const fn = getDesktopIpcFnOrThrow(['syncer', 'settings', 'get'], [['syncer', 'get']])
                    return ipcInvoke<SyncerSettings>(() => fn())
                }
                return http<SyncerSettings>('/api/syncer/settings', { method: 'GET' })
            },
            set: (payload: { clear?: boolean; remoteUrl?: string; syncPhrase?: string; syncDeletions?: boolean }) => {
                if (isDesktopRuntime()) {
                    const fn = getDesktopIpcFnOrThrow(['syncer', 'settings', 'set'], [['syncer', 'set']])
                    return ipcInvoke<{ ok: true }>(() => fn(payload))
                }
                return http<{ ok: true }>('/api/syncer/settings', { method: 'POST', body: JSON.stringify(payload) })
            },
        },
        namedQueries: {
            sync: (payload: { resolutions?: NamedQuerySyncResolution[] } = {}) => {
                if (isDesktopRuntime()) {
                    const fn = getDesktopIpcFnOrThrow(['syncer', 'namedQueries', 'sync'], [['syncer', 'sync']])
                    return ipcInvoke<NamedQuerySyncOkResult>(() => fn(payload))
                }
                return http<NamedQuerySyncOkResult>('/api/syncer/named-queries', { method: 'POST', body: JSON.stringify(payload) })
            },
        },
    },
}
