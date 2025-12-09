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

  // Persistence: Save tabs on change
  useEffect(() => {
    try {
      localStorage.setItem("db-console-tabs-v1", JSON.stringify(tabs))
      localStorage.setItem("db-console-active-tab-v1", activeTab)
    } catch (e) {
      console.error("Failed to save tabs", e)
    }
  }, [tabs, activeTab])

  const [connections, setConnections] = useState<ConnectionWithStatus[]>([])
  const [activeConnection, setActiveConnection] = useState<string | null>(null)
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)

  const [namedQueries, setNamedQueries] = useState<NamedQuery[]>([])
  const [showSaveNamedDialog, setShowSaveNamedDialog] = useState(false)

  const [resultsByTab, setResultsByTab] = useState<{
    [tabId: string]: { columns: string[]; rows: Record<string, unknown>[]; durationMs: number } | undefined
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
    setTabs([...tabs, { id: newId, name: `Query ${tabs.length + 1}`, query: "" }])
    setActiveTab(newId)
  }

  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const newTabs = tabs.filter((t) => t.id !== id)
    setTabs(newTabs)
    if (activeTab === id) {
      setActiveTab(newTabs[0].id)
    }
  }

  const updateQuery = (id: string, query: string) => {
    setTabs(tabs.map((t) => (t.id === id ? { ...t, query } : t)))
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
    setTabs([...tabs, { id: newId, name: nq.name, query: nq.query, isNamedQuery: true, namedQueryId: nq.id }])
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
    const newTab = { id: newId, name: `${baseTable} ⋈ ${joins.length > 1 ? `(${joins.length})` : joinNames}`, query: joinQuery }
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
    const newTab = { id: newId, name: `${tableName} (Top 100)`, query, pagination: { limit: 100, offset: 0 } }
    setTabs([...tabs, newTab])
    setActiveTab(newId)

    if (activeConnection) {
      // Explicitly pass offset 0 and limit 100
      executeRawQuery(query, newId, activeConnection, 0, 100)
    }
  }



  const handleConnectionChange = (id: string) => {
    // Set previous active to disconnected, new one to connected
    setConnections((prev) =>
      prev.map((c) => ({
        ...c,
        status: c.id === id ? "connected" : "disconnected",
      })),
    )
    setActiveConnection(id)
    void loadSchema(id)
  }

  const currentTab = tabs.find((t) => t.id === activeTab)
  const currentNamedQuery = currentTab?.namedQueryId
    ? namedQueries.find((nq) => nq.id === currentTab.namedQueryId)
    : null

  const currentResult = currentTab ? resultsByTab[currentTab.id] : undefined

  // loadSchema defined above with useCallback

  async function executeRawQuery(sqlArg?: string, tabIdArg?: string, connectionIdArg?: string, newOffset: number = 0, newLimit?: number) {
    const targetTabId = tabIdArg || activeTab
    const targetConnectionId = connectionIdArg || activeConnection

    if (!targetConnectionId) return

    // Find tab to get current pagination state
    const tab = tabs.find(t => t.id === targetTabId)
    // Use provided limit/offset or fallback to current tab state or defaults
    const limit = newLimit ?? tab?.pagination?.limit ?? 100
    const offset = newOffset

    // Resolve SQL: Argument -> Current Tab -> Empty
    let sql = sqlArg
    if (!sql) {
      sql = tab?.query || ""
    }

    if (!sql.trim()) return

    // Strict Read-Only Check
    if (!isReadOnlySql(sql)) {
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
      const cleanSql = sql.trim().replace(/;+$/, "")

      // 1. If this is a new query (offset 0) or explicit run, fetch TOTAL COUNT first
      // We only fetch count if we don't have it or if we are resetting to page 1
      let totalRows = tab?.pagination?.total
      const shouldFetchCount = offset === 0 || totalRows === undefined

      if (shouldFetchCount) {
        // Basic regex check to see if it's a SELECT query (simple heuristic)
        if (/^\s*SELECT/i.test(cleanSql)) {
          const countQuery = `SELECT COUNT(*) as count FROM (${cleanSql}) as q`
          const countRes = await fetch("/api/query/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "raw", sql: countQuery, connectionId: targetConnectionId }),
          })

          if (countRes.ok) {
            const countData = await countRes.json()
            if (countData.rows && countData.rows.length > 0) {
              totalRows = Number(countData.rows[0].count)
            }
          }
        }
      }

      // 2. Run paginated query
      // Wrap query with LIMIT/OFFSET
      const paginatedQuery = `SELECT * FROM (${cleanSql}) as q LIMIT ${limit} OFFSET ${offset}`

      const res = await fetch("/api/query/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "raw", sql: paginatedQuery, connectionId: targetConnectionId }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Query failed")
      }
      const data = (await res.json()) as { columns: string[]; rows: Record<string, unknown>[]; durationMs: number }

      setResultsByTab((prev) => ({ ...prev, [targetTabId]: data }))

      // Update tab pagination state
      setTabs(prev => prev.map(t => {
        if (t.id === targetTabId) {
          return {
            ...t,
            pagination: {
              limit,
              offset,
              total: totalRows
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



  async function executeNamedQuery(query: NamedQuery, params: Record<string, string>) {
    if (!activeConnection) return

    // Client-side parameter substitution
    let sql = query.query

    // 1. First Pass: Handle "Optional" parameters (handled in UI, but good to have backup or if passed from elsewhere)
    // Actually UI handles the "1=1" substitution for empty params. We assume 'query.query' might already have that if passed from UI?
    // Wait, the UI passed a modified NamedQuery object. Yes.

    // 2. Second Pass: Substitute values
    // We need to be careful about SQL injection here since we are doing client-side substitution
    // But this is a dev tool, and these are parameters.
    // We will just do simple string replacement for now, wrapping strings in single quotes.

    Object.entries(params).forEach(([key, value]) => {
      // Determine type from query definition if possible, but params are string from UI.
      // We'll treat everything as string for substitution unless it looks numeric?
      // Safer to look at the NamedQuery definition.
      const paramDef = query.parameters.find(p => p.name === key)
      const isNumber = paramDef?.type === "number"

      const replacement = isNumber ? value : `'${value.replace(/'/g, "''")}'`

      // Use regex to replace all occurrences of :key with value
      // We use word boundaries to avoid replacing :id in :id_val
      sql = sql.replace(new RegExp(`:${key}\\b`, "g"), replacement)
    })

    // 3. Delegate to executeRawQuery for pagination/limit handling
    // We treat this as a raw query now.
    // We need to update the Current Tab to reflect this SQL so pagination works on subsequent requests (Next Page)
    // But wait, executeRawQuery uses 'tab.query' or 'sqlArg'.
    // If we pass 'sqlArg', it uses that.
    // If user clicks "Next Page", executeRawQuery is called with undefined sqlArg.
    // It looks up tab.query.
    // So we MUST update the tab's query with the substituted SQL!

    if (currentTab) {
      // Update the tab with the RESOLVED SQL so that pagination works
      // But we might want to keep the original template?
      // If we overwrite tab.query, the NamedQueryEditor will show the resolved SQL?
      // NamedQueryEditor shows 'namedQuery.query' (from props) not 'tab.query'.
      // So updateTab(currentTab.id, { query: sql }) is safe for the "run" context, 
      // BUT the UI might get confused if it switches back to Raw view?
      // Actually, Named Query tabs are special.
      // Let's see how they are rendered. 
      // Logic: if (currentTab?.isNamedQuery) -> Render NamedQueryEditor.
      // So modifying 'tab.query' (which is state) is fine, it won't affect the definition in Sidebar.
      // AND it allows executeRawQuery to work for pagination.

      const updatedTabs = tabs.map(t => {
        if (t.id === currentTab.id) {
          return {
            ...t,
            query: sql,
            pagination: {
              limit: t.pagination?.limit || 100,
              offset: 0,
              total: t.pagination?.total
            }
          }
        }
        return t
      })
      setTabs(updatedTabs)
    }

    // Call executeRawQuery with the resolved SQL and reset pagination
    await executeRawQuery(sql, currentTab?.id, activeConnection, 0)
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
                        pagination={currentTab.pagination}
                        onPageChange={(newOffset) => executeRawQuery(undefined, currentTab.id, undefined, newOffset)}
                        onLimitChange={(newLimit) => executeRawQuery(undefined, currentTab.id, undefined, 0, newLimit)}
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
