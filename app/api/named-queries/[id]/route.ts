import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getOneNamedQuery, removeNamedQuery, saveNamedQuery } from '@/lib/core/named-queries'
import { isCoreError } from '@/lib/core/errors'

export const runtime = 'nodejs'

export async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params
    try {
        return NextResponse.json(getOneNamedQuery(id))
    } catch (err) {
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to load named query', err)
        return NextResponse.json({ error: 'Failed to load named query' }, { status: 500 })
    }
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
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params
    let existing: ReturnType<typeof getOneNamedQuery>
    try {
        existing = getOneNamedQuery(id)
    } catch (err) {
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to load named query', err)
        return NextResponse.json({ error: 'Failed to load named query' }, { status: 500 })
    }

    try {
        const json = await req.json()
        const parsed = UpdateNamedQuerySchema.parse(json)
        return NextResponse.json(
            saveNamedQuery({
                id: existing.id,
                name: parsed.name ?? existing.name,
                description: parsed.description ?? existing.description,
                sqlTemplate: parsed.sqlTemplate ?? existing.sqlTemplate,
                params: parsed.params ?? existing.params,
                defaultConnectionId: parsed.defaultConnectionId ?? existing.defaultConnectionId,
            }),
        )
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
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params

    try {
        getOneNamedQuery(id)
        removeNamedQuery(id)
        return NextResponse.json({ success: true })
    } catch (err) {
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to delete named query', err)
        return NextResponse.json({ error: 'Failed to delete named query' }, { status: 500 })
    }
}
