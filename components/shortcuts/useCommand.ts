"use client"

import { useContext, useEffect } from "react"
import type { CommandId } from "@/lib/shortcuts/types"
import { ShortcutsContext } from "./ShortcutsProvider"

export function useCommand(id: CommandId, handler: (event: KeyboardEvent) => boolean | void) {
  const ctx = useContext(ShortcutsContext)
  useEffect(() => {
    if (!ctx || !handler) return
    return ctx.registerHandler(id, handler)
  }, [ctx, id, handler])
}

