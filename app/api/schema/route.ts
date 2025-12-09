import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadSchemaGraph } from '@/lib/schema-introspection'

export const runtime = 'nodejs'

export async function GET(req: Request) {
    const url = new URL(req.url)
    const connectionId = url.searchParams.get('connectionId')

    const schema = z.object({ connectionId: z.string().min(1) })

    const parseResult = schema.safeParse({ connectionId })
    if (!parseResult.success) {
        return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    try {
        const graph = await loadSchemaGraph(parseResult.data.connectionId)
        return NextResponse.json(graph)
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load schema'
        return NextResponse.json({ error: message }, { status: 400 })
    }
}
