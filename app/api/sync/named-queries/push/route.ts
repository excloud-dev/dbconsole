import nodeCrypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fromBase64Url, toBase64Url } from '@/lib/secrets/base64url'
import { getSyncNamedQueriesChain, pushSyncNamedQueriesChain } from '@/lib/meta-db'

export const runtime = 'nodejs'

const PushSchema = z.object({
    baseVersion: z.number().int().nonnegative(),
    ciphertextB64: z.string().nullable(),
})

function getChainIdFromRequest(req: Request): { chainId: string } | NextResponse {
    const token = req.headers.get('x-dbconsole-sync-token')
    if (!token || !token.trim()) {
        return NextResponse.json({ error: 'Missing sync token' }, { status: 401 })
    }

    let tokenBytes: Buffer
    try {
        tokenBytes = fromBase64Url(token.trim())
    } catch {
        return NextResponse.json({ error: 'Invalid sync token' }, { status: 401 })
    }

    if (tokenBytes.length !== 32) {
        return NextResponse.json({ error: 'Invalid sync token' }, { status: 401 })
    }

    const chainId = toBase64Url(nodeCrypto.createHash('sha256').update(tokenBytes).digest())
    return { chainId }
}

export async function POST(req: Request) {
    const auth = getChainIdFromRequest(req)
    if (auth instanceof NextResponse) return auth

    let parsed: z.infer<typeof PushSchema>
    try {
        parsed = PushSchema.parse(await req.json())
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid sync payload', issues: err.issues }, { status: 400 })
        }
        return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400 })
    }

    const result = pushSyncNamedQueriesChain(auth.chainId, parsed.baseVersion, parsed.ciphertextB64)
    if (result.ok) {
        return NextResponse.json({ version: result.version })
    }

    // Include current ciphertext so the client can merge and retry.
    return NextResponse.json(
        {
            error: 'Version conflict',
            currentVersion: result.currentVersion,
            ciphertextB64: result.ciphertextB64,
            updatedAt: result.updatedAt,
        },
        { status: 409 },
    )
}

// Optional: allow clients to query the current version without pulling ciphertext.
export async function GET(req: Request) {
    const auth = getChainIdFromRequest(req)
    if (auth instanceof NextResponse) return auth

    const row = getSyncNamedQueriesChain(auth.chainId)
    return NextResponse.json({ version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null })
}
