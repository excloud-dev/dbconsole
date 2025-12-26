"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { apiClient } from "@/lib/client/apiClient"
import { AlertCircle, Cloud } from "lucide-react"

type SyncSettingsDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: () => void
    onCleared?: () => void
}

export function SyncSettingsDialog({ open, onOpenChange, onSaved, onCleared }: SyncSettingsDialogProps) {
    const [remoteUrl, setRemoteUrl] = useState("")
    const [syncPhrase, setSyncPhrase] = useState("")
    const [syncDeletions, setSyncDeletions] = useState(false)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        setError(null)

        void (async () => {
            try {
                const s = await apiClient.syncer.settings.get()
                if (cancelled) return
                setRemoteUrl(s.remoteUrl ?? "")
                setSyncDeletions(!!s.syncDeletions)
                // Never prefill phrase; we only allow setting a new one.
                setSyncPhrase("")
            } catch (e: any) {
                if (cancelled) return
                setError(e?.message || "Failed to load sync settings")
            } finally {
                if (cancelled) return
                setLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [open])

    const save = async () => {
        setSaving(true)
        setError(null)
        try {
            await apiClient.syncer.settings.set({
                remoteUrl: remoteUrl.trim() || undefined,
                syncPhrase: syncPhrase.trim() || undefined,
                syncDeletions,
            })
            onOpenChange(false)
            onSaved?.()
        } catch (e: any) {
            setError(e?.message || "Failed to save sync settings")
        } finally {
            setSaving(false)
        }
    }

    const leaveChain = async () => {
        const ok = window.confirm("Leave sync chain on this device? This clears the local sync phrase and server URL.")
        if (!ok) return

        setSaving(true)
        setError(null)
        try {
            await apiClient.syncer.settings.set({ clear: true })
            setRemoteUrl("")
            setSyncPhrase("")
            setSyncDeletions(false)
            onOpenChange(false)
            onCleared?.()
        } catch (e: any) {
            setError(e?.message || "Failed to clear sync settings")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:!max-w-lg !w-[540px] max-h-[80vh] overflow-hidden p-0">
                <div className="flex flex-col h-full">
                    <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
                        <DialogTitle className="flex items-center gap-2">
                            <Cloud className="h-5 w-5 text-muted-foreground" />
                            Sync settings
                        </DialogTitle>
                        <DialogDescription>
                            Configure encrypted sync for queries and metadata
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="sync-remote-url" className="text-xs font-medium text-muted-foreground">
                                Sync server URL
                            </Label>
                            <Input
                                id="sync-remote-url"
                                value={remoteUrl}
                                onChange={(e) => setRemoteUrl(e.target.value)}
                                placeholder="https://your-dbconsole-server.example"
                                disabled={loading || saving}
                                className="h-8"
                            />
                            <p className="text-xs text-muted-foreground">
                                This is the central server that stores encrypted snapshots.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="sync-phrase" className="text-xs font-medium text-muted-foreground">
                                Sync phrase
                            </Label>
                            <Input
                                id="sync-phrase"
                                type="password"
                                value={syncPhrase}
                                onChange={(e) => setSyncPhrase(e.target.value)}
                                placeholder="Enter your sync phrase"
                                disabled={loading || saving}
                                className="h-8"
                            />
                            <p className="text-xs text-muted-foreground">
                                Stored locally encrypted-at-rest. Anyone with this phrase can join the sync chain.
                            </p>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2">
                            <div className="min-w-0 space-y-0.5">
                                <div className="text-xs font-medium text-muted-foreground">Sync deletions</div>
                                <div className="text-xs text-muted-foreground">
                                    If off, deleting locally won&apos;t delete on the server (and remote deletes won&apos;t delete locally).
                                </div>
                            </div>
                            <Switch
                                checked={syncDeletions}
                                onCheckedChange={(v) => setSyncDeletions(!!v)}
                                disabled={loading || saving}
                            />
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                <AlertCircle className="h-4 w-4 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="px-6 py-3 border-t border-border">
                        <Button
                            variant="outline"
                            onClick={leaveChain}
                            disabled={saving || loading}
                            className="text-destructive hover:text-destructive hover:border-destructive/60"
                        >
                            Leave sync chain
                        </Button>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={save} disabled={saving || loading || !remoteUrl.trim()}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
