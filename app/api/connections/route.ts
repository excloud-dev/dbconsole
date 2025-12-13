import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listConnections, createConnection } from '@/lib/core/connections'
import {
    ConnectionDraftSchema,
    type ConnectionDraftInput,
} from '@/lib/connection-schema'
import { isCoreError } from '@/lib/core/errors'

export const runtime = 'nodejs'

export async function GET() {
    return NextResponse.json(listConnections())
}

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = ConnectionDraftSchema.parse(json) as ConnectionDraftInput
        const client = createConnection(parsed)
        return NextResponse.json(client, { status: 201 })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid connection payload', issues: err.issues }, { status: 400 })
        }
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to create connection', err)
        return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
    }
}
