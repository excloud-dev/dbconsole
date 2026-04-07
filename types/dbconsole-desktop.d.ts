// Ambient declaration for the Electron preload bridge mounted at
// `window.dbconsole`. Source of truth for the runtime surface lives in
// `electron/preload.cjs`; the runtime payload shapes live in
// `lib/client/apiClient.ts` and `lib/ipc/schemas.ts`.
//
// Keep this file in sync when adding/removing IPC channels in
// `electron/ipc.ts` + `electron/preload.cjs`.

import type {
    AppInfo,
    ClientConnectionMeta,
    ClientNamedQuery,
    ConnectionDraft,
    NamedQuerySyncOkResult,
    NamedQuerySyncResolution,
    QueryResult,
    RawQueryPayload,
    NamedQueryPayload,
    ReleasePoolsPayload,
    SchemaGraph,
    StreamCloseResult,
    StreamNextResult,
    StreamOpenResult,
    SyncerSettings,
} from '@/lib/client/apiClient'

export { }

declare global {
    type DesktopIpcResponse<T> = Promise<T>

    type DesktopShortcutsPayload = {
        overrides?: { web?: Record<string, unknown>; desktop?: Record<string, unknown> }
        runtime?: 'web' | 'desktop'
        commandId?: string
        binding?: string | null
        disabled?: boolean
        reset?: boolean
        resetAll?: boolean
    }

    type DesktopShortcutsState = {
        version: number
        overrides: { web: Record<string, unknown>; desktop: Record<string, unknown> }
    }

    interface DbconsoleBridge {
        isDesktop: boolean
        platform: string
        api: {
            app: {
                info: () => DesktopIpcResponse<AppInfo>
            }
            sqlFile: {
                openDialog: () => DesktopIpcResponse<{ name: string; sql: string } | null>
            }
            connections: {
                list: () => DesktopIpcResponse<ClientConnectionMeta[]>
                create: (draft: ConnectionDraft) => DesktopIpcResponse<ClientConnectionMeta>
                update: (id: string, patch: Partial<ConnectionDraft>) => DesktopIpcResponse<ClientConnectionMeta>
                delete: (id: string) => DesktopIpcResponse<{ success: true }>
                test: (draft: ConnectionDraft) => DesktopIpcResponse<{ ok: boolean; error?: string; issues?: unknown }>
                releasePools: (payload: ReleasePoolsPayload) => DesktopIpcResponse<{ ok: true }>
            }
            namedQueries: {
                list: () => DesktopIpcResponse<ClientNamedQuery[]>
                get: (id: string) => DesktopIpcResponse<ClientNamedQuery>
                save: (payload: Omit<ClientNamedQuery, 'id'> & { id?: string }) => DesktopIpcResponse<ClientNamedQuery>
                update: (id: string, patch: Partial<Omit<ClientNamedQuery, 'id'>>) => DesktopIpcResponse<ClientNamedQuery>
                delete: (id: string) => DesktopIpcResponse<{ ok: true }>
            }
            schema: {
                load: (connectionId: string) => DesktopIpcResponse<SchemaGraph>
            }
            query: {
                run: (payload: RawQueryPayload | NamedQueryPayload) => DesktopIpcResponse<QueryResult>
                stream: {
                    open: (payload: { query: RawQueryPayload | NamedQueryPayload; batchSize?: number }) => DesktopIpcResponse<StreamOpenResult>
                    next: (payload: { streamId: string; batchSize?: number }) => DesktopIpcResponse<StreamNextResult>
                    close: (payload: { streamId: string }) => DesktopIpcResponse<StreamCloseResult>
                }
            }
            diagnostics: {
                slowQueries: (payload: { connectionId: string; sort?: 'mean_time' | 'total_time' | 'calls' | 'rows'; limit?: number }) => DesktopIpcResponse<unknown>
            }
            history: {
                list: (payload?: {
                    connectionId?: string
                    status?: 'ok' | 'error' | 'timeout'
                    kind?: 'raw' | 'named'
                    from?: string
                    to?: string
                    search?: string
                    limit?: number
                    offset?: number
                }) => DesktopIpcResponse<unknown>
            }
            shortcuts: {
                get: () => DesktopIpcResponse<DesktopShortcutsState>
                set: (payload: DesktopShortcutsPayload) => DesktopIpcResponse<{ ok: true }>
            }
            syncer: {
                settings: {
                    get: () => DesktopIpcResponse<SyncerSettings>
                    set: (payload: { clear?: boolean; remoteUrl?: string; syncPhrase?: string; syncDeletions?: boolean }) => DesktopIpcResponse<{ ok: true }>
                }
                namedQueries: {
                    sync: (payload?: { resolutions?: NamedQuerySyncResolution[] }) => DesktopIpcResponse<NamedQuerySyncOkResult>
                }
            }
            // Updater types intentionally left loose — the canonical shapes
            // live in lib/updater/types and are only consumed by a couple of
            // dialogs that cast at the boundary.
            updater?: {
                check: () => DesktopIpcResponse<any>
                install: (payload: any) => DesktopIpcResponse<any>
                state: () => DesktopIpcResponse<any>
                history: () => DesktopIpcResponse<any>
                settings: {
                    get: () => DesktopIpcResponse<any>
                    set: (settings: any) => DesktopIpcResponse<any>
                }
                token: {
                    exists: () => DesktopIpcResponse<any>
                    validate: (token: string) => DesktopIpcResponse<any>
                    set: (token: string) => DesktopIpcResponse<any>
                }
            }
            uiPrefs?: {
                get: (key: string) => DesktopIpcResponse<any>
                set: (payload: { key: string; value: unknown }) => DesktopIpcResponse<any>
            }
        }
        events: {
            onSqlFileOpen: (handler: (payload: { name?: string; sql: string }) => void) => () => void
            onMenuAbout: (handler: () => void) => () => void
            onMenuCheckUpdates: (handler: () => void) => () => void
            onMenuUpdateSettings: (handler: () => void) => () => void
            onMenuSyncNow: (handler: () => void) => () => void
            onMenuSyncSettings: (handler: () => void) => () => void
            onMenuSidebarActionsShowOnHover: (handler: (payload: { enabled: boolean }) => void) => () => void
            onMenuTheme: (handler: (payload: { theme: 'light' | 'dark' | 'system' }) => void) => () => void
            onMenuQueryHistory: (handler: () => void) => () => void
            onMenuSlowQueries: (handler: () => void) => () => void
            onMenuSchemaGraph: (handler: () => void) => () => void
        }
    }

    interface Window {
        dbconsole?: DbconsoleBridge
    }
}
