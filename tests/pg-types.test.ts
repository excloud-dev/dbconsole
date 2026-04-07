import { describe, it, expect } from 'vitest'
import {
    PG_OID,
    bytesToBase64,
    bytesToHex,
    formatRange,
    humanizeInterval,
    isArrayOid,
    pgTypeKind,
} from '@/lib/pg-types'

describe('pgTypeKind', () => {
    it('classifies known scalar OIDs', () => {
        expect(pgTypeKind(PG_OID.JSONB)).toBe('jsonb')
        expect(pgTypeKind(PG_OID.JSON)).toBe('json')
        expect(pgTypeKind(PG_OID.UUID)).toBe('uuid')
        expect(pgTypeKind(PG_OID.BYTEA)).toBe('bytea')
        expect(pgTypeKind(PG_OID.INET)).toBe('inet')
        expect(pgTypeKind(PG_OID.CIDR)).toBe('cidr')
        expect(pgTypeKind(PG_OID.INTERVAL)).toBe('interval')
        expect(pgTypeKind(PG_OID.INT4RANGE)).toBe('int4range')
        expect(pgTypeKind(PG_OID.TSTZRANGE)).toBe('tstzrange')
    })

    it('classifies array OIDs as "array"', () => {
        expect(pgTypeKind(1007)).toBe('array') // int4[]
        expect(pgTypeKind(1009)).toBe('array') // text[]
        expect(pgTypeKind(2951)).toBe('array') // uuid[]
        expect(pgTypeKind(3807)).toBe('array') // jsonb[]
    })

    it('falls back to scalar for unknown OIDs', () => {
        expect(pgTypeKind(0)).toBe('scalar')
        expect(pgTypeKind(undefined)).toBe('scalar')
        expect(pgTypeKind(99999)).toBe('scalar')
    })
})

describe('isArrayOid', () => {
    it('recognizes array OIDs', () => {
        expect(isArrayOid(1007)).toBe(true)
        expect(isArrayOid(1009)).toBe(true)
    })
    it('rejects non-array OIDs', () => {
        expect(isArrayOid(PG_OID.JSONB)).toBe(false)
        expect(isArrayOid(0)).toBe(false)
    })
})

describe('humanizeInterval', () => {
    it('formats a multi-unit interval compactly', () => {
        const v = { years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }
        expect(humanizeInterval(v)).toBe('1y 2mo 3d 4h 5m 6s')
    })
    it('skips zero units', () => {
        expect(humanizeInterval({ days: 5, seconds: 0 })).toBe('5d')
    })
    it('handles fractional seconds via milliseconds field', () => {
        expect(humanizeInterval({ seconds: 1, milliseconds: 250 })).toBe('1.250s')
    })
    it('passes through string intervals unchanged', () => {
        expect(humanizeInterval('1 day 02:00:00')).toBe('1 day 02:00:00')
    })
    it('returns empty string for null', () => {
        expect(humanizeInterval(null)).toBe('')
    })
    it('returns 0s for an empty interval object', () => {
        expect(humanizeInterval({})).toBe('0s')
    })
})

describe('formatRange', () => {
    it('pads brackets and commas for readability', () => {
        expect(formatRange('[1,10)')).toBe('[ 1, 10 )')
    })
    it('handles tstzrange', () => {
        expect(formatRange('[2024-01-01,2024-12-31)')).toBe('[ 2024-01-01, 2024-12-31 )')
    })
})

describe('bytesToHex', () => {
    it('strips the \\x prefix from pg literal form', () => {
        expect(bytesToHex('\\xdeadbeef')).toBe('deadbeef')
    })
    it('hex-encodes Uint8Array', () => {
        expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef')
    })
    it('returns empty string for null', () => {
        expect(bytesToHex(null)).toBe('')
    })
})

describe('bytesToBase64', () => {
    it('base64-encodes Uint8Array', () => {
        expect(bytesToBase64(new Uint8Array([72, 101, 108, 108, 111]))).toBe('SGVsbG8=')
    })
    it('converts pg \\x literals to base64', () => {
        expect(bytesToBase64('\\x48656c6c6f')).toBe('SGVsbG8=')
    })
})
