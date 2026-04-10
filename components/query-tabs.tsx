"use client"

import { useEffect, useMemo, useRef } from "react"
import { Plus } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable"
import { restrictToHorizontalAxis, restrictToParentElement } from "@dnd-kit/modifiers"
import { Button } from "@/components/ui/button"
import { SortableTab } from "./sortable-tab"

export type RawParam = {
  type: 'string' | 'number' | 'boolean'
  value: string
}

export interface TabLastRun {
  status: 'ok' | 'error' | 'timeout' | 'running'
  rowCount?: number
  durationMs?: number
  at: string // ISO timestamp
}

export interface Tab {
  id: string
  name: string
  query: string
  /** True if the user gave this tab an explicit name; auto-labels won't override. */
  userRenamed?: boolean
  /** Pinned tabs sort to the front and collapse to icon-only width. */
  pinned?: boolean
  /** Most recent execution status for the status pill on the tab. */
  lastRun?: TabLastRun
  isNamedQuery?: boolean
  isGenerator?: boolean
  /** Schema graph tab — renders a Mermaid ER diagram instead of the SQL editor + grid. */
  isSchemaGraph?: boolean
  namedQueryId?: string
  connectionId?: string
  params?: RawParam[]
  namedParams?: Record<string, string>
  generator?: {
    mode: "insert" | "update"
    table: { schema: string; name: string }
    params: Array<{
      name: string
      dataType: string
      inputType: "string" | "number" | "boolean"
      isNullable: boolean
      isAuto: boolean
      isPk: boolean
      role?: "set" | "where"
      overrideAuto?: boolean
      isNull?: boolean
      value: string
    }>
    allowUnsafeUpdate?: boolean
  }
  pagination?: {
    limit?: number
    offset: number
    total?: number
  }
  editorHeight?: number
  showQuery?: boolean
}

interface QueryTabsProps {
  tabs: Tab[]
  activeTab: string
  /** Lookup map of connectionId → human label, for the hover preview card. */
  connectionLabels?: Record<string, string>
  onTabChange: (id: string) => void
  onTabClose: (id: string) => void
  onTabRename?: (id: string, newName: string) => void
  onTabPinToggle?: (id: string) => void
  onAddTab: () => void
  onTabReorder: (tabs: Tab[]) => void
}

export function QueryTabs({ tabs, activeTab, connectionLabels, onTabChange, onTabClose, onTabRename, onTabPinToggle, onAddTab, onTabReorder }: QueryTabsProps) {
  // Pinned tabs sort to the front; everything else keeps its original order.
  const sortedTabs = useMemo(() => {
    const pinned = tabs.filter((t) => t.pinned)
    const unpinned = tabs.filter((t) => !t.pinned)
    return [...pinned, ...unpinned]
  }, [tabs])
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Set up drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Drag must move 8px before activating
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Auto-scroll to active tab when it changes
  useEffect(() => {
    const activeTabElement = tabRefs.current.get(activeTab)
    if (activeTabElement && scrollContainerRef.current) {
      activeTabElement.scrollIntoView({
        behavior: 'smooth',
        inline: 'nearest',
        block: 'nearest'
      })
    }
  }, [activeTab])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((tab) => tab.id === active.id)
      const newIndex = tabs.findIndex((tab) => tab.id === over.id)

      const reorderedTabs = arrayMove(tabs, oldIndex, newIndex)
      onTabReorder(reorderedTabs)
    }
  }

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToHorizontalAxis]}
      >
        <SortableContext
          items={sortedTabs.map((tab) => tab.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollContainerRef}
            className="flex items-center gap-1 overflow-x-auto overflow-y-hidden flex-1 min-w-0 scrollbar-hide"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {sortedTabs.map((tab) => (
              <SortableTab
                key={tab.id}
                ref={(el) => {
                  if (el) {
                    tabRefs.current.set(tab.id, el)
                  } else {
                    tabRefs.current.delete(tab.id)
                  }
                }}
                tab={tab}
                isActive={activeTab === tab.id}
                isOnlyTab={tabs.length === 1}
                onTabChange={onTabChange}
                onTabClose={onTabClose}
                onTabRename={onTabRename}
                onTabPinToggle={onTabPinToggle}
                connectionLabels={connectionLabels}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
        onClick={onAddTab}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
