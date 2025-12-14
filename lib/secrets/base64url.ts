export function toBase64Url(buf: Uint8Array): string {
    const b64 = Buffer.from(buf).toString('base64')
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64Url(s: string): Buffer {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (b64.length % 4)) % 4
    const padded = b64 + '='.repeat(padLen)
    return Buffer.from(padded, 'base64')
}
