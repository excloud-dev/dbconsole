import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Pool } from 'pg'
import {
    ConnectionDraftSchema,
    type ConnectionDraftInput,
} from '@/lib/connection-schema'

export const runtime = 'nodejs'

function buildConnectionString(input: ConnectionDraftInput): string {
    const host = input.host
    const port = typeof input.port === 'string' ? Number(input.port) : input.port
    const database = input.database
    const user = encodeURIComponent(input.username)
    const pass = encodeURIComponent(input.password)

    return `postgres://${user}:${pass}@${host}:${port}/${database}`
}

export async function POST(req: Request) {
    let parsed: ConnectionDraftInput

    try {
        const json = await req.json()
        parsed = ConnectionDraftSchema.parse(json) as ConnectionDraftInput
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json(
                { ok: false, error: 'Invalid connection payload', issues: err.issues },
                { status: 400 },
            )
        }

        return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
    }

    const connectionString = buildConnectionString(parsed)

    const pool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
        query_timeout: 5_000,
    })

    try {
        await pool.query('SELECT 1')
        return NextResponse.json({ ok: true })
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection test failed'
        return NextResponse.json({ ok: false, error: message })
    } finally {
        try {
            await pool.end()
        } catch {
            // ignore
        }
    }
}
