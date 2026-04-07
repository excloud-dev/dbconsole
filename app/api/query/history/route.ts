import { NextResponse } from 'next/server'
import { z } from 'zod'

import { listQueryRuns, type ListQueryRunsInput } from '@/lib/meta-db'

export const runtime = 'nodejs'

const QuerySchema = z.object({
    connectionId: z.string().min(1).optional(),
    status: z.enum(['ok', 'error', 'timeout']).optional(),
    kind: z.enum(['raw', 'named']).optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
})

export async function GET(req: Request) {
    try {
        const url = new URL(req.url)
        const parsed = QuerySchema.parse({
            connectionId: url.searchParams.get('connectionId') ?? undefined,
            status: url.searchParams.get('status') ?? undefined,
            kind: url.searchParams.get('kind') ?? undefined,
            from: url.searchParams.get('from') ?? undefined,
            to: url.searchParams.get('to') ?? undefined,
            search: url.searchParams.get('search') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
            offset: url.searchParams.get('offset') ?? undefined,
        })

        const result = listQueryRuns(parsed as ListQueryRunsInput)
        return NextResponse.json(result)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid history query', issues: err.issues }, { status: 400 })
        }
        const message = err instanceof Error ? err.message : 'Failed to load history'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
