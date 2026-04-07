import { NextResponse } from 'next/server'
import { z } from 'zod'

import { runApiStreamClose } from '@/lib/core/query'
import { isQueryError, statusForQueryError, toQueryError } from '@/lib/core/errors'
import { StreamCloseBodySchema } from '@/lib/ipc/schemas'

export const runtime = 'nodejs'

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = StreamCloseBodySchema.parse(json)

        const result = await runApiStreamClose(parsed.streamId)

        return NextResponse.json(result)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid stream payload', issues: err.issues }, { status: 400 })
        }
        const qe = isQueryError(err) ? err : toQueryError(err)
        return NextResponse.json(qe.body, { status: statusForQueryError(qe.body) })
    }
}
