import { describe, it, expect } from 'vitest'
import { deriveTabLabel } from '@/lib/sql/derive-label'

describe('deriveTabLabel', () => {
    it('returns null for empty input', () => {
        expect(deriveTabLabel('')).toBeNull()
        expect(deriveTabLabel('   ')).toBeNull()
    })

    it('extracts a simple FROM target', () => {
        expect(deriveTabLabel('SELECT * FROM users')).toBe('users')
    })

    it('strips a public. schema prefix', () => {
        expect(deriveTabLabel('SELECT * FROM public.users')).toBe('users')
    })

    it('keeps non-public schemas', () => {
        expect(deriveTabLabel('SELECT * FROM auth.sessions')).toBe('auth.sessions')
    })

    it('appends an equality predicate from the WHERE clause', () => {
        expect(deriveTabLabel("SELECT * FROM users WHERE id = '42'")).toBe('users · id = 42')
    })

    it('uses ⋈ when there is a JOIN', () => {
        expect(deriveTabLabel('SELECT * FROM orders o JOIN payments p ON o.id = p.order_id')).toBe('orders ⋈ payments')
    })

    it('handles WITH (CTE) queries', () => {
        expect(deriveTabLabel('WITH active AS (SELECT 1) SELECT * FROM active')).toBe('active')
    })

    it('handles WITH RECURSIVE', () => {
        // The first FROM after the CTE wins, so we get "active" rather than the CTE name.
        expect(deriveTabLabel('WITH RECURSIVE walked AS (SELECT 1) SELECT * FROM walked')).toBe('walked')
    })

    it('truncates long labels with an ellipsis', () => {
        const long = 'SELECT * FROM ' + 'x'.repeat(100)
        const out = deriveTabLabel(long)!
        expect(out.length).toBeLessThanOrEqual(40)
        expect(out.endsWith('…')).toBe(true)
    })

    it('returns null for nonsense', () => {
        expect(deriveTabLabel('hello world')).toBeNull()
    })

    it('strips comments before deriving the label', () => {
        expect(deriveTabLabel('-- the bad one\nSELECT * FROM users')).toBe('users')
    })

    it('handles fully-quoted multi-part identifiers', () => {
        // Regression: previously produced `public"."vms` because the unquote
        // function only stripped outer quotes from `"public"."vms"`.
        expect(deriveTabLabel('SELECT * FROM "public"."vms" ORDER BY "id" DESC')).toBe('vms')
    })

    it('keeps non-public schemas in the label', () => {
        expect(deriveTabLabel('SELECT * FROM "k8s"."kubeclusters"')).toBe('k8s.kubeclusters')
    })

    it('handles quoted JOIN targets', () => {
        expect(deriveTabLabel('SELECT * FROM "public"."orders" JOIN "public"."payments" ON 1=1')).toBe('orders ⋈ payments')
    })
})
