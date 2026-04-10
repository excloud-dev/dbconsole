"use client"

import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { X, Bookmark, Sparkles, AlertCircle, Loader2, Pin, PinOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tab } from "./query-tabs"
import { connectionColor } from "@/lib/color/connection-color"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

// ============================================================================
// LOCKED DESIGN SYSTEM (every tab-nav component obeys this — no exceptions)
// ----------------------------------------------------------------------------
// TYPE       text-base (16px / titles)
//            text-sm   (14px / body)
//            text-xs   (12px / meta — minimum size, no text-[10px])
// COLOR      text-foreground            (full)
//            text-muted-foreground       (muted)
//            text-foreground/40          (very muted)
//            text-success / text-destructive for status
// SPACING    multiples of 4: gap-2/3/4/6, p-3/4/6/8
// RADIUS     rounded-md everywhere
// BORDERS    1px border-border, no fractional widths
// HOVER      opacity-80 (inactive tabs only)
// ACTIVE     full opacity, no decoration — inactive tabs dim to 50%
// ============================================================================

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  isOnlyTab: boolean
  onTabChange: (id: string) => void
  onTabClose: (id: string) => void
  onTabRename?: (id: string, newName: string) => void
  onTabPinToggle?: (id: string) => void
  connectionLabels?: Record<string, string>
}

export const SortableTab = forwardRef<HTMLDivElement, SortableTabProps>(
  ({ tab, isActive, isOnlyTab, onTabChange, onTabClose, onTabRename, onTabPinToggle }, ref) => {
    const [editing, setEditing] = useState(false)
    const [draftName, setDraftName] = useState(tab.name)
    const inputRef = useRef<HTMLInputElement | null>(null)

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

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

    // Connection identity = the dot. NOT a bar, NOT a tint, NOT a stripe.
    const pipColor = tab.connectionId ? connectionColor(tab.connectionId) : null

    // dnd-kit's pointer listeners default to ANY mouse button, swallowing the
    // contextmenu event. Filter to button === 0 so right-click reaches the
    // ContextMenu trigger.
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
      minWidth: tab.pinned ? 48 : 120,
      maxWidth: tab.pinned ? 48 : 250,
    }

    const tabContent = (
      <div
        ref={(node) => {
          setNodeRef(node)
          if (typeof ref === "function") {
            ref(node)
          } else if (ref) {
            ref.current = node
          }
        }}
        style={style}
        title={tab.name}
        className={cn(
          // No highlight on the active tab. Instead, inactive tabs fade
          // to 50% opacity — dot, icons, text, everything dims together.
          // The active tab just looks *normal*; everything else recedes.
          "group flex items-center gap-2 rounded-md px-2 py-1 text-xs border border-transparent select-none overflow-hidden",
          isActive
            ? "text-foreground"
            : "opacity-50 hover:opacity-80 transition-opacity",
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
        {pipColor && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: pipColor }}
          />
        )}
        {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-label="Pinned" />}
        {tab.isGenerator ? (
          <Sparkles className="h-3 w-3 text-success flex-shrink-0" />
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
            className="flex-1 min-w-0 bg-transparent border-b border-primary/60 outline-none text-sm select-text"
            aria-label="Rename tab"
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{tab.name}</span>
        )}
        {!editing && tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
          <span
            className="text-xs tabular-nums text-muted-foreground bg-foreground/[0.05] rounded px-1 py-0 flex-shrink-0"
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
