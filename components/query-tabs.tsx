"use client"

import { Plus, X, Bookmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type RawParam = {
  type: 'string' | 'number' | 'boolean'
  value: string
}

export interface Tab {
  id: string
  name: string
  query: string
  isNamedQuery?: boolean
  namedQueryId?: string
  connectionId?: string
  params?: RawParam[]
  namedParams?: Record<string, string>
  pagination?: {
    limit: number
    offset: number
    total?: number
  }
  editorHeight?: number
  showQuery?: boolean
}

interface QueryTabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  onTabClose: (id: string) => void
  onAddTab: () => void
}

export function QueryTabs({ tabs, activeTab, onTabChange, onTabClose, onAddTab }: QueryTabsProps) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "group flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all duration-150",
            activeTab === tab.id
              ? "bg-white text-stone-900 border border-stone-200 font-medium"
              : "text-stone-500 hover:bg-stone-200/50 hover:text-stone-700",
          )}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.isNamedQuery && <Bookmark className="h-3 w-3 text-accent-foreground fill-accent" />}
          <span className="truncate max-w-24">{tab.name}</span>
          {tabs.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-stone-200 rounded p-0.5 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <Button variant="ghost" size="icon" className="h-7 w-7 text-stone-400 hover:text-stone-600" onClick={onAddTab}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
