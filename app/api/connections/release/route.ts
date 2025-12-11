import { NextResponse } from 'next/server'
import { z } from 'zod'
import { closePool, closePoolsForConnection, type PoolMode } from '@/lib/pg-pool'

export const runtime = 'nodejs'

const BodySchema = z.object({
    connectionId: z.string().min(1),
    poolMode: z.enum(['single', 'shared', 'per-scope']).optional(),
    scopeKey: z.string().min(1).optional(),
})

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = BodySchema.parse(json)
        const mode: PoolMode = parsed.poolMode ?? 'shared'

        if (mode === 'shared' || mode === 'single') {
            await closePoolsForConnection(parsed.connectionId)
        } else {
            await closePool(parsed.connectionId, mode, parsed.scopeKey)
        }

        return NextResponse.json({ ok: true })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid payload', issues: err.issues }, { status: 400 })
        }
        console.error('Failed to release pool', err)
        return NextResponse.json({ error: 'Failed to release pool' }, { status: 500 })
    }
}
