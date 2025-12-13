import { NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteConnection, updateConnection } from '@/lib/core/connections'
import { isCoreError } from '@/lib/core/errors'

export const runtime = 'nodejs'

const ConnectionUpdateSchema = z.object({
    label: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
    database: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    readOnly: z.boolean().optional(),
})

export async function PUT(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params

    try {
        const json = await req.json()
        const parsed = ConnectionUpdateSchema.parse(json)
        const client = await updateConnection(id, parsed)
        return NextResponse.json(client)
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid connection payload', issues: err.issues }, { status: 400 })
        }
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to update connection', err)
        return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 })
    }
}

export async function DELETE(
    _req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const { id } = await context.params

    try {
        const result = await deleteConnection(id)
        return NextResponse.json(result)
    } catch (err) {
        if (isCoreError(err)) {
            return NextResponse.json(err.body, { status: err.status })
        }
        console.error('Failed to delete connection', err)
        return NextResponse.json({ error: 'Failed to delete connection' }, { status: 500 })
    }
}
