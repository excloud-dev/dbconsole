import { describe, it, expect } from 'vitest'
import { QueryError, isQueryError, statusForQueryError, toQueryError } from '@/lib/core/errors'

// Mimics a `pg.DatabaseError` enough to exercise duck-typed extraction in
// toQueryError. The real pg DatabaseError has many more fields but we only
// touch the ones the engine forwards.
function pgError(opts: {
    message: string
    code?: string
    severity?: string
    hint?: string
    detail?: string
    position?: string
    schema?: string
    table?: string
    column?: string
}) {
    return Object.assign(new Error(opts.message), opts)
}

describe('toQueryError', () => {
    it('classifies 57014 as timeout', () => {
        const qe = toQueryError(pgError({ message: 'canceling statement due to statement timeout', code: '57014' }))
        expect(qe.body.classification).toBe('timeout')
        expect(qe.body.code).toBe('57014')
    })

    it('classifies 42601 as syntax', () => {
        const qe = toQueryError(pgError({ message: 'syntax error at or near "FORM"', code: '42601', position: '8' }))
        expect(qe.body.classification).toBe('syntax')
        expect(qe.body.position).toBe('8')
    })

    it('classifies 42501 as permission', () => {
        const qe = toQueryError(pgError({ message: 'permission denied for table users', code: '42501' }))
        expect(qe.body.classification).toBe('permission')
    })

    it('classifies 42P01 as not_found', () => {
        const qe = toQueryError(pgError({ message: 'relation "ghost" does not exist', code: '42P01' }))
        expect(qe.body.classification).toBe('not_found')
    })

    it('classifies 42703 as not_found', () => {
        const qe = toQueryError(pgError({ message: 'column "ghost" does not exist', code: '42703' }))
        expect(qe.body.classification).toBe('not_found')
    })

    it('classifies 08006 as connection', () => {
        const qe = toQueryError(pgError({ message: 'connection terminated unexpectedly', code: '08006' }))
        expect(qe.body.classification).toBe('connection')
    })

    it('classifies 53300 (insufficient resources) as connection', () => {
        const qe = toQueryError(pgError({ message: 'too many clients already', code: '53300' }))
        expect(qe.body.classification).toBe('connection')
    })

    it('falls back to message-based classification when no code', () => {
        const qe = toQueryError(new Error('connect ETIMEDOUT 127.0.0.1:5432'))
        expect(qe.body.classification).toBe('connection')
    })

    it('returns "unknown" for completely opaque errors', () => {
        const qe = toQueryError(new Error('bzzt'))
        expect(qe.body.classification).toBe('unknown')
    })

    it('forwards rich pg fields onto the body', () => {
        const qe = toQueryError(
            pgError({
                message: 'duplicate key value violates unique constraint "users_pkey"',
                code: '23505',
                severity: 'ERROR',
                detail: 'Key (id)=(1) already exists.',
                hint: 'Use ON CONFLICT.',
                schema: 'public',
                table: 'users',
                column: 'id',
            }),
        )
        expect(qe.body.severity).toBe('ERROR')
        expect(qe.body.detail).toBe('Key (id)=(1) already exists.')
        expect(qe.body.hint).toBe('Use ON CONFLICT.')
        expect(qe.body.schema).toBe('public')
        expect(qe.body.table).toBe('users')
        expect(qe.body.column).toBe('id')
    })

    it('passes a QueryError through unchanged', () => {
        const original = new QueryError({ error: 'safety bite', classification: 'safety' })
        const round = toQueryError(original)
        expect(round).toBe(original)
    })
})

describe('isQueryError', () => {
    it('recognizes a QueryError instance', () => {
        const qe = new QueryError({ error: 'x', classification: 'unknown' })
        expect(isQueryError(qe)).toBe(true)
    })

    it('rejects a plain Error', () => {
        expect(isQueryError(new Error('x'))).toBe(false)
    })
})

describe('statusForQueryError', () => {
    it('maps classifications to HTTP statuses', () => {
        expect(statusForQueryError({ error: 'x', classification: 'permission' })).toBe(403)
        expect(statusForQueryError({ error: 'x', classification: 'not_found' })).toBe(404)
        expect(statusForQueryError({ error: 'x', classification: 'timeout' })).toBe(504)
        expect(statusForQueryError({ error: 'x', classification: 'connection' })).toBe(503)
        expect(statusForQueryError({ error: 'x', classification: 'syntax' })).toBe(400)
        expect(statusForQueryError({ error: 'x', classification: 'safety' })).toBe(400)
        expect(statusForQueryError({ error: 'x', classification: 'unknown' })).toBe(400)
    })
})
