import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getNamedQuery, upsertNamedQuery, deleteNamedQuery, type QueryParamDef } from '@/lib/meta-db'

export const runtime = 'nodejs'

export async function GET(
    _req: Request,
    { params }: { params: { id: string } },
) {
    const nq = getNamedQuery(params.id)
    if (!nq) {
        return NextResponse.json({ error: 'Named query not found' }, { status: 404 })
    }

    return NextResponse.json({
        id: nq.id,
        name: nq.name,
        description: nq.description,
        sqlTemplate: nq.sqlTemplate,
        params: JSON.parse(nq.paramsJson) as QueryParamDef[],
        defaultConnectionId: nq.defaultConnectionId,
    })
}

const UpdateNamedQuerySchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    sqlTemplate: z.string().min(1).optional(),
    params: z
        .array(
            z.object({
                name: z.string().min(1),
                type: z.enum(['string', 'number', 'boolean']),
                defaultValue: z.string().optional(),
            }),
        )
        .optional(),
    defaultConnectionId: z.string().optional(),
})

export async function PUT(
    req: Request,
    { params }: { params: { id: string } },
) {
    const existing = getNamedQuery(params.id)
    if (!existing) {
        return NextResponse.json({ error: 'Named query not found' }, { status: 404 })
    }

    try {
        const json = await req.json()
        const parsed = UpdateNamedQuerySchema.parse(json)

        const saved = upsertNamedQuery({
            id: existing.id,
            name: parsed.name ?? existing.name,
            description: parsed.description ?? existing.description,
            sqlTemplate: parsed.sqlTemplate ?? existing.sqlTemplate,
            params: (parsed.params as QueryParamDef[] | undefined) ?? (JSON.parse(existing.paramsJson) as QueryParamDef[]),
            defaultConnectionId: parsed.defaultConnectionId ?? existing.defaultConnectionId,
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
        console.error('Failed to update named query', err)
        return NextResponse.json({ error: 'Failed to update named query' }, { status: 500 })
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: { id: string } },
) {
    const existing = getNamedQuery(params.id)
    if (!existing) {
        return NextResponse.json({ error: 'Named query not found' }, { status: 404 })
    }

    deleteNamedQuery(params.id)
    return NextResponse.json({ success: true })
}
