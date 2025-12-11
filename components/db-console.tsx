"use client"

import { useCallback, useEffect, useState } from "react"
import { SchemasSidebar } from "./schemas-sidebar"
import { QueryTabs, type Tab } from "./query-tabs"
import { QueryEditor } from "./query-editor"
import { NamedQueryEditor, type NamedQuery } from "./named-query-editor"
import { SaveNamedQueryDialog } from "./save-named-query-dialog"
import { DataGrid } from "./data-grid"
import { ConnectionDialog } from "./connection-dialog"
import { Button } from "@/components/ui/button"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Settings, PanelLeftClose, PanelLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { ClientConnectionMeta } from "@/lib/connections"
import type { SchemaGraph } from "@/lib/schema-introspection"
import { isReadOnlySql } from "@/lib/sql/safety"

type PoolMode = "single" | "shared" | "per-scope"

const cleanPositionalPlaceholders = (sql: string): string =>
  sql.replace(/(['"])\$(\d+)\1/g, (_m, _quote, num) => `$${num}`)

const deriveParamLabels = (sql: string, maxIndex: number): string[] => {
  const labels: string[] = Array.from({ length: maxIndex }, () => "")
  const regex = /([\w."`.]+)\s*(?:=|<>|!=|<|>|<=|>=|LIKE|ILIKE|IN)\s*\$(\d+)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(sql))) {
    const column = match[1]?.replace(/["`]/g, "")
    const idx = Number(match[2]) - 1
    if (idx >= 0 && idx < maxIndex && column) {
      labels[idx] = column
    }
  }
  return labels
}

const toSqlLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL"
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}

const renderSqlWithParams = (sql: string, params: unknown[]): string =>
  sql.replace(/\$(\d+)/g, (_m, idx) => {
    const i = Number(idx) - 1
    return toSqlLiteral(params[i] ?? null)
  })

interface JoinConfig {
  table: string
  leftTable?: string
  leftColumn: string
  rightColumn: string
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL"
}

interface ConnectionWithStatus extends ClientConnectionMeta {
  status: "connected" | "connecting" | "disconnected"
}

export function DbConsole() {
  const { toast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [activeTab, setActiveTab] = useState("query-1")
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "query-1", name: "Query 1", query: "", pagination: { limit: 100, offset: 0 } }
  ])
  const [poolMode, setPoolMode] = useState<PoolMode>(() => {
    if (typeof window === "undefined") return "shared"
    const stored = localStorage.getItem("db-console-pool-mode") as PoolMode | null
    return stored ?? "shared"
  })

  // Persistence: Restore tabs on mount
  useEffect(() => {
    try {
      const savedTabs = localStorage.getItem("db-console-tabs-v1")
      const savedActive = localStorage.getItem("db-console-active-tab-v1")
      if (savedTabs) {
        setTabs(JSON.parse(savedTabs))
      }
      if (savedActive) {
        setActiveTab(savedActive)
      }
    } catch (e) {
      console.error("Failed to restore tabs", e)
    }
  }, [])

  // Persistence: Save tabs and pool mode on change
  useEffect(() => {
    try {
      localStorage.setItem("db-console-tabs-v1", JSON.stringify(tabs))
      localStorage.setItem("db-console-active-tab-v1", activeTab)
      localStorage.setItem("db-console-pool-mode", poolMode)
    } catch (e) {
      console.error("Failed to save tabs", e)
    }
  }, [tabs, activeTab, poolMode])

  const [connections, setConnections] = useState<ConnectionWithStatus[]>([])
  const [activeConnection, setActiveConnection] = useState<string | null>(null)
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)

  const [namedQueries, setNamedQueries] = useState<NamedQuery[]>([])
  const [showSaveNamedDialog, setShowSaveNamedDialog] = useState(false)

  const [resultsByTab, setResultsByTab] = useState<{
    [tabId: string]: { columns: string[]; rows: Record<string, unknown>[]; durationMs: number; sqlDisplay?: string } | undefined
  }>({})
  const [schema, setSchema] = useState<SchemaGraph | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSchema = useCallback(async (connectionId: string) => {
    try {
      const res = await fetch(`/api/schema?connectionId=${encodeURIComponent(connectionId)}`)
      if (!res.ok) return
      const graph = (await res.json()) as SchemaGraph
      setSchema(graph)
    } catch (e: any) {
      console.error("Failed to load schema", e)
      toast({
        variant: "destructive",
        title: "Failed to load schema",
        description: e?.message || "Could not load database schema.",
      })
    }
  }, [toast])

  // Load initial connections & named queries on mount
  useEffect(() => {
    const controller = new AbortController()

    async function loadInitial() {
      try {
        const [connsRes, nqRes] = await Promise.all([
          fetch("/api/connections", { signal: controller.signal }),
          fetch("/api/named-queries", { signal: controller.signal }),
        ])

        if (connsRes.ok) {
          const conns = (await connsRes.json()) as ClientConnectionMeta[]
          const withStatus: ConnectionWithStatus[] = conns.map((c, index) => ({
            ...c,
            status: index === 0 ? "connected" : "disconnected",
          }))
          setConnections(withStatus)
          if (withStatus.length > 0) {
            setActiveConnection(withStatus[0].id)
            void loadSchema(withStatus[0].id)
          }
        }

        if (nqRes.ok) {
          const raw = (await nqRes.json()) as Array<{
            id: string
            name: string
            description?: string
            sqlTemplate: string
            params: { name: string; type: "string" | "number" | "boolean"; defaultValue?: string }[]
          }>

          const mapped: NamedQuery[] = raw.map((q) => ({
            id: q.id,
            name: q.name,
            description: q.description,
            query: q.sqlTemplate,
            parameters: q.params,
          }))
          setNamedQueries(mapped)
        }
      } catch (e: any) {
        console.error("Failed to load initial data", e)
        toast({
          variant: "destructive",
          title: "Failed to load initial data",
          description: e?.message || "Could not load connections and named queries.",
        })
      }
    }

    void loadInitial()

    return () => {
      controller.abort()
    }
  }, [toast])

  const addTab = () => {
    const newId = `query-${Date.now()}`
    setTabs([...tabs, { id: newId, name: `Query ${tabs.length + 1}`, query: "", connectionId: activeConnection ?? undefined }])
    setActiveTab(newId)
  }

  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const closingTab = tabs.find((t) => t.id === id)
    const newTabs = tabs.filter((t) => t.id !== id)
    setTabs(newTabs)
    // If we are using per-tab pools, release the tab-specific pool on close.
    if (poolMode === "per-scope" && closingTab?.connectionId) {
      void fetch("/api/connections/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: closingTab.connectionId,
          poolMode,
          scopeKey: id,
        }),
      }).catch(() => {})
    }
    if (activeTab === id) {
      setActiveTab(newTabs[0].id)
    }
  }

  const updateQuery = (id: string, query: string) => {
    setTabs(tabs.map((t) => {
      if (t.id !== id) return t
      // auto-grow params array to match highest $n placeholder found
      const match = [...query.matchAll(/\$([1-9]\d*)/g)]
      const maxIndex = match.length > 0 ? Math.max(...match.map(m => Number(m[1]) || 0)) : 0
      const existingParams = t.params ?? []
      let params = existingParams
      if (maxIndex > existingParams.length) {
        const extra = Array.from({ length: maxIndex - existingParams.length }, () => ({ type: "string" as const, value: "" }))
        params = [...existingParams, ...extra]
      } else if (maxIndex < existingParams.length) {
        params = existingParams.slice(0, maxIndex)
      }
      return { ...t, query, params }
    }))
  }

  const updateParams = (id: string, params: Tab["params"]) => {
    setTabs(tabs.map((t) => (t.id === id ? { ...t, params } : t)))
  }

  const handleSaveAsNamed = async (namedQuery: Omit<NamedQuery, "id">) => {
    try {
      const res = await fetch("/api/named-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: namedQuery.name,
          description: namedQuery.description,
          sqlTemplate: namedQuery.query,
          params: namedQuery.parameters,
          defaultConnectionId: activeConnection ?? undefined,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Failed to save named query")
      }

      const saved = (await res.json()) as {
        id: string
        name: string
        description?: string
        sqlTemplate: string
        params: { name: string; type: "string" | "number" | "boolean"; defaultValue?: string }[]
      }

      const newNamedQuery: NamedQuery = {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        query: saved.sqlTemplate,
        parameters: saved.params,
      }

      setNamedQueries((prev) => [...prev, newNamedQuery])

      setTabs((prevTabs) =>
        prevTabs.map((t) =>
          t.id === activeTab
            ? { ...t, name: namedQuery.name, isNamedQuery: true, namedQueryId: newNamedQuery.id }
            : t,
        ),
      )
    } catch (e) {
      console.error("Failed to save named query", e)
    }
  }

  const openNamedQueryTab = (nqId: string) => {
    const nq = namedQueries.find((q) => q.id === nqId)
    if (!nq) return

    const existing = tabs.find((t) => t.namedQueryId === nq.id)
    if (existing) {
      setActiveTab(existing.id)
      return
    }

    const newId = `nq-tab-${Date.now()}`
    setTabs([...tabs, { id: newId, name: nq.name, query: nq.query, isNamedQuery: true, namedQueryId: nq.id, connectionId: activeConnection ?? undefined }])
    setActiveTab(newId)
  }

  const handleJoinTables = async (baseTable: string, joins: JoinConfig[]) => {
    const joinClauses = joins
      .map(
        (j) =>
          `${j.joinType} JOIN ${j.table} ON ${j.leftTable || baseTable}.${j.leftColumn} = ${j.table}.${j.rightColumn}`,
      )
      .join("\n")

    const joinQuery = `SELECT *
FROM ${baseTable}
${joinClauses}`

    const joinNames = joins.map((j) => j.table).join(", ")
    const newId = `query-${Date.now()}`
    const newTab = { id: newId, name: `${baseTable} ⋈ ${joins.length > 1 ? `(${joins.length})` : joinNames}`, query: joinQuery, connectionId: activeConnection ?? undefined }
    setTabs([...tabs, newTab])
    setActiveTab(newId)

    // Auto-execute the join query
    if (activeConnection) {
      executeRawQuery(joinQuery, newId, activeConnection)
    }
  }

  const handleViewTable = (tableName: string) => {
    // Find primary key
    let orderByClause = ""
    if (schema?.primaryKeys) {
      const pk = schema.primaryKeys.find(pk => pk.table.name === tableName)
      if (pk) {
        orderByClause = `\nORDER BY ${pk.columnName} DESC`
      }
    }

    const query = `SELECT * FROM ${tableName}${orderByClause}`
    const newId = `view-${Date.now()}`
    const newTab = { id: newId, name: `${tableName} (Top 100)`, query, pagination: { limit: 100, offset: 0 }, connectionId: activeConnection ?? undefined }
    setTabs([...tabs, newTab])
    setActiveTab(newId)

    if (activeConnection) {
      // Explicitly pass offset 0 and limit 100
      executeRawQuery(query, newId, activeConnection, 0, 100)
    }
  }



  const handleConnectionChange = (id: string) => {
    const previous = activeConnection
    // Set previous active to disconnected, new one to connected
    setConnections((prev) =>
      prev.map((c) => ({
        ...c,
        status: c.id === id ? "connected" : "disconnected",
      })),
    )
    setActiveConnection(id)
    // Release pools tied to the previous connection to avoid leaks when switching targets.
    if (previous && previous !== id) {
      void fetch("/api/connections/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: previous }),
      }).catch(() => {})
    }
    void loadSchema(id)
  }

  const currentTab = tabs.find((t) => t.id === activeTab)
  const currentNamedQuery = currentTab?.namedQueryId
    ? namedQueries.find((nq) => nq.id === currentTab.namedQueryId)
    : null

  const currentResult = currentTab ? resultsByTab[currentTab.id] : undefined
  const currentParamLabels = currentTab?.query && currentTab.params ? deriveParamLabels(currentTab.query, currentTab.params.length) : []

  // loadSchema defined above with useCallback

  async function executeRawQuery(sqlArg?: string, tabIdArg?: string, connectionIdArg?: string, newOffset: number = 0, newLimit?: number) {
    const targetTabId = tabIdArg || activeTab
    const targetTab = tabs.find(t => t.id === targetTabId)
    const targetConnectionId = connectionIdArg || targetTab?.connectionId || activeConnection

    if (!targetConnectionId) return

    // Use provided limit/offset or fallback to current tab state or defaults
    const limit = newLimit ?? targetTab?.pagination?.limit ?? 100
    const offset = newOffset
    const paramValues = (targetTab?.params ?? []).map((p) => {
      if (p.type === "number") return Number(p.value)
      if (p.type === "boolean") return p.value === "true"
      return p.value
    })

    // Resolve SQL: Argument -> Current Tab -> Empty
    let sql = sqlArg
    if (!sql) {
      sql = targetTab?.query || ""
    }
    // Support users who wrap $n in quotes; strip the quotes for execution while keeping param order.
    const sqlToRun = cleanPositionalPlaceholders(sql)

    if (!sqlToRun.trim()) return

    // Strict Read-Only Check
    if (!isReadOnlySql(sqlToRun)) {
      toast({
        variant: "destructive",
        title: "Query Rejected",
        description: "Only read-only queries (SELECT, WITH) are allowed prevention initiated by client console."
      })
      return
    }

    setIsRunning(true)
    setError(null)

    try {
      // Clean SQL for wrapping (remove trailing semicolon)
      const cleanSql = sqlToRun.trim().replace(/;+$/, "")

      const shouldIncludeCount = offset === 0 || targetTab?.pagination?.total === undefined

      const res = await fetch("/api/query/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "raw",
          sql: cleanSql,
          originalSql: cleanSql,
          connectionId: targetConnectionId,
          poolMode,
          scopeKey: poolMode === "per-scope" ? targetTabId : undefined,
          params: paramValues,
          limit,
          offset,
          includeCount: shouldIncludeCount,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Query failed")
      }
      const data = (await res.json()) as { columns: string[]; rows: Record<string, unknown>[]; durationMs: number; totalCount?: number }

      const sqlDisplay = renderSqlWithParams(cleanSql, paramValues)
      setResultsByTab((prev) => ({ ...prev, [targetTabId]: { ...data, sqlDisplay } }))

      // Update tab pagination state
      setTabs(prev => prev.map(t => {
        if (t.id === targetTabId) {
          return {
            ...t,
            connectionId: targetConnectionId,
            pagination: {
              limit,
              offset,
              total: data.totalCount ?? t.pagination?.total ?? data.rows?.length
            }
          }
        }
        return t
      }))

    } catch (e: any) {
      console.error("Failed to run query", e)
      setError(e?.message || "Failed to run query")
      toast({
        variant: "destructive",
        title: "Query failed",
        description: e?.message || "Failed to run query",
      })
    } finally {
      setIsRunning(false)
    }
  }



  async function executeNamedQuery(query: NamedQuery, params: Record<string, string>, newOffset: number = 0, newLimit?: number) {
    if (!activeConnection) return
    const targetTab = currentTab
    const limit = newLimit ?? targetTab?.pagination?.limit ?? 100
    const offset = newOffset
    setIsRunning(true)
    setError(null)

    try {
      const shouldIncludeCount = offset === 0 || targetTab?.pagination?.total === undefined

      const res = await fetch("/api/query/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "named",
          queryId: query.id,
          params,
          connectionId: activeConnection,
          poolMode,
          scopeKey: poolMode === "per-scope" ? currentTab?.id : undefined,
          limit,
          offset,
          originalSql: query.query,
          includeCount: shouldIncludeCount,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Query failed")
      }

      const data = (await res.json()) as { columns: string[]; rows: Record<string, unknown>[]; durationMs: number; totalCount?: number }

      if (currentTab) {
        // For display, substitute :param occurrences with literals in the template
        const sqlDisplay = Object.entries(params).reduce((acc, [key, value]) => {
          const literal = toSqlLiteral(value)
          return acc.replace(new RegExp(`:${key}\\b`, "g"), literal)
        }, query.query)
        setResultsByTab((prev) => ({ ...prev, [currentTab.id]: { ...data, sqlDisplay } }))
        setTabs(prev => prev.map(t => {
          if (t.id === currentTab.id) {
            return {
              ...t,
              connectionId: activeConnection,
              namedParams: params,
              pagination: {
                limit,
                offset,
                total: data.totalCount ?? t.pagination?.total ?? data.rows?.length
              }
            }
          }
          return t
        }))
      }
    } catch (e: any) {
      console.error("Failed to run named query", e)
      setError(e?.message || "Failed to run named query")
      toast({
        variant: "destructive",
        title: "Query failed",
        description: e?.message || "Failed to run query",
      })
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <>
      <div className="h-full w-full rounded-xl border border-stone-300 bg-stone-50 shadow-sm flex flex-col overflow-hidden">
        {/* Header with tabs and settings */}
        <div className="flex items-center justify-between border-b border-stone-200 bg-stone-100/50 px-2 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-stone-500 hover:text-stone-700"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <QueryTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onTabClose={closeTab}
              onAddTab={addTab}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-stone-500 hover:text-stone-700"
            onClick={() => setShowConnectionDialog(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            {/* Collapsible sidebar */}
            {sidebarOpen && (
              <>
                <ResizablePanel defaultSize={15} minSize={15} maxSize={40} className="border-r border-stone-200 bg-stone-50">
                  <div className="h-full flex flex-col">
                    <div className="flex-1 p-3 overflow-hidden">
                      <SchemasSidebar
                        connections={connections}
                        activeConnection={activeConnection}
                        onConnectionChange={handleConnectionChange}
                        namedQueries={namedQueries.map((nq) => ({ id: nq.id, name: nq.name }))}
                        onOpenNamedQuery={openNamedQueryTab}
                        onDeleteNamedQuery={async (id) => {
                          try {
                            const res = await fetch(`/api/named-queries?id=${encodeURIComponent(id)}`, {
                              method: "DELETE",
                            })
                            if (!res.ok) {
                              const body = (await res.json().catch(() => ({}))) as { error?: string }
                              throw new Error(body.error || "Failed to delete query")
                            }
                            setNamedQueries((prev) => prev.filter((nq) => nq.id !== id))
                            // Close any open tabs for this query
                            setTabs((prev) => prev.filter((t) => t.namedQueryId !== id))
                            toast({ title: "Query deleted" })
                          } catch (e: any) {
                            toast({
                              variant: "destructive",
                              title: "Failed to delete query",
                              description: e?.message,
                            })
                          }
                        }}
                        onJoinTables={handleJoinTables}
                        onViewTable={handleViewTable}
                        onOpenSettings={() => setShowConnectionDialog(true)}
                        schema={schema}
                      />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}

            {/* Query and results area */}
            <ResizablePanel defaultSize={80}>
              <div className="h-full flex flex-col p-3 gap-3 overflow-hidden">
                {/* Query editor section */}
                <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
                  {currentTab?.isNamedQuery && currentNamedQuery ? (
                    <NamedQueryEditor namedQuery={currentNamedQuery} onExecute={executeNamedQuery} />
                  ) : (
                  <QueryEditor
                    query={currentTab?.query || ""}
                    onChange={(q) => currentTab && updateQuery(currentTab.id, q)}
                    onRun={() => executeRawQuery(undefined, undefined, undefined, 0)}
                    onSaveAsNamed={() => setShowSaveNamedDialog(true)}
                    schema={schema}
                    params={currentTab?.params}
                    paramLabels={currentParamLabels}
                    onParamsChange={(p) => currentTab && updateParams(currentTab.id, p)}
                  />
                )}
                </div>

                {/* Data grid section */}
                <div className="flex-1 rounded-lg border border-stone-200 bg-white shadow-sm overflow-hidden">
            {currentResult ? (
              currentTab && (
                <DataGrid
                  columns={currentResult?.columns || []}
                  data={currentResult?.rows || []}
                  loading={isRunning}
                  error={error}
                  executedSql={currentResult?.sqlDisplay}
                  pagination={currentTab.pagination}
                  onPageChange={(newOffset) => {
                    if (currentTab.isNamedQuery && currentNamedQuery) {
                      executeNamedQuery(currentNamedQuery, currentTab.namedParams ?? {}, newOffset)
                    } else {
                      executeRawQuery(undefined, currentTab.id, currentTab.connectionId ?? activeConnection ?? undefined, newOffset)
                    }
                  }}
                  onLimitChange={(newLimit) => {
                    if (currentTab.isNamedQuery && currentNamedQuery) {
                      executeNamedQuery(currentNamedQuery, currentTab.namedParams ?? {}, 0, newLimit)
                    } else {
                      executeRawQuery(undefined, currentTab.id, currentTab.connectionId ?? activeConnection ?? undefined, 0, newLimit)
                    }
                  }}
                />
              )
            ) : (
                    <div className="flex h-full items-center justify-center text-stone-400 text-sm">
                      {isRunning ? "Running query..." : "Run a query to see results"}
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <ConnectionDialog
        open={showConnectionDialog}
        onOpenChange={setShowConnectionDialog}
        connections={connections}
        activeConnection={activeConnection}
        poolMode={poolMode}
        onConnectionsChange={(updated) => {
          setConnections((prev) => {
            const statusById = new Map(prev.map((c) => [c.id, c.status]))
            return updated.map((c) => ({
              ...c,
              status: statusById.get(c.id) ?? "disconnected",
            }))
          })
        }}
        onConnect={(id) => {
          handleConnectionChange(id)
        }}
        onPoolModeChange={(mode) => setPoolMode(mode)}
      />

      <SaveNamedQueryDialog
        open={showSaveNamedDialog}
        onOpenChange={setShowSaveNamedDialog}
        query={currentTab?.query || ""}
        onSave={handleSaveAsNamed}
      />
    </>
  )
}
