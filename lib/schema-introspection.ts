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
        pool.query(
            `SELECT
         tc.table_schema AS src_schema,
         tc.table_name   AS src_table,
         kcu.column_name AS src_column,
         ccu.table_schema AS dest_schema,
         ccu.table_name   AS dest_table,
         ccu.column_name  AS dest_column
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`,
        ),
        pool.query(
            `SELECT
         tc.table_schema,
         tc.table_name,
         kcu.column_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`,
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
