import { getConnectionById } from '@/lib/connections'
import { getPoolForConnection } from '@/lib/pg-pool'

export type TableRef = { schema: string; name: string }

export type ColumnInfo = {
    table: TableRef
    name: string
    dataType: string
    isNullable: boolean
}

export type ForeignKeyEdge = {
    from: TableRef
    fromColumn: string
    to: TableRef
    toColumn: string
}

export type SchemaGraph = {
    tables: TableRef[]
    columns: ColumnInfo[]
    foreignKeys: ForeignKeyEdge[]
    primaryKeys: { table: TableRef; columnName: string }[]
}

export async function loadSchemaGraph(connectionId: string): Promise<SchemaGraph> {
    const conn = getConnectionById(connectionId)
    if (!conn) {
        throw new Error('Connection not found')
    }

    const pool = getPoolForConnection(conn)

    const [tablesRes, columnsRes, fksRes, pksRes] = await Promise.all([
        pool.query(
            `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`,
        ),
        pool.query(
            `SELECT table_schema, table_name, column_name, data_type, is_nullable
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

    return { tables, columns, foreignKeys, primaryKeys }
}
