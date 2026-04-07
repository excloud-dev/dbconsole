import { NextResponse } from 'next/server'
import { z } from 'zod'

import { runApiStreamOpen } from '@/lib/core/query'
import { isQueryError, statusForQueryError, toQueryError } from '@/lib/core/errors'
import { StreamOpenBodySchema } from '@/lib/ipc/schemas'
import type { NamedQueryInput, RawQueryInput } from '@/lib/query-engine'

export const runtime = 'nodejs'

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = StreamOpenBodySchema.parse(json)

        const result = await runApiStreamOpen(
            parsed.query as RawQueryInput | NamedQueryInput,
            { batchSize: parsed.batchSize },
        )

        return NextResponse.json(result)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid stream payload', issues: err.issues }, { status: 400 })
        }
        const qe = isQueryError(err) ? err : toQueryError(err)
        return NextResponse.json(qe.body, { status: statusForQueryError(qe.body) })
    }
}
