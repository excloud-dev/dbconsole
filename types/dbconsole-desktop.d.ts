export { }

declare global {
    type DesktopIpcResponse<T> = Promise<T>

    interface Window {
        dbconsole?: {
            isDesktop: boolean
            platform: string
            api: {
                app: {
                    info: () => DesktopIpcResponse<unknown>
                }
                sqlFile: {
                    openDialog: () => DesktopIpcResponse<{ name: string; sql: string } | null>
                }
                connections: {
                    list: () => DesktopIpcResponse<unknown>
                    create: (draft: unknown) => DesktopIpcResponse<unknown>
                    update: (id: string, patch: unknown) => DesktopIpcResponse<unknown>
                    delete: (id: string) => DesktopIpcResponse<unknown>
                    test: (draft: unknown) => DesktopIpcResponse<unknown>
                    releasePools: (payload: unknown) => DesktopIpcResponse<unknown>
                }
                namedQueries: {
                    list: () => DesktopIpcResponse<unknown>
                    get: (id: string) => DesktopIpcResponse<unknown>
                    save: (payload: unknown) => DesktopIpcResponse<unknown>
                    update: (id: string, patch: unknown) => DesktopIpcResponse<unknown>
                    delete: (id: string) => DesktopIpcResponse<unknown>
                }
                schema: {
                    load: (connectionId: string) => DesktopIpcResponse<unknown>
                }
                query: {
                    run: (payload: unknown) => DesktopIpcResponse<unknown>
                }
                syncer: {
                    settings: {
                        get: () => DesktopIpcResponse<unknown>
                        set: (payload: unknown) => DesktopIpcResponse<unknown>
                    }
                    namedQueries: {
                        sync: (payload?: unknown) => DesktopIpcResponse<unknown>
                    }
                }
                updater?: {
                    check: () => DesktopIpcResponse<unknown>
                    install: (payload: unknown) => DesktopIpcResponse<unknown>
                    state: () => DesktopIpcResponse<unknown>
                    history: () => DesktopIpcResponse<unknown>
                    settings: {
                        get: () => DesktopIpcResponse<unknown>
                        set: (settings: unknown) => DesktopIpcResponse<unknown>
                    }
                    token: {
                        exists: () => DesktopIpcResponse<unknown>
                        validate: (token: string) => DesktopIpcResponse<unknown>
                        set: (token: string) => DesktopIpcResponse<unknown>
                    }
                }
                uiPrefs?: {
                    get: (key: string) => DesktopIpcResponse<{ value: unknown }>
                    set: (payload: { key: string; value: unknown }) => DesktopIpcResponse<{ success: boolean }>
                }
            }
            events: {
                onSqlFileOpen: (handler: (payload: { name?: string; sql: string }) => void) => () => void
                onMenuAbout?: (handler: () => void) => () => void
                onMenuCheckUpdates?: (handler: () => void) => () => void
                onMenuUpdateSettings?: (handler: () => void) => () => void
                onMenuSyncNow?: (handler: () => void) => () => void
                onMenuSyncSettings?: (handler: () => void) => () => void
                onMenuSidebarActionsShowOnHover?: (handler: (payload: { enabled: boolean }) => void) => () => void
            }
        }
    }
}
