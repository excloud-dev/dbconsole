import { z } from "zod"
import { getSetting, setSetting } from "@/lib/meta-db"
import type { CommandId, Runtime } from "@/lib/shortcuts/types"

const SETTINGS_KEY = "shortcuts.keymap.v1"

export type ShortcutsOverrides = Partial<Record<CommandId, string | null>>

export const OverridesRecordSchema: z.ZodType<ShortcutsOverrides> = z.record(
    z.string() as z.ZodType<CommandId>,
    z.union([z.string().min(1), z.null()]),
)

const StoredKeymapSchema = z.object({
    version: z.literal(1),
    overrides: z
        .object({
            web: OverridesRecordSchema.optional(),
            desktop: OverridesRecordSchema.optional(),
        })
        .default({}),
})

export type StoredKeymapV1 = z.infer<typeof StoredKeymapSchema>

function load(): StoredKeymapV1 {
    const raw = getSetting(SETTINGS_KEY)
    if (!raw) {
        return { version: 1, overrides: {} }
    }
    try {
        const parsed = JSON.parse(raw)
        return StoredKeymapSchema.parse(parsed)
    } catch {
        return { version: 1, overrides: {} }
    }
}

function persist(data: StoredKeymapV1): void {
    setSetting(SETTINGS_KEY, JSON.stringify(data))
}

export function getShortcutsKeymap(runtime: Runtime): ShortcutsOverrides {
    const stored = load()
    return stored.overrides[runtime] ?? {}
}

export function setShortcutsOverride(runtime: Runtime, commandId: CommandId, binding: string | null): void {
    const current = load()
    const overrides = { ...current.overrides[runtime] }
    overrides[commandId] = binding
    persist({
        version: 1,
        overrides: {
            ...current.overrides,
            [runtime]: overrides,
        },
    })
}

export function resetShortcutsOverride(runtime: Runtime, commandId: CommandId): void {
    const current = load()
    const overrides = { ...(current.overrides[runtime] ?? {}) }
    delete overrides[commandId]
    persist({
        version: 1,
        overrides: {
            ...current.overrides,
            [runtime]: Object.keys(overrides).length ? overrides : undefined,
        },
    })
}

export function resetAllShortcutsOverrides(runtime: Runtime): void {
    const current = load()
    const nextOverrides = { ...current.overrides }
    delete nextOverrides[runtime]
    persist({
        version: 1,
        overrides: nextOverrides,
    })
}

export function setShortcutsKeymap(runtime: Runtime, overrides: ShortcutsOverrides): void {
    const safe = OverridesRecordSchema.parse(overrides)
    const current = load()
    persist({
        version: 1,
        overrides: {
            ...current.overrides,
            [runtime]: safe,
        },
    })
}

