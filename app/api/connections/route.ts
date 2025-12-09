import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
    getAllConnections,
    getConnectionById,
    toClientMeta,
    invalidateConnectionsCache,
} from '@/lib/connections'
import {
    insertUiConnection,
    type UiConnectionInsert,
} from '@/lib/meta-db'
import {
    ConnectionDraftSchema,
    type ConnectionDraftInput,
} from '@/lib/connection-schema'

export const runtime = 'nodejs'

export async function GET() {
    const conns = getAllConnections().map(toClientMeta)
    return NextResponse.json(conns)
}

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = ConnectionDraftSchema.parse(json) as ConnectionDraftInput

        const uiInsert: UiConnectionInsert = {
            id: crypto.randomUUID(),
            label: parsed.label,
            host: parsed.host,
            port: typeof parsed.port === 'string' ? Number(parsed.port) : parsed.port,
            database: parsed.database,
            username: parsed.username,
            password: parsed.password,
            readOnly: parsed.readOnly,
        }

        const row = insertUiConnection(uiInsert)
        invalidateConnectionsCache()

        const serverConn = getConnectionById(row.id)
        if (!serverConn) {
            return NextResponse.json({ error: 'Connection created but could not be loaded' }, { status: 500 })
        }

        const client = toClientMeta(serverConn)

        return NextResponse.json(client, { status: 201 })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid connection payload', issues: err.issues }, { status: 400 })
        }
        console.error('Failed to create connection', err)
        return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
    }
}
