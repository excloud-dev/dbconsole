import { describe, it, expect } from 'vitest'
import { isReadOnlySql } from '@/lib/sql/safety'

describe('isReadOnlySql', () => {
    it('allows SELECTs that mention created_at / updated_at columns', () => {
        const sql = "SELECT id, created_at, updated_at FROM vms WHERE state <> 'TERMINATED'"
        expect(isReadOnlySql(sql)).toBe(true)
    })

    it('rejects write statements', () => {
        expect(isReadOnlySql("UPDATE vms SET name = 'x' WHERE id = 1")).toBe(false)
        expect(isReadOnlySql("DELETE FROM vms")).toBe(false)
    })

    it('rejects multiple statements', () => {
        expect(isReadOnlySql('SELECT 1; SELECT 2')).toBe(false)
    })
})
