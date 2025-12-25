"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SqlEditor } from "@/components/sql-editor"
import type { NamedQuerySyncResolution } from "@/lib/client/apiClient"
import { cn } from "@/lib/utils"

type SyncNamedQueryRecord = {
    id: string
    name: string
    description?: string
    sqlTemplate: string
    paramsJson: string
    defaultConnectionId?: string
    createdAt: string
    updatedAt: string
}

type QueryParamDef = {
    name: string
    type: "string" | "number" | "boolean"
    defaultValue?: string
}

function parseParamsJson(raw: string): { ok: true; params: QueryParamDef[] } | { ok: false; params: QueryParamDef[] } {
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return { ok: false, params: [] }

        const params: QueryParamDef[] = []
        for (const item of parsed) {
            if (!item || typeof item !== "object") continue
            const anyItem = item as any
            const name = typeof anyItem.name === "string" ? anyItem.name : ""
            const type = anyItem.type
            const defaultValue = typeof anyItem.defaultValue === "string" ? anyItem.defaultValue : undefined

            if (!name.trim()) continue
            if (type !== "string" && type !== "number" && type !== "boolean") continue
            params.push({ name, type, defaultValue })
        }

        return { ok: true, params }
    } catch {
        return { ok: false, params: [] }
    }
}

type NamedQuerySyncConflict =
    | {
        kind: "same-id"
        conflictKey: string
        id: string
        local: SyncNamedQueryRecord
        remote: SyncNamedQueryRecord
    }
    | {
        kind: "name"
        conflictKey: string
        name: string
        local: SyncNamedQueryRecord
        remote: SyncNamedQueryRecord
    }

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    conflicts: NamedQuerySyncConflict[]
    onApply: (resolutions: NamedQuerySyncResolution[]) => void
}

export function NamedQuerySyncConflictsDialog({ open, onOpenChange, conflicts, onApply }: Props) {
    const [selectedKey, setSelectedKey] = useState<string | null>(conflicts[0]?.conflictKey ?? null)

    const selected = useMemo(() => {
        return conflicts.find((c) => c.conflictKey === selectedKey) ?? conflicts[0] ?? null
    }, [conflicts, selectedKey])

    const localParams = useMemo(() => {
        if (!selected) return { ok: true as const, params: [] as QueryParamDef[] }
        return parseParamsJson(selected.local.paramsJson || "[]")
    }, [selected])

    const remoteParams = useMemo(() => {
        if (!selected) return { ok: true as const, params: [] as QueryParamDef[] }
        return parseParamsJson(selected.remote.paramsJson || "[]")
    }, [selected])

    const [resolutionsByKey, setResolutionsByKey] = useState<Record<string, NamedQuerySyncResolution>>({})
    const [renameByKey, setRenameByKey] = useState<Record<string, string>>({})

    const allResolved = conflicts.every((c) => {
        const r = resolutionsByKey[c.conflictKey]
        if (!r) return false
        if (r.action === "rename-local") {
            return r.newName.trim().length > 0
        }
        return true
    })

    const setResolution = (conflictKey: string, action: NamedQuerySyncResolution["action"]) => {
        if (action === "rename-local") {
            setResolutionsByKey((prev) => ({
                ...prev,
                [conflictKey]: { conflictKey, action: "rename-local", newName: (renameByKey[conflictKey] ?? "").trim() },
            }))
        } else {
            setResolutionsByKey((prev) => ({
                ...prev,
                [conflictKey]: { conflictKey, action } as NamedQuerySyncResolution,
            }))
        }
    }

    const apply = () => {
        const resolutions = conflicts.map((c) => {
            const r = resolutionsByKey[c.conflictKey]
            if (!r) return null
            if (r.action === "rename-local") {
                const newName = (renameByKey[c.conflictKey] ?? r.newName).trim()
                return { conflictKey: c.conflictKey, action: "rename-local", newName }
            }
            return r
        }).filter(Boolean) as NamedQuerySyncResolution[]

        onApply(resolutions)
    }

    const currentResolution = selected ? resolutionsByKey[selected.conflictKey] : undefined

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Resolve sync conflicts</DialogTitle>
                </DialogHeader>

                <div className="flex-1 min-h-0 grid grid-cols-12 gap-4">
                    <div className="col-span-4 border rounded-md overflow-auto">
                        <div className="p-2 text-xs text-muted-foreground border-b">Conflicts ({conflicts.length})</div>
                        <div className="p-1">
                            {conflicts.map((c) => (
                                <button
                                    key={c.conflictKey}
                                    onClick={() => setSelectedKey(c.conflictKey)}
                                    className={cn(
                                        "w-full text-left px-2 py-2 rounded-md hover:bg-secondary",
                                        selected?.conflictKey === c.conflictKey && "bg-secondary",
                                    )}
                                >
                                    <div className="text-sm font-medium text-foreground truncate">
                                        {c.kind === "name" ? `Name conflict: ${c.name}` : `Modified: ${c.local.name}`}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                        Local: {c.local.id} • Remote: {c.remote.id}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="col-span-8 flex flex-col min-h-0">
                        {selected ? (
                            <>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div>
                                        <div className="text-sm font-medium text-foreground">
                                            {selected.kind === "name" ? `Name conflict: ${selected.name}` : `Query changed: ${selected.local.name}`}
                                        </div>
                                        <div className="text-xs text-muted-foreground">Choose how to resolve, then apply.</div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant={currentResolution?.action === "keep-remote" ? "default" : "outline"}
                                            onClick={() => setResolution(selected.conflictKey, "keep-remote")}
                                        >
                                            Overwrite local
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={currentResolution?.action === "keep-local" ? "default" : "outline"}
                                            onClick={() => setResolution(selected.conflictKey, "keep-local")}
                                        >
                                            Overwrite remote
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={currentResolution?.action === "rename-local" ? "default" : "outline"}
                                            onClick={() => setResolution(selected.conflictKey, "rename-local")}
                                        >
                                            Rename local
                                        </Button>
                                    </div>
                                </div>

                                {currentResolution?.action === "rename-local" && (
                                    <div className="mb-3 flex items-end gap-2">
                                        <div className="flex-1">
                                            <Label htmlFor="rename-local">New name</Label>
                                            <Input
                                                id="rename-local"
                                                value={renameByKey[selected.conflictKey] ?? ""}
                                                onChange={(e) => {
                                                    const v = e.target.value
                                                    setRenameByKey((prev) => ({ ...prev, [selected.conflictKey]: v }))
                                                    setResolutionsByKey((prev) => ({
                                                        ...prev,
                                                        [selected.conflictKey]: { conflictKey: selected.conflictKey, action: "rename-local", newName: v },
                                                    }))
                                                }}
                                                placeholder="e.g. Users by status (local copy)"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                                    <div className="border rounded-md overflow-hidden flex flex-col min-h-0">
                                        <div className="px-2 py-1 text-xs border-b bg-secondary">Local</div>
                                        <div className="flex-1 min-h-0 flex flex-col">
                                            <div className="flex-1 min-h-0">
                                                <SqlEditor value={selected.local.sqlTemplate} onChange={() => { }} readOnly className="h-full" />
                                            </div>
                                            <div className="border-t">
                                                <div className="px-2 py-1 text-xs bg-secondary">
                                                    Parameters ({localParams.params.length})
                                                    {!localParams.ok && <span className="text-destructive ml-2">Invalid</span>}
                                                </div>
                                                <div className="px-2 py-2 text-xs text-foreground max-h-28 overflow-auto">
                                                    {localParams.params.length === 0 ? (
                                                        <div className="text-muted-foreground">No parameters</div>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            {localParams.params.map((p) => (
                                                                <div key={`${p.name}:${p.type}`} className="flex items-center justify-between gap-3">
                                                                    <div className="font-mono truncate">{p.name}</div>
                                                                    <div className="text-muted-foreground whitespace-nowrap">
                                                                        {p.type}
                                                                        {p.defaultValue ? ` = ${p.defaultValue}` : ""}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border rounded-md overflow-hidden flex flex-col min-h-0">
                                        <div className="px-2 py-1 text-xs border-b bg-secondary">Remote</div>
                                        <div className="flex-1 min-h-0 flex flex-col">
                                            <div className="flex-1 min-h-0">
                                                <SqlEditor value={selected.remote.sqlTemplate} onChange={() => { }} readOnly className="h-full" />
                                            </div>
                                            <div className="border-t">
                                                <div className="px-2 py-1 text-xs bg-secondary">
                                                    Parameters ({remoteParams.params.length})
                                                    {!remoteParams.ok && <span className="text-destructive ml-2">Invalid</span>}
                                                </div>
                                                <div className="px-2 py-2 text-xs text-foreground max-h-28 overflow-auto">
                                                    {remoteParams.params.length === 0 ? (
                                                        <div className="text-muted-foreground">No parameters</div>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            {remoteParams.params.map((p) => (
                                                                <div key={`${p.name}:${p.type}`} className="flex items-center justify-between gap-3">
                                                                    <div className="font-mono truncate">{p.name}</div>
                                                                    <div className="text-muted-foreground whitespace-nowrap">
                                                                        {p.type}
                                                                        {p.defaultValue ? ` = ${p.defaultValue}` : ""}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="text-sm text-muted-foreground">No conflicts.</div>
                        )}
                    </div>
                </div>

                <div className="pt-3 border-t flex justify-between">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={apply} disabled={!allResolved}>
                        Apply resolutions & sync
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
