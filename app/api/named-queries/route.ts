import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listAllNamedQueries, removeNamedQuery, saveNamedQuery } from '@/lib/core/named-queries'

export const runtime = 'nodejs'

export async function GET() {
    return NextResponse.json(listAllNamedQueries())
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
        return NextResponse.json(saveNamedQuery(parsed))
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

        removeNamedQuery(id)
        return NextResponse.json({ ok: true })
    } catch (err) {
        console.error('Failed to delete named query', err)
        return NextResponse.json({ error: 'Failed to delete named query' }, { status: 500 })
    }
}
