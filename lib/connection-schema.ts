import { z } from 'zod'

export const ConnectionDraftSchema = z.object({
    label: z.string().min(1),
    host: z.string().min(1),
    port: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    database: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    readOnly: z.boolean().default(true),
})

export type ConnectionDraftInput = z.infer<typeof ConnectionDraftSchema>
