import nodeCrypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { fromBase64Url, toBase64Url } from '@/lib/secrets/base64url'
import { getSyncNamedQueriesChain } from '@/lib/meta-db'

export const runtime = 'nodejs'

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

    const row = getSyncNamedQueriesChain(auth.chainId)
    if (!row) {
        return NextResponse.json({ version: 0, ciphertextB64: null })
    }

    return NextResponse.json({ version: row.version, ciphertextB64: row.ciphertextB64, updatedAt: row.updatedAt })
}
