import { describe, it, expect, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import {
    resolveTableNames,
    dropTableNameCache,
    __getCacheSizeForTests,
} from '@/lib/pg-pool-cache'

// Minimal pg.Pool stand-in: only the `query` method is touched by the cache.
class FakePool {
    public queryCount = 0
    public lastOidsRequested: number[] | null = null

    constructor(private readonly catalog: Record<number, { nspname: string; relname: string }>) {}

    async query(text: string, values?: unknown[]): Promise<{ rows: Array<{ oid: number; nspname: string; relname: string }> }> {
        this.queryCount++
        const requested = (values?.[0] as number[]) ?? []
        this.lastOidsRequested = [...requested]
        const rows = requested
            .map((oid) => {
                const hit = this.catalog[oid]
                if (!hit) return null
                return { oid, nspname: hit.nspname, relname: hit.relname }
            })
            .filter((r): r is { oid: number; nspname: string; relname: string } => r !== null)
        return { rows }
    }
}

function asPool(fp: FakePool): Pool {
    return fp as unknown as Pool
}

const CATALOG = {
    16384: { nspname: 'public', relname: 'users' },
    16385: { nspname: 'public', relname: 'orders' },
    16386: { nspname: 'app', relname: 'sessions' },
}

describe('resolveTableNames', () => {
    let fake: FakePool
    let pool: Pool

    beforeEach(() => {
        fake = new FakePool(CATALOG)
        pool = asPool(fake)
        // Make sure no leftover cache from a previous test interferes.
        dropTableNameCache(pool)
    })

    it('hits pg_catalog on the first call', async () => {
        const result = await resolveTableNames(pool, [16384, 16385])
        expect(fake.queryCount).toBe(1)
        expect(result.get(16384)?.qualified).toBe('public.users')
        expect(result.get(16385)?.qualified).toBe('public.orders')
    })

    it('returns identical results from cache on a second call without hitting pg_catalog', async () => {
        await resolveTableNames(pool, [16384, 16385])
        expect(fake.queryCount).toBe(1)

        const second = await resolveTableNames(pool, [16384, 16385])
        expect(fake.queryCount).toBe(1) // unchanged
        expect(second.get(16384)?.qualified).toBe('public.users')
    })

    it('only fetches the OIDs that are missing from cache', async () => {
        await resolveTableNames(pool, [16384])
        expect(fake.queryCount).toBe(1)
        expect(fake.lastOidsRequested).toEqual([16384])

        await resolveTableNames(pool, [16384, 16385, 16386])
        expect(fake.queryCount).toBe(2)
        expect(fake.lastOidsRequested?.sort()).toEqual([16385, 16386])
    })

    it('deduplicates input OIDs before issuing the catalog query', async () => {
        await resolveTableNames(pool, [16384, 16384, 16384, 16385])
        expect(fake.lastOidsRequested?.sort()).toEqual([16384, 16385])
    })

    it('returns an empty Map for empty input without touching the pool', async () => {
        const result = await resolveTableNames(pool, [])
        expect(result.size).toBe(0)
        expect(fake.queryCount).toBe(0)
    })

    it('does not cache OIDs that the catalog query did not return', async () => {
        // 99999 is not in CATALOG; it should be missed every time so subsequent
        // calls keep retrying it (rare in practice, but the LRU shouldn't poison
        // itself with negative entries).
        await resolveTableNames(pool, [99999])
        expect(fake.queryCount).toBe(1)
        await resolveTableNames(pool, [99999])
        expect(fake.queryCount).toBe(2)
    })

    it('grows the cache and reports its size for known OIDs', async () => {
        await resolveTableNames(pool, [16384, 16385, 16386])
        expect(__getCacheSizeForTests(pool)).toBe(3)
    })

    it('isolates caches between distinct Pool instances', async () => {
        const fake2 = new FakePool(CATALOG)
        const pool2 = asPool(fake2)

        await resolveTableNames(pool, [16384])
        expect(fake.queryCount).toBe(1)
        expect(fake2.queryCount).toBe(0)

        await resolveTableNames(pool2, [16384])
        expect(fake2.queryCount).toBe(1)
    })

    it('clears the cache when dropTableNameCache is called', async () => {
        await resolveTableNames(pool, [16384])
        expect(__getCacheSizeForTests(pool)).toBe(1)

        dropTableNameCache(pool)
        expect(__getCacheSizeForTests(pool)).toBe(0)

        await resolveTableNames(pool, [16384])
        expect(fake.queryCount).toBe(2) // forced re-fetch
    })
})
