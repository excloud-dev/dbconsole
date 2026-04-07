"use client"

import { AlertCircle, CheckCircle2, FileCode, Loader2, Pin } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { connectionColor } from "@/lib/color/connection-color"
import { cn } from "@/lib/utils"
import type { Tab } from "./query-tabs"
import type { TabGroup } from "@/lib/tab-store"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: Tab[]
  activeTabId: string | null
  groups?: TabGroup[]
  connectionLabels?: Record<string, string>
  onPickTab: (id: string) => void
}

/**
 * Card-grid overview of every open tab. Each card shows:
 *  - The connection color stripe + tab title (with pin icon if pinned)
 *  - A 6-line SQL preview (or "Schema graph view" placeholder)
 *  - Connection label, group dot, last-run row count + status
 *
 * Bound to `tabs.overview` (default ⌘⇧P). Designed as the escape hatch when
 * the inline tab bar is too dense to scan and the fuzzy switcher (⌘P/⌘K)
 * isn't quite the tool you want.
 */
export function TabOverview({ open, onOpenChange, tabs, activeTabId, groups, connectionLabels, onPickTab }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[92vw] max-h-[80vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-base">All tabs ({tabs.length})</DialogTitle>
        </DialogHeader>

        <div className="overflow-auto p-4">
          {tabs.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">No tabs open.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : "transparent"
                const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] : undefined
                const group = tab.groupId ? groups?.find((g) => g.id === tab.groupId) : undefined

                const sqlLines = (tab.query || "")
                  .split("\n")
                  .filter((line, idx, arr) => {
                    const before = arr.slice(0, idx)
                    return !(line.trim() === "" && before.every((l) => l.trim() === ""))
                  })
                  .slice(0, 6)
                const remainingLines = Math.max(0, (tab.query?.split("\n").length ?? 0) - sqlLines.length)

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
                      "text-left flex flex-col rounded-md border border-border bg-card hover:bg-secondary/40 transition-colors overflow-hidden",
                      isActive && "ring-2 ring-primary/50 border-primary/40",
                    )}
                    style={{
                      borderLeft: tab.connectionId ? `3px solid ${stripeColor}` : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                      {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />}
                      <span className="font-medium text-sm truncate flex-1">{tab.name}</span>
                      {StatusIcon && (
                        <StatusIcon
                          className={cn(
                            "h-3.5 w-3.5 flex-shrink-0",
                            tab.lastRun?.status === "error" && "text-destructive",
                            tab.lastRun?.status === "ok" && "text-emerald-600 dark:text-emerald-400",
                            tab.lastRun?.status === "running" && "animate-spin text-muted-foreground",
                          )}
                        />
                      )}
                    </div>

                    {sqlLines.length > 0 ? (
                      <pre className="px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-pre overflow-hidden flex-1 max-h-[120px]">
                        {sqlLines.join("\n")}
                        {remainingLines > 0 && `\n… +${remainingLines} more lines`}
                      </pre>
                    ) : tab.isSchemaGraph ? (
                      <div className="px-3 py-4 text-[11px] text-muted-foreground italic">
                        Schema graph view
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-[11px] text-muted-foreground italic">
                        (empty)
                      </div>
                    )}

                    <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border min-h-[24px]">
                      {connLabel && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <span
                            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: stripeColor }}
                          />
                          {connLabel}
                        </span>
                      )}
                      {group && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: group.color }}
                            />
                            {group.name}
                          </span>
                        </>
                      )}
                      {tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
                        <span className="ml-auto tabular-nums">
                          {tab.lastRun.rowCount.toLocaleString()} rows
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
