import nodeCrypto from 'node:crypto'
import { deriveSyncChainKeys } from '@/lib/secrets/sync-phrase'
import {
    getSyncNamedQueriesLastSnapshotJson,
    setSyncNamedQueriesLastRemoteVersion,
    setSyncNamedQueriesLastSnapshotJson,
} from '@/lib/core/syncer-settings'
import {
    listNamedQueries,
    listNamedQueryTombstones,
    replaceNamedQueriesAndTombstones,
    type NamedQuerySyncRecord,
    type QueryTombstoneRow,
} from '@/lib/meta-db'

export type NamedQueriesSnapshotV1 = {
    v: 1
    queries: NamedQuerySyncRecord[]
    tombstones: QueryTombstoneRow[]
}

export type NamedQuerySyncConflict =
    | {
        kind: 'same-id'
        conflictKey: string
        id: string
        local: NamedQuerySyncRecord
        remote: NamedQuerySyncRecord
    }
    | {
        kind: 'name'
        conflictKey: string
        name: string
        local: NamedQuerySyncRecord
        remote: NamedQuerySyncRecord
    }

export type NamedQuerySyncResolution =
    | { conflictKey: string; action: 'keep-remote' }
    | { conflictKey: string; action: 'keep-local' }
    | { conflictKey: string; action: 'rename-local'; newName: string }

export type NamedQuerySyncResult =
    | { status: 'ok'; remoteVersion: number; pushed: boolean; newRemoteVersion?: number }
    | { status: 'conflict'; remoteVersion: number; conflicts: NamedQuerySyncConflict[] }

function shouldSyncDeletions(explicit?: boolean): boolean {
    // Default: don't sync deletions. (Safer until we have a more explicit UX around deletes.)
    if (typeof explicit === 'boolean') return explicit
    return false
}

function describeFetchError(err: unknown): string {
    if (!err) return 'Unknown error'
    if (typeof err === 'string') return err

    if (err instanceof Error) {
        const anyErr = err as any
        const cause = anyErr?.cause

        const code = (cause && typeof cause === 'object' && 'code' in cause ? (cause as any).code : anyErr?.code) as
            | string
            | undefined
        const causeMsg =
            cause && typeof cause === 'object' && 'message' in cause ? String((cause as any).message ?? '') : ''
        const baseMsg = String(err.message || causeMsg || 'fetch failed')

        return code ? `${baseMsg} (${code})` : baseMsg
    }

    try {
        return JSON.stringify(err)
    } catch {
        return String(err)
    }
}

function makeUniqueName(desiredName: string, used: Set<string>): string {
    const base = desiredName.trim() || 'Untitled query'
    if (!used.has(base)) return base

    let n = 2
    while (used.has(`${base} (${n})`)) n++
    return `${base} (${n})`
}

function encryptSnapshotToCiphertextB64(snapshot: NamedQueriesSnapshotV1, encKey32: Buffer): string {
    const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const iv = nodeCrypto.randomBytes(12)
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', encKey32, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

function decryptCiphertextB64ToSnapshot(ciphertextB64: string, encKey32: Buffer): NamedQueriesSnapshotV1 {
    const payload = Buffer.from(ciphertextB64, 'base64')
    if (payload.length < 12 + 16 + 2) {
        throw new Error('Invalid ciphertext payload')
    }

    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const ciphertext = payload.subarray(28)

    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', encKey32, iv)
    decipher.setAuthTag(tag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as NamedQueriesSnapshotV1
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.queries) || !Array.isArray(parsed.tombstones)) {
        throw new Error('Invalid snapshot format')
    }
    return parsed
}

function normalizeSnapshot(s: NamedQueriesSnapshotV1): NamedQueriesSnapshotV1 {
    const queries = [...s.queries].sort((a, b) => a.id.localeCompare(b.id))
    const tombstones = [...s.tombstones].sort((a, b) => a.id.localeCompare(b.id))
    return { v: 1, queries, tombstones }
}

function snapshotEquals(a: NamedQueriesSnapshotV1, b: NamedQueriesSnapshotV1): boolean {
    // Stable string comparison after normalization
    return JSON.stringify(normalizeSnapshot(a)) === JSON.stringify(normalizeSnapshot(b))
}

function recordEquals(a: NamedQuerySyncRecord | undefined, b: NamedQuerySyncRecord | undefined): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    return JSON.stringify(a) === JSON.stringify(b)
}

function buildLocalSnapshot(opts: { syncDeletions: boolean }): NamedQueriesSnapshotV1 {
    const queries = listNamedQueries().map<NamedQuerySyncRecord>((q) => ({
        id: q.id,
        name: q.name,
        description: q.description,
        sqlTemplate: q.sqlTemplate,
        paramsJson: q.paramsJson,
        defaultConnectionId: q.defaultConnectionId,
        createdBy: q.createdBy,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
    }))

    const tombstones = opts.syncDeletions ? listNamedQueryTombstones() : []
    return normalizeSnapshot({ v: 1, queries, tombstones })
}

function emptySnapshot(): NamedQueriesSnapshotV1 {
    return { v: 1, queries: [], tombstones: [] }
}

function parseSnapshotJson(raw: string | null): NamedQueriesSnapshotV1 | null {
    if (!raw || !raw.trim()) return null
    try {
        const parsed = JSON.parse(raw) as NamedQueriesSnapshotV1
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.queries) || !Array.isArray(parsed.tombstones)) {
            return null
        }
        return normalizeSnapshot(parsed)
    } catch {
        return null
    }
}

function loadMergeBaseSnapshot(opts: { syncDeletions: boolean }): NamedQueriesSnapshotV1 | null {
    const parsed = parseSnapshotJson(getSyncNamedQueriesLastSnapshotJson())
    if (!parsed) return null
    if (!opts.syncDeletions && parsed.tombstones.length > 0) {
        return { ...parsed, tombstones: [] }
    }
    return parsed
}

function computeConflicts(
    base: NamedQueriesSnapshotV1,
    local: NamedQueriesSnapshotV1,
    remote: NamedQueriesSnapshotV1,
): NamedQuerySyncConflict[] {
    const baseById = new Map(base.queries.map((q) => [q.id, q]))
    const localById = new Map(local.queries.map((q) => [q.id, q]))
    const remoteById = new Map(remote.queries.map((q) => [q.id, q]))

    const remoteByName = new Map(remote.queries.map((q) => [q.name, q]))

    const conflicts: NamedQuerySyncConflict[] = []

    for (const [id, lq] of localById.entries()) {
        const rq = remoteById.get(id)
        if (rq) {
            if (!recordEquals(lq, rq)) {
                const bq = baseById.get(id)
                const localChanged = !recordEquals(lq, bq)
                const remoteChanged = !recordEquals(rq, bq)
                // Only a conflict if *both* sides changed since our merge base and they diverged.
                if (!(localChanged && remoteChanged)) continue
                conflicts.push({
                    kind: 'same-id',
                    conflictKey: `id:${id}`,
                    id,
                    local: lq,
                    remote: rq,
                })
            }
        } else {
            const nameHit = remoteByName.get(lq.name)
            if (nameHit && nameHit.id !== lq.id) {
                conflicts.push({
                    kind: 'name',
                    conflictKey: `name:${lq.name}:${lq.id}:${nameHit.id}`,
                    name: lq.name,
                    local: lq,
                    remote: nameHit,
                })
            }
        }
    }

    return conflicts
}

function applyResolutions(
    base: NamedQueriesSnapshotV1,
    local: NamedQueriesSnapshotV1,
    remote: NamedQueriesSnapshotV1,
    resolutions: NamedQuerySyncResolution[],
    opts: { syncDeletions: boolean },
): NamedQueriesSnapshotV1 {
    const conflicts = computeConflicts(base, local, remote)
    const byKey = new Map(resolutions.map((r) => [r.conflictKey, r]))

    for (const c of conflicts) {
        if (!byKey.has(c.conflictKey)) {
            throw new Error(`Missing resolution for conflict: ${c.conflictKey}`)
        }
    }

    const merged = new Map(remote.queries.map((q) => [q.id, { ...q }]))

    const tombstoneById = new Map<string, QueryTombstoneRow>()
    if (opts.syncDeletions) {
        // Start by adding remote tombstones and local tombstones.
        for (const t of remote.tombstones) tombstoneById.set(t.id, t)
        for (const t of local.tombstones) {
            const existing = tombstoneById.get(t.id)
            if (!existing || t.deletedAt > existing.deletedAt) tombstoneById.set(t.id, t)
        }

        // Remove tombstoned queries.
        for (const id of tombstoneById.keys()) {
            merged.delete(id)
        }
    }

    const usedNames = new Set<string>()
    for (const q of merged.values()) usedNames.add(q.name)

    function upsertMergedQuery(next: NamedQuerySyncRecord): void {
        const existing = merged.get(next.id)
        if (existing) usedNames.delete(existing.name)

        const uniqueName = makeUniqueName(next.name, usedNames)
        const record = uniqueName === next.name ? next : { ...next, name: uniqueName }
        merged.set(record.id, { ...record })
        usedNames.add(uniqueName)
    }

    const remoteByName = new Map(remote.queries.map((q) => [q.name, q]))
    const baseById = new Map(base.queries.map((q) => [q.id, q]))
    const nowIso = new Date().toISOString()

    // Merge in local queries, applying conflict resolutions.
    for (const lq of local.queries) {
        if (tombstoneById.has(lq.id)) continue

        const rq = merged.get(lq.id)
        if (rq) {
            const key = `id:${lq.id}`
            const resolution = byKey.get(key)
            if (resolution) {
                if (resolution.action === 'keep-local') {
                    upsertMergedQuery(lq)
                } else if (resolution.action === 'rename-local') {
                    const newId = nodeCrypto.randomUUID()
                    upsertMergedQuery({
                        ...lq,
                        id: newId,
                        name: resolution.newName,
                        createdAt: nowIso,
                        updatedAt: nowIso,
                    })
                }
                // keep-remote: do nothing
            } else {
                // No conflict: 3-way merge with merge-base to avoid constant conflicts.
                const bq = baseById.get(lq.id)
                const localChanged = !recordEquals(lq, bq)
                const remoteChanged = !recordEquals(rq, bq)

                if (localChanged && !remoteChanged) {
                    upsertMergedQuery(lq)
                }
                // If only remote changed (or neither changed), keep remote (no-op).
            }
            continue
        }

        const nameHit = remoteByName.get(lq.name)
        if (nameHit && nameHit.id !== lq.id) {
            const conflictKey = `name:${lq.name}:${lq.id}:${nameHit.id}`
            const resolution = byKey.get(conflictKey)
            if (!resolution) {
                // Should not happen; conflicts should have been fully resolved.
                continue
            }

            if (resolution.action === 'keep-remote') {
                // Discard local duplicate.
                continue
            }

            if (resolution.action === 'keep-local') {
                // Overwrite the remote query *with the same name* (keeping remote id).
                upsertMergedQuery({
                    ...lq,
                    id: nameHit.id,
                })
                continue
            }

            if (resolution.action === 'rename-local') {
                const newId = nodeCrypto.randomUUID()
                upsertMergedQuery({
                    ...lq,
                    id: newId,
                    name: resolution.newName,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                })
                continue
            }

            continue
        }

        // No conflict: add local query.
        upsertMergedQuery(lq)
    }

    const mergedSnapshot: NamedQueriesSnapshotV1 = {
        v: 1,
        queries: [...merged.values()],
        tombstones: opts.syncDeletions ? [...tombstoneById.values()] : [],
    }

    return normalizeSnapshot(mergedSnapshot)
}

async function remotePull(remoteUrl: string, authToken: string): Promise<{ version: number; ciphertextB64: string | null }> {
    const url = new URL('/api/sync/named-queries/pull', remoteUrl).toString()
    let res: Response
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'x-dbconsole-sync-token': authToken },
        })
    } catch (e) {
        throw new Error(`Remote pull failed: ${describeFetchError(e)} (url=${url})`)
    }

    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(`Remote pull failed (${res.status}): ${JSON.stringify(body)}`)
    }

    const body = (await res.json()) as { version: number; ciphertextB64: string | null }
    return { version: Number(body.version ?? 0), ciphertextB64: body.ciphertextB64 ?? null }
}

async function remotePush(
    remoteUrl: string,
    authToken: string,
    baseVersion: number,
    ciphertextB64: string | null,
): Promise<{ ok: true; version: number } | { ok: false; conflict: true; currentVersion: number; ciphertextB64: string | null }> {
    const url = new URL('/api/sync/named-queries/push', remoteUrl).toString()
    let res: Response
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'x-dbconsole-sync-token': authToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion, ciphertextB64 }),
        })
    } catch (e) {
        throw new Error(`Remote push failed: ${describeFetchError(e)} (url=${url})`)
    }

    if (res.status === 409) {
        const body = (await res.json()) as { currentVersion: number; ciphertextB64: string | null }
        return { ok: false, conflict: true, currentVersion: Number(body.currentVersion ?? 0), ciphertextB64: body.ciphertextB64 ?? null }
    }

    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(`Remote push failed (${res.status}): ${JSON.stringify(body)}`)
    }

    const body = (await res.json()) as { version: number }
    return { ok: true, version: Number(body.version) }
}

export async function syncNamedQueriesWithServer(opts: {
    remoteUrl: string
    syncPhrase: string
    resolutions?: NamedQuerySyncResolution[]
    syncDeletions?: boolean
}): Promise<NamedQuerySyncResult> {
    const { remoteUrl, syncPhrase, resolutions } = opts
    const syncDeletions = shouldSyncDeletions(opts.syncDeletions)

    const { encKey, authToken } = deriveSyncChainKeys(syncPhrase)

    // 1) Load local snapshot.
    const local = buildLocalSnapshot({ syncDeletions })

    // 2) Pull remote snapshot.
    let pulled = await remotePull(remoteUrl, authToken)
    let remote = pulled.ciphertextB64 ? decryptCiphertextB64ToSnapshot(pulled.ciphertextB64, encKey) : emptySnapshot()
    if (!syncDeletions && remote.tombstones.length > 0) {
        remote = { ...remote, tombstones: [] }
    }

    // 2.5) Load merge base snapshot from the last successful sync.
    // If none exists (first run), treat the current remote snapshot as our base to avoid spurious conflicts.
    const base = loadMergeBaseSnapshot({ syncDeletions }) ?? normalizeSnapshot(remote)

    // 3) Merge + push with optimistic concurrency retries.
    const maxAttempts = 3
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const conflicts = computeConflicts(base, local, remote)
        if (conflicts.length > 0) {
            if (!resolutions || resolutions.length === 0) {
                return { status: 'conflict', remoteVersion: pulled.version, conflicts }
            }

            const resolutionKeys = new Set(resolutions.map((r) => r.conflictKey))
            const missing = conflicts.find((c) => !resolutionKeys.has(c.conflictKey))
            if (missing) {
                return { status: 'conflict', remoteVersion: pulled.version, conflicts }
            }
        }

        const merged = applyResolutions(base, local, remote, resolutions ?? [], { syncDeletions })

        // No push needed; still align local to merged result.
        if (snapshotEquals(merged, remote)) {
            replaceNamedQueriesAndTombstones(merged.queries, merged.tombstones, { preserveLocalTombstones: !syncDeletions })
            try {
                setSyncNamedQueriesLastSnapshotJson(JSON.stringify(merged))
                setSyncNamedQueriesLastRemoteVersion(pulled.version)
            } catch (e) {
                console.warn('Failed to persist sync merge base', e)
            }
            return { status: 'ok', remoteVersion: pulled.version, pushed: false }
        }

        const ciphertextB64 = encryptSnapshotToCiphertextB64(merged, encKey)
        const pushRes = await remotePush(remoteUrl, authToken, pulled.version, ciphertextB64)
        if (pushRes.ok) {
            replaceNamedQueriesAndTombstones(merged.queries, merged.tombstones, { preserveLocalTombstones: !syncDeletions })
            try {
                setSyncNamedQueriesLastSnapshotJson(JSON.stringify(merged))
                setSyncNamedQueriesLastRemoteVersion(pushRes.version)
            } catch (e) {
                console.warn('Failed to persist sync merge base', e)
            }
            return { status: 'ok', remoteVersion: pulled.version, pushed: true, newRemoteVersion: pushRes.version }
        }

        // Remote moved (someone pushed). Refresh remote snapshot and retry merge.
        pulled = { version: pushRes.currentVersion, ciphertextB64: pushRes.ciphertextB64 }
        remote = pushRes.ciphertextB64 ? decryptCiphertextB64ToSnapshot(pushRes.ciphertextB64, encKey) : emptySnapshot()
        if (!syncDeletions && remote.tombstones.length > 0) {
            remote = { ...remote, tombstones: [] }
        }
    }

    const finalConflicts = computeConflicts(base, local, remote)
    if (finalConflicts.length === 0) {
        throw new Error('Sync failed due to concurrent updates; please retry')
    }
    return { status: 'conflict', remoteVersion: pulled.version, conflicts: finalConflicts }
}
