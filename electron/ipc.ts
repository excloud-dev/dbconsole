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
import { ElectronUpdater } from '@/lib/updater/electron-updater'
import type { UpdateSettings as CoreUpdateSettings, TimeWindow } from '@/lib/updater/types'

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

type UiMaintenanceWindow = {
    enabled: boolean
    startTime: string // HH:MM
    endTime: string // HH:MM
    timezone: string
}

type UiUpdateSettings = {
    autoCheck: boolean
    autoInstall: boolean
    checkInterval: number // hours
    updateChannel: 'latest' | 'prerelease' | 'custom'
    customTagPattern?: string
    maintenanceWindow?: UiMaintenanceWindow
}

function parseHourFromTimeString(time: string): number {
    const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(time)
    if (!match) throw new Error(`Invalid time format: ${time}`)
    const hour = Number(match[1])
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Invalid hour: ${time}`)
    return hour
}

function pad2(n: number): string {
    return String(n).padStart(2, '0')
}

function hourToTimeString(hour: number): string {
    return `${pad2(hour)}:00`
}

function uiMaintenanceToCore(mw: UiMaintenanceWindow | undefined): TimeWindow | undefined {
    if (!mw || !mw.enabled) return undefined
    const startHour = parseHourFromTimeString(mw.startTime)
    const endHour = parseHourFromTimeString(mw.endTime)
    return {
        startHour,
        endHour,
        // UI currently doesn't expose day selection; default to every day.
        days: [0, 1, 2, 3, 4, 5, 6]
    }
}

function coreMaintenanceToUi(mw: TimeWindow | undefined): UiMaintenanceWindow | undefined {
    if (!mw) return undefined
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return {
        enabled: true,
        startTime: hourToTimeString(mw.startHour),
        endTime: hourToTimeString(mw.endHour),
        timezone
    }
}

function coreToUiSettings(settings: CoreUpdateSettings): UiUpdateSettings {
    return {
        autoCheck: settings.autoCheck,
        autoInstall: settings.autoInstall,
        checkInterval: settings.checkInterval,
        updateChannel: settings.updateChannel,
        customTagPattern: settings.customTagPattern,
        maintenanceWindow: coreMaintenanceToUi(settings.maintenanceWindow)
    }
}

function mergeUiPatchIntoCoreSettings(current: CoreUpdateSettings, patch: Partial<UiUpdateSettings>): CoreUpdateSettings {
    const next: CoreUpdateSettings = {
        ...current,
        ...patch,
        customTagPattern: patch.customTagPattern === '' ? undefined : patch.customTagPattern ?? current.customTagPattern,
        maintenanceWindow: patch.maintenanceWindow ? uiMaintenanceToCore(patch.maintenanceWindow) : current.maintenanceWindow
    }

    // If maintenance window patch disables, clear it.
    if (patch.maintenanceWindow && patch.maintenanceWindow.enabled === false) {
        next.maintenanceWindow = undefined
    }

    return next
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

// Initialize updater (will be set up in registerDesktopIpcHandlers)
let electronUpdater: ElectronUpdater | null = null

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
    // Initialize the Electron updater
    // Allow overrides via env vars for forks/private deployments.
    const repoOwner = (process.env.GITHUB_REPO_OWNER || process.env.DBCONSOLE_GITHUB_OWNER || 'excloud-in').trim()
    const repoName = (process.env.GITHUB_REPO_NAME || process.env.DBCONSOLE_GITHUB_REPO || 'dbconsole').trim()

    electronUpdater = new ElectronUpdater({
        owner: repoOwner,
        repo: repoName,
        // The current updater flow downloads GitHub release assets directly.
        // Disable electron-updater integration by default until a publish provider
        // is configured and we're actually using autoUpdater for downloads.
        enableElectronUpdater: false,
        // Don't auto-restart; the installer handoff flow requires the user to complete
        // the OS-level install and then relaunch the app.
        quitAndInstall: false,
        // Respect user intent: only check when invoked from the UI/menu unless enabled later.
        checkOnStartup: false,
        autoStart: false
    })

    // Initialize the updater
    electronUpdater.initialize().catch(error => {
        console.error('Failed to initialize updater:', error)
    })
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

    // --- Update System ---

    ipcMain.handle('dbconsole:updater:check', async () => {
        if (!electronUpdater) {
            return err(500, { error: 'Updater not initialized' })
        }

        try {
            const updateInfo = await electronUpdater.checkForUpdates()
            return ok(updateInfo)
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Update check failed'
            return err(500, { error: message })
        }
    })

    ipcMain.handle('dbconsole:updater:install', async (_evt, payload: unknown) => {
        if (!electronUpdater) {
            return err(500, { error: 'Updater not initialized' })
        }

        const schema = z.object({
            version: z.string().min(1),
            releaseNotes: z.string(),
            downloadUrl: z.string().url(),
            checksum: z.string(),
            publishedAt: z.string(),
            isPrerelease: z.boolean()
        })

        try {
            const parsed = schema.parse(payload)
            const updateInfo = {
                ...parsed,
                publishedAt: new Date(parsed.publishedAt)
            }

            await electronUpdater.downloadAndInstall(updateInfo)
            return ok({ success: true })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid update info', issues: e.issues })
            const message = e instanceof Error ? e.message : 'Installation failed'
            return err(500, { error: message })
        }
    })

    ipcMain.handle('dbconsole:updater:state', () => {
        if (!electronUpdater) {
            return err(500, { error: 'Updater not initialized' })
        }

        try {
            const state = electronUpdater.getState()
            return ok(state)
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to get updater state'
            return err(500, { error: message })
        }
    })

    ipcMain.handle('dbconsole:updater:history', async () => {
        if (!electronUpdater) {
            return err(500, { error: 'Updater not initialized' })
        }

        try {
            const history = await electronUpdater.getUpdateHistory()
            return ok(history)
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to get update history'
            return err(500, { error: message })
        }
    })

    ipcMain.handle('dbconsole:updater:settings:get', async () => {
        try {
            if (!electronUpdater) {
                // Return defaults with autoCheck disabled by default
                return ok({
                    autoCheck: false,
                    autoInstall: false,
                    checkInterval: 24,
                    updateChannel: 'latest'
                } satisfies UiUpdateSettings)
            }

            const coreSettings = await electronUpdater.getUpdateSettings()
            return ok(coreToUiSettings(coreSettings))
        } catch (e) {
            return ok({
                autoCheck: false,
                autoInstall: false,
                checkInterval: 24,
                updateChannel: 'latest'
            } satisfies UiUpdateSettings)
        }
    })

    ipcMain.handle('dbconsole:updater:settings:set', async (_evt, payload: unknown) => {
        if (!electronUpdater) {
            return err(500, { error: 'Updater not initialized' })
        }

        const schema = z.object({
            autoCheck: z.boolean().optional(),
            autoInstall: z.boolean().optional(),
            checkInterval: z.number().int().positive().optional(),
            updateChannel: z.enum(['latest', 'prerelease', 'custom']).optional(),
            customTagPattern: z.string().optional(),
            maintenanceWindow: z
                .object({
                    enabled: z.boolean(),
                    startTime: z.string(),
                    endTime: z.string(),
                    timezone: z.string()
                })
                .optional()
        })

        try {
            const parsed = schema.parse(payload)

            const current = await electronUpdater.getUpdateSettings()
            const merged = mergeUiPatchIntoCoreSettings(current, parsed)
            await electronUpdater.setUpdateSettings(merged)

            return ok({ success: true, settings: coreToUiSettings(merged) })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid settings', issues: e.issues })
            return err(500, { error: e instanceof Error ? e.message : 'Failed to save settings' })
        }
    })

    ipcMain.handle('dbconsole:updater:token:validate', async (_evt, payload: unknown) => {
        const schema = z.object({
            token: z.string().min(1)
        })

        try {
            const parsed = schema.parse(payload)

            // Test the token by making a GitHub API call
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${parsed.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'DBConsole-Updater/1.0.0'
                }
            })

            if (response.status === 401) {
                return ok({ valid: false, error: 'Invalid or expired token' })
            }

            if (!response.ok) {
                return ok({ valid: false, error: `GitHub API error: ${response.status} ${response.statusText}` })
            }

            // Check token scopes
            const scopes = response.headers.get('x-oauth-scopes')
            const scopeList = scopes ? scopes.split(',').map(s => s.trim()).filter(s => s.length > 0) : []
            const hasRepoScope = scopeList.includes('repo')

            if (!hasRepoScope) {
                return ok({
                    valid: false,
                    error: 'Token needs "repo" scope for private repository access',
                    scopes: scopeList
                })
            }

            return ok({
                valid: true,
                scopes: scopeList,
                message: 'Token is valid and has required permissions'
            })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid token format', issues: e.issues })
            return err(500, { error: 'Failed to validate token' })
        }
    })

    ipcMain.handle('dbconsole:updater:token:exists', async () => {
        try {
            if (!electronUpdater) return ok({ exists: false })
            const token = await electronUpdater.getGitHubToken()
            return ok({ exists: !!token })
        } catch (e) {
            return ok({ exists: false })
        }
    })

    ipcMain.handle('dbconsole:updater:token:set', async (_evt, payload: unknown) => {
        const schema = z.object({
            token: z.string().min(1)
        })

        try {
            const parsed = schema.parse(payload)

            if (!electronUpdater) {
                return err(500, { error: 'Updater not initialized' })
            }

            await electronUpdater.setGitHubToken(parsed.token)
            return ok({ success: true })
        } catch (e) {
            if (e instanceof z.ZodError) return err(400, { error: 'Invalid token', issues: e.issues })
            return err(500, { error: e instanceof Error ? e.message : 'Failed to save token' })
        }
    })
}
