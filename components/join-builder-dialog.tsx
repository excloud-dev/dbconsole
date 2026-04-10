"use client"

import { useState, useMemo, useCallback } from "react"
import { GitMerge, Plus, X, ChevronRight, ArrowRight, Database, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface TableInfo {
  name: string
  schema: string
  qualifiedName: string
  columns: {
    name: string
    type: string
    isFk?: boolean
    references?: { schema: string; table: string; qualifiedTable: string; column: string }
  }[]
}

interface JoinConfig {
  table: string
  leftTable: string
  leftColumn: string
  rightColumn: string
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL"
}

interface JoinBuilderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  baseTable: string
  tables: TableInfo[]
  onCreateJoin: (baseTable: string, joins: JoinConfig[]) => void
}

export function JoinBuilderDialog({ open, onOpenChange, baseTable, tables, onCreateJoin }: JoinBuilderDialogProps) {
  const [joins, setJoins] = useState<JoinConfig[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  // Get FK relationships for a table (both directions, 2 levels deep)
  const getFkRelationships = useCallback((
    tableName: string,
    visited: Set<string> = new Set(),
  ): { table: string; fromTable: string; fromCol: string; toCol: string; direction: "outgoing" | "incoming" }[] => {
    if (visited.has(tableName)) return []
    visited.add(tableName)

    const relationships: { table: string; fromTable: string; fromCol: string; toCol: string; direction: "outgoing" | "incoming" }[] = []
    const currentTable = tables.find((t) => t.qualifiedName === tableName || t.name === tableName)

    // Outgoing FKs (this table references another)
    currentTable?.columns.forEach((col) => {
      if (col.isFk && col.references && !visited.has(col.references.qualifiedTable)) {
        relationships.push({
          table: col.references.qualifiedTable,
          fromTable: currentTable.qualifiedName,
          fromCol: col.name,
          toCol: col.references.column,
          direction: "outgoing",
        })
      }
    })

    // Incoming FKs (other tables reference this table)
    tables.forEach((t) => {
      if (t.qualifiedName !== (currentTable?.qualifiedName ?? tableName) && !visited.has(t.qualifiedName)) {
        t.columns.forEach((col) => {
          if (col.isFk && col.references?.qualifiedTable === (currentTable?.qualifiedName ?? tableName)) {
            relationships.push({
              table: t.qualifiedName,
              fromTable: currentTable?.qualifiedName ?? tableName,
              fromCol: col.references.column,
              toCol: col.name,
              direction: "incoming",
            })
          }
        })
      }
    })
    return relationships
  }, [tables])

  // Get available FK relationships based on current join chain
  const availableRelationships = useMemo(() => {
    const joinedTables = new Set([baseTable, ...joins.map((j) => j.table)])
    const allRelationships: { fromTable: string; toTable: string; fromCol: string; toCol: string }[] = []

    // Get relationships from all joined tables (2 levels deep)
    const visited = new Set<string>()
    const tablesToCheck = [baseTable, ...joins.map((j) => j.table)]

    tablesToCheck.forEach((tableName) => {
      const rels = getFkRelationships(tableName, new Set())
      rels.forEach((rel) => {
        if (!joinedTables.has(rel.table)) {
          allRelationships.push({
            fromTable: rel.fromTable ?? tableName,
            toTable: rel.table,
            fromCol: rel.fromCol,
            toCol: rel.toCol,
          })
        }
      })
    })

    // Deduplicate
    const seen = new Set<string>()
    return allRelationships.filter((rel) => {
      const key = `${rel.fromTable}-${rel.toTable}-${rel.fromCol}-${rel.toCol}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [baseTable, getFkRelationships, joins])

  // Filter relationships based on search query
  const filteredRelationships = useMemo(() => {
    if (!searchQuery.trim()) return availableRelationships

    const search = searchQuery.toLowerCase()
    return availableRelationships.filter((rel) =>
      rel.toTable.toLowerCase().includes(search) ||
      rel.fromTable.toLowerCase().includes(search) ||
      rel.toCol.toLowerCase().includes(search) ||
      rel.fromCol.toLowerCase().includes(search)
    )
  }, [availableRelationships, searchQuery])

  const addJoin = (rel: { fromTable: string; toTable: string; fromCol: string; toCol: string }) => {
    setJoins([
      ...joins,
      {
        table: rel.toTable,
        leftTable: rel.fromTable,
        leftColumn: rel.fromCol,
        rightColumn: rel.toCol,
        joinType: "INNER",
      },
    ])
  }

  const removeJoin = (index: number) => {
    // Remove this join and all joins after it (chain dependency)
    setJoins(joins.slice(0, index))
  }

  const updateJoinType = (index: number, joinType: JoinConfig["joinType"]) => {
    setJoins(joins.map((j, i) => (i === index ? { ...j, joinType } : j)))
  }

  const handleCreate = () => {
    onCreateJoin(baseTable, joins)
    setJoins([])
    setSearchQuery("")
    onOpenChange(false)
  }

  const handleClose = () => {
    setJoins([])
    setSearchQuery("")
    onOpenChange(false)
  }

  const getTableColumns = (tableName: string) => {
    return tables.find((t) => t.name === tableName)?.columns || []
  }

  // Build join chain for visualization
  const joinChain = [baseTable, ...joins.map((j) => j.table)]

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4 text-muted-foreground" />
            Join Builder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Join chain visualization */}
          <div className="flex items-center gap-1 flex-wrap p-3 bg-secondary rounded-lg border border-border">
            {joinChain.map((table, i) => (
              <div key={table} className="flex items-center gap-1">
                <Badge
                  variant={i === 0 ? "default" : "secondary"}
                  className={cn(
                    "font-mono text-xs",
                    i === 0 ? "bg-success/15 text-success border border-success/30" : "bg-card border border-border",
                  )}
                >
                  {table}
                </Badge>
                {i < joinChain.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>

          {/* Available FK relationships to add - FIRST */}
          {availableRelationships.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center justify-between">
                <span>Available Relationships</span>
                <span className="text-xs text-muted-foreground/60 font-normal normal-case">Click to add</span>
              </div>

              {/* Conditional search bar - only show when 5+ relationships */}
              {availableRelationships.length >= 5 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tables or columns..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-9 text-xs bg-card border-border focus:border-muted-foreground focus:ring-ring/20"
                  />
                  {searchQuery && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/60">
                      {filteredRelationships.length} of {availableRelationships.length}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto overflow-x-hidden pr-1">
                {filteredRelationships.map((rel, i) => (
                  <button
                    key={i}
                    onClick={() => addJoin(rel)}
                    className="group flex flex-col gap-1.5 p-3 text-xs rounded-lg border border-border bg-secondary hover:bg-card hover:border-muted-foreground hover:shadow-sm hover:ring-1 hover:ring-ring/20 transition-all text-left w-full min-w-0"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="h-5 w-5 rounded-full bg-info/15 flex-shrink-0 flex items-center justify-center text-info">
                          <Plus className="h-3 w-3" />
                        </div>
                        <span className="font-semibold text-foreground truncate text-sm" title={rel.toTable}>
                          {rel.toTable}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 w-full pl-7 opacity-80 group-hover:opacity-100 transition-opacity">
                      <code className="text-info font-mono font-medium text-xs truncate bg-info/10 px-1 py-0.5 rounded border border-info/30 max-w-[45%]" title={rel.toCol}>
                        {rel.toCol}
                      </code>
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <div className="flex items-center gap-0.5 min-w-0 max-w-[45%]">
                        <code className="text-muted-foreground font-mono text-xs truncate" title={rel.fromTable}>
                          {rel.fromTable}
                        </code>
                        <span className="text-muted-foreground/60">.</span>
                        <code className="text-foreground font-mono text-xs truncate" title={rel.fromCol}>
                          {rel.fromCol}
                        </code>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* No search results */}
              {filteredRelationships.length === 0 && searchQuery && (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No relationships match &quot;{searchQuery}&quot;
                </div>
              )}
            </div>
          )}

          {availableRelationships.length === 0 && joins.length === 0 && (
            <div className="text-center py-8 flex flex-col items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                <Database className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">No foreign key relationships found</span>
            </div>
          )}

          {/* Current joins */}
          {joins.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border mt-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Joins</div>
              {joins.map((join, index) => {
                return (
                  <div key={index} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card shadow-sm overflow-hidden">
                    <Select
                      value={join.joinType}
                      onValueChange={(v) => updateJoinType(index, v as JoinConfig["joinType"])}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs font-medium bg-secondary flex-shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INNER" className="text-xs">
                          INNER
                        </SelectItem>
                        <SelectItem value="LEFT" className="text-xs">
                          LEFT
                        </SelectItem>
                        <SelectItem value="RIGHT" className="text-xs">
                          RIGHT
                        </SelectItem>
                        <SelectItem value="FULL" className="text-xs">
                          FULL
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <div className="flex-1 flex items-center gap-2 text-xs min-w-0">
                      <code className="px-1.5 py-0.5 bg-secondary rounded text-foreground font-mono border border-border truncate" title={`${join.leftTable}.${join.leftColumn}`}>
                        {join.leftTable}.{join.leftColumn}
                      </code>
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <code className="px-1.5 py-0.5 bg-info/10 text-info rounded font-mono border border-info/30 truncate" title={`${join.table}.${join.rightColumn}`}>
                        {join.table}.{join.rightColumn}
                      </code>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 flex-shrink-0"
                      onClick={() => removeJoin(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {availableRelationships.length === 0 && joins.length > 0 && (
            <div className="text-center py-4 text-xs text-muted-foreground italic">No more relationships available</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={joins.length === 0}
            onClick={handleCreate}
          >
            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
            Create Query
          </Button>
        </div>
      </DialogContent>
    </Dialog >
  )
}
