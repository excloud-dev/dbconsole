"use client"

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { getDefaultBindings, getCommandDef, listCommands } from "@/lib/shortcuts/commands"
import { parseBinding } from "@/lib/shortcuts/parse"
import { matchesBinding, shouldIgnoreTarget } from "@/lib/shortcuts/match"
import type { CommandId, KeyBinding, Runtime } from "@/lib/shortcuts/types"
import { apiClient } from "@/lib/client/apiClient"

type Handler = (event: KeyboardEvent) => boolean | void

interface ContextValue {
  runtime: Runtime
  registerHandler: (id: CommandId, handler: Handler) => () => void
  getBinding: (id: CommandId) => string | undefined
  invoke: (id: CommandId) => boolean
  setBinding: (id: CommandId, binding: string | null) => Promise<void>
  resetBinding: (id: CommandId) => Promise<void>
  resetAll: () => Promise<void>
}

export const ShortcutsContext = createContext<ContextValue | null>(null)

function buildDefaultBindingMap(runtime: Runtime): Record<CommandId, KeyBinding[]> {
  const map = {} as Record<CommandId, KeyBinding[]>
  listCommands().forEach((cmd) => {
    const parsed = (cmd.defaultBindings[runtime] || []).map(parseBinding).filter(Boolean) as KeyBinding[]
    map[cmd.id] = parsed
  })
  return map
}

function applyOverrides(
  base: Record<CommandId, KeyBinding[]>,
  overrides: Record<string, string | null> | undefined,
): Record<CommandId, KeyBinding[]> {
  const next: Record<CommandId, KeyBinding[]> = { ...base }
  if (!overrides) return next
  for (const [id, raw] of Object.entries(overrides)) {
    const cmdId = id as CommandId
    if (raw === null) {
      next[cmdId] = []
      continue
    }
    const parsed = parseBinding(raw)
    if (parsed) {
      next[cmdId] = [parsed]
    }
  }
  return next
}

export function ShortcutsProvider({ runtime, children }: { runtime: Runtime; children: React.ReactNode }) {
  const handlersRef = useRef<Map<CommandId, Set<Handler>>>(new Map())
  const defaultBindings = useMemo(() => buildDefaultBindingMap(runtime), [runtime])
  const [bindings, setBindings] = useState<Record<CommandId, KeyBinding[]>>(defaultBindings)
  const bindingsRef = useRef<Record<CommandId, KeyBinding[]>>(defaultBindings)
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined"
        ? /mac/i.test(navigator.platform)
        : typeof process !== "undefined" && process.platform === "darwin",
    [],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const cmd of listCommands()) {
        const bindings = bindingsRef.current[cmd.id] || []
        if (!bindings.length) continue
        const hasHandler = handlersRef.current.get(cmd.id)?.size
        if (!hasHandler) continue
        if (shouldIgnoreTarget(event, cmd.allowInInputs)) continue

        const matched = bindings.some((binding) => matchesBinding(binding, event, runtime, { isMac }))
        if (!matched) continue

        // Only consume the shortcut if a handler actually handled it.
        // This matters for commands like Copy: when grid has no selection, we should not steal normal copy.
        let handled = false
        handlersRef.current.get(cmd.id)?.forEach((handler) => {
          const res = handler(event)
          if (res !== false) handled = true
        })
        if (!handled) continue

        if (cmd.preventDefault !== false) event.preventDefault()
        break
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [runtime, isMac])

  useEffect(() => {
    let canceled = false
    async function loadOverrides() {
      try {
        const data: any = await apiClient.shortcuts.get()
        if (canceled) return
        const merged = applyOverrides(defaultBindings, data?.overrides?.[runtime])
        bindingsRef.current = merged
        setBindings(merged)
      } catch {
        // fall back to defaults if fetch fails
        bindingsRef.current = defaultBindings
        setBindings(defaultBindings)
      }
    }
    void loadOverrides()
    return () => {
      canceled = true
    }
  }, [defaultBindings, runtime])

  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])

  const value = useMemo<ContextValue>(
    () => ({
      runtime,
      registerHandler: (id, handler) => {
        let set = handlersRef.current.get(id)
        if (!set) {
          set = new Set()
          handlersRef.current.set(id, set)
        }
        set.add(handler)
        return () => {
          const existing = handlersRef.current.get(id)
          existing?.delete(handler)
        }
      },
      getBinding: (id) => {
        const current = bindingsRef.current[id]
        if (current?.length) return current[0].raw
        const defaults = getDefaultBindings(id, runtime)
        return defaults[0]
      },
      invoke: (id) => {
        const evt = new KeyboardEvent("keydown", { bubbles: true, cancelable: true })
        let handled = false
        handlersRef.current.get(id)?.forEach((handler) => {
          const res = handler(evt)
          if (res !== false) handled = true
        })
        return handled
      },
      setBinding: async (id, binding) => {
        await apiClient.shortcuts.set({ runtime, commandId: id, binding })
        setBindings((prev) => {
          const next = { ...prev }
          const parsed = binding === null ? null : parseBinding(binding)
          next[id] = parsed ? [parsed] : []
          return next
        })
      },
      resetBinding: async (id) => {
        await apiClient.shortcuts.set({ runtime, commandId: id, reset: true })
        setBindings((prev) => {
          const next = { ...prev }
          next[id] = defaultBindings[id] ?? []
          return next
        })
      },
      resetAll: async () => {
        await apiClient.shortcuts.set({ runtime, resetAll: true })
        setBindings(defaultBindings)
      },
    }),
    [runtime, defaultBindings],
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

export function useShortcutsContext(): ContextValue {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) throw new Error("useShortcutsContext must be used within ShortcutsProvider")
  return ctx
}

