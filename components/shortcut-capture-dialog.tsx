"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { parseBinding } from "@/lib/shortcuts/parse"
import { BindingKbd } from "@/components/shortcuts/binding-kbd"

function normalizeKeyForBinding(key: string): string {
    if (key.length === 1) return key.toUpperCase()
    if (key === " ") return "Space"
    // Keep common names stable with our parser/matcher which lowercases
    return key
}

function buildBindingString(e: KeyboardEvent, opts: { isMac: boolean }): string | null {
    const key = e.key
    if (!key) return null
    if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return null

    // Escape cancels (don’t bind Escape by accident)
    if (key === "Escape") return null

    const parts: string[] = []

    // Canonicalize platform “mod” so storage stays stable across mac/win/linux
    if (opts.isMac) {
        if (e.metaKey) parts.push("Mod")
        if (e.ctrlKey) parts.push("Ctrl")
    } else {
        if (e.ctrlKey) parts.push("Mod")
        if (e.metaKey) parts.push("Meta")
    }

    if (e.altKey) parts.push("Alt")
    if (e.shiftKey) parts.push("Shift")

    parts.push(normalizeKeyForBinding(key))
    return parts.join("+")
}

export function ShortcutCaptureDialog({
    open,
    onOpenChange,
    onConfirm,
    initial,
    runtime,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (binding: string) => void
    initial?: string
    runtime: "web" | "desktop"
}) {
    const [captured, setCaptured] = useState<string | null>(initial ?? null)
    const [warning, setWarning] = useState<string | null>(null)
    const isMac = useMemo(
        () => (typeof navigator !== "undefined" ? /mac/i.test(navigator.platform) : false),
        [],
    )

    const formatted = useMemo(() => {
        if (!captured) return null
        const parsed = parseBinding(captured)
        if (!parsed) return null
        return parsed
    }, [captured])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                onOpenChange(false)
                return
            }
            e.preventDefault()
            e.stopPropagation()
            const next = buildBindingString(e, { isMac })
            if (!next) return
            if (runtime === "web") {
                // Warn for common browser-reserved combos
                const reserved = ["Mod+W", "Mod+T", "Mod+L", "Mod+R", "Mod+P", "Mod+N"]
                if (reserved.some((r) => r.toLowerCase() === next.toLowerCase())) {
                    setWarning("This shortcut may be reserved by the browser.")
                } else {
                    setWarning(null)
                }
            }
            setCaptured(next)
        }
        window.addEventListener("keydown", onKeyDown, { capture: true })
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
    }, [open, runtime, isMac, onOpenChange])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Press new shortcut</DialogTitle>
                </DialogHeader>
                <div className="py-4 flex flex-col gap-2">
                    <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">
                        {formatted ? (
                            <div className="flex justify-center">
                                <BindingKbd binding={formatted} isMac={isMac} />
                            </div>
                        ) : (
                            <span className="text-stone-500">Press keys to capture</span>
                        )}
                    </div>
                    {warning && <p className="text-xs text-amber-600">{warning}</p>}
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!captured}
                        onClick={() => {
                            if (captured) onConfirm(captured)
                        }}
                    >
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

