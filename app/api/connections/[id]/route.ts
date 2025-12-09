import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAllConnections, getConnectionById, invalidateConnectionsCache, toClientMeta } from '@/lib/connections'
import { updateUiConnection, deleteUiConnection } from '@/lib/meta-db'

export const runtime = 'nodejs'

const ConnectionUpdateSchema = z.object({
    label: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
    database: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    readOnly: z.boolean().optional(),
})

export async function PUT(
    req: Request,
    { params }: { params: { id: string } },
) {
    const id = params.id

    // Only UI connections can be updated.
    const existing = getAllConnections().find((c) => c.id === id)
    if (!existing) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
    if (existing.from !== 'ui') {
        return NextResponse.json({ error: 'Env connections are read-only' }, { status: 400 })
    }

    try {
        const json = await req.json()
        const parsed = ConnectionUpdateSchema.parse(json)

        const updated = updateUiConnection(id, {
            label: parsed.label,
            host: parsed.host,
            port: parsed.port !== undefined ? (typeof parsed.port === 'string' ? Number(parsed.port) : parsed.port) : undefined,
            database: parsed.database,
            username: parsed.username,
            password: parsed.password,
            readOnly: parsed.readOnly,
        })

        if (!updated) {
            return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
        }

        invalidateConnectionsCache()

        const serverConn = getConnectionById(updated.id)
        if (!serverConn) {
            return NextResponse.json({ error: 'Connection updated but could not be loaded' }, { status: 500 })
        }

        return NextResponse.json(toClientMeta(serverConn))
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid connection payload', issues: err.issues }, { status: 400 })
        }
        console.error('Failed to update connection', err)
        return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 })
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: { id: string } },
) {
    const id = params.id

    const existing = getAllConnections().find((c) => c.id === id)
    if (!existing) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
    if (existing.from !== 'ui') {
        return NextResponse.json({ error: 'Env connections are read-only' }, { status: 400 })
    }

    deleteUiConnection(id)
    invalidateConnectionsCache()

    return NextResponse.json({ success: true })
}
