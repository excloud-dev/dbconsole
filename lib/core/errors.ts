export type CoreErrorBody = {
    error: string
    issues?: unknown
}

export class CoreError extends Error {
    readonly status: number
    readonly body: CoreErrorBody

    constructor(status: number, body: CoreErrorBody) {
        super(body.error)
        this.name = 'CoreError'
        this.status = status
        this.body = body
    }
}

export function isCoreError(err: unknown): err is CoreError {
    return err instanceof CoreError
}

