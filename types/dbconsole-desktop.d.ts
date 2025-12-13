export {}

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
            }
        }
    }
}
