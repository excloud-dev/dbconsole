"use client"

import { useMemo, useState, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TableRef } from "@/lib/schema-introspection"
import { cn } from "@/lib/utils"

export type WriteQueryMode = "insert" | "update"

interface GenerateWriteQueryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tables: TableRef[]
  onGenerate: (mode: WriteQueryMode, table: TableRef) => void
}

export function GenerateWriteQueryDialog({ open, onOpenChange, tables, onGenerate }: GenerateWriteQueryDialogProps) {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<TableRef | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tables
    return tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q))
  }, [search, tables])

  const entries = useMemo(
    () =>
      filtered.map((t) => ({
        table: t,
        label: `${t.schema}.${t.name}`,
      })),
    [filtered],
  )

  const selectedIndex = useMemo(() => {
    if (!selected) return -1
    return entries.findIndex((e) => e.table.schema === selected.schema && e.table.name === selected.name)
  }, [entries, selected])

  const effectiveHighlightIndex = entries.length === 0
    ? -1
    : selectedIndex >= 0
      ? selectedIndex
      : Math.max(0, Math.min(entries.length - 1, highlightIndex))

  const effectiveSelected = entries.length === 0
    ? null
    : selectedIndex >= 0
      ? selected
      : entries[effectiveHighlightIndex]?.table ?? null

  const handleGenerate = (mode: WriteQueryMode) => {
    if (!effectiveSelected) return
    onGenerate(mode, effectiveSelected)
    onOpenChange(false)
  }

  const handleNavigate = (direction: 1 | -1) => {
    if (entries.length === 0) return
    const next = Math.max(0, Math.min(entries.length - 1, effectiveHighlightIndex + direction))
    setHighlightIndex(next)
    setSelected(entries[next].table)
    const container = listRef.current
    const child = container?.querySelector(`[data-index="${next}"]`) as HTMLElement | null
    if (container && child) {
      const top = child.offsetTop
      const bottom = top + child.offsetHeight
      if (top < container.scrollTop) container.scrollTop = top
      else if (bottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = bottom - container.clientHeight
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Write Query</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            ref={searchRef}
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                handleNavigate(1)
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                handleNavigate(-1)
              } else if (e.key === "Enter") {
                if (effectiveSelected) {
                  e.preventDefault()
                  handleGenerate("insert")
                }
              }
            }}
          />

          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border" ref={listRef}>
            {entries.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No tables found</div>
            ) : (
              <div className="divide-y divide-border">
                {entries.map((entry, index) => {
                  const isSelected = effectiveSelected?.schema === entry.table.schema && effectiveSelected?.name === entry.table.name
                  const isHighlighted = index === effectiveHighlightIndex
                  return (
                    <button
                      key={entry.label}
                      data-index={index}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm font-mono hover:bg-secondary",
                        isHighlighted && "bg-secondary",
                        isSelected && "text-foreground",
                      )}
                      onClick={() => {
                        setSelected(entry.table)
                        setHighlightIndex(index)
                      }}
                      type="button"
                    >
                      {entry.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={() => handleGenerate("update")} disabled={!selected} variant="outline">
              Generate Update
            </Button>
            <Button onClick={() => handleGenerate("insert")} disabled={!selected}>
              Generate Insert
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
