"use client"

import React from "react"
import { ShortcutsProvider } from "./ShortcutsProvider"

export function WebShortcutsRoot({ children }: { children: React.ReactNode }) {
  return <ShortcutsProvider runtime="web">{children}</ShortcutsProvider>
}
