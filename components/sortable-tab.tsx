"use client"

import { forwardRef } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { X, Bookmark, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Tab } from "./query-tabs"

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  isOnlyTab: boolean
  onTabChange: (id: string) => void
  onTabClose: (id: string) => void
  width: number | null
}

export const SortableTab = forwardRef<HTMLDivElement, SortableTabProps>(
  ({ tab, isActive, isOnlyTab, onTabChange, onTabClose, width }, ref) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: tab.id })

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      width: width ? `${width}px` : undefined,
      minWidth: width ? `${width}px` : undefined,
      maxWidth: width ? `${width}px` : undefined,
    }

    return (
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
                ? "bg-white text-stone-900 border border-stone-200 font-medium"
                : "text-stone-500 hover:bg-stone-200/50 hover:text-stone-700",
              isDragging && "opacity-50 shadow-lg z-50",
            )}
            onClick={() => onTabChange(tab.id)}
            {...attributes}
            {...listeners}
          >
            {tab.isGenerator ? (
              <Sparkles className="h-3 w-3 text-emerald-600 flex-shrink-0" />
            ) : (
              tab.isNamedQuery && <Bookmark className="h-3 w-3 text-accent-foreground fill-accent flex-shrink-0" />
            )}
            <span className="truncate flex-1 min-w-0">{tab.name}</span>
            {!isOnlyTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-stone-200 rounded p-0.5 transition-opacity flex-shrink-0"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {tab.name}
        </TooltipContent>
      </Tooltip>
    )
  }
)

SortableTab.displayName = "SortableTab"
