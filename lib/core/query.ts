import { runQuery, type NamedQueryInput, type RawQueryInput, type QueryResult } from '@/lib/query-engine'
import {
    closeStream,
    fetchNext,
    openStream,
    type StreamCloseResult,
    type StreamNextResult,
    type StreamOpenResult,
} from '@/lib/query-stream'

export async function runApiQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult> {
    return runQuery(input)
}

export async function runApiStreamOpen(
    input: RawQueryInput | NamedQueryInput,
    opts: { batchSize?: number } = {},
): Promise<StreamOpenResult> {
    return openStream(input, opts)
}

export async function runApiStreamNext(
    streamId: string,
    opts: { batchSize?: number } = {},
): Promise<StreamNextResult> {
    return fetchNext(streamId, opts)
}

export async function runApiStreamClose(streamId: string): Promise<StreamCloseResult> {
    return closeStream(streamId, { reason: 'user' })
}

