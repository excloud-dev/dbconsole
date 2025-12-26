"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BindingDisplay } from "@/components/shortcuts/binding-kbd"
import { listCommands, getDefaultBindings } from "@/lib/shortcuts/commands"
import { useShortcutsContext } from "@/components/shortcuts/ShortcutsProvider"
import { cn } from "@/lib/utils"
import { ShortcutCaptureDialog } from "./shortcut-capture-dialog"
import type { CommandId } from "@/lib/shortcuts/types"

export function KeyboardShortcutsDialog({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const ctx = useShortcutsContext()
    const commands = useMemo(() => listCommands(), [])
    const [query, setQuery] = useState("")
    const [editing, setEditing] = useState<CommandId | null>(null)
    const isMac = useMemo(() => (typeof navigator !== "undefined" ? /mac/i.test(navigator.platform) : false), [])

    const stateSnapshot = useMemo(() => {
        const map: Record<CommandId, ReturnType<typeof ctx.getCommandState>> = {} as any
        commands.forEach((cmd) => {
            map[cmd.id] = ctx.getCommandState(cmd.id)
        })
        return map
    }, [commands, ctx])

    const bindingSnapshot = useMemo(() => {
        const map: Record<CommandId, string | undefined> = {} as any
        commands.forEach((cmd) => {
            map[cmd.id] = stateSnapshot[cmd.id]?.displayBinding
        })
        return map
    }, [commands, stateSnapshot])

    const conflicts = useMemo(() => {
        const map: Record<string, CommandId[]> = {}
        for (const [id, binding] of Object.entries(bindingSnapshot) as [CommandId, string | undefined][]) {
            if (!binding) continue
            if (stateSnapshot[id]?.isDisabled) continue
            const key = binding.toLowerCase()
            if (!map[key]) map[key] = []
            map[key].push(id)
        }
        return map
    }, [bindingSnapshot, stateSnapshot])

    const filtered = commands.filter((cmd) => {
        if (!query.trim()) return true
        const q = query.toLowerCase()
        return cmd.title.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q) || cmd.category?.toLowerCase().includes(q)
    })

    const handleToggleDisabled = async (id: CommandId) => {
        const state = stateSnapshot[id]
        await ctx.setDisabled(id, !state?.isDisabled)
    }

    const handleReset = async (id: CommandId) => {
        await ctx.resetBinding(id)
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="!w-[min(95vw,1200px)] !max-w-[1200px] sm:!max-w-[1200px] overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>Keyboard Shortcuts</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="Search shortcuts…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="h-9"
                            />
                            <Button variant="outline" size="sm" onClick={() => ctx.resetAll()}>
                                Reset all
                            </Button>
                        </div>

                        <div className="max-h-[55vh] overflow-y-auto overflow-x-auto rounded-lg border border-border">
                            <table className="min-w-[900px] w-full text-sm table-fixed">
                                <thead className="bg-secondary text-muted-foreground uppercase text-xs">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Command</th>
                                        <th className="px-3 py-2 text-left">Current</th>
                                        <th className="px-3 py-2 text-left">Default</th>
                                        <th className="px-3 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((cmd) => {
                                        const current = bindingSnapshot[cmd.id]
                                        const def = getDefaultBindings(cmd.id, ctx.runtime)[0]
                                         const conflictIds = current ? conflicts[current.toLowerCase()] : undefined
                                         const hasConflict = conflictIds && conflictIds.length > 1
                                         const isDisabled = stateSnapshot[cmd.id]?.isDisabled

                                        return (
                                            <tr key={cmd.id} className="border-t border-border">
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 w-[45%]",
                                                        isDisabled &&
                                                            "bg-destructive/10 shadow-[inset_3px_0_0_0_hsl(var(--destructive)/0.8),inset_0_3px_0_0_hsl(var(--destructive)/0.8),inset_0_-3px_0_0_hsl(var(--destructive)/0.8)]",
                                                    )}
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-foreground">{cmd.title}</span>
                                                        <span className="text-xs text-muted-foreground truncate">{cmd.id}</span>
                                                    </div>
                                                </td>
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 w-[20%]",
                                                        isDisabled &&
                                                            "bg-destructive/10 shadow-[inset_0_3px_0_0_hsl(var(--destructive)/0.8),inset_0_-3px_0_0_hsl(var(--destructive)/0.8)]",
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <BindingDisplay raw={current} isMac={isMac} />
                                                        {isDisabled && <Badge variant="secondary">Disabled</Badge>}
                                                        {hasConflict && <Badge variant="destructive">Conflict</Badge>}
                                                    </div>
                                                </td>
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 w-[15%]",
                                                        isDisabled &&
                                                            "bg-destructive/10 shadow-[inset_0_3px_0_0_hsl(var(--destructive)/0.8),inset_0_-3px_0_0_hsl(var(--destructive)/0.8)]",
                                                    )}
                                                >
                                                    <div className="text-xs text-muted-foreground">
                                                        {def ? <BindingDisplay raw={def} isMac={isMac} /> : <span>—</span>}
                                                    </div>
                                                </td>
                                                <td
                                                    className={cn(
                                                        "px-3 py-2 text-right space-x-2 w-[20%] whitespace-nowrap",
                                                        isDisabled &&
                                                            "bg-destructive/10 shadow-[inset_-3px_0_0_0_hsl(var(--destructive)/0.8),inset_0_3px_0_0_hsl(var(--destructive)/0.8),inset_0_-3px_0_0_hsl(var(--destructive)/0.8)]",
                                                    )}
                                                >
                                                    <Button variant="outline" size="sm" onClick={() => setEditing(cmd.id)}>
                                                        Edit
                                                    </Button>
                                                    <Button variant="outline" size="sm" onClick={() => handleToggleDisabled(cmd.id)}>
                                                        {isDisabled ? "Enable" : "Disable"}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleReset(cmd.id)}>
                                                        Reset
                                                    </Button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                No shortcuts match your search.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <DialogFooter />
                </DialogContent>
            </Dialog>

            <ShortcutCaptureDialog
                key={editing ?? "closed"}
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) setEditing(null)
                }}
                runtime={ctx.runtime}
                initial={editing ? bindingSnapshot[editing] : undefined}
                onConfirm={async (binding) => {
                    if (editing) {
                        await ctx.setBinding(editing, binding)
                    }
                    setEditing(null)
                }}
            />
        </>
    )
}

