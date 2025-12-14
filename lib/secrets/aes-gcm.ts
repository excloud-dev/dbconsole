import crypto from 'node:crypto'
import { fromBase64Url, toBase64Url } from '@/lib/secrets/base64url'

export const ENC_V1_PREFIX = 'enc:v1:'

export function encryptStringAes256GcmV1(plaintext: string, key32: Buffer): string {
    if (key32.length !== 32) {
        throw new Error(`Invalid encryption key length: expected 32 bytes, got ${key32.length}`)
    }

    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key32, iv)
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
    const tag = cipher.getAuthTag() // 16 bytes

    // payload = iv(12) || tag(16) || ciphertext
    const payload = Buffer.concat([iv, tag, ciphertext])
    return `${ENC_V1_PREFIX}${toBase64Url(payload)}`
}

export function decryptStringAes256GcmV1(value: string, key32: Buffer): string {
    if (!value.startsWith(ENC_V1_PREFIX)) {
        throw new Error('Value is not enc:v1')
    }
    if (key32.length !== 32) {
        throw new Error(`Invalid encryption key length: expected 32 bytes, got ${key32.length}`)
    }

    const payload = fromBase64Url(value.slice(ENC_V1_PREFIX.length))
    if (payload.length < 12 + 16 + 1) {
        throw new Error('Invalid enc:v1 payload')
    }

    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const ciphertext = payload.subarray(28)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key32, iv)
    decipher.setAuthTag(tag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
}

export function maybeDecryptString(value: string, key32: Buffer): string {
    if (typeof value !== 'string') return String(value)
    if (!value.startsWith(ENC_V1_PREFIX)) return value
    return decryptStringAes256GcmV1(value, key32)
}

export function maybeEncryptString(value: string, key32: Buffer): string {
    if (typeof value !== 'string') return String(value)
    if (value.startsWith(ENC_V1_PREFIX)) return value
    return encryptStringAes256GcmV1(value, key32)
}
