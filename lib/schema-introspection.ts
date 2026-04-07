import { getConnectionById } from '@/lib/connections'
import { getPoolForConnection } from '@/lib/pg-pool'

export type TableRef = { schema: string; name: string }

/** Distinguishes regular tables from views and materialized views in the unified list. */
export type RelationKind = 'table' | 'view' | 'matview'

export type RelationRef = TableRef & { kind: RelationKind }

export type ColumnInfo = {
    table: TableRef
    name: string
    dataType: string
    isNullable: boolean
    defaultValue?: string | null
    isIdentity?: boolean
    identityGeneration?: string | null
    isGenerated?: boolean
    generationExpression?: string | null
}

export type ForeignKeyEdge = {
    from: TableRef
    fromColumn: string
    to: TableRef
    toColumn: string
}

export type IndexInfo = {
    table: TableRef
    name: string
    isUnique: boolean
    isPrimary: boolean
    columns: string[]
    definition: string
}

export type TriggerInfo = {
    table: TableRef
    name: string
    timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF' | string
    events: string[]
    definition: string
}

export type RoutineInfo = {
    schema: string
    name: string
    kind: 'function' | 'procedure' | 'aggregate' | 'window'
    language: string
    returnType?: string
    argsSignature: string
}

export type SchemaGraph = {
    tables: TableRef[]
    /** All relations (tables + views + matviews) with kind for type-aware UI. */
    relations: RelationRef[]
    columns: ColumnInfo[]
    foreignKeys: ForeignKeyEdge[]
    primaryKeys: { table: TableRef; columnName: string }[]
    indexes: IndexInfo[]
    triggers: TriggerInfo[]
    routines: RoutineInfo[]
}

export async function loadSchemaGraph(connectionId: string): Promise<SchemaGraph> {
    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new Error('Connection not found')
    }

    const pool = getPoolForConnection(conn)

    const [tablesRes, columnsRes, fksRes, pksRes, viewsRes, matviewsRes, indexesRes, triggersRes, routinesRes] = await Promise.all([
        pool.query(
            `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`,
        ),
        pool.query(
            `SELECT table_schema, table_name, column_name, data_type, is_nullable,
                    column_default, is_identity, identity_generation, is_generated, generation_expression
       FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name, ordinal_position`,
        ),
        // Use pg_catalog for foreign keys to be more reliable across environments/replicas
        pool.query(
            `SELECT
              ns_from.nspname AS src_schema,
              tbl_from.relname AS src_table,
              att_from.attname AS src_column,
              ns_to.nspname   AS dest_schema,
              tbl_to.relname  AS dest_table,
              att_to.attname  AS dest_column
            FROM pg_constraint con
            JOIN pg_class tbl_from ON tbl_from.oid = con.conrelid
            JOIN pg_namespace ns_from ON ns_from.oid = tbl_from.relnamespace
            JOIN pg_class tbl_to ON tbl_to.oid = con.confrelid
            JOIN pg_namespace ns_to ON ns_to.oid = tbl_to.relnamespace
            -- Align FK columns by ordinal position within the constraint
            JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS fk_cols(attnum, ord) ON true
            JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk_cols(attnum, ord) ON pk_cols.ord = fk_cols.ord
            JOIN pg_attribute att_from ON att_from.attrelid = con.conrelid AND att_from.attnum = fk_cols.attnum
            JOIN pg_attribute att_to   ON att_to.attrelid   = con.confrelid AND att_to.attnum   = pk_cols.attnum
            WHERE con.contype = 'f'
              AND ns_from.nspname NOT IN ('pg_catalog', 'information_schema')
              AND ns_to.nspname   NOT IN ('pg_catalog', 'information_schema')`,
        ),
        // Primary keys via pg_catalog to avoid information_schema visibility issues on replicas
        pool.query(
            `SELECT
              ns.nspname AS table_schema,
              cls.relname AS table_name,
              att.attname AS column_name
            FROM pg_index idx
            JOIN pg_class cls ON cls.oid = idx.indrelid
            JOIN pg_namespace ns ON ns.oid = cls.relnamespace
            JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ANY(idx.indkey)
            WHERE idx.indisprimary
              AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
        ),
        // Views (regular)
        pool.query(
            `SELECT schemaname AS table_schema, viewname AS table_name
             FROM pg_views
             WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY schemaname, viewname`,
        ),
        // Materialized views
        pool.query(
            `SELECT schemaname AS table_schema, matviewname AS table_name
             FROM pg_matviews
             WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY schemaname, matviewname`,
        ),
        // Indexes (excluding primary keys, those are surfaced separately as PKs)
        pool.query(
            `SELECT
                ns.nspname AS table_schema,
                cls.relname AS table_name,
                ic.relname AS index_name,
                idx.indisunique AS is_unique,
                idx.indisprimary AS is_primary,
                pg_get_indexdef(idx.indexrelid) AS definition,
                ARRAY(
                    SELECT a.attname
                    FROM unnest(idx.indkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = cls.oid AND a.attnum = k.attnum
                    ORDER BY k.ord
                ) AS column_names
             FROM pg_index idx
             JOIN pg_class cls ON cls.oid = idx.indrelid
             JOIN pg_class ic ON ic.oid = idx.indexrelid
             JOIN pg_namespace ns ON ns.oid = cls.relnamespace
             WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY ns.nspname, cls.relname, ic.relname`,
        ),
        // Triggers
        pool.query(
            `SELECT
                ns.nspname AS table_schema,
                cls.relname AS table_name,
                tg.tgname AS trigger_name,
                CASE
                    WHEN (tg.tgtype & 64) <> 0 THEN 'INSTEAD OF'
                    WHEN (tg.tgtype & 2) <> 0 THEN 'BEFORE'
                    ELSE 'AFTER'
                END AS timing,
                ARRAY(
                    SELECT ev FROM (
                        SELECT 'INSERT' AS ev WHERE (tg.tgtype & 4) <> 0
                        UNION ALL SELECT 'DELETE' WHERE (tg.tgtype & 8) <> 0
                        UNION ALL SELECT 'UPDATE' WHERE (tg.tgtype & 16) <> 0
                        UNION ALL SELECT 'TRUNCATE' WHERE (tg.tgtype & 32) <> 0
                    ) e
                ) AS events,
                pg_get_triggerdef(tg.oid) AS definition
             FROM pg_trigger tg
             JOIN pg_class cls ON cls.oid = tg.tgrelid
             JOIN pg_namespace ns ON ns.oid = cls.relnamespace
             WHERE NOT tg.tgisinternal
               AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY ns.nspname, cls.relname, tg.tgname`,
        ),
        // Functions, procedures, aggregates (from pg_proc)
        pool.query(
            `SELECT
                ns.nspname AS schema,
                p.proname AS name,
                CASE p.prokind
                    WHEN 'f' THEN 'function'
                    WHEN 'p' THEN 'procedure'
                    WHEN 'a' THEN 'aggregate'
                    WHEN 'w' THEN 'window'
                    ELSE 'function'
                END AS kind,
                l.lanname AS language,
                pg_get_function_result(p.oid) AS return_type,
                pg_get_function_arguments(p.oid) AS args
             FROM pg_proc p
             JOIN pg_namespace ns ON ns.oid = p.pronamespace
             JOIN pg_language l ON l.oid = p.prolang
             WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
               AND p.prokind IN ('f', 'p', 'a', 'w')
             ORDER BY ns.nspname, p.proname`,
        ),
    ])

    const tables: TableRef[] = tablesRes.rows.map((r) => ({
        schema: r.table_schema as string,
        name: r.table_name as string,
    }))

    const columns: ColumnInfo[] = columnsRes.rows.map((r) => ({
        table: { schema: r.table_schema as string, name: r.table_name as string },
        name: r.column_name as string,
        dataType: r.data_type as string,
        isNullable: String(r.is_nullable).toLowerCase() === 'yes',
        defaultValue: r.column_default as string | null | undefined,
        isIdentity: String(r.is_identity).toLowerCase() === 'yes',
        identityGeneration: r.identity_generation as string | null | undefined,
        isGenerated: String(r.is_generated).toLowerCase() === 'yes',
        generationExpression: r.generation_expression as string | null | undefined,
    }))

    const foreignKeys: ForeignKeyEdge[] = fksRes.rows.map((r) => ({
        from: { schema: r.src_schema as string, name: r.src_table as string },
        fromColumn: r.src_column as string,
        to: { schema: r.dest_schema as string, name: r.dest_table as string },
        toColumn: r.dest_column as string,
    }))

    const primaryKeys: { table: TableRef; columnName: string }[] = pksRes.rows.map((r) => ({
        table: { schema: r.table_schema as string, name: r.table_name as string },
        columnName: r.column_name as string,
    }))

    const views: RelationRef[] = viewsRes.rows.map((r) => ({
        schema: r.table_schema as string,
        name: r.table_name as string,
        kind: 'view' as const,
    }))
    const matviews: RelationRef[] = matviewsRes.rows.map((r) => ({
        schema: r.table_schema as string,
        name: r.table_name as string,
        kind: 'matview' as const,
    }))

    const relations: RelationRef[] = [
        ...tables.map((t): RelationRef => ({ ...t, kind: 'table' })),
        ...views,
        ...matviews,
    ]

    const indexes: IndexInfo[] = indexesRes.rows.map((r) => ({
        table: { schema: r.table_schema as string, name: r.table_name as string },
        name: r.index_name as string,
        isUnique: !!r.is_unique,
        isPrimary: !!r.is_primary,
        columns: Array.isArray(r.column_names) ? (r.column_names as string[]) : [],
        definition: String(r.definition ?? ''),
    }))

    const triggers: TriggerInfo[] = triggersRes.rows.map((r) => ({
        table: { schema: r.table_schema as string, name: r.table_name as string },
        name: r.trigger_name as string,
        timing: r.timing as TriggerInfo['timing'],
        events: Array.isArray(r.events) ? (r.events as string[]) : [],
        definition: String(r.definition ?? ''),
    }))

    const routines: RoutineInfo[] = routinesRes.rows.map((r) => ({
        schema: r.schema as string,
        name: r.name as string,
        kind: r.kind as RoutineInfo['kind'],
        language: r.language as string,
        returnType: r.return_type ? String(r.return_type) : undefined,
        argsSignature: String(r.args ?? ''),
    }))

    return { tables, relations, columns, foreignKeys, primaryKeys, indexes, triggers, routines }
}
