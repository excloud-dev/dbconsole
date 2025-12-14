import { NextResponse } from 'next/server'
import { z } from 'zod'
import { syncNamedQueriesWithServer, type NamedQuerySyncResolution } from '@/lib/core/named-queries-sync'
import { getSyncerPhraseOrThrow, getSyncerRemoteUrlOrThrow, getSyncerSyncDeletions } from '@/lib/core/syncer-settings'

export const runtime = 'nodejs'

const ResolutionSchema: z.ZodType<NamedQuerySyncResolution> = z.discriminatedUnion('action', [
    z.object({ conflictKey: z.string().min(1), action: z.literal('keep-remote') }),
    z.object({ conflictKey: z.string().min(1), action: z.literal('keep-local') }),
    z.object({ conflictKey: z.string().min(1), action: z.literal('rename-local'), newName: z.string().min(1) }),
])

const BodySchema = z.object({
    resolutions: z.array(ResolutionSchema).optional(),
})

export async function POST(req: Request) {
    let resolutions: NamedQuerySyncResolution[] | undefined
    try {
        const json = await req.json().catch(() => ({}))
        const parsed = BodySchema.parse(json)
        resolutions = parsed.resolutions
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid sync payload', issues: err.issues }, { status: 400 })
        }
        return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400 })
    }

    let remoteUrl: string
    let syncPhrase: string
    try {
        remoteUrl = getSyncerRemoteUrlOrThrow()
        syncPhrase = getSyncerPhraseOrThrow()
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Missing sync settings'
        return NextResponse.json({ error: message }, { status: 400 })
    }

    try {
        const result = await syncNamedQueriesWithServer({ remoteUrl, syncPhrase, resolutions, syncDeletions: getSyncerSyncDeletions() })
        if (result.status === 'conflict') {
            return NextResponse.json({ error: 'Conflicts', remoteVersion: result.remoteVersion, conflicts: result.conflicts }, { status: 409 })
        }
        return NextResponse.json(result)
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Sync failed'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
