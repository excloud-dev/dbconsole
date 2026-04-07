"use client"

import { useEffect, useMemo } from "react"
import { AlertCircle, CheckCircle2, FileCode, Loader2, Pin } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { connectionColor, connectionHue } from "@/lib/color/connection-color"
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

// ---------------------------------------------------------------------------
// Concept: the tab overview is the wall above the desk. Not a generic card
// grid — the layout itself encodes the structure of the workspace by
// breaking tabs into COLUMNS BY CONNECTION. So if you have 3 prod tabs and
// 2 staging tabs, you see two columns side by side, not a 5-card grid.
//
// Hero treatment for the active tab (subtle ring + larger title row).
// Numbered key hints (1-9) so you can press a number to jump straight in.
// Pinned tabs sort to the top of their column with a pin glyph.
// ---------------------------------------------------------------------------

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

export function TabOverview({ open, onOpenChange, tabs, activeTabId, connectionLabels, onPickTab }: Props) {
  // Group tabs by connection. Tabs without a connection get bucketed under
  // "(no connection)" and pushed to the end.
  const columns = useMemo(() => {
    const byConn = new Map<string, Tab[]>()
    for (const t of tabs) {
      const key = t.connectionId ?? "__none"
      const list = byConn.get(key) ?? []
      list.push(t)
      byConn.set(key, list)
    }
    // Sort each column: pinned first, then in original order.
    for (const list of byConn.values()) {
      list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
    }
    const cols = Array.from(byConn.entries()).map(([connId, list]) => ({
      connId: connId === "__none" ? null : connId,
      label: connId === "__none" ? "(no connection)" : connectionLabels?.[connId] ?? connId,
      tabs: list,
      color: connId === "__none" ? null : connectionColor(connId),
      hue: connId === "__none" ? null : connectionHue(connId),
    }))
    // The "__none" column always sorts last; everything else by descending
    // count so the busiest connection lands first.
    cols.sort((a, b) => {
      if (a.connId === null) return 1
      if (b.connId === null) return -1
      return b.tabs.length - a.tabs.length
    })
    return cols
  }, [tabs, connectionLabels])

  // Compute the ordered tab list as the user sees it (reading order across
  // columns), so the 1-9 number badges match jumpToTabIndex.
  const orderedTabIds = useMemo(() => {
    const ids: string[] = []
    for (const col of columns) for (const t of col.tabs) ids.push(t.id)
    return ids
  }, [columns])

  // Number-key shortcuts: 1-9 jumps directly to that tab.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1
        const id = orderedTabIds[idx]
        if (id) {
          e.preventDefault()
          onPickTab(id)
          onOpenChange(false)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, orderedTabIds, onPickTab, onOpenChange])

  let runningIndex = 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Big — the wall takes over. 88vw x 82vh, no rounded ceremony.
          "max-w-[1280px] w-[88vw] max-h-[82vh] h-[82vh]",
          "p-0 gap-0 border border-border rounded-md overflow-hidden flex flex-col",
        )}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">All tabs</DialogTitle>

        {/* Header strip ----------------------------------------------------- */}
        <div className="flex items-center justify-between px-5 h-11 border-b border-border bg-muted/20">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-medium">All tabs</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 tabular-nums">
              {tabs.length} open · {columns.length} {columns.length === 1 ? "connection" : "connections"}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
            press <kbd className="font-mono normal-case tracking-normal">1</kbd>–<kbd className="font-mono normal-case tracking-normal">9</kbd> to jump · <kbd className="font-mono normal-case tracking-normal">esc</kbd> to close
          </div>
        </div>

        {/* Columns ---------------------------------------------------------- */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full divide-x divide-border">
            {columns.map((col) => (
              <div key={col.connId ?? "__none"} className="flex-1 min-w-[280px] max-w-[440px] flex flex-col h-full">
                {/* Column header */}
                <div className="flex items-center gap-2 px-4 h-10 border-b border-border bg-background/40">
                  {col.color && (
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: col.color }}
                    />
                  )}
                  <span className="text-xs font-medium truncate flex-1">{col.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 tabular-nums">
                    {col.tabs.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  {col.tabs.map((tab) => {
                    const isActive = tab.id === activeTabId
                    const numberHint = runningIndex < 9 ? runningIndex + 1 : null
                    runningIndex++

                    const sqlPreview = (tab.query || "")
                      .split("\n")
                      .filter((line, idx, arr) => {
                        const before = arr.slice(0, idx)
                        return !(line.trim() === "" && before.every((l) => l.trim() === ""))
                      })
                    const previewLines = sqlPreview.slice(0, 8)
                    const overflowLines = Math.max(0, sqlPreview.length - previewLines.length)

                    const StatusIcon =
                      tab.lastRun?.status === "running"
                        ? Loader2
                        : tab.lastRun?.status === "error"
                          ? AlertCircle
                          : tab.lastRun?.status === "ok"
                            ? CheckCircle2
                            : tab.isSchemaGraph
                              ? FileCode
                              : null

                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          onPickTab(tab.id)
                          onOpenChange(false)
                        }}
                        className={cn(
                          "group w-full text-left rounded-md border bg-card transition-all overflow-hidden",
                          isActive
                            ? "border-primary/50 ring-1 ring-primary/30"
                            : "border-border hover:border-muted-foreground/40",
                        )}
                        style={
                          isActive && col.hue !== null
                            ? { backgroundColor: `hsl(${col.hue}, 60%, 50%, 0.06)` }
                            : undefined
                        }
                      >
                        {/* Top accent line in connection color — 1px hint, not a stripe */}
                        {col.color && (
                          <div
                            aria-hidden
                            className="h-px w-full"
                            style={{ backgroundColor: col.color }}
                          />
                        )}

                        {/* Title row */}
                        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                          {tab.pinned && (
                            <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />
                          )}
                          <span
                            className={cn(
                              "truncate flex-1 min-w-0",
                              isActive ? "text-sm font-medium" : "text-sm",
                            )}
                          >
                            {tab.name}
                          </span>
                          {numberHint !== null && (
                            <span
                              className={cn(
                                "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded text-[9px] font-mono tabular-nums flex-shrink-0",
                                isActive
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted/60 text-muted-foreground/70",
                              )}
                              aria-label={`Press ${numberHint} to jump`}
                            >
                              {numberHint}
                            </span>
                          )}
                        </div>

                        {/* SQL preview body */}
                        {previewLines.length > 0 ? (
                          <pre className="px-3 pb-2 text-[10.5px] font-mono text-muted-foreground/85 whitespace-pre overflow-hidden leading-relaxed">
                            {previewLines.join("\n")}
                            {overflowLines > 0 && (
                              <span className="text-muted-foreground/40">{`\n… +${overflowLines} more`}</span>
                            )}
                          </pre>
                        ) : tab.isSchemaGraph ? (
                          <div className="px-3 pb-2 text-[10.5px] text-muted-foreground/60 italic">
                            schema graph view
                          </div>
                        ) : (
                          <div className="px-3 pb-2 text-[10.5px] text-muted-foreground/40 italic">empty</div>
                        )}

                        {/* Footer row */}
                        {(tab.lastRun || tab.isSchemaGraph) && (
                          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] border-t border-border/60 bg-background/30">
                            {StatusIcon && (
                              <StatusIcon
                                className={cn(
                                  "h-3 w-3 flex-shrink-0",
                                  tab.lastRun?.status === "error" && "text-destructive",
                                  tab.lastRun?.status === "ok" && "text-emerald-600 dark:text-emerald-400",
                                  tab.lastRun?.status === "running" && "animate-spin text-muted-foreground",
                                )}
                              />
                            )}
                            {tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
                              <span className="tabular-nums text-emerald-700 dark:text-emerald-400/90">
                                {tab.lastRun.rowCount.toLocaleString()} rows
                              </span>
                            )}
                            {tab.lastRun?.status === "ok" && tab.lastRun.durationMs !== undefined && (
                              <>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {tab.lastRun.durationMs}ms
                                </span>
                              </>
                            )}
                            {tab.lastRun?.status === "error" && (
                              <span className="text-destructive">failed</span>
                            )}
                            {tab.lastRun?.status === "running" && (
                              <span className="text-muted-foreground">running…</span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
