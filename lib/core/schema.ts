import { loadSchemaGraph, type SchemaGraph } from '@/lib/schema-introspection'

export async function loadSchema(connectionId: string): Promise<SchemaGraph> {
    return loadSchemaGraph(connectionId)
}

