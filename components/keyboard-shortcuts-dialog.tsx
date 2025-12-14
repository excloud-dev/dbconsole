"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BindingDisplay } from "@/components/shortcuts/binding-kbd"
import { listCommands, getDefaultBindings } from "@/lib/shortcuts/commands"
import { useShortcutsContext } from "@/components/shortcuts/ShortcutsProvider"
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

    const bindingSnapshot = useMemo(() => {
        const map: Record<CommandId, string | undefined> = {} as any
        commands.forEach((cmd) => {
            map[cmd.id] = ctx.getBinding(cmd.id)
        })
        return map
    }, [commands, ctx])

    const conflicts = useMemo(() => {
        const map: Record<string, CommandId[]> = {}
        for (const [id, binding] of Object.entries(bindingSnapshot) as [CommandId, string | undefined][]) {
            if (!binding) continue
            const key = binding.toLowerCase()
            if (!map[key]) map[key] = []
            map[key].push(id)
        }
        return map
    }, [bindingSnapshot])

    const filtered = commands.filter((cmd) => {
        if (!query.trim()) return true
        const q = query.toLowerCase()
        return cmd.title.toLowerCase().includes(q) || cmd.id.toLowerCase().includes(q) || cmd.category?.toLowerCase().includes(q)
    })

    const handleDisable = async (id: CommandId) => {
        await ctx.setBinding(id, null)
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

                        <div className="max-h-[55vh] overflow-y-auto overflow-x-auto rounded-lg border border-stone-200">
                            <table className="min-w-[900px] w-full text-sm table-fixed">
                                <thead className="bg-stone-50 text-stone-600 uppercase text-xs">
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
                                        return (
                                            <tr key={cmd.id} className="border-t border-stone-100">
                                                <td className="px-3 py-2 w-[45%]">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-stone-900">{cmd.title}</span>
                                                        <span className="text-xs text-stone-500 truncate">{cmd.id}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 w-[20%]">
                                                    <div className="flex items-center gap-2">
                                                        <BindingDisplay raw={current} isMac={isMac} />
                                                        {hasConflict && <Badge variant="destructive">Conflict</Badge>}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 w-[15%]">
                                                    <div className="text-xs text-stone-500">
                                                        {def ? <BindingDisplay raw={def} isMac={isMac} /> : <span>—</span>}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-right space-x-2 w-[20%] whitespace-nowrap">
                                                    <Button variant="outline" size="sm" onClick={() => setEditing(cmd.id)}>
                                                        Edit
                                                    </Button>
                                                    <Button variant="outline" size="sm" onClick={() => handleDisable(cmd.id)}>
                                                        Disable
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
                                            <td colSpan={4} className="px-3 py-6 text-center text-sm text-stone-500">
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

