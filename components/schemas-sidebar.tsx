"use client"

import { useState } from "react"
import { ChevronRight, Table2, Search, Bookmark, GitMerge, X, Plus, ChevronDown, Eye, RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { JoinBuilderDialog } from "./join-builder-dialog"
import type { SchemaGraph } from "@/lib/schema-introspection"

interface TableInfo {
  name: string
  schema: string
  qualifiedName: string
  columns: {
    name: string;
    type: string;
    isFk?: boolean;
    isPk?: boolean;
    references?: { schema: string; table: string; qualifiedTable: string; column: string }
  }[]
}

interface NamedQuery {
  id: string
  name: string
}

interface Connection {
  id: string
  label: string
  status?: "connected" | "connecting" | "disconnected"
}

interface JoinConfig {
  table: string
  leftColumn: string
  rightColumn: string
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL"
}

interface SchemasSidebarProps {
  connections: Connection[]
  activeConnection: string | null
  onConnectionChange: (id: string) => void
  namedQueries: NamedQuery[]
  onOpenNamedQuery: (id: string) => void
  onDeleteNamedQuery?: (id: string) => void
  onJoinTables: (baseTable: string, joins: JoinConfig[]) => void
  onViewTable: (tableName: string) => void
  onOpenSettings: () => void
  onRefreshSchema?: () => void
  schema?: SchemaGraph | null
}

export function SchemasSidebar({
  connections,
  activeConnection,
  onConnectionChange,
  namedQueries,
  onOpenNamedQuery,
  onDeleteNamedQuery,
  onJoinTables,
  onViewTable,
  onOpenSettings,
  onRefreshSchema,
  schema,
}: SchemasSidebarProps) {
  const [search, setSearch] = useState("")
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<"tables" | "queries">("tables")
  const [joinDialogOpen, setJoinDialogOpen] = useState(false)
  const [joinBaseTable, setJoinBaseTable] = useState<string>("")

  const toggleTable = (name: string) => {
    const next = new Set(expandedTables)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setExpandedTables(next)
  }

  const searchLower = search.toLowerCase()

  const tables: TableInfo[] = schema
    ? schema.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
      qualifiedName: `${t.schema}.${t.name}`,
      columns:
        schema.columns
          .filter((c) => c.table.schema === t.schema && c.table.name === t.name)
          .map((c) => {
            const fk = schema.foreignKeys.find(
              (fk) =>
                fk.from.schema === t.schema &&
                fk.from.name === t.name &&
                fk.fromColumn === c.name,
            )
            const pk = schema.primaryKeys.find(
              (pk) =>
                pk.table.schema === t.schema &&
                pk.table.name === t.name &&
                pk.columnName === c.name,
            )
            return {
              name: c.name,
              type: c.dataType,
              isFk: !!fk,
              isPk: !!pk,
              references: fk
                ? {
                  schema: fk.to.schema,
                  table: fk.to.name,
                  qualifiedTable: `${fk.to.schema}.${fk.to.name}`,
                  column: fk.toColumn,
                }
                : undefined,
            }
          }) ?? [],
    }))
    : []

  const filteredTables = tables.filter((t) => t.name.toLowerCase().includes(searchLower))
  const filteredQueries = namedQueries.filter((q) => q.name.toLowerCase().includes(searchLower))

  const activeConn = connections.find((c) => c.id === activeConnection)

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "connected":
        return "bg-emerald-400"
      case "connecting":
        return "bg-amber-400"
      default:
        return "bg-stone-300"
    }
  }

  const openJoinBuilder = (tableName: string) => {
    setJoinBaseTable(tableName)
    setJoinDialogOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top controls */}
      <div className="space-y-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "group flex h-9 w-full items-center gap-2 rounded-md border border-stone-200 bg-white/60 px-2 text-left text-sm text-stone-700 shadow-xs backdrop-blur",
                "hover:bg-white hover:text-stone-900",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300/60",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  getStatusColor(activeConn?.status),
                )}
              />
              <span className="truncate font-medium">{activeConn?.label || "No connection"}</span>
              <ChevronDown className="ml-auto h-4 w-4 text-stone-400 transition-colors group-hover:text-stone-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {connections.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <div className="text-xs text-stone-500 mb-2">No connections yet</div>
                <DropdownMenuItem
                  onClick={onOpenSettings}
                  className="text-xs justify-center bg-stone-100 hover:bg-stone-200"
                >
                  <Plus className="h-3 w-3 mr-1.5" />
                  Add connection
                </DropdownMenuItem>
              </div>
            ) : (
              <>
                {connections.map((conn) => (
                  <DropdownMenuItem
                    key={conn.id}
                    onClick={() => onConnectionChange(conn.id)}
                    className={cn(
                      "text-sm gap-2 cursor-pointer",
                      activeConnection === conn.id && "bg-stone-100",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm",
                        getStatusColor(conn.status),
                      )}
                    />
                    <span className="truncate font-medium">{conn.label}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenSettings} className="text-sm text-stone-600">
                  <Plus className="h-4 w-4 mr-2" />
                  Manage connections...
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            placeholder="Search tables & queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              "h-9 pl-9 pr-9 bg-white/60 border-stone-200 shadow-xs backdrop-blur",
              "focus-visible:ring-stone-300/60",
            )}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Separator className="my-3 bg-stone-200" />

      {/* Lists */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "tables" | "queries")} className="gap-3 pr-1">
          <TabsList className="w-full flex bg-stone-100/70 text-stone-600">
            <TabsTrigger value="tables" className="text-xs flex-1 min-w-0">
              <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">Tables</span>
              <Badge
                variant="secondary"
                className="ml-1 h-4 px-1.5 text-[10px] tabular-nums text-stone-600 bg-white border-stone-200 flex-shrink-0"
              >
                {filteredTables.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="queries" className="text-xs flex-1 min-w-0">
              <Bookmark className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">Saved</span>
              <Badge
                variant="secondary"
                className="ml-1 h-4 px-1.5 text-[10px] tabular-nums text-stone-600 bg-white border-stone-200 flex-shrink-0"
              >
                {filteredQueries.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tables" className="m-0 outline-none">
            {/* Tables header row with refresh (animated like DataGrid hide icon) */}
            <div className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="uppercase tracking-wide">Tables</span>
              </div>

              <div className="flex items-center gap-1">
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-[11px] tabular-nums text-stone-600 bg-stone-100 border-stone-200"
                >
                  {filteredTables.length}
                </Badge>

                {onRefreshSchema && (
                  <div className="w-0 overflow-hidden opacity-0 group-hover:w-5 group-hover:opacity-100 transition-all duration-300 ease-in-out flex-shrink-0">
                    <button
                      onClick={() => onRefreshSchema()}
                      className="p-0.5 hover:bg-stone-200 rounded text-stone-400 hover:text-stone-600 transition-colors outline-none"
                      title="Refresh schema"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-1 space-y-1">
              {filteredTables.map((table) => (
                <div key={table.qualifiedName}>
                  <div className="group/row flex items-center gap-1">
                    <button
                      onClick={() => toggleTable(table.name)}
                      aria-expanded={expandedTables.has(table.name)}
                      className={cn(
                        "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-stone-700",
                        "hover:bg-stone-100 hover:text-stone-900",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300/60",
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 text-stone-400 transition-transform flex-shrink-0",
                          expandedTables.has(table.name) && "rotate-90",
                        )}
                      />
                      <span className="truncate">{table.name}</span>
                    </button>

                    {/* Actions: animate in like DataGrid hide button */}
                    <div className="flex items-center">
                      <div className="w-0 overflow-hidden opacity-0 group-hover/row:w-8 group-hover/row:opacity-100 transition-all duration-300 ease-in-out flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onViewTable(table.name)
                          }}
                          className="p-1 hover:bg-stone-200 rounded text-stone-400 hover:text-stone-600 transition-colors outline-none"
                          title="View top 100 rows"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="w-0 overflow-hidden opacity-0 group-hover/row:w-8 group-hover/row:opacity-100 transition-all duration-300 ease-in-out flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openJoinBuilder(table.qualifiedName)
                          }}
                          className="p-1 hover:bg-stone-200 rounded text-stone-400 hover:text-stone-600 transition-colors outline-none"
                          title="Join with..."
                        >
                          <GitMerge className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {expandedTables.has(table.name) && (
                    <div className="ml-4 mt-1 border-l border-stone-200 pl-3">
                      <div className="space-y-0.5 pb-1">
                        {table.columns.map((col) => (
                          <div
                            key={col.name}
                            className={cn(
                              "rounded-md px-2 py-1 text-xs text-stone-700",
                              "hover:bg-stone-100/70",
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={cn(
                                  "truncate",
                                  col.isPk && "text-amber-700 font-medium",
                                  col.isFk && "text-blue-700 font-medium",
                                )}
                              >
                                {col.name}
                              </span>
                              {col.isPk && (
                                <Badge className="h-4 rounded-sm px-1 text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                                  PK
                                </Badge>
                              )}
                              {col.isFk && (
                                <Badge className="h-4 rounded-sm px-1 text-[10px] bg-blue-100 text-blue-800 border-blue-200">
                                  FK
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-stone-400">
                              {col.type}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {filteredTables.length === 0 && search && (
                <div className="px-2 py-3 text-sm text-stone-400 text-center">No tables found</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="queries" className="m-0 outline-none">
            <div className="space-y-0.5">
              {filteredQueries.map((nq) => (
                <div key={nq.id} className="group/item flex items-center">
                  <button
                    onClick={() => onOpenNamedQuery(nq.id)}
                    className={cn(
                      "flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-stone-700",
                      "hover:bg-stone-100 hover:text-stone-900",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300/60",
                    )}
                  >
                    <Bookmark className="h-4 w-4 text-stone-400 group-hover/item:text-stone-600" />
                    <span className="truncate">{nq.name}</span>
                  </button>
                  {onDeleteNamedQuery && (
                    <div className="w-0 overflow-hidden opacity-0 group-hover/item:w-8 group-hover/item:opacity-100 transition-all duration-300 ease-in-out flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteNamedQuery(nq.id)
                        }}
                        className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-600 transition-colors outline-none"
                        title="Delete saved query"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {filteredQueries.length === 0 && search && (
                <div className="px-2 py-3 text-sm text-stone-400 text-center">No queries found</div>
              )}
              {filteredQueries.length === 0 && !search && (
                <div className="px-2 py-3 text-sm text-stone-400 text-center">No saved queries yet</div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <JoinBuilderDialog
        open={joinDialogOpen}
        onOpenChange={setJoinDialogOpen}
        baseTable={joinBaseTable}
        tables={tables}
        onCreateJoin={onJoinTables}
      />
    </div>
  )
}
