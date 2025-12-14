import { app, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { listConnections, createConnection, deleteConnection, releasePools, testConnection, updateConnection } from '@/lib/core/connections'
import { listAllNamedQueries, getOneNamedQuery, removeNamedQuery, saveNamedQuery } from '@/lib/core/named-queries'
import { syncNamedQueriesWithServer, type NamedQuerySyncResolution } from '@/lib/core/named-queries-sync'
import {
    clearSyncerSettings,
    getSyncerSettings,
    getSyncerSyncDeletions,
    getSyncerPhraseOrThrow,
    getSyncerRemoteUrlOrThrow,
    setSyncerPhrase,
    setSyncerRemoteUrl,
    setSyncerSyncDeletions,
} from '@/lib/core/syncer-settings'
import { runApiQuery } from '@/lib/core/query'
import { loadSchema } from '@/lib/core/schema'
import { isCoreError } from '@/lib/core/errors'
import { ConnectionDraftSchema, type ConnectionDraftInput } from '@/lib/connection-schema'
import type { NamedQueryInput, RawQueryInput } from '@/lib/query-engine'
import { readSqlFileOrThrow } from './sql-file-open.cjs'
import {
    OverridesRecordSchema,
    getShortcutsKeymap,
    resetAllShortcutsOverrides,
    resetShortcutsOverride,
    setShortcutsKeymap,
    setShortcutsOverride,
} from '@/lib/core/shortcuts-settings'

type IpcResponse = { status: number; body: unknown }

function ok(body: unknown, status = 200): IpcResponse {
    return { status, body }
}

function err(status: number, body: unknown): IpcResponse {
    return { status, body }
}

function coreErrorToResponse(e: unknown): IpcResponse | null {
    if (!isCoreError(e)) return null
    return err(e.status, e.body)
}

function readBuildInfo(): { sha?: string; shaShort?: string; time?: string } | null {
    try {
        // In packaged app, build-info.json is in the app root
        // In dev, it's in dist/electron/build-info.json relative to project root
        const buildInfoPath = app.isPackaged
            ? path.join(app.getAppPath(), 'build-info.json')
            : path.join(app.getAppPath(), 'dist', 'electron', 'build-info.json')
        const raw = fs.readFileSync(buildInfoPath, 'utf8')
        return JSON.parse(raw) as { sha?: string; shaShort?: string; time?: string }
    } catch {
        return null
    }
}

function tryGetDevGitShaShort(): string | undefined {
    if (app.isPackaged) return undefined
    try {
        const out = execSync('git rev-parse --short HEAD', { cwd: app.getAppPath(), stdio: ['ignore', 'pipe', 'ignore'] })
        return String(out).trim() || undefined
    } catch {
        return undefined
    }
}

const PoolModeSchema = z.enum(['single', 'shared', 'per-scope']).optional()

const RawQuerySchema = z.object({
    kind: z.literal('raw'),
    sql: z.string().min(1),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    params: z.array(z.any()).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
})

const NamedQuerySchema = z.object({
    kind: z.literal('named'),
    queryId: z.string().min(1),
    params: z.record(z.any()).default({}),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
})

const QueryRunBodySchema = z.union([RawQuerySchema, NamedQuerySchema])

const ConnectionUpdateSchema = z.object({
    label: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
    database: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    readOnly: z.boolean().optional(),
})

const ReleasePoolsSchema = z.object({
    connectionId: z.string().min(1),
    poolMode: z.enum(['single', 'shared', 'per-scope']).optional(),
    scopeKey: z.string().min(1).optional(),
})

const SaveNamedQuerySchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    sqlTemplate: z.string().min(1),
    params: z.array(
        z.object({
            name: z.string().min(1),
            type: z.enum(['string', 'number', 'boolean']),
            defaultValue: z.string().optional(),
        }),
    ),
    defaultConnectionId: z.string().optional(),
})

const UpdateNamedQuerySchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    sqlTemplate: z.string().min(1).optional(),
    params: z
        .array(
            z.object({
                name: z.string().min(1),
                type: z.enum(['string', 'number', 'boolean']),
                defaultValue: z.string().optional(),
            }),
        )
        .optional(),
    defaultConnectionId: z.string().optional(),
})

const SyncResolutionSchema: z.ZodType<NamedQuerySyncResolution> = z.discriminatedUnion('action', [
    z.object({ conflictKey: z.string().min(1), action: z.literal('keep-remote') }),
    z.object({ conflictKey: z.string().min(1), action: z.literal('keep-local') }),
    z.object({ conflictKey: z.string().min(1), action: z.literal('rename-local'), newName: z.string().min(1) }),
])

const RuntimeSchema = z.enum(['web', 'desktop'])

const ShortcutsPayloadSchema = z.object({
    overrides: z
        .object({
            web: OverridesRecordSchema.optional(),
            desktop: OverridesRecordSchema.optional(),
        })
        .partial()
        .optional(),
    runtime: RuntimeSchema.optional(),
    commandId: z.string().optional(),
    binding: z.union([z.string().min(1), z.null()]).optional(),
    reset: z.boolean().optional(),
    resetAll: z.boolean().optional(),
})

export function registerDesktopIpcHandlers(): void {
    ipcMain.handle('dbconsole:app:info', () => {
        const buildInfo = readBuildInfo()
        return ok({
            version: app.getVersion(),
            buildSha: buildInfo?.shaShort ?? buildInfo?.sha ?? tryGetDevGitShaShort(),
            buildTime: buildInfo?.time,
            platform: process.platform,
            arch: process.arch,
            runtime: {
                electron: process.versions.electron,
                node: process.versions.node,
                chrome: process.versions.chrome,
            },
        })
    })

    ipcMain.handle('dbconsole:connections:list', () => {
        return ok(listConnections())
    })

    ipcMain.handle('dbconsole:connections:create', (_evt, payload: unknown) => {
        try {
            const parsed = ConnectionDraftSchema.parse(payload) as ConnectionDraftInput
            const created = createConnection(parsed)
            return ok(created, 201)
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid connection payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to create connection' })
        }
    })

    ipcMain.handle('dbconsole:connections:update', async (_evt, payload: unknown) => {
        const schema = z.object({ id: z.string().min(1), patch: ConnectionUpdateSchema })
        try {
            const parsed = schema.parse(payload)
            const updated = await updateConnection(parsed.id, parsed.patch)
            return ok(updated)
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid connection payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to update connection' })
        }
    })

    ipcMain.handle('dbconsole:connections:delete', async (_evt, payload: unknown) => {
        const schema = z.object({ id: z.string().min(1) })
        try {
            const parsed = schema.parse(payload)
            return ok(await deleteConnection(parsed.id))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to delete connection' })
        }
    })

    ipcMain.handle('dbconsole:connections:test', async (_evt, payload: unknown) => {
        try {
            const parsed = ConnectionDraftSchema.parse(payload) as ConnectionDraftInput
            return ok(await testConnection(parsed))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { ok: false, error: 'Invalid connection payload', issues: e.issues })
            return err(400, { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' })
        }
    })

    ipcMain.handle('dbconsole:pools:release', async (_evt, payload: unknown) => {
        try {
            const parsed = ReleasePoolsSchema.parse(payload)
            return ok(await releasePools(parsed))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid payload', issues: e.issues })
            return err(500, { error: 'Failed to release pool' })
        }
    })

    ipcMain.handle('dbconsole:namedQueries:list', () => {
        return ok(listAllNamedQueries())
    })

    ipcMain.handle('dbconsole:namedQueries:get', (_evt, payload: unknown) => {
        const schema = z.object({ id: z.string().min(1) })
        try {
            const parsed = schema.parse(payload)
            return ok(getOneNamedQuery(parsed.id))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to load named query' })
        }
    })

    ipcMain.handle('dbconsole:namedQueries:save', (_evt, payload: unknown) => {
        try {
            const parsed = SaveNamedQuerySchema.parse(payload)
            return ok(saveNamedQuery(parsed))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid named query payload', issues: e.issues })
            return err(500, { error: 'Failed to save named query' })
        }
    })

    ipcMain.handle('dbconsole:namedQueries:update', (_evt, payload: unknown) => {
        const schema = z.object({ id: z.string().min(1), patch: UpdateNamedQuerySchema })
        try {
            const parsed = schema.parse(payload)
            const existing = getOneNamedQuery(parsed.id)
            return ok(
                saveNamedQuery({
                    id: existing.id,
                    name: parsed.patch.name ?? existing.name,
                    description: parsed.patch.description ?? existing.description,
                    sqlTemplate: parsed.patch.sqlTemplate ?? existing.sqlTemplate,
                    params: parsed.patch.params ?? existing.params,
                    defaultConnectionId: parsed.patch.defaultConnectionId ?? existing.defaultConnectionId,
                }),
            )
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid named query payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to update named query' })
        }
    })

    ipcMain.handle('dbconsole:namedQueries:delete', (_evt, payload: unknown) => {
        const schema = z.object({ id: z.string().min(1) })
        try {
            const parsed = schema.parse(payload)
            getOneNamedQuery(parsed.id)
            removeNamedQuery(parsed.id)
            return ok({ success: true })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid payload', issues: e.issues })
            const mapped = coreErrorToResponse(e)
            if (mapped) return mapped
            return err(500, { error: 'Failed to delete named query' })
        }
    })

    ipcMain.handle('dbconsole:schema:load', async (_evt, payload: unknown) => {
        const schema = z.object({ connectionId: z.string().min(1) })
        try {
            const parsed = schema.parse(payload)
            return ok(await loadSchema(parsed.connectionId))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'connectionId is required' })
            return err(400, { error: e instanceof Error ? e.message : 'Failed to load schema' })
        }
    })

    ipcMain.handle('dbconsole:query:run', async (_evt, payload: unknown) => {
        try {
            const parsed = QueryRunBodySchema.parse(payload)
            return ok(await runApiQuery(parsed as RawQueryInput | NamedQueryInput))
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid query payload', issues: e.issues })
            const message = e instanceof Error ? e.message : 'Query failed'
            return err(400, { error: message })
        }
    })

    ipcMain.handle('dbconsole:sqlFile:openDialog', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'SQL', extensions: ['sql'] }],
        })

        if (result.canceled || !result.filePaths?.length) {
            return ok(null)
        }

        const filePath = result.filePaths[0]
        try {
            const sql = readSqlFileOrThrow(filePath)
            return ok({ name: path.basename(filePath), sql })
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to open SQL file'
            return err(400, { error: message })
        }
    })

    ipcMain.handle('dbconsole:shortcuts:get', () => {
        return ok({
            version: 1,
            overrides: {
                web: getShortcutsKeymap('web'),
                desktop: getShortcutsKeymap('desktop'),
            },
        })
    })

    ipcMain.handle('dbconsole:shortcuts:set', (_evt, payload: unknown) => {
        try {
            const parsed = ShortcutsPayloadSchema.parse(payload)

            if (parsed.overrides && Object.keys(parsed.overrides).length > 0) {
                if (parsed.overrides.web) setShortcutsKeymap('web', parsed.overrides.web)
                if (parsed.overrides.desktop) setShortcutsKeymap('desktop', parsed.overrides.desktop)
                return ok({ ok: true })
            }

            if (parsed.runtime) {
                const rt = parsed.runtime
                if (parsed.resetAll) {
                    resetAllShortcutsOverrides(rt)
                    return ok({ ok: true })
                }

                if (parsed.commandId) {
                    if (parsed.reset) {
                        resetShortcutsOverride(rt, parsed.commandId as any)
                        return ok({ ok: true })
                    }
                    if (parsed.binding !== undefined) {
                        setShortcutsOverride(rt, parsed.commandId as any, parsed.binding)
                        return ok({ ok: true })
                    }
                }
            }

            return err(400, { error: 'Invalid shortcuts payload' })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid shortcuts payload', issues: e.issues })
            return err(500, { error: 'Failed to save shortcuts' })
        }
    })

    // --- Syncer (E2E named query sync) ---

    ipcMain.handle('dbconsole:syncer:settings:get', () => {
        return ok(getSyncerSettings())
    })

    ipcMain.handle('dbconsole:syncer:settings:set', (_evt, payload: unknown) => {
        const schema = z.object({
            clear: z.boolean().optional(),
            remoteUrl: z.string().url().optional(),
            syncPhrase: z.string().min(1).optional(),
            syncDeletions: z.boolean().optional(),
        })
        try {
            const parsed = schema.parse(payload)
            if (parsed.clear) {
                clearSyncerSettings()
                return ok({ ok: true })
            }
            if (parsed.remoteUrl !== undefined) setSyncerRemoteUrl(parsed.remoteUrl)
            if (parsed.syncPhrase !== undefined) setSyncerPhrase(parsed.syncPhrase)
            if (parsed.syncDeletions !== undefined) setSyncerSyncDeletions(parsed.syncDeletions)
            return ok({ ok: true })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid sync settings', issues: e.issues })
            return err(500, { error: 'Failed to save sync settings' })
        }
    })

    ipcMain.handle('dbconsole:syncer:namedQueries:sync', async (_evt, payload: unknown) => {
        const schema = z.object({ resolutions: z.array(SyncResolutionSchema).optional() })

        let remoteUrl: string
        let syncPhrase: string
        try {
            remoteUrl = getSyncerRemoteUrlOrThrow()
            syncPhrase = getSyncerPhraseOrThrow()
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Missing sync settings'
            return err(400, { error: message })
        }

        try {
            const parsed = schema.parse(payload)
            const result = await syncNamedQueriesWithServer({
                remoteUrl,
                syncPhrase,
                syncDeletions: getSyncerSyncDeletions(),
                resolutions: parsed.resolutions,
            })
            if (result.status === 'conflict') {
                return err(409, { error: 'Conflicts', remoteVersion: result.remoteVersion, conflicts: result.conflicts })
            }
            return ok(result)
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid sync payload', issues: e.issues })
            const message = e instanceof Error ? e.message : 'Sync failed'
            return err(500, { error: message })
        }
    })
}
