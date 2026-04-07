import { NextResponse } from 'next/server'
import { z } from 'zod'

import { fetchSlowQueries, type SlowQuerySort } from '@/lib/diagnostics/slow-queries'
import { isQueryError, statusForQueryError, toQueryError } from '@/lib/core/errors'

export const runtime = 'nodejs'

const QuerySchema = z.object({
    connectionId: z.string().min(1),
    sort: z.enum(['mean_time', 'total_time', 'calls', 'rows']).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
})

export async function GET(req: Request) {
    try {
        const url = new URL(req.url)
        const parsed = QuerySchema.parse({
            connectionId: url.searchParams.get('connectionId'),
            sort: url.searchParams.get('sort') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
        })

        const result = await fetchSlowQueries(parsed.connectionId, {
            sort: parsed.sort as SlowQuerySort | undefined,
            limit: parsed.limit,
        })

        return NextResponse.json(result)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid diagnostics query', issues: err.issues }, { status: 400 })
        }
        const qe = isQueryError(err) ? err : toQueryError(err)
        return NextResponse.json(qe.body, { status: statusForQueryError(qe.body) })
    }
}
