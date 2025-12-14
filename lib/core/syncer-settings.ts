import { deleteSetting, getDecryptedSetting, getSetting, setEncryptedSetting, setSetting } from '@/lib/meta-db'

const SYNC_PHRASE_KEY = 'sync.phrase.v1'
const SYNC_REMOTE_URL_KEY = 'sync.remoteUrl'
const SYNC_DELETIONS_KEY = 'sync.namedQueries.syncDeletions.v1'
const SYNC_NAMED_QUERIES_LAST_SNAPSHOT_KEY = 'sync.namedQueries.lastSnapshot.v1'
const SYNC_NAMED_QUERIES_LAST_REMOTE_VERSION_KEY = 'sync.namedQueries.lastRemoteVersion.v1'

export type SyncerSettings = {
    remoteUrl: string | null
    hasPhrase: boolean
    syncDeletions: boolean
}

export function getSyncNamedQueriesLastSnapshotJson(): string | null {
    return getDecryptedSetting(SYNC_NAMED_QUERIES_LAST_SNAPSHOT_KEY)
}

export function setSyncNamedQueriesLastSnapshotJson(snapshotJson: string): void {
    setEncryptedSetting(SYNC_NAMED_QUERIES_LAST_SNAPSHOT_KEY, snapshotJson)
}

export function getSyncNamedQueriesLastRemoteVersion(): number | null {
    const raw = getSetting(SYNC_NAMED_QUERIES_LAST_REMOTE_VERSION_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
}

export function setSyncNamedQueriesLastRemoteVersion(version: number): void {
    setSetting(SYNC_NAMED_QUERIES_LAST_REMOTE_VERSION_KEY, String(version))
}

export function getSyncerSettings(): SyncerSettings {
    const remoteUrl = getSetting(SYNC_REMOTE_URL_KEY)
    const phrase = getDecryptedSetting(SYNC_PHRASE_KEY)
    const syncDeletionsRaw = getSetting(SYNC_DELETIONS_KEY)
    return {
        remoteUrl: remoteUrl && remoteUrl.trim() ? remoteUrl : null,
        hasPhrase: !!(phrase && phrase.trim()),
        syncDeletions: syncDeletionsRaw === '1' || syncDeletionsRaw === 'true',
    }
}

export function setSyncerRemoteUrl(remoteUrl: string): void {
    setSetting(SYNC_REMOTE_URL_KEY, remoteUrl.trim())
}

export function setSyncerPhrase(phrase: string): void {
    setEncryptedSetting(SYNC_PHRASE_KEY, phrase)
    // Changing the phrase effectively switches chains; drop cached merge base.
    deleteSetting(SYNC_NAMED_QUERIES_LAST_SNAPSHOT_KEY)
    deleteSetting(SYNC_NAMED_QUERIES_LAST_REMOTE_VERSION_KEY)
}

export function setSyncerSyncDeletions(enabled: boolean): void {
    setSetting(SYNC_DELETIONS_KEY, enabled ? '1' : '0')
}

export function getSyncerSyncDeletions(): boolean {
    const raw = getSetting(SYNC_DELETIONS_KEY)
    return raw === '1' || raw === 'true'
}

export function getSyncerRemoteUrlOrThrow(): string {
    const remoteUrl = getSetting(SYNC_REMOTE_URL_KEY)
    if (!remoteUrl || !remoteUrl.trim()) {
        throw new Error('Missing sync remote URL')
    }
    return remoteUrl.trim()
}

export function getSyncerPhraseOrThrow(): string {
    const phrase = getDecryptedSetting(SYNC_PHRASE_KEY)
    if (!phrase || !phrase.trim()) {
        throw new Error('Missing sync phrase')
    }
    return phrase
}

export function clearSyncerSettings(): void {
    deleteSetting(SYNC_PHRASE_KEY)
    deleteSetting(SYNC_REMOTE_URL_KEY)
    deleteSetting(SYNC_DELETIONS_KEY)
    deleteSetting(SYNC_NAMED_QUERIES_LAST_SNAPSHOT_KEY)
    deleteSetting(SYNC_NAMED_QUERIES_LAST_REMOTE_VERSION_KEY)
}
