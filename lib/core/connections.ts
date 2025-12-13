import { Pool } from 'pg'
import type { ClientConnectionMeta } from '@/lib/connections'
import {
    getAllConnections,
    getConnectionById,
    invalidateConnectionsCache,
    toClientMeta,
} from '@/lib/connections'
import type { ConnectionDraftInput } from '@/lib/connection-schema'
import { deleteUiConnection, insertUiConnection, type UiConnectionInsert, updateUiConnection } from '@/lib/meta-db'
import { closePool, closePoolsForConnection, type PoolMode } from '@/lib/pg-pool'
import { CoreError } from '@/lib/core/errors'

export function listConnections(): ClientConnectionMeta[] {
    return getAllConnections().map(toClientMeta)
}

export function createConnection(draft: ConnectionDraftInput): ClientConnectionMeta {
    const uiInsert: UiConnectionInsert = {
        id: crypto.randomUUID(),
        label: draft.label,
        host: draft.host,
        port: typeof draft.port === 'string' ? Number(draft.port) : draft.port,
        database: draft.database,
        username: draft.username,
        password: draft.password,
        readOnly: draft.readOnly,
    }

    const row = insertUiConnection(uiInsert)
    invalidateConnectionsCache()

    const serverConn = getConnectionById(row.id)
    if (!serverConn) {
        throw new CoreError(500, { error: 'Connection created but could not be loaded' })
    }

    return toClientMeta(serverConn)
}

export type ConnectionUpdatePatch = {
    label?: string
    host?: string
    port?: number | string
    database?: string
    username?: string
    password?: string
    readOnly?: boolean
}

export async function updateConnection(id: string, patch: ConnectionUpdatePatch): Promise<ClientConnectionMeta> {
    const existing = getAllConnections().find((c) => c.id === id)
    if (!existing) {
        throw new CoreError(404, { error: 'Connection not found' })
    }
    if (existing.from !== 'ui') {
        throw new CoreError(400, { error: 'Env connections are read-only' })
    }

    const updated = updateUiConnection(id, {
        label: patch.label,
        host: patch.host,
        port:
            patch.port !== undefined
                ? typeof patch.port === 'string'
                    ? Number(patch.port)
                    : patch.port
                : undefined,
        database: patch.database,
        username: patch.username,
        password: patch.password,
        readOnly: patch.readOnly,
    })

    if (!updated) {
        throw new CoreError(404, { error: 'Connection not found' })
    }

    invalidateConnectionsCache()

    const serverConn = getConnectionById(updated.id)
    if (!serverConn) {
        throw new CoreError(500, { error: 'Connection updated but could not be loaded' })
    }

    await closePoolsForConnection(updated.id)

    return toClientMeta(serverConn)
}

export async function deleteConnection(id: string): Promise<{ success: true }> {
    const existing = getAllConnections().find((c) => c.id === id)
    if (!existing) {
        throw new CoreError(404, { error: 'Connection not found' })
    }
    if (existing.from !== 'ui') {
        throw new CoreError(400, { error: 'Env connections are read-only' })
    }

    deleteUiConnection(id)
    invalidateConnectionsCache()
    await closePoolsForConnection(id)

    return { success: true }
}

function buildConnectionString(input: ConnectionDraftInput): string {
    const host = input.host
    const port = typeof input.port === 'string' ? Number(input.port) : input.port
    const database = input.database
    const user = encodeURIComponent(input.username)
    const pass = encodeURIComponent(input.password)

    return `postgres://${user}:${pass}@${host}:${port}/${database}`
}

export async function testConnection(draft: ConnectionDraftInput): Promise<{ ok: boolean; error?: string }> {
    const connectionString = buildConnectionString(draft)

    const pool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
        query_timeout: 5_000,
        application_name: 'dbconsole',
    })

    try {
        await pool.query('SELECT 1')
        return { ok: true }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection test failed'
        return { ok: false, error: message }
    } finally {
        try {
            await pool.end()
        } catch {
            // ignore
        }
    }
}

export type ReleasePoolsInput = {
    connectionId: string
    poolMode?: PoolMode
    scopeKey?: string
}

export async function releasePools(input: ReleasePoolsInput): Promise<{ ok: true }> {
    const mode: PoolMode = input.poolMode ?? 'shared'

    if (mode === 'shared' || mode === 'single') {
        await closePoolsForConnection(input.connectionId)
    } else {
        await closePool(input.connectionId, mode, input.scopeKey)
    }

    return { ok: true }
}
