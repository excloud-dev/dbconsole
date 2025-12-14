import crypto from 'node:crypto'
import { toBase64Url } from '@/lib/secrets/base64url'

export type SyncChainKeys = {
    encKey: Buffer
    authKey: Buffer
    authToken: string
    chainId: string
}

export function deriveSyncChainKeys(phrase: string): SyncChainKeys {
    if (!phrase || !phrase.trim()) {
        throw new Error('Sync phrase is required')
    }

    // Deterministic KDF so all devices with the same phrase derive the same keys.
    const keyMaterial = crypto.scryptSync(phrase, 'dbconsole-sync-v1', 32, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
    })

    const encKey = Buffer.from(
        crypto.hkdfSync('sha256', keyMaterial, Buffer.from('dbconsole-sync-enc'), Buffer.from('named-queries'), 32),
    )
    const authKey = Buffer.from(
        crypto.hkdfSync('sha256', keyMaterial, Buffer.from('dbconsole-sync-auth'), Buffer.from('named-queries'), 32),
    )

    const chainId = toBase64Url(crypto.createHash('sha256').update(authKey).digest())
    const authToken = toBase64Url(authKey)

    return { encKey, authKey, authToken, chainId }
}
