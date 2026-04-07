"use client"

import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { X, Bookmark, Sparkles, AlertCircle, Loader2, Pin, PinOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Tab } from "./query-tabs"
import { connectionColor, connectionHue } from "@/lib/color/connection-color"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  isOnlyTab: boolean
  onTabChange: (id: string) => void
  onTabClose: (id: string) => void
  /** Persist a manual rename. The tab is marked userRenamed=true so the auto-label deriver won't overwrite it. */
  onTabRename?: (id: string, newName: string) => void
  /** Toggle the pin state. Pinned tabs sort to the front and survive ⌘W on the last tab. */
  onTabPinToggle?: (id: string) => void
  /** Lookup map of connectionId → human label, for the hover preview card. */
  connectionLabels?: Record<string, string>
  width: number | null
}

export const SortableTab = forwardRef<HTMLDivElement, SortableTabProps>(
  ({ tab, isActive, isOnlyTab, onTabChange, onTabClose, onTabRename, onTabPinToggle, connectionLabels, width }, ref) => {
    const [editing, setEditing] = useState(false)
    const [draftName, setDraftName] = useState(tab.name)
    const inputRef = useRef<HTMLInputElement | null>(null)

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: tab.id })

    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [editing])

    useEffect(() => {
      if (!editing) setDraftName(tab.name)
    }, [tab.name, editing])

    const commit = () => {
      const next = draftName.trim()
      if (next && next !== tab.name) onTabRename?.(tab.id, next)
      setEditing(false)
    }
    const cancel = () => {
      setDraftName(tab.name)
      setEditing(false)
    }

    // Connection identity is encoded as a small inline pip + an active-tab
    // background wash. NO border, NO stripe — the previous "2px left border"
    // produced janky parens shapes when tabs sat next to each other because
    // the rounded corners clipped the border into an arc.
    const pipColor = tab.connectionId ? connectionColor(tab.connectionId) : null
    const activeBgHue = tab.connectionId ? connectionHue(tab.connectionId) : null

    // dnd-kit's pointer listeners default to ANY mouse button, which means
    // a right-click starts a drag and the contextmenu event never fires.
    // Filter so the drag only engages on the primary (left) button.
    const safeListeners = useMemo(() => {
      if (!listeners) return undefined
      return {
        ...listeners,
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          listeners.onPointerDown?.(e)
        },
        onMouseDown: (e: React.MouseEvent) => {
          if (e.button !== 0) return
          listeners.onMouseDown?.(e)
        },
      } as typeof listeners
    }, [listeners])

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      width: width ? `${width}px` : undefined,
      minWidth: width ? `${width}px` : undefined,
      maxWidth: width ? `${width}px` : undefined,
      // Faint hue wash on the active tab. The 4% lightness keeps it readable
      // on both light and dark themes; on inactive tabs we leave it flat.
      backgroundColor:
        isActive && activeBgHue !== null
          ? `hsl(${activeBgHue}, 60%, 50%, 0.07)`
          : undefined,
    }

    const tabContent = (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={(node) => {
              setNodeRef(node)
              if (typeof ref === 'function') {
                ref(node)
              } else if (ref) {
                ref.current = node
              }
            }}
            style={style}
            className={cn(
              "group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-100",
              isActive
                ? "text-foreground border border-border font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground border border-transparent",
              isDragging && "opacity-50 shadow-lg z-50",
              !editing && "cursor-grab active:cursor-grabbing",
              editing && "cursor-text",
            )}
            onClick={() => !editing && onTabChange(tab.id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (onTabRename) {
                setDraftName(tab.name)
                setEditing(true)
              }
            }}
            {...(editing ? {} : attributes)}
            {...(editing ? {} : safeListeners)}
          >
            {/* Connection pip — a tiny solid disc that encodes the connection
                identity without screaming. Hidden for tabs not bound to a
                connection (e.g. brand new query tabs). */}
            {pipColor && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: pipColor }}
              />
            )}
            {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-label="Pinned" />}
            {tab.isGenerator ? (
              <Sparkles className="h-3 w-3 text-emerald-600 flex-shrink-0" />
            ) : (
              tab.isNamedQuery && <Bookmark className="h-3 w-3 text-accent-foreground fill-accent flex-shrink-0" />
            )}
            {tab.lastRun?.status === "running" && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" aria-label="Running" />
            )}
            {tab.lastRun?.status === "error" && (
              <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" aria-label="Failed" />
            )}
            {editing ? (
              <input
                ref={inputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commit()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    cancel()
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent border-b border-primary/60 outline-none text-sm"
                aria-label="Rename tab"
              />
            ) : (
              <span className="truncate flex-1 min-w-0">{tab.name}</span>
            )}
            {!editing && tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
              <span
                className="text-[9px] tabular-nums text-muted-foreground bg-muted/60 rounded px-1 py-0 flex-shrink-0"
                title={`${tab.lastRun.rowCount.toLocaleString()} rows · ${tab.lastRun.durationMs ?? 0}ms`}
              >
                {tab.lastRun.rowCount > 9999 ? `${(tab.lastRun.rowCount / 1000).toFixed(1)}k` : tab.lastRun.rowCount}
              </span>
            )}
            {!isOnlyTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5 transition-opacity flex-shrink-0"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="p-0 max-w-[360px] w-[360px] border-0">
          <TabPreviewCard tab={tab} connectionLabels={connectionLabels} />
        </TooltipContent>
      </Tooltip>
    )

    if (!onTabPinToggle) return tabContent

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{tabContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => onTabPinToggle(tab.id)}>
            {tab.pinned ? (
              <>
                <PinOff className="h-3.5 w-3.5 mr-2" />
                Unpin tab
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5 mr-2" />
                Pin tab
              </>
            )}
          </ContextMenuItem>
          {onTabRename && (
            <ContextMenuItem
              onClick={() => {
                setDraftName(tab.name)
                setEditing(true)
              }}
            >
              Rename…
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={isOnlyTab}
            onClick={() => onTabClose(tab.id)}
            className="text-destructive focus:text-destructive"
          >
            <X className="h-3.5 w-3.5 mr-2" />
            Close tab
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
)

SortableTab.displayName = "SortableTab"

// ---- Hover preview card ---------------------------------------------------
//
// The hover preview is the "examine the tab" affordance. It's intentionally
// dense — connection label as a small uppercase tag in the top-right, the
// tab name as the heading, the SQL preview in monospace below, and a
// metadata footer for last-run info. The connection-colored top accent line
// (1px) ties the floating card visually back to the tab it came from.

function TabPreviewCard({
  tab,
  connectionLabels,
}: {
  tab: Tab
  connectionLabels?: Record<string, string>
}) {
  const connectionLabel =
    tab.connectionId && connectionLabels?.[tab.connectionId]
      ? connectionLabels[tab.connectionId]
      : tab.connectionId
  const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : null
  const tintHue = tab.connectionId ? connectionHue(tab.connectionId) : null

  // Strip leading blank lines so the preview doesn't waste vertical space.
  const sqlLines = (tab.query || "")
    .split("\n")
    .filter((line, idx, arr) => {
      const before = arr.slice(0, idx)
      return !(line.trim() === "" && before.every((l) => l.trim() === ""))
    })
    .slice(0, 6)
  const remainingLines = Math.max(0, (tab.query?.split("\n").length ?? 0) - sqlLines.length)

  const lastRunBlurb = (() => {
    if (!tab.lastRun) return null
    const date = new Date(tab.lastRun.at)
    const elapsed = Math.round((Date.now() - date.getTime()) / 1000)
    const ago =
      elapsed < 5
        ? "just now"
        : elapsed < 60
          ? `${elapsed}s ago`
          : elapsed < 3600
            ? `${Math.round(elapsed / 60)}m ago`
            : elapsed < 86_400
              ? `${Math.round(elapsed / 3600)}h ago`
              : date.toLocaleString()
    if (tab.lastRun.status === "running") return { ago, body: "running…", tone: "neutral" as const }
    if (tab.lastRun.status === "error") return { ago, body: "failed", tone: "error" as const }
    if (tab.lastRun.status === "ok") {
      const rows = tab.lastRun.rowCount?.toLocaleString() ?? "?"
      const dur = tab.lastRun.durationMs !== undefined ? `${tab.lastRun.durationMs}ms` : ""
      return { ago, body: `${rows} rows${dur ? ` · ${dur}` : ""}`, tone: "ok" as const }
    }
    return null
  })()

  return (
    <div
      className="text-left rounded-md border border-border overflow-hidden bg-popover"
      style={{
        // Subtle wash matching the active-tab treatment so the preview reads
        // as "the same tab, expanded" rather than a generic floating card.
        backgroundColor:
          tintHue !== null ? `hsl(${tintHue}, 60%, 50%, 0.04)` : undefined,
      }}
    >
      {/* Top accent line in the connection color. 1px so it's a hint, not a stripe. */}
      {stripeColor && (
        <div aria-hidden className="h-px w-full" style={{ backgroundColor: stripeColor }} />
      )}

      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
        <div className="flex-1 min-w-0">
          {connectionLabel && (
            <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground/80 mb-0.5">
              {connectionLabel}
            </div>
          )}
          <div className="font-medium text-sm truncate flex items-center gap-1.5">
            {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground/70 flex-shrink-0" aria-hidden />}
            {tab.name}
          </div>
        </div>
      </div>

      {sqlLines.length > 0 && (
        <pre className="px-3 pb-2 text-[11px] font-mono text-muted-foreground/90 whitespace-pre overflow-hidden leading-relaxed">
          {sqlLines.join("\n")}
          {remainingLines > 0 && `\n… +${remainingLines} more lines`}
        </pre>
      )}

      {!sqlLines.length && tab.isSchemaGraph && (
        <div className="px-3 pb-2 text-[11px] text-muted-foreground italic">Schema graph view</div>
      )}

      {lastRunBlurb && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px] border-t border-border/60 bg-background/30">
          <span
            className={cn(
              "tabular-nums font-medium",
              lastRunBlurb.tone === "ok" && "text-emerald-700 dark:text-emerald-400",
              lastRunBlurb.tone === "error" && "text-destructive",
              lastRunBlurb.tone === "neutral" && "text-muted-foreground",
            )}
          >
            {lastRunBlurb.body}
          </span>
          <span className="text-muted-foreground">{lastRunBlurb.ago}</span>
        </div>
      )}
    </div>
  )
}
