import { runQuery, type NamedQueryInput, type RawQueryInput, type QueryResult } from '@/lib/query-engine'

export async function runApiQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult> {
    return runQuery(input)
}

