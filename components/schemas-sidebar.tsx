"use client"

import { useState } from "react"
import { ChevronRight, Table2, Search, Bookmark, GitMerge, X, Plus, ChevronDown, Eye, RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
  const [tablesExpanded, setTablesExpanded] = useState(false)
  const [queriesExpanded, setQueriesExpanded] = useState(false)
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
    <div className="flex flex-col h-full gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-stone-600 hover:text-stone-900 transition-colors rounded hover:bg-stone-100 group">
            <span className={cn(
              "h-2 w-2 rounded-full flex-shrink-0",
              getStatusColor(activeConn?.status)
            )} />
            <span className="truncate font-medium">{activeConn?.label || "No connection"}</span>
            <ChevronDown className="h-3 w-3 text-stone-300 ml-auto transition-transform group-hover:text-stone-500" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {connections.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <div className="text-xs text-stone-500 mb-2">No connections yet</div>
              <DropdownMenuItem onClick={onOpenSettings} className="text-xs justify-center bg-stone-100 hover:bg-stone-200">
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
                    "text-xs gap-2 cursor-pointer",
                    activeConnection === conn.id && "bg-stone-100"
                  )}
                >
                  <span className={cn(
                    "h-2 w-2 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm",
                    getStatusColor(conn.status)
                  )} />
                  <span className="truncate font-medium">{conn.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenSettings} className="text-xs text-stone-500">
                <Plus className="h-3 w-3 mr-2" />
                Manage connections...
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
        <Input
          placeholder="Search tables & queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 pr-8 text-sm bg-white border-stone-200"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto space-y-3">
        {/* Tables section - collapsible */}
        <div>
          <div className="flex items-center gap-1 px-1 py-1.5 rounded hover:bg-stone-100">
            <button
              onClick={() => setTablesExpanded(!tablesExpanded)}
              className="flex flex-1 items-center gap-2 text-left focus:outline-none focus:ring-0"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-stone-400 transition-transform",
                  tablesExpanded && "rotate-90",
                )}
              />
              <Table2 className="h-3.5 w-3.5 text-stone-500" />
              <span className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Tables</span>
              <span className="text-xs text-stone-400 ml-auto">{filteredTables.length}</span>
            </button>
            {onRefreshSchema && (
              <button
                title="Refresh schema"
                className="h-7 w-7 flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-white rounded border border-transparent hover:border-stone-200"
                onClick={() => onRefreshSchema()}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {tablesExpanded && (
            <div className="mt-1 space-y-0.5">
              {filteredTables.map((table) => (
                <div key={table.name}>
                  <div className="flex items-center group/row">
                    <button
                      onClick={() => toggleTable(table.name)}
                      className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 transition-colors focus:outline-none focus:ring-0"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 text-stone-400 transition-transform flex-shrink-0",
                          expandedTables.has(table.name) && "rotate-90",
                        )}
                      />
                      <span className="truncate">{table.name}</span>
                    </button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 invisible group-hover/row:visible text-stone-400 hover:text-blue-600 hover:bg-blue-50 focus:ring-0 focus-visible:ring-0 focus:outline-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        onViewTable(table.name)
                      }}
                      title="View top 100 rows"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 invisible group-hover/row:visible text-stone-400 hover:text-blue-600 hover:bg-blue-50 focus:ring-0 focus-visible:ring-0 focus:outline-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        openJoinBuilder(table.qualifiedName)
                      }}
                      title="Join with..."
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {expandedTables.has(table.name) && (
                    <div className="ml-6 border-l border-stone-200 pl-2 py-0.5">
                      {table.columns.map((col) => (
                        <div
                          key={col.name}
                          className="flex flex-col px-1.5 py-0.5 text-xs text-stone-600 hover:bg-stone-50 rounded"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn(
                              "truncate",
                              col.isPk && "text-amber-600 font-medium",
                              col.isFk && "text-blue-600 font-medium"
                            )}>
                              {col.name}
                            </span>
                            {col.isPk && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded flex-shrink-0 font-medium">PK</span>}
                            {col.isFk && <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded flex-shrink-0 font-medium">FK</span>}
                          </div>
                          <span className="text-stone-400 font-mono text-[10px] truncate">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredTables.length === 0 && search && (
                <div className="px-2 py-3 text-sm text-stone-400 text-center">No tables found</div>
              )}
            </div>
          )}
        </div>

        {/* Saved Queries section - collapsible */}
        {(filteredQueries.length > 0 || !search) && (
          <div>
            <button
              onClick={() => setQueriesExpanded(!queriesExpanded)}
              className="w-full flex items-center gap-2 px-1 py-1.5 hover:bg-stone-100 rounded transition-colors"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-stone-400 transition-transform",
                  queriesExpanded && "rotate-90",
                )}
              />
              <Bookmark className="h-3.5 w-3.5 text-stone-500" />
              <span className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Saved Queries</span>
              <span className="text-xs text-stone-400 ml-auto">{filteredQueries.length}</span>
            </button>

            {queriesExpanded && (
              <div className="mt-1 space-y-0.5">
                {filteredQueries.map((nq) => (
                  <div key={nq.id} className="flex items-center group">
                    <button
                      onClick={() => onOpenNamedQuery(nq.id)}
                      className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 rounded-md hover:bg-stone-100 transition-colors text-left"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      <span className="truncate">{nq.name}</span>
                    </button>
                    {onDeleteNamedQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-red-500 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteNamedQuery(nq.id)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
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
            )}
          </div>
        )}
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
