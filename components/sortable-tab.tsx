"use client"

import { forwardRef, useEffect, useRef, useState } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { X, Bookmark, Sparkles, AlertCircle, Loader2, Pin, PinOff } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { TabGroup } from "@/lib/tab-store"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Tab } from "./query-tabs"
import { connectionColor } from "@/lib/color/connection-color"

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
  /** Move a tab into a group, or pass `null` to remove from any group. */
  onTabAssignGroup?: (id: string, groupId: string | null) => void
  /** Create a new group, name it, and assign this tab to it. */
  onCreateGroupForTab?: (id: string) => void
  /** All groups defined in the workspace. */
  groups?: TabGroup[]
  /** Lookup map of connectionId → human label, for the hover preview card. */
  connectionLabels?: Record<string, string>
  width: number | null
}

export const SortableTab = forwardRef<HTMLDivElement, SortableTabProps>(
  ({ tab, isActive, isOnlyTab, onTabChange, onTabClose, onTabRename, onTabPinToggle, onTabAssignGroup, onCreateGroupForTab, groups, connectionLabels, width }, ref) => {
    const [editing, setEditing] = useState(false)
    const [draftName, setDraftName] = useState(tab.name)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [editing])

    // Reset the draft when the underlying tab name changes from outside
    // (e.g. auto-label deriver fires while we're not editing).
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
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: tab.id })

    // Stable per-connection color used as a 2px left border so tabs from
    // prod / staging / sandbox visually segregate without reading the title.
    // Falls back to muted/transparent for tabs with no connection bound yet.
    const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : 'transparent'

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      width: width ? `${width}px` : undefined,
      minWidth: width ? `${width}px` : undefined,
      maxWidth: width ? `${width}px` : undefined,
      borderLeft: tab.connectionId ? `2px solid ${stripeColor}` : undefined,
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
              "group flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing transition-all duration-150",
              isActive
                ? "bg-card text-foreground border border-border font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              isDragging && "opacity-50 shadow-lg z-50",
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
            {...(editing ? {} : listeners)}
          >
            {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-label="Pinned" />}
            {tab.groupId && groups && (() => {
              const g = groups.find((x) => x.id === tab.groupId)
              return g ? (
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: g.color }}
                  aria-label={`Group: ${g.name}`}
                  title={g.name}
                />
              ) : null
            })()}
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
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="p-0 max-w-[360px] w-[360px]">
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
          {onTabAssignGroup && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Group…</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuLabel className="text-[10px] text-muted-foreground uppercase">
                  Move to group
                </ContextMenuLabel>
                <ContextMenuItem
                  onClick={() => onTabAssignGroup(tab.id, null)}
                  className={cn(!tab.groupId && "font-medium")}
                >
                  No group
                </ContextMenuItem>
                {groups?.map((g) => (
                  <ContextMenuItem
                    key={g.id}
                    onClick={() => onTabAssignGroup(tab.id, g.id)}
                    className={cn(tab.groupId === g.id && "font-medium")}
                  >
                    <span
                      className="h-2 w-2 rounded-full mr-2 flex-shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    {g.name}
                  </ContextMenuItem>
                ))}
                {onCreateGroupForTab && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onCreateGroupForTab(tab.id)}>
                      New group…
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
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

  // Show the first ~6 lines of SQL. Skip leading blank lines so the preview
  // doesn't waste vertical space when the user has whitespace at the top.
  const sqlLines = (tab.query || "")
    .split("\n")
    .filter((line, idx, arr) => {
      // Trim leading blank lines
      const before = arr.slice(0, idx)
      return !(line.trim() === "" && before.every((l) => l.trim() === ""))
    })
    .slice(0, 6)
  const remainingLines = Math.max(0, (tab.query?.split("\n").length ?? 0) - sqlLines.length)

  const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : "transparent"

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
    if (tab.lastRun.status === "running") return `Running · ${ago}`
    if (tab.lastRun.status === "error") return `Failed · ${ago}`
    if (tab.lastRun.status === "ok") {
      const rows = tab.lastRun.rowCount?.toLocaleString() ?? "?"
      const dur = tab.lastRun.durationMs !== undefined ? `${tab.lastRun.durationMs}ms` : ""
      return `${rows} rows${dur ? ` · ${dur}` : ""} · ${ago}`
    }
    return null
  })()

  return (
    <div className="text-left">
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border"
        style={{
          borderLeft: tab.connectionId ? `2px solid ${stripeColor}` : undefined,
        }}
      >
        {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />}
        <span className="font-medium text-sm truncate flex-1">{tab.name}</span>
        {connectionLabel && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: stripeColor }}
              aria-hidden
            />
            {connectionLabel}
          </span>
        )}
      </div>

      {sqlLines.length > 0 && (
        <pre className="px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-pre overflow-hidden">
          {sqlLines.join("\n")}
          {remainingLines > 0 && `\n… +${remainingLines} more lines`}
        </pre>
      )}

      {!sqlLines.length && tab.isSchemaGraph && (
        <div className="px-3 py-2 text-[11px] text-muted-foreground italic">Schema graph view</div>
      )}

      {lastRunBlurb && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
          {lastRunBlurb}
        </div>
      )}
    </div>
  )
}
