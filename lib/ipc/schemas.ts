// Single source of truth for IPC / API request schemas that are shared
// between the Next.js route handlers (app/api/**) and the Electron IPC
// handlers (electron/ipc.ts).
//
// Anything that is duplicated across both runtimes belongs here. Schemas
// that are only used by one side (e.g. updater settings, syncer-only
// payloads) should stay where they're used.

import { z } from 'zod'

export const PoolModeSchema = z.enum(['single', 'shared', 'per-scope']).optional()
export type PoolModeInput = z.infer<typeof PoolModeSchema>

export const RawQuerySchema = z.object({
    kind: z.literal('raw'),
    sql: z.string().min(1),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    params: z.array(z.any()).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
})
export type RawQueryRequest = z.infer<typeof RawQuerySchema>

export const NamedQuerySchema = z.object({
    kind: z.literal('named'),
    queryId: z.string().min(1),
    params: z.record(z.any()).default({}),
    originalSql: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    poolMode: PoolModeSchema,
    scopeKey: z.string().min(1).optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    includeCount: z.boolean().optional(),
})
export type NamedQueryRequest = z.infer<typeof NamedQuerySchema>

export const QueryRunBodySchema = z.union([RawQuerySchema, NamedQuerySchema])
export type QueryRunRequest = z.infer<typeof QueryRunBodySchema>

// ---- Streaming ------------------------------------------------------------
//
// `open` accepts the same RawQuery / NamedQuery shapes as `run`, plus an
// optional batch size. The handler returns a stream id that the client uses
// to call `next` and `close`.

export const StreamOpenBodySchema = z.object({
    query: QueryRunBodySchema,
    batchSize: z.number().int().positive().max(10_000).optional(),
})
export type StreamOpenRequest = z.infer<typeof StreamOpenBodySchema>

export const StreamNextBodySchema = z.object({
    streamId: z.string().min(1),
    batchSize: z.number().int().positive().max(10_000).optional(),
})
export type StreamNextRequest = z.infer<typeof StreamNextBodySchema>

export const StreamCloseBodySchema = z.object({
    streamId: z.string().min(1),
})
export type StreamCloseRequest = z.infer<typeof StreamCloseBodySchema>
