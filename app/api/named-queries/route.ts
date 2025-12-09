import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
    listNamedQueries,
    upsertNamedQuery,
    deleteNamedQuery,
    type QueryParamDef,
} from '@/lib/meta-db'

export const runtime = 'nodejs'

export async function GET() {
    const queries = listNamedQueries().map((q) => ({
        id: q.id,
        name: q.name,
        description: q.description,
        sqlTemplate: q.sqlTemplate,
        params: JSON.parse(q.paramsJson) as QueryParamDef[],
        defaultConnectionId: q.defaultConnectionId,
    }))

    return NextResponse.json(queries)
}

const SaveNamedQuerySchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    sqlTemplate: z.string().min(1),
    params: z.array(
        z.object({
            name: z.string().min(1),
            type: z.enum(['string', 'number', 'boolean']),
            defaultValue: z.string().optional(),
        }),
    ),
    defaultConnectionId: z.string().optional(),
})

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = SaveNamedQuerySchema.parse(json)

        const saved = upsertNamedQuery({
            id: parsed.id,
            name: parsed.name,
            description: parsed.description,
            sqlTemplate: parsed.sqlTemplate,
            params: parsed.params,
            defaultConnectionId: parsed.defaultConnectionId,
        })

        return NextResponse.json({
            id: saved.id,
            name: saved.name,
            description: saved.description,
            sqlTemplate: saved.sqlTemplate,
            params: JSON.parse(saved.paramsJson) as QueryParamDef[],
            defaultConnectionId: saved.defaultConnectionId,
        })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid named query payload', issues: err.issues }, { status: 400 })
        }
        console.error('Failed to save named query', err)
        return NextResponse.json({ error: 'Failed to save named query' }, { status: 500 })
    }
}

export async function DELETE(req: Request) {
    try {
        const url = new URL(req.url)
        const id = url.searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'Missing query id' }, { status: 400 })
        }

        deleteNamedQuery(id)
        return NextResponse.json({ ok: true })
    } catch (err) {
        console.error('Failed to delete named query', err)
        return NextResponse.json({ error: 'Failed to delete named query' }, { status: 500 })
    }
}
