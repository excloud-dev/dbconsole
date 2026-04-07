// Per-pool caches for cheap, frequently-repeated metadata lookups.
//
// Today the only consumer is the duplicate-column resolver in
// lib/query-engine.ts, which used to query pg_class on every query that had
// colliding column names. With this cache, the catalog query only fires for
// table OIDs we haven't seen on this pool before — and a single fetch can
// resolve many OIDs at once via `WHERE c.oid = ANY($1)`.
//
// Caches are keyed by Pool *identity*, so a fresh Pool (after a release/
// reconnect) starts with an empty cache automatically. Call
// `dropTableNameCache(pool)` from the pool teardown path to free the entry.

import type { Pool } from 'pg'

const DEFAULT_MAX_ENTRIES = 512

export type QualifiedTableName = { schema: string; name: string; qualified: string }

class TableNameLru {
    private readonly map = new Map<number, QualifiedTableName>()
    constructor(private readonly maxEntries: number) {}

    get(oid: number): QualifiedTableName | undefined {
        const hit = this.map.get(oid)
        if (!hit) return undefined
        // Touch: move to the end of the iteration order (Map preserves insertion order).
        this.map.delete(oid)
        this.map.set(oid, hit)
        return hit
    }

    set(oid: number, entry: QualifiedTableName): void {
        if (this.map.has(oid)) {
            this.map.delete(oid)
        } else if (this.map.size >= this.maxEntries) {
            // Evict the least-recently-used entry (first in iteration order).
            const oldestKey = this.map.keys().next().value
            if (oldestKey !== undefined) this.map.delete(oldestKey)
        }
        this.map.set(oid, entry)
    }

    has(oid: number): boolean {
        return this.map.has(oid)
    }

    get size(): number {
        return this.map.size
    }

    clear(): void {
        this.map.clear()
    }
}

// WeakMap so a Pool that gets GC'd takes its cache with it without us having
// to remember to clean up.
const pools = new WeakMap<Pool, TableNameLru>()

function getOrCreate(pool: Pool, max = DEFAULT_MAX_ENTRIES): TableNameLru {
    let lru = pools.get(pool)
    if (!lru) {
        lru = new TableNameLru(max)
        pools.set(pool, lru)
    }
    return lru
}

/**
 * Resolve a list of pg_class OIDs to qualified `schema.relname` names. Hits
 * the per-pool LRU first; only the OIDs we don't already know are looked up.
 *
 * The result Map preserves the input OID order so callers can iterate either
 * the input array or the returned map.
 */
export async function resolveTableNames(pool: Pool, oids: number[]): Promise<Map<number, QualifiedTableName>> {
    const result = new Map<number, QualifiedTableName>()
    if (oids.length === 0) return result

    const lru = getOrCreate(pool)
    const unique = Array.from(new Set(oids))
    const missing: number[] = []

    for (const oid of unique) {
        const hit = lru.get(oid)
        if (hit) result.set(oid, hit)
        else missing.push(oid)
    }

    if (missing.length > 0) {
        const lookup = await pool.query(
            `SELECT c.oid, n.nspname, c.relname
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.oid = ANY($1::oid[])`,
            [missing],
        )

        for (const row of lookup.rows as Array<{ oid: number | string; nspname: string; relname: string }>) {
            const oid = Number(row.oid)
            const entry: QualifiedTableName = {
                schema: row.nspname,
                name: row.relname,
                qualified: `${row.nspname}.${row.relname}`,
            }
            lru.set(oid, entry)
            result.set(oid, entry)
        }
    }

    return result
}

/** Drop the cache associated with a Pool. Call this when the Pool is being closed. */
export function dropTableNameCache(pool: Pool): void {
    pools.delete(pool)
}

// ---- test helpers (not part of the public surface) -------------------------

/** @internal */
export function __getCacheSizeForTests(pool: Pool): number {
    return pools.get(pool)?.size ?? 0
}

/** @internal */
export function __clearAllCachesForTests(): void {
    // WeakMap doesn't expose iteration; tests should drop the Pool reference
    // they care about and rely on dropTableNameCache for explicit eviction.
}
