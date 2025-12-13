import type BetterSqlite3 from 'better-sqlite3'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { asc, eq } from 'drizzle-orm'
import { createRequire } from 'node:module'

// Server-only SQLite metadata DB for dbconsole.
// Holds UI-defined connections, named queries, and query run logs.

let _db: BetterSqlite3.Database | undefined
let _orm: ReturnType<typeof drizzle> | undefined

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

function migrate(db: Database.Database) {
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

    // Named queries table.
    db.exec(`
    CREATE TABLE IF NOT EXISTS dbconsole_queries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sql_template TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '[]',
      default_connection_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
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

const dbconsoleQueries = sqliteTable('dbconsole_queries', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    sqlTemplate: text('sql_template').notNull(),
    paramsJson: text('params_json').notNull().default('[]'),
    defaultConnectionId: text('default_connection_id'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
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
    createdBy?: string
    createdAt: string
    updatedAt: string
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
            password: input.password,
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

    const merged = {
        ...existing,
        label: updates.label ?? existing.label,
        host: updates.host ?? existing.host,
        port: updates.port ?? existing.port,
        database: updates.database ?? existing.database,
        username: updates.username ?? existing.username,
        password: updates.password ?? existing.password,
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
    return {
        id: String(r.id),
        label: String(r.label),
        kind: 'postgres',
        origin: 'ui',
        host: String(r.host),
        port: Number(r.port),
        database: String(r.database),
        username: String(r.username),
        password: String(r.password),
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

    const row = db
        .select()
        .from(dbconsoleQueries)
        .where(eq(dbconsoleQueries.id, id))
        .get()!
    return mapQueryRow(row)
}

export function deleteNamedQuery(id: string): void {
    const db = getOrm()
    db.delete(dbconsoleQueries).where(eq(dbconsoleQueries.id, id)).run()
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
        createdBy: r.createdBy === null || r.createdBy === undefined ? undefined : String(r.createdBy),
        createdAt: String(r.createdAt),
        updatedAt: String(r.updatedAt),
    }
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
