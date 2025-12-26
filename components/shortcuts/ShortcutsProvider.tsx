"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { getDefaultBindings, listCommands } from "@/lib/shortcuts/commands"
import { parseBinding } from "@/lib/shortcuts/parse"
import { matchesBinding, shouldIgnoreTarget } from "@/lib/shortcuts/match"
import type { CommandId, KeyBinding, Runtime } from "@/lib/shortcuts/types"
import { apiClient } from "@/lib/client/apiClient"

type Handler = (event: KeyboardEvent) => boolean | void

type OverrideValue = string | null | { binding?: string | null; disabled?: boolean }

interface CommandState {
  effectiveBinding?: string
  displayBinding?: string
  isDisabled: boolean
  hasOverride: boolean
}

interface ContextValue {
  runtime: Runtime
  registerHandler: (id: CommandId, handler: Handler) => () => void
  getBinding: (id: CommandId) => string | undefined
  getCommandState: (id: CommandId) => CommandState
  invoke: (id: CommandId) => boolean
  setBinding: (id: CommandId, binding: string | null) => Promise<void>
  setDisabled: (id: CommandId, disabled: boolean) => Promise<void>
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

type ResolvedShortcutsState = {
  bindings: Record<CommandId, KeyBinding[]>
  disabled: Record<CommandId, boolean>
  display: Record<CommandId, string | undefined>
  hasOverride: Record<CommandId, boolean>
}

function buildDefaultDisplayMap(defaultBindings: Record<CommandId, KeyBinding[]>): Record<CommandId, string | undefined> {
  const map = {} as Record<CommandId, string | undefined>
  listCommands().forEach((cmd) => {
    map[cmd.id] = defaultBindings[cmd.id]?.[0]?.raw
  })
  return map
}

function resolveState(
  defaultBindings: Record<CommandId, KeyBinding[]>,
  defaultDisplay: Record<CommandId, string | undefined>,
  overrides: Record<string, OverrideValue> | undefined,
): ResolvedShortcutsState {
  const bindings = { ...defaultBindings }
  const disabled: Record<CommandId, boolean> = {} as Record<CommandId, boolean>
  const display: Record<CommandId, string | undefined> = { ...defaultDisplay }
  const hasOverride: Record<CommandId, boolean> = {} as Record<CommandId, boolean>

  listCommands().forEach((cmd) => {
    const raw = overrides?.[cmd.id]
    if (raw === undefined) {
      hasOverride[cmd.id] = false
      disabled[cmd.id] = false
      return
    }

    hasOverride[cmd.id] = true

    const normalized: { binding?: string | null; disabled?: boolean } =
      raw && typeof raw === "object" ? raw : ({ binding: raw as string | null } satisfies { binding: string | null })

    disabled[cmd.id] = normalized.disabled ?? false

    if (normalized.binding !== undefined) {
      const binding = normalized.binding
      if (binding === null) {
        bindings[cmd.id] = []
        display[cmd.id] = undefined
      } else {
        const parsed = parseBinding(binding)
        bindings[cmd.id] = parsed ? [parsed] : []
        display[cmd.id] = binding
      }
    }
  })

  return { bindings, disabled, display, hasOverride }
}

export function ShortcutsProvider({ runtime, children }: { runtime: Runtime; children: React.ReactNode }) {
  const handlersRef = useRef<Map<CommandId, Set<Handler>>>(new Map())
  const defaultBindings = useMemo(() => buildDefaultBindingMap(runtime), [runtime])
  const defaultDisplay = useMemo(() => buildDefaultDisplayMap(defaultBindings), [defaultBindings])

  const [resolved, setResolved] = useState<ResolvedShortcutsState>(() =>
    resolveState(defaultBindings, defaultDisplay, undefined),
  )

  const bindingsRef = useRef<Record<CommandId, KeyBinding[]>>(resolved.bindings)
  const disabledRef = useRef<Record<CommandId, boolean>>(resolved.disabled)

  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined"
        ? /mac/i.test(navigator.platform)
        : typeof process !== "undefined" && process.platform === "darwin",
    [],
  )

  useEffect(() => {
    bindingsRef.current = resolved.bindings
    disabledRef.current = resolved.disabled
  }, [resolved])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const cmd of listCommands()) {
        if (disabledRef.current[cmd.id]) continue

        const bindings = bindingsRef.current[cmd.id] || []
        if (!bindings.length) continue

        const hasHandler = handlersRef.current.get(cmd.id)?.size
        if (!hasHandler) continue

        if (shouldIgnoreTarget(event, cmd.allowInInputs)) continue

        const matched = bindings.some((binding) => matchesBinding(binding, event, runtime, { isMac }))
        if (!matched) continue

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
        setResolved(resolveState(defaultBindings, defaultDisplay, data?.overrides?.[runtime]))
      } catch {
        setResolved(resolveState(defaultBindings, defaultDisplay, undefined))
      }
    }

    void loadOverrides()
    return () => {
      canceled = true
    }
  }, [defaultBindings, defaultDisplay, runtime])

  useEffect(() => {
    setResolved(resolveState(defaultBindings, defaultDisplay, undefined))
  }, [defaultBindings, defaultDisplay])

  const registerHandler = useCallback((id: CommandId, handler: Handler) => {
    let set = handlersRef.current.get(id)
    if (!set) {
      set = new Set()
      handlersRef.current.set(id, set)
    }
    set.add(handler)
    return () => {
      handlersRef.current.get(id)?.delete(handler)
    }
  }, [])

  const getCommandState = useCallback(
    (id: CommandId): CommandState => {
      const isDisabled = !!resolved.disabled[id]
      const displayBinding = resolved.display[id] ?? getDefaultBindings(id, runtime)[0]
      const effectiveBinding = isDisabled ? undefined : displayBinding
      return {
        effectiveBinding,
        displayBinding,
        isDisabled,
        hasOverride: !!resolved.hasOverride[id],
      }
    },
    [resolved, runtime],
  )

  const value = useMemo<ContextValue>(
    () => ({
      runtime,
      registerHandler,
      getBinding: (id) => getCommandState(id).effectiveBinding,
      getCommandState,
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
        setResolved((prev) => {
          const next: ResolvedShortcutsState = {
            ...prev,
            bindings: { ...prev.bindings },
            display: { ...prev.display },
            hasOverride: { ...prev.hasOverride },
          }

          next.hasOverride[id] = true

          if (binding === null) {
            next.bindings[id] = []
            next.display[id] = undefined
          } else {
            const parsed = parseBinding(binding)
            next.bindings[id] = parsed ? [parsed] : []
            next.display[id] = binding
          }

          return next
        })
      },
      setDisabled: async (id, disabled) => {
        await apiClient.shortcuts.set({ runtime, commandId: id, disabled })
        setResolved((prev) => ({
          ...prev,
          disabled: { ...prev.disabled, [id]: disabled },
          hasOverride: { ...prev.hasOverride, [id]: true },
        }))
      },
      resetBinding: async (id) => {
        await apiClient.shortcuts.set({ runtime, commandId: id, reset: true })
        setResolved((prev) => ({
          ...prev,
          bindings: { ...prev.bindings, [id]: defaultBindings[id] ?? [] },
          display: { ...prev.display, [id]: defaultDisplay[id] },
          disabled: { ...prev.disabled, [id]: false },
          hasOverride: { ...prev.hasOverride, [id]: false },
        }))
      },
      resetAll: async () => {
        await apiClient.shortcuts.set({ runtime, resetAll: true })
        setResolved(resolveState(defaultBindings, defaultDisplay, undefined))
      },
    }),
    [runtime, registerHandler, getCommandState, defaultBindings, defaultDisplay],
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

export function useShortcutsContext(): ContextValue {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) throw new Error("useShortcutsContext must be used within ShortcutsProvider")
  return ctx
}
