import type BetterSqlite3 from 'better-sqlite3'
import path from 'node:path'
import nodeCrypto from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { asc, eq } from 'drizzle-orm'
import { createRequire } from 'node:module'
import { maybeDecryptString, maybeEncryptString } from '@/lib/secrets/aes-gcm'

// Server-only SQLite metadata DB for dbconsole.
// Holds UI-defined connections, named queries, and query run logs.

let _db: BetterSqlite3.Database | undefined
let _orm: ReturnType<typeof drizzle> | undefined
let _localEncryptionKey32: Buffer | null = null

function getDbPath() {
    const envPath = process.env.DBCONSOLE_META_SQLITE_PATH
    if (envPath && envPath.trim().length > 0) {
        return envPath
    }
    return path.join(process.cwd(), 'dbconsole-meta.sqlite')
}

function loadBetterSqlite3() {
    // When running under Electron, we need an Electron-ABI build of better-sqlite3.
    // Keeping a separate Electron-only node_modules tree prevents breaking Node.js dev (Next) builds.
    const nativeDir = process.env.DBCONSOLE_ELECTRON_NATIVE_DIR
    if (nativeDir && nativeDir.trim().length > 0) {
        const req = createRequire(path.join(nativeDir, 'package.json'))
        return req('better-sqlite3') as typeof import('better-sqlite3')
    }

    // Default: use the standard Node resolution (web/dev server).
    return require('better-sqlite3') as typeof import('better-sqlite3')
}

export function getMetaDb(): BetterSqlite3.Database {
    if (_db) return _db
    const dbPath = getDbPath()
    const Database = loadBetterSqlite3()
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    migrate(db)

    _db = db
    return db
}

function getOrm() {
    if (_orm) return _orm
    const db = getMetaDb()
    _orm = drizzle(db)
    return _orm
}

function migrate(db: BetterSqlite3.Database) {
    function hasColumn(tableName: string, columnName: string): boolean {
        try {
            const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[]
            return rows.some((r) => String(r.name) === columnName)
        } catch {
            return false
        }
    }

    // Connections table: UI-defined Postgres connections only.
    db.exec(`
    CREATE TABLE IF NOT EXISTS dbconsole_connections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'postgres',
      origin TEXT NOT NULL DEFAULT 'ui',
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

    // App settings / key-value store.
    db.exec(`
        CREATE TABLE IF NOT EXISTS dbconsole_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `)

    // Named queries table.
    db.exec(`
    CREATE TABLE IF NOT EXISTS dbconsole_queries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sql_template TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '[]',
      default_connection_id TEXT,
            deleted_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

    // Backfill column on existing DBs created before deleted_at existed.
    if (!hasColumn('dbconsole_queries', 'deleted_at')) {
        db.exec('ALTER TABLE dbconsole_queries ADD COLUMN deleted_at TEXT')
    }

    // Tombstones for propagating deletions during sync.
    db.exec(`
        CREATE TABLE IF NOT EXISTS dbconsole_query_tombstones (
            id TEXT PRIMARY KEY,
            name TEXT,
            deleted_at TEXT NOT NULL
        );
    `)

    // E2E sync storage (server-side relay). Stores opaque ciphertext only.
    db.exec(`
        CREATE TABLE IF NOT EXISTS dbconsole_sync_named_queries (
            chain_id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            ciphertext_b64 TEXT,
            updated_at TEXT NOT NULL
        );
    `)

    // Query runs / audit log.
    db.exec(`
    CREATE TABLE IF NOT EXISTS dbconsole_query_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      named_query_id TEXT,
      connection_id TEXT NOT NULL,
      user_id TEXT,
      sql TEXT NOT NULL,
      rows_returned INTEGER,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `)
}

const dbconsoleConnections = sqliteTable('dbconsole_connections', {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    kind: text('kind').notNull().default('postgres'),
    origin: text('origin').notNull().default('ui'),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    database: text('database').notNull(),
    username: text('username').notNull(),
    password: text('password').notNull(),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
})

const dbconsoleSettings = sqliteTable('dbconsole_settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
})

const dbconsoleQueries = sqliteTable('dbconsole_queries', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    sqlTemplate: text('sql_template').notNull(),
    paramsJson: text('params_json').notNull().default('[]'),
    defaultConnectionId: text('default_connection_id'),
    deletedAt: text('deleted_at'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
})

const dbconsoleQueryTombstones = sqliteTable('dbconsole_query_tombstones', {
    id: text('id').primaryKey(),
    name: text('name'),
    deletedAt: text('deleted_at').notNull(),
})

const dbconsoleSyncNamedQueries = sqliteTable('dbconsole_sync_named_queries', {
    chainId: text('chain_id').primaryKey(),
    version: integer('version').notNull(),
    ciphertextB64: text('ciphertext_b64'),
    updatedAt: text('updated_at').notNull(),
})

const dbconsoleQueryRuns = sqliteTable('dbconsole_query_runs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    namedQueryId: text('named_query_id'),
    connectionId: text('connection_id').notNull(),
    userId: text('user_id'),
    sql: text('sql').notNull(),
    rowsReturned: integer('rows_returned'),
    durationMs: integer('duration_ms'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
})

function isElectronMainProcess(): boolean {
    return !!process.versions.electron && (process as any).type === 'browser'
}

function getSettingValue(key: string): string | null {
    const db = getOrm()
    const row = db
        .select({ value: dbconsoleSettings.value })
        .from(dbconsoleSettings)
        .where(eq(dbconsoleSettings.key, key))
        .get()
    return row?.value ?? null
}

function setSettingValue(key: string, value: string): void {
    const db = getOrm()
    const now = new Date().toISOString()
    const existing = db
        .select({ key: dbconsoleSettings.key })
        .from(dbconsoleSettings)
        .where(eq(dbconsoleSettings.key, key))
        .get()

    if (existing) {
        db.update(dbconsoleSettings)
            .set({ value, updatedAt: now })
            .where(eq(dbconsoleSettings.key, key))
            .run()
    } else {
        db.insert(dbconsoleSettings)
            .values({ key, value, updatedAt: now })
            .run()
    }
}

function getLocalEncryptionKey32(): Buffer {
    if (_localEncryptionKey32) return _localEncryptionKey32

    if (isElectronMainProcess()) {
        // Dynamically require to avoid bundling Electron into Next.js server.
        const { safeStorage } = require('electron') as typeof import('electron')

        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error(
                'Electron safeStorage encryption is not available. On non-Electron runtimes, set DBCONSOLE_SECRET_KEY_B64 to enable encryption at rest.',
            )
        }

        const wrappedB64 = getSettingValue('encryption.key.wrapped.v1')
        if (wrappedB64 && wrappedB64.trim()) {
            try {
                const wrapped = Buffer.from(wrappedB64, 'base64')
                const keyB64 = safeStorage.decryptString(wrapped)
                const key = Buffer.from(String(keyB64), 'base64')
                if (key.length === 32) {
                    _localEncryptionKey32 = key
                    return key
                }
            } catch {
                // If the wrapped key can't be decrypted (e.g. moved DB / OS keychain reset), rotate to a new key.
            }
        }

        const key = nodeCrypto.randomBytes(32)
        const keyB64 = key.toString('base64')
        const wrapped = safeStorage.encryptString(keyB64)
        setSettingValue('encryption.key.wrapped.v1', Buffer.from(wrapped).toString('base64'))
        _localEncryptionKey32 = key
        return key
    }

    const env = process.env.DBCONSOLE_SECRET_KEY_B64
    if (!env || !env.trim()) {
        throw new Error('Missing DBCONSOLE_SECRET_KEY_B64 (base64 32-byte key) to enable encryption at rest.')
    }

    const key = Buffer.from(env.trim(), 'base64')
    if (key.length !== 32) {
        throw new Error('DBCONSOLE_SECRET_KEY_B64 must decode to exactly 32 bytes')
    }

    _localEncryptionKey32 = key
    return key
}

function deleteSettingValue(key: string): void {
    const db = getOrm()
    db.delete(dbconsoleSettings).where(eq(dbconsoleSettings.key, key)).run()
}

export function getSetting(key: string): string | null {
    return getSettingValue(key)
}

export function setSetting(key: string, value: string): void {
    setSettingValue(key, value)
}

export function deleteSetting(key: string): void {
    deleteSettingValue(key)
}

export function getDecryptedSetting(key: string): string | null {
    const raw = getSettingValue(key)
    if (raw === null) return null
    try {
        return maybeDecryptString(raw, getLocalEncryptionKey32())
    } catch {
        // If the encryption key has changed or the value is corrupted, treat as missing so the user can re-enter it.
        return null
    }
}

export function setEncryptedSetting(key: string, plaintext: string): void {
    setSettingValue(key, maybeEncryptString(plaintext, getLocalEncryptionKey32()))
}

export type UiConnectionRow = {
    id: string
    label: string
    kind: 'postgres'
    origin: 'ui'
    host: string
    port: number
    database: string
    username: string
    password: string
    readOnly: boolean
    createdAt: string
    updatedAt: string
}

export type QueryParamDef = {
    name: string
    type: 'string' | 'number' | 'boolean'
    defaultValue?: string
}

export type DbconsoleQueryRow = {
    id: string
    name: string
    description?: string
    sqlTemplate: string
    paramsJson: string
    defaultConnectionId?: string
    deletedAt?: string
    createdBy?: string
    createdAt: string
    updatedAt: string
}

export type QueryTombstoneRow = {
    id: string
    name?: string
    deletedAt: string
}

export type QueryRunRow = {
    id: number
    kind: 'raw' | 'named'
    namedQueryId?: string
    connectionId: string
    userId?: string
    sql: string
    rowsReturned?: number
    durationMs?: number
    status: 'ok' | 'error' | 'timeout'
    errorMessage?: string
    createdAt: string
}

// --- Connection helpers ---

export function listUiConnections(): UiConnectionRow[] {
    const db = getOrm()
    const rows = db
        .select()
        .from(dbconsoleConnections)
        .orderBy(asc(dbconsoleConnections.label))
        .all()

    return rows.map((r) => mapConnectionRow(r))
}

export type UiConnectionInsert = {
    id: string
    label: string
    host: string
    port: number
    database: string
    username: string
    password: string
    readOnly: boolean
}

export function insertUiConnection(input: UiConnectionInsert): UiConnectionRow {
    const db = getOrm()
    const now = new Date().toISOString()
    const key = getLocalEncryptionKey32()
    db.insert(dbconsoleConnections)
        .values({
            id: input.id,
            label: input.label,
            kind: 'postgres',
            origin: 'ui',
            host: input.host,
            port: input.port,
            database: input.database,
            username: input.username,
            password: maybeEncryptString(input.password, key),
            readOnly: input.readOnly,
            createdAt: now,
            updatedAt: now,
        })
        .run()

    const row = db
        .select()
        .from(dbconsoleConnections)
        .where(eq(dbconsoleConnections.id, input.id))
        .get()!
    return mapConnectionRow(row)
}

export type UiConnectionUpdate = {
    label?: string
    host?: string
    port?: number
    database?: string
    username?: string
    password?: string
    readOnly?: boolean
}

export function updateUiConnection(id: string, updates: UiConnectionUpdate): UiConnectionRow | null {
    const db = getOrm()
    const existing = db
        .select()
        .from(dbconsoleConnections)
        .where(eq(dbconsoleConnections.id, id))
        .get()
    if (!existing) return null

    const key = getLocalEncryptionKey32()

    const merged = {
        ...existing,
        label: updates.label ?? existing.label,
        host: updates.host ?? existing.host,
        port: updates.port ?? existing.port,
        database: updates.database ?? existing.database,
        username: updates.username ?? existing.username,
        password: updates.password !== undefined ? maybeEncryptString(updates.password, key) : existing.password,
        readOnly: typeof updates.readOnly === 'boolean' ? updates.readOnly : existing.readOnly,
        updatedAt: new Date().toISOString(),
    }

    db.update(dbconsoleConnections)
        .set({
            label: merged.label,
            host: merged.host,
            port: merged.port,
            database: merged.database,
            username: merged.username,
            password: merged.password,
            readOnly: merged.readOnly,
            updatedAt: merged.updatedAt,
        })
        .where(eq(dbconsoleConnections.id, id))
        .run()

    const row = db
        .select()
        .from(dbconsoleConnections)
        .where(eq(dbconsoleConnections.id, id))
        .get()!
    return mapConnectionRow(row)
}

export function deleteUiConnection(id: string): void {
    const db = getOrm()
    db.delete(dbconsoleConnections).where(eq(dbconsoleConnections.id, id)).run()
}

type DbconsoleConnectionRow = typeof dbconsoleConnections.$inferSelect

function mapConnectionRow(r: DbconsoleConnectionRow): UiConnectionRow {
    const key = getLocalEncryptionKey32()
    let password = String(r.password)
    try {
        password = maybeDecryptString(password, key)
    } catch {
        // Keep the row accessible so the user can re-enter a password via UI.
        password = ''
    }
    return {
        id: String(r.id),
        label: String(r.label),
        kind: 'postgres',
        origin: 'ui',
        host: String(r.host),
        port: Number(r.port),
        database: String(r.database),
        username: String(r.username),
        password,
        readOnly: Boolean(r.readOnly),
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
    }
}

// --- Named query helpers ---

export function listNamedQueries(): DbconsoleQueryRow[] {
    const db = getOrm()
    const rows = db
        .select()
        .from(dbconsoleQueries)
        .orderBy(asc(dbconsoleQueries.name))
        .all()

    return rows.map(mapQueryRow)
}

export function getNamedQuery(id: string): DbconsoleQueryRow | null {
    const db = getOrm()
    const row = db
        .select()
        .from(dbconsoleQueries)
        .where(eq(dbconsoleQueries.id, id))
        .get()
    if (!row) return null
    return mapQueryRow(row)
}

export type NamedQueryUpsertInput = {
    id?: string
    name: string
    description?: string
    sqlTemplate: string
    params: QueryParamDef[]
    defaultConnectionId?: string
}

export function upsertNamedQuery(input: NamedQueryUpsertInput): DbconsoleQueryRow {
    const db = getOrm()
    const now = new Date().toISOString()
    const id = input.id ?? crypto.randomUUID()
    const paramsJson = JSON.stringify(input.params ?? [])

    const existing = db
        .select({ id: dbconsoleQueries.id })
        .from(dbconsoleQueries)
        .where(eq(dbconsoleQueries.id, id))
        .get()

    if (existing) {
        db.update(dbconsoleQueries)
            .set({
                name: input.name,
                description: input.description ?? null,
                sqlTemplate: input.sqlTemplate,
                paramsJson,
                defaultConnectionId: input.defaultConnectionId ?? null,
                updatedAt: now,
            })
            .where(eq(dbconsoleQueries.id, id))
            .run()
    } else {
        db.insert(dbconsoleQueries)
            .values({
                id,
                name: input.name,
                description: input.description ?? null,
                sqlTemplate: input.sqlTemplate,
                paramsJson,
                defaultConnectionId: input.defaultConnectionId ?? null,
                createdBy: null,
                createdAt: now,
                updatedAt: now,
            })
            .run()
    }

    // If this query was previously deleted on this device, clear its tombstone.
    db.delete(dbconsoleQueryTombstones)
        .where(eq(dbconsoleQueryTombstones.id, id))
        .run()

    const row = db
        .select()
        .from(dbconsoleQueries)
        .where(eq(dbconsoleQueries.id, id))
        .get()!
    return mapQueryRow(row)
}

export function deleteNamedQuery(id: string): void {
    const db = getOrm()
    const existing = db
        .select({ id: dbconsoleQueries.id, name: dbconsoleQueries.name })
        .from(dbconsoleQueries)
        .where(eq(dbconsoleQueries.id, id))
        .get()

    if (existing) {
        const now = new Date().toISOString()
        const already = db
            .select({ id: dbconsoleQueryTombstones.id })
            .from(dbconsoleQueryTombstones)
            .where(eq(dbconsoleQueryTombstones.id, id))
            .get()

        if (already) {
            db.update(dbconsoleQueryTombstones)
                .set({ name: existing.name, deletedAt: now })
                .where(eq(dbconsoleQueryTombstones.id, id))
                .run()
        } else {
            db.insert(dbconsoleQueryTombstones)
                .values({ id, name: existing.name, deletedAt: now })
                .run()
        }
    }

    db.delete(dbconsoleQueries).where(eq(dbconsoleQueries.id, id)).run()
}

export function listNamedQueryTombstones(): QueryTombstoneRow[] {
    const db = getOrm()
    const rows = db
        .select()
        .from(dbconsoleQueryTombstones)
        .orderBy(asc(dbconsoleQueryTombstones.deletedAt))
        .all()

    return rows.map((r) => ({
        id: String(r.id),
        name: r.name === null || r.name === undefined ? undefined : String(r.name),
        deletedAt: String(r.deletedAt),
    }))
}

export type NamedQuerySyncRecord = {
    id: string
    name: string
    description?: string
    sqlTemplate: string
    paramsJson: string
    defaultConnectionId?: string
    createdBy?: string
    createdAt: string
    updatedAt: string
}

export function replaceNamedQueriesAndTombstones(
    queries: NamedQuerySyncRecord[],
    tombstones: QueryTombstoneRow[],
    opts?: { preserveLocalTombstones?: boolean },
): void {
    const db = getMetaDb()

    const tx = (db as any).transaction(() => {
        db.exec('DELETE FROM dbconsole_queries;')
        if (!opts?.preserveLocalTombstones) {
            db.exec('DELETE FROM dbconsole_query_tombstones;')
        }

        const insertQuery = db.prepare(
            'INSERT INTO dbconsole_queries (id, name, description, sql_template, params_json, default_connection_id, deleted_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )

        for (const q of queries) {
            insertQuery.run(
                q.id,
                q.name,
                q.description ?? null,
                q.sqlTemplate,
                q.paramsJson ?? '[]',
                q.defaultConnectionId ?? null,
                null,
                q.createdBy ?? null,
                q.createdAt,
                q.updatedAt,
            )
        }

        if (!opts?.preserveLocalTombstones) {
            const insertTombstone = db.prepare(
                'INSERT INTO dbconsole_query_tombstones (id, name, deleted_at) VALUES (?, ?, ?)',
            )
            for (const t of tombstones) {
                insertTombstone.run(t.id, t.name ?? null, t.deletedAt)
            }
        } else {
            // When deletions are local-only, keep local tombstones and ensure tombstoned ids stay deleted locally.
            db.exec('DELETE FROM dbconsole_queries WHERE id IN (SELECT id FROM dbconsole_query_tombstones);')
        }
    })

    tx()
}

type DbconsoleQueryRowInternal = typeof dbconsoleQueries.$inferSelect

function mapQueryRow(r: DbconsoleQueryRowInternal): DbconsoleQueryRow {
    return {
        id: String(r.id),
        name: String(r.name),
        description: r.description === null || r.description === undefined ? undefined : String(r.description),
        sqlTemplate: String(r.sqlTemplate),
        paramsJson: String(r.paramsJson ?? '[]'),
        defaultConnectionId:
            r.defaultConnectionId === null || r.defaultConnectionId === undefined
                ? undefined
                : String(r.defaultConnectionId),
        deletedAt: r.deletedAt === null || r.deletedAt === undefined ? undefined : String(r.deletedAt),
        createdBy: r.createdBy === null || r.createdBy === undefined ? undefined : String(r.createdBy),
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
    }
}

// --- E2E sync relay storage (server-side) ---

export type SyncNamedQueriesChainRow = {
    chainId: string
    version: number
    ciphertextB64: string | null
    updatedAt: string
}

export function getSyncNamedQueriesChain(chainId: string): SyncNamedQueriesChainRow | null {
    const db = getOrm()
    const row = db
        .select()
        .from(dbconsoleSyncNamedQueries)
        .where(eq(dbconsoleSyncNamedQueries.chainId, chainId))
        .get()
    if (!row) return null
    return {
        chainId: String(row.chainId),
        version: Number(row.version),
        ciphertextB64: row.ciphertextB64 === null || row.ciphertextB64 === undefined ? null : String(row.ciphertextB64),
        updatedAt: String(row.updatedAt),
    }
}

export type PushSyncNamedQueriesResult =
    | { ok: true; version: number }
    | { ok: false; conflict: true; currentVersion: number; ciphertextB64: string | null; updatedAt: string }

export function pushSyncNamedQueriesChain(
    chainId: string,
    baseVersion: number,
    ciphertextB64: string | null,
): PushSyncNamedQueriesResult {
    const db = getMetaDb()
    const now = new Date().toISOString()

    const tx = (db as any).transaction(() => {
        const selectStmt = db.prepare(
            'SELECT chain_id, version, ciphertext_b64, updated_at FROM dbconsole_sync_named_queries WHERE chain_id = ?',
        )
        const row = selectStmt.get(chainId) as
            | { chain_id: string; version: number; ciphertext_b64: string | null; updated_at: string }
            | undefined

        if (!row) {
            if (baseVersion !== 0) {
                return {
                    ok: false as const,
                    conflict: true as const,
                    currentVersion: 0,
                    ciphertextB64: null,
                    updatedAt: now,
                }
            }

            db.prepare(
                'INSERT INTO dbconsole_sync_named_queries (chain_id, version, ciphertext_b64, updated_at) VALUES (?, ?, ?, ?)',
            ).run(chainId, 1, ciphertextB64, now)

            return { ok: true as const, version: 1 }
        }

        const currentVersion = Number(row.version)
        if (currentVersion !== baseVersion) {
            return {
                ok: false as const,
                conflict: true as const,
                currentVersion,
                ciphertextB64: row.ciphertext_b64 ?? null,
                updatedAt: String(row.updated_at),
            }
        }

        const nextVersion = currentVersion + 1
        db.prepare(
            'UPDATE dbconsole_sync_named_queries SET version = ?, ciphertext_b64 = ?, updated_at = ? WHERE chain_id = ?',
        ).run(nextVersion, ciphertextB64, now, chainId)

        return { ok: true as const, version: nextVersion }
    })

    return tx() as PushSyncNamedQueriesResult
}

// --- Query run logging ---

export type LogQueryRunInput = {
    kind: QueryRunRow['kind']
    namedQueryId?: string
    connectionId: string
    userId?: string
    sql: string
    rowsReturned?: number
    durationMs?: number
    status: QueryRunRow['status']
    errorMessage?: string
}

export function logQueryRun(input: LogQueryRunInput): void {
    const db = getOrm()
    const now = new Date().toISOString()

    const truncatedSql = input.sql.length > 4000 ? input.sql.slice(0, 4000) : input.sql
    const truncatedError = input.errorMessage && input.errorMessage.length > 2000
        ? input.errorMessage.slice(0, 2000)
        : input.errorMessage ?? null

    db.insert(dbconsoleQueryRuns)
        .values({
            kind: input.kind,
            namedQueryId: input.namedQueryId ?? null,
            connectionId: input.connectionId,
            userId: input.userId ?? null,
            sql: truncatedSql,
            rowsReturned: input.rowsReturned ?? null,
            durationMs: input.durationMs ?? null,
            status: input.status,
            errorMessage: truncatedError,
            createdAt: now,
        })
        .run()
}
