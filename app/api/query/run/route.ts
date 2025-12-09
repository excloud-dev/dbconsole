import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runQuery, type RawQueryInput, type NamedQueryInput } from '@/lib/query-engine'

export const runtime = 'nodejs'

const RawQuerySchema = z.object({
    kind: z.literal('raw'),
    sql: z.string().min(1),
    connectionId: z.string().min(1),
})

const NamedQuerySchema = z.object({
    kind: z.literal('named'),
    queryId: z.string().min(1),
    params: z.record(z.any()).default({}),
    connectionId: z.string().min(1).optional(),
})

const BodySchema = z.union([RawQuerySchema, NamedQuerySchema])

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = BodySchema.parse(json)

        const result = await runQuery(parsed as RawQueryInput | NamedQueryInput)

        return NextResponse.json(result)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid query payload', issues: err.issues }, { status: 400 })
        }

        const message = err instanceof Error ? err.message : 'Query failed'
        return NextResponse.json({ error: message }, { status: 400 })
    }
}
