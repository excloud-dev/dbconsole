import { NextResponse } from 'next/server'
import { z } from 'zod'
import { testConnection } from '@/lib/core/connections'
import {
    ConnectionDraftSchema,
    type ConnectionDraftInput,
} from '@/lib/connection-schema'

export const runtime = 'nodejs'

export async function POST(req: Request) {
    let parsed: ConnectionDraftInput

    try {
        const json = await req.json()
        parsed = ConnectionDraftSchema.parse(json) as ConnectionDraftInput
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json(
                { ok: false, error: 'Invalid connection payload', issues: err.issues },
                { status: 400 },
            )
        }

        return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
    }

    const result = await testConnection(parsed)
    return NextResponse.json(result)
}
