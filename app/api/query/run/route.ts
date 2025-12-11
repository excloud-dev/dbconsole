import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runQuery, type RawQueryInput, type NamedQueryInput } from '@/lib/query-engine'

export const runtime = 'nodejs'

const PoolModeSchema = z.enum(['single', 'shared', 'per-scope']).optional()

const RawQuerySchema = z.object({
    kind: z.literal('raw'),
    sql: z.string().min(1),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    params: z.array(z.any()).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
})

const NamedQuerySchema = z.object({
    kind: z.literal('named'),
    queryId: z.string().min(1),
    params: z.record(z.any()).default({}),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
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
