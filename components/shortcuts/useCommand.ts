"use client"

import { useContext, useEffect } from "react"
import type { CommandId } from "@/lib/shortcuts/types"
import { ShortcutsContext } from "./ShortcutsProvider"

export function useCommand(id: CommandId, handler: (event: KeyboardEvent) => boolean | void) {
  const ctx = useContext(ShortcutsContext)
  const registerHandler = ctx?.registerHandler

  useEffect(() => {
    if (!registerHandler || !handler) return
    return registerHandler(id, handler)
  }, [registerHandler, id, handler])
}

