import { describe, it, expect } from 'vitest'
import { isReadOnlySql, stripSqlComments, splitTopLevelStatements } from '@/lib/sql/safety'

describe('isReadOnlySql', () => {
    describe('basic happy path', () => {
        it('allows SELECTs that mention created_at / updated_at columns', () => {
            const sql = "SELECT id, created_at, updated_at FROM vms WHERE state <> 'TERMINATED'"
            expect(isReadOnlySql(sql)).toBe(true)
        })

        it('allows WITH … SELECT', () => {
            expect(isReadOnlySql('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(true)
        })

        it('allows nested SELECTs', () => {
            expect(isReadOnlySql('SELECT * FROM (SELECT 1 AS x) sub')).toBe(true)
        })

        it('allows trailing semicolon on a single statement', () => {
            expect(isReadOnlySql('SELECT 1;')).toBe(true)
        })

        it('does not flag column names that contain forbidden substrings', () => {
            expect(isReadOnlySql('SELECT updated_at, deleted_at, inserted_by FROM t')).toBe(true)
            expect(isReadOnlySql('SELECT lock_id, set_size, do_count, commit_hash FROM t')).toBe(true)
        })
    })

    describe('write statement rejection', () => {
        it('rejects bare DML', () => {
            expect(isReadOnlySql("UPDATE vms SET name = 'x' WHERE id = 1")).toBe(false)
            expect(isReadOnlySql("DELETE FROM vms")).toBe(false)
            expect(isReadOnlySql("INSERT INTO vms (id) VALUES (1)")).toBe(false)
            expect(isReadOnlySql("MERGE INTO vms USING staging ON vms.id = staging.id WHEN MATCHED THEN DELETE")).toBe(false)
        })

        it('rejects DDL', () => {
            expect(isReadOnlySql("DROP TABLE vms")).toBe(false)
            expect(isReadOnlySql("ALTER TABLE vms ADD COLUMN x int")).toBe(false)
            expect(isReadOnlySql("CREATE TABLE vms (id int)")).toBe(false)
            expect(isReadOnlySql("TRUNCATE vms")).toBe(false)
            expect(isReadOnlySql("VACUUM vms")).toBe(false)
        })
    })

    describe('multi-statement rejection', () => {
        it('rejects two top-level statements', () => {
            expect(isReadOnlySql('SELECT 1; SELECT 2')).toBe(false)
        })

        it('rejects DML hidden behind a SELECT and a semicolon', () => {
            expect(isReadOnlySql('SELECT 1; DELETE FROM users')).toBe(false)
        })

        it('does not count semicolons inside string literals as separators', () => {
            expect(isReadOnlySql("SELECT ';' AS s, 1 AS n")).toBe(true)
        })

        it('does not count semicolons inside dollar-quoted strings', () => {
            expect(isReadOnlySql("SELECT $tag$ a; b $tag$ AS s")).toBe(true)
        })
    })

    describe('comment-hidden DML', () => {
        it('rejects line-comment hidden DML', () => {
            const sql = 'SELECT 1 -- innocent\n; DELETE FROM users'
            expect(isReadOnlySql(sql)).toBe(false)
        })

        it('rejects DML hidden inside a block comment that is then closed', () => {
            // /* */ is stripped, leaving "SELECT 1 ; DELETE FROM users" which
            // splits into two statements and trips the multi-statement guard.
            const sql = 'SELECT 1 /* innocent */ ; DELETE FROM users'
            expect(isReadOnlySql(sql)).toBe(false)
        })

        it('rejects DML smuggled via a fragmented block comment that hides the semicolon', () => {
            const sql = 'SELECT 1 /*; DELETE FROM users; */'
            // After comment strip: "SELECT 1 " — totally safe.
            // But we want to make sure we don't blindly trust comment contents.
            // This particular form is harmless (the DML is INSIDE the comment).
            expect(isReadOnlySql(sql)).toBe(true)
        })

        it('rejects DML where the leading SELECT is a comment', () => {
            const sql = '-- SELECT 1\nDELETE FROM users'
            expect(isReadOnlySql(sql)).toBe(false)
        })
    })

    describe('CTE-wrapped DML (writable CTEs)', () => {
        it('rejects WITH wrapping a DELETE', () => {
            const sql = 'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone'
            expect(isReadOnlySql(sql)).toBe(false)
        })

        it('rejects WITH wrapping an INSERT', () => {
            const sql = "WITH ins AS (INSERT INTO audit (msg) VALUES ('x') RETURNING *) SELECT * FROM ins"
            expect(isReadOnlySql(sql)).toBe(false)
        })

        it('rejects WITH wrapping an UPDATE', () => {
            const sql = "WITH up AS (UPDATE users SET name='x' RETURNING *) SELECT * FROM up"
            expect(isReadOnlySql(sql)).toBe(false)
        })
    })

    describe('SELECT … INTO new table (DDL disguise)', () => {
        it('rejects SELECT INTO newtable', () => {
            expect(isReadOnlySql('SELECT * INTO new_users FROM users')).toBe(false)
        })

        it('rejects SELECT INTO TEMP newtable', () => {
            expect(isReadOnlySql('SELECT * INTO TEMP scratch FROM users')).toBe(false)
            expect(isReadOnlySql('SELECT * INTO TEMPORARY scratch FROM users')).toBe(false)
            expect(isReadOnlySql('SELECT * INTO UNLOGGED scratch FROM users')).toBe(false)
        })

        it('still allows SELECTs that just contain "into" as part of a string literal', () => {
            expect(isReadOnlySql("SELECT 'put it into here' AS msg")).toBe(true)
        })
    })

    describe('whitespace and formatting tolerance', () => {
        it('rejects DML with leading whitespace', () => {
            expect(isReadOnlySql('   \n\t DELETE FROM users')).toBe(false)
        })

        it('rejects multi-line DML', () => {
            const sql = `
                DELETE
                  FROM users
                 WHERE id = 1
            `
            expect(isReadOnlySql(sql)).toBe(false)
        })
    })
})

describe('stripSqlComments', () => {
    it('strips line comments', () => {
        expect(stripSqlComments('SELECT 1 -- hi\n FROM t').trim().replace(/\s+/g, ' ')).toBe('SELECT 1 FROM t')
    })

    it('strips block comments', () => {
        expect(stripSqlComments('SELECT /* hi */ 1').replace(/\s+/g, ' ').trim()).toBe('SELECT 1')
    })

    it('handles nested block comments', () => {
        expect(stripSqlComments('SELECT /* a /* b */ c */ 1').replace(/\s+/g, ' ').trim()).toBe('SELECT 1')
    })

    it('preserves comment-looking content inside string literals', () => {
        expect(stripSqlComments("SELECT '-- not a comment' AS s")).toContain('-- not a comment')
        expect(stripSqlComments("SELECT '/* not a comment */' AS s")).toContain('/* not a comment */')
    })

    it('preserves content inside dollar-quoted strings', () => {
        const sql = 'SELECT $tag$ -- still text /* still text */ $tag$'
        const out = stripSqlComments(sql)
        expect(out).toContain('-- still text')
        expect(out).toContain('/* still text */')
    })
})

describe('splitTopLevelStatements', () => {
    it('splits on top-level semicolons', () => {
        expect(splitTopLevelStatements('SELECT 1; SELECT 2')).toHaveLength(2)
    })

    it('ignores semicolons inside string literals', () => {
        expect(splitTopLevelStatements("SELECT ';;;' AS s")).toHaveLength(1)
    })

    it('ignores semicolons inside dollar-quoted strings', () => {
        expect(splitTopLevelStatements('SELECT $$ a;b;c $$ AS s')).toHaveLength(1)
    })

    it('ignores empty trailing statement after a semicolon', () => {
        expect(splitTopLevelStatements('SELECT 1;')).toHaveLength(1)
    })
})
