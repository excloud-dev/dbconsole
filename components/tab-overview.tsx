"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Pin, X } from "lucide-react"
import { connectionColor } from "@/lib/color/connection-color"
import { cn } from "@/lib/utils"
import type { Tab } from "./query-tabs"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: Tab[]
  activeTabId: string | null
  connectionLabels?: Record<string, string>
  onPickTab: (id: string) => void
}

// ============================================================================
// LOCKED DESIGN SYSTEM (see sortable-tab.tsx for the source of truth)
// TYPE: text-base, text-sm, text-xs only.
// COLOR: text-foreground, text-muted-foreground, text-foreground/40 only.
// SPACING: 4px multiples — gap-2/3/4/6, p-3/4/6/8.
// RADIUS: rounded-md.
// ============================================================================
//
// Why a custom overlay instead of <Dialog>: the shadcn DialogContent forces
// `max-w-[calc(100%-2rem)] sm:max-w-lg` and centers via translate. Our
// max-w-[960px] override was being clobbered, which made the overview float
// in a tiny box in the middle of dead space. Rolling our own fixed-position
// overlay gives us actual fullscreen control.

export function TabOverview({ open, onOpenChange, tabs, activeTabId, connectionLabels, onPickTab }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // Cursor index for keyboard navigation. Distinct from `activeTabId` —
  // activeTabId is the user's *current* tab in the workspace; cursor is
  // where they're hovering inside the overview.
  const [cursor, setCursor] = useState(0)

  // Sort: pinned first, then everything else.
  const orderedTabs = useMemo(() => {
    const pinned = tabs.filter((t) => t.pinned)
    const unpinned = tabs.filter((t) => !t.pinned)
    return [...pinned, ...unpinned]
  }, [tabs])

  const distinctConnections = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tabs) {
      if (!t.connectionId) continue
      if (!seen.has(t.connectionId)) {
        seen.set(t.connectionId, connectionLabels?.[t.connectionId] ?? t.connectionId)
      }
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [tabs, connectionLabels])
  const showInlineConn = distinctConnections.length > 1

  // Reset cursor when opening. Default to the currently active tab if it's
  // in the ordered list, otherwise the top.
  useEffect(() => {
    if (!open) return
    const idx = orderedTabs.findIndex((t) => t.id === activeTabId)
    setCursor(idx >= 0 ? idx : 0)
  }, [open, orderedTabs, activeTabId])

  // Keyboard nav:
  //   ↑ ↓        — move cursor
  //   ↵          — open the row under the cursor
  //   1-9        — jump directly (skip cursor)
  //   home/end   — first / last row
  //   pgup/pgdn  — ±5 rows
  //   esc        — close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
        return
      }
      if (orderedTabs.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, orderedTabs.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const target = orderedTabs[cursor]
        if (target) {
          onPickTab(target.id)
          onOpenChange(false)
        }
        return
      }
      if (e.key === "Home") {
        e.preventDefault()
        setCursor(0)
        return
      }
      if (e.key === "End") {
        e.preventDefault()
        setCursor(orderedTabs.length - 1)
        return
      }
      if (e.key === "PageDown") {
        e.preventDefault()
        setCursor((c) => Math.min(c + 5, orderedTabs.length - 1))
        return
      }
      if (e.key === "PageUp") {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 5))
        return
      }
      if (e.key >= "1" && e.key <= "9") {
        const target = orderedTabs[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          onPickTab(target.id)
          onOpenChange(false)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, orderedTabs, cursor, onPickTab, onOpenChange])

  // Scroll cursor row into view as it moves.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [cursor, open])

  // No manual body-scroll lock — DialogPrimitive handles it.

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="All tabs"
          ref={panelRef}
          className="fixed inset-0 z-[60] flex flex-col w-full max-w-[1100px] mx-auto px-6 py-6 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">All tabs</DialogPrimitive.Title>
        {/* Header --------------------------------------------------------- */}
        <header className="flex items-baseline justify-between mb-4">
          <div className="flex items-baseline gap-4">
            <h2 className="text-sm font-semibold text-foreground">All tabs</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{tabs.length} open</span>
              {distinctConnections.length > 0 && (
                <>
                  <span className="text-foreground/40">·</span>
                  <span className="flex items-center gap-2">
                    {distinctConnections.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: connectionColor(c.id) }}
                        />
                        <span>{c.label}</span>
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            aria-label="Close overview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Table ----------------------------------------------------------- */}
        <div ref={listRef} className="flex-1 overflow-y-auto -mx-2">
          <div role="list" className="flex flex-col">
            {orderedTabs.map((tab, idx) => {
              const isActive = tab.id === activeTabId
              const isCursor = idx === cursor
              const numberHint = idx < 9 ? idx + 1 : null
              const dotColor = tab.connectionId ? connectionColor(tab.connectionId) : null
              const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] : null

              const oneLine = (tab.query || "").replace(/\s+/g, " ").trim()

              const statusGlyph =
                tab.lastRun?.status === "running"
                  ? "running"
                  : tab.lastRun?.status === "error"
                    ? "error"
                    : tab.lastRun?.status === "ok"
                      ? "ok"
                      : tab.isSchemaGraph
                        ? "graph"
                        : ""

              const rowsLabel =
                tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined
                  ? tab.lastRun.rowCount.toLocaleString()
                  : ""

              const timeLabel =
                tab.lastRun?.status === "ok" && tab.lastRun.durationMs !== undefined
                  ? tab.lastRun.durationMs < 1000
                    ? `${tab.lastRun.durationMs}ms`
                    : `${(tab.lastRun.durationMs / 1000).toFixed(1)}s`
                  : ""

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="listitem"
                  data-row-index={idx}
                  onClick={() => {
                    onPickTab(tab.id)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setCursor(idx)}
                  className={cn(
                    // Flush full-width strip. Cursor (kbd nav) and active
                    // (current workspace tab) both use bg-muted, so the
                    // moment you arrow into a row it reads as selected
                    // without any layout shift or accent decoration.
                    "grid items-center gap-3 px-4 py-2 text-left transition-colors",
                    (isCursor || isActive) ? "bg-muted" : "hover:bg-muted/40",
                  )}
                  style={{
                    gridTemplateColumns: showInlineConn
                      ? "20px minmax(0, 1fr) 120px 72px 64px 56px"
                      : "20px minmax(0, 1fr) 72px 64px 56px",
                  }}
                >
                  {/* Number — plain mono digit, no badge chrome */}
                  <span
                    className={cn(
                      "text-xs tabular-nums font-mono text-right",
                      isActive ? "text-foreground" : "text-muted-foreground/60",
                    )}
                  >
                    {numberHint ?? ""}
                  </span>

                  {/* Title + SQL preview */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />}
                      {dotColor && !showInlineConn && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">{tab.name}</span>
                    </div>
                    {oneLine && (
                      <div className="mt-0.5 text-xs font-mono text-muted-foreground truncate">{oneLine}</div>
                    )}
                    {!oneLine && tab.isSchemaGraph && (
                      <div className="mt-0.5 text-xs text-foreground/40 italic">schema graph view</div>
                    )}
                  </div>

                  {/* Connection (only if multiple) */}
                  {showInlineConn && (
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                      {dotColor && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                      )}
                      {connLabel}
                    </div>
                  )}

                  {/* Rows */}
                  <div className="text-xs tabular-nums text-muted-foreground text-right">{rowsLabel}</div>

                  {/* Time */}
                  <div className="text-xs tabular-nums text-foreground/40 text-right">{timeLabel}</div>

                  {/* Status */}
                  <div
                    className={cn(
                      "text-xs uppercase tracking-wider text-right",
                      statusGlyph === "error" && "text-destructive",
                      statusGlyph === "ok" && "text-success",
                      statusGlyph === "running" && "text-muted-foreground",
                      statusGlyph === "graph" && "text-foreground/40",
                    )}
                  >
                    {statusGlyph}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer hints --------------------------------------------------- */}
        <footer className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="font-mono text-foreground/80">↑↓</kbd> nav
            </span>
            <span>
              <kbd className="font-mono text-foreground/80">↵</kbd> open
            </span>
            <span>
              <kbd className="font-mono text-foreground/80">1</kbd>–
              <kbd className="font-mono text-foreground/80">9</kbd> jump
            </span>
          </div>
          <span>
            <kbd className="font-mono text-foreground/80">esc</kbd> close
          </span>
        </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
