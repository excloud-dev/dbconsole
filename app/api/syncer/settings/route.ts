import { NextResponse } from 'next/server'
import { z } from 'zod'
import { clearSyncerSettings, getSyncerSettings, setSyncerPhrase, setSyncerRemoteUrl, setSyncerSyncDeletions } from '@/lib/core/syncer-settings'

export const runtime = 'nodejs'

const SaveSettingsSchema = z.object({
    clear: z.boolean().optional(),
    remoteUrl: z.string().url().optional(),
    syncPhrase: z.string().min(1).optional(),
    syncDeletions: z.boolean().optional(),
})

export async function GET() {
    return NextResponse.json(getSyncerSettings())
}

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const parsed = SaveSettingsSchema.parse(json)

        if (parsed.clear) {
            clearSyncerSettings()
            return NextResponse.json({ ok: true })
        }

        if (parsed.remoteUrl !== undefined) {
            setSyncerRemoteUrl(parsed.remoteUrl)
        }
        if (parsed.syncPhrase !== undefined) {
            setSyncerPhrase(parsed.syncPhrase)
        }
        if (parsed.syncDeletions !== undefined) {
            setSyncerSyncDeletions(parsed.syncDeletions)
        }

        return NextResponse.json({ ok: true })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: 'Invalid sync settings', issues: err.issues }, { status: 400 })
        }
        return NextResponse.json({ error: 'Failed to save sync settings' }, { status: 500 })
    }
}
