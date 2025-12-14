"use client"

import { useContext } from "react"
import type { CommandId } from "@/lib/shortcuts/types"
import { ShortcutsContext } from "./ShortcutsProvider"

export function useBinding(id: CommandId): string | undefined {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) return undefined
  return ctx.getBinding(id)
}

