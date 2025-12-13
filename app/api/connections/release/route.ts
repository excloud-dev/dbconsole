import { NextResponse } from 'next/server'
import { z } from 'zod'
import { releasePools } from '@/lib/core/connections'

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
        return NextResponse.json(await releasePools(parsed))
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid payload', issues: err.issues }, { status: 400 })
        }
        console.error('Failed to release pool', err)
        return NextResponse.json({ error: 'Failed to release pool' }, { status: 500 })
    }
}
