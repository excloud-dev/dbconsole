"use client"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { parseBinding } from "@/lib/shortcuts/parse"
import type { KeyBinding } from "@/lib/shortcuts/types"
import { ArrowRightToLine, ArrowBigUp, CornerDownLeft, CornerDownRight, CircleArrowOutUpLeft, Delete } from "lucide-react"
import type { LucideIcon } from "lucide-react"

const KEY_ICON_MAP: Record<string, LucideIcon> = {
    shift: ArrowBigUp,
    enter: CornerDownRight,
    return: CornerDownRight,
    tab: ArrowRightToLine,
    escape: CornerDownLeft,
    esc: CircleArrowOutUpLeft,
    backspace: Delete,
    delete: Delete,
}

function partsForBinding(binding: KeyBinding, isMac: boolean): string[] {
    const parts: string[] = []
    const useSymbols = isMac

    const add = (label: string) => parts.push(label)

    if (binding.mod) add(useSymbols ? "⌘" : "Mod")
    if (binding.meta) add(useSymbols ? "⌘" : "Cmd")
    if (binding.ctrl) add(useSymbols ? "⌃" : "Ctrl")
    if (binding.alt) add(useSymbols ? "⌥" : "Alt")
    if (binding.shift) add("Shift")

    if (binding.key && binding.key !== "Mod") {
        const keyLabel = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key
        add(keyLabel)
    }

    return parts
}

export function BindingKbd({ binding, isMac }: { binding: KeyBinding; isMac: boolean }) {
    const parts = partsForBinding(binding, isMac)
    return (
        <KbdGroup className="whitespace-nowrap">
            {parts.map((p, idx) => {
                const Icon = KEY_ICON_MAP[p.toLowerCase()]
                return (
                    <Kbd key={`${p}:${idx}`} className="font-mono">
                        {Icon ? <Icon className="h-3 w-3" /> : p}
                    </Kbd>
                )
            })}
        </KbdGroup>
    )
}

export function BindingDisplay({ raw, isMac }: { raw: string | undefined; isMac: boolean }) {
    if (!raw) return <span className="text-stone-400">Unbound</span>
    const parsed = parseBinding(raw)
    if (!parsed) return <span className="font-mono text-stone-800 whitespace-nowrap">{raw}</span>
    return <BindingKbd binding={parsed} isMac={isMac} />
}


