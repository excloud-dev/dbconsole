import type { Pool } from 'pg'
import { listUiConnections, type UiConnectionRow } from '@/lib/meta-db'

export type ConnectionOrigin = 'env' | 'ui'

export type ServerDbConnection = {
    id: string
    label: string
    kind: 'postgres'
    from: ConnectionOrigin
    readOnly: boolean
    // server-only, never sent to client
    url: string
    // non-secret connection metadata (safe to send to client)
    host?: string
    port?: number
    database?: string
    username?: string
}

export type ClientConnectionMeta = {
    id: string
    label: string
    kind: 'postgres'
    from: ConnectionOrigin
    readOnly: boolean
    host?: string
    port?: number
    database?: string
    username?: string
}

export function toClientMeta(conn: ServerDbConnection): ClientConnectionMeta {
    return {
        id: conn.id,
        label: conn.label,
        kind: conn.kind,
        from: conn.from,
        readOnly: conn.readOnly,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
    }
}

function buildUrlFromUiRow(row: UiConnectionRow): string {
    const hostPort = `${row.host}:${row.port}`
    const user = encodeURIComponent(row.username)
    const pass = encodeURIComponent(row.password)
    return `postgres://${user}:${pass}@${hostPort}/${row.database}`
}

function parseEnvConnectionsJson(): ServerDbConnection[] {
    const raw = process.env.DBCONSOLE_CONNECTIONS_JSON
    if (!raw || !raw.trim()) return []

    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []

        const mapped: ServerDbConnection[] = []

        for (const item of parsed) {
            if (!item || typeof item !== 'object') continue
            const anyItem: any = item
            if (typeof anyItem.id !== 'string') continue
            if (typeof anyItem.label !== 'string') continue
            if (typeof anyItem.url !== 'string') continue

            const readOnly =
                typeof anyItem.readOnly === 'boolean'
                    ? anyItem.readOnly
                    : typeof anyItem.read_only === 'boolean'
                        ? anyItem.read_only
                        : true

            mapped.push({
                id: anyItem.id,
                label: anyItem.label,
                kind: 'postgres',
                from: 'env',
                readOnly,
                url: anyItem.url,
                ...(() => {
                    try {
                        const u = new URL(anyItem.url)
                        return {
                            host: u.hostname || undefined,
                            port: u.port ? Number(u.port) : 5432,
                            database: u.pathname ? u.pathname.replace(/^\//, '') : undefined,
                            username: u.username || undefined,
                        }
                    } catch {
                        return {}
                    }
                })(),
            })
        }

        return mapped
    } catch {
        // Invalid JSON; fail closed with no env connections.
        return []
    }
}

export function loadEnvConnections(): ServerDbConnection[] {
    return parseEnvConnectionsJson()
}

export function loadUiConnections(): ServerDbConnection[] {
    const rows = listUiConnections()
    return rows.map<ServerDbConnection>((row) => ({
        id: row.id,
        label: row.label,
        kind: 'postgres',
        from: 'ui',
        readOnly: row.readOnly,
        url: buildUrlFromUiRow(row),
        host: row.host,
        port: row.port,
        database: row.database,
        username: row.username,
    }))
}

let _allConnectionsCache: ServerDbConnection[] | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 5_000

export function getAllConnections(): ServerDbConnection[] {
    const now = Date.now()
    if (_allConnectionsCache && now - _cacheTimestamp < CACHE_TTL_MS) {
        return _allConnectionsCache
    }

    const envConns = loadEnvConnections()
    const uiConns = loadUiConnections()
    _allConnectionsCache = [...envConns, ...uiConns]
    _cacheTimestamp = now
    return _allConnectionsCache
}

export function invalidateConnectionsCache(): void {
    _allConnectionsCache = null
    _cacheTimestamp = 0
}

export function getConnectionById(id: string): ServerDbConnection | undefined {
    const all = getAllConnections()
    return all.find((c) => c.id === id)
}

// Optional: a WeakMap for connection-specific pg Pools could live here; the actual
// Pool creation will be handled in a separate pg helper module.
export type PgPoolFactory = (conn: ServerDbConnection) => Pool
