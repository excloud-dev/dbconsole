"use client"

import { useCallback, useEffect, useMemo, useState, useRef } from "react"
import { SchemasSidebar } from "./schemas-sidebar"
import { QueryTabs, type Tab } from "./query-tabs"
import { QueryEditor } from "./query-editor"
import { NamedQueryEditor, type NamedQuery } from "./named-query-editor"
import { SaveNamedQueryDialog } from "./save-named-query-dialog"
import { DataGrid } from "./data-grid"
import { ConnectionDialog } from "./connection-dialog"
import { SyncSettingsDialog } from "./sync-settings-dialog"
import { NamedQuerySyncConflictsDialog } from "./named-query-sync-conflicts-dialog"
import { ToastAction } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, type ImperativePanelHandle } from "@/components/ui/resizable"
import { Settings, PanelLeftClose, PanelLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { ClientConnectionMeta } from "@/lib/connections"
import type { SchemaGraph } from "@/lib/schema-introspection"
import { isReadOnlySql } from "@/lib/sql/safety"
import { ApiError, apiClient, type NamedQuerySyncResolution } from "@/lib/client/apiClient"
import { useCommand } from "@/components/shortcuts/useCommand"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command"
import { listCommands } from "@/lib/shortcuts/commands"
import { useShortcutsContext } from "@/components/shortcuts/ShortcutsProvider"
import { parseBinding } from "@/lib/shortcuts/parse"
import { formatBinding } from "@/lib/shortcuts/format"
import { MenuHandler } from "./menu-handler"


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

function getErrorInfo(e: any): { status?: number; body?: any; message: string } {
  if (e instanceof ApiError) return { status: e.status, body: e.body, message: e.message }

  const status = typeof e?.status === "number" ? e.status : undefined
  const body = e?.body
  const message =
    typeof e?.message === "string"
      ? e.message
      : typeof body?.error === "string"
        ? body.error
        : "Unknown error"

  return { status, body, message }
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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$")

// Quote a possibly-qualified identifier (schema.table or table) safely.
// Splits on dots and quotes each part so mixed-case/reserved names work.
const quoteIdent = (name: string) =>
  name
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".")

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
  const shortcuts = useShortcutsContext()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<"tables" | "queries">("tables")
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const topPanelRef = useRef<ImperativePanelHandle | null>(null)
  const verticalGroupRef = useRef<HTMLDivElement | null>(null)

  const [activeTab, setActiveTab] = useState("query-1")
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "query-1", name: "Query 1", query: "", pagination: { limit: 100, offset: 0 } }
  ])
  const [poolMode, setPoolMode] = useState<PoolMode>(() => {
    if (typeof window === "undefined") return "shared"
    const stored = localStorage.getItem("db-console-pool-mode") as PoolMode | null
    return stored ?? "shared"
  })

  // Global state for params expanded - applies to all named query tabs, default collapsed
  const [globalParamsExpanded, setGlobalParamsExpanded] = useState(false)

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
  const [editingNamedQuery, setEditingNamedQuery] = useState<NamedQuery | null>(null)

  const [showSyncSettingsDialog, setShowSyncSettingsDialog] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncConflicts, setSyncConflicts] = useState<any[] | null>(null)
  const [showSyncConflictsDialog, setShowSyncConflictsDialog] = useState(false)
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [resultsByTab, setResultsByTab] = useState<{
    [tabId: string]: { columns: string[]; rows: Record<string, unknown>[]; durationMs: number; sqlDisplay?: string } | undefined
  }>({})
  const [schema, setSchema] = useState<SchemaGraph | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openSqlInNewTab = useCallback(
    (sql: string, name?: string) => {
      const newId = `query-${Date.now()}`
      setTabs((prev) => [
        ...prev,
        {
          id: newId,
          name: name?.trim() || `Query ${prev.length + 1}`,
          query: sql,
          connectionId: activeConnection ?? undefined,
        },
      ])
      setActiveTab(newId)
    },
    [activeConnection],
  )

  useEffect(() => {
    const events = typeof window !== "undefined" ? window.dbconsole?.events : undefined
    if (!events?.onSqlFileOpen) return
    const unsubscribe = events.onSqlFileOpen((payload) => {
      if (!payload || !payload.sql) return
      openSqlInNewTab(payload.sql, payload.name)
    })
    return unsubscribe
  }, [openSqlInNewTab])

  const loadSchema = useCallback(async (connectionId: string) => {
    try {
      const graph = await apiClient.schema.load(connectionId)
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

  const reloadNamedQueries = useCallback(async () => {
    const raw = await apiClient.namedQueries.list()
    if (Array.isArray(raw)) {
      const mapped: NamedQuery[] = raw.map((q: any) => ({
        id: q.id,
        name: q.name,
        description: q.description,
        query: q.sqlTemplate,
        parameters: q.params,
      }))
      setNamedQueries(mapped)
    }
  }, [])

  const handleSyncNamedQueries = useCallback(async () => {
    if (syncBusy) return
    setSyncBusy(true)
    try {
      await apiClient.syncer.namedQueries.sync()
      await reloadNamedQueries()
      toast({ title: "Synced saved queries" })
    } catch (e: any) {
      const info = getErrorInfo(e)

      if (info.status === 409 || info.message === "Conflicts") {
        const conflicts = info.body?.conflicts
        if (Array.isArray(conflicts)) {
          setSyncConflicts(conflicts)
          setShowSyncConflictsDialog(true)
          toast({
            title: "Sync needs attention",
            description: "Resolve conflicts to continue.",
            action: (
              <ToastAction altText="Resolve" onClick={() => setShowSyncConflictsDialog(true)}>
                Resolve
              </ToastAction>
            ),
          })
        } else {
          toast({ variant: "destructive", title: "Sync conflict", description: info.message })
        }
      } else if (info.status === 400) {
        // Missing local settings (remote URL / phrase)
        setShowSyncSettingsDialog(true)
        toast({ variant: "destructive", title: "Sync not configured", description: info.message })
      } else {
        toast({ variant: "destructive", title: "Sync failed", description: info.message })
      }
    } finally {
      setSyncBusy(false)
    }
  }, [reloadNamedQueries, syncBusy, toast])

  const scheduleAutoSyncNamedQueries = useCallback(() => {
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current)
    autoSyncTimerRef.current = setTimeout(() => {
      void handleSyncNamedQueries()
    }, 300)
  }, [handleSyncNamedQueries])

  const applySyncResolutions = useCallback(async (resolutions: NamedQuerySyncResolution[]) => {
    if (syncBusy) return
    setSyncBusy(true)
    try {
      await apiClient.syncer.namedQueries.sync({ resolutions })
      await reloadNamedQueries()
      setShowSyncConflictsDialog(false)
      setSyncConflicts(null)
      toast({ title: "Synced saved queries" })
    } catch (e: any) {
      const info = getErrorInfo(e)
      if (info.status === 409 || info.message === "Conflicts") {
        const conflicts = info.body?.conflicts
        if (Array.isArray(conflicts)) {
          setSyncConflicts(conflicts)
          setShowSyncConflictsDialog(true)
          return
        }
      }
      toast({ variant: "destructive", title: "Sync failed", description: info.message })
    } finally {
      setSyncBusy(false)
    }
  }, [reloadNamedQueries, syncBusy, toast])

  // Load initial connections & named queries on mount
  useEffect(() => {
    const controller = new AbortController()

    async function loadInitial() {
      try {
        const [conns, raw] = await Promise.all([
          apiClient.connections.list({ signal: controller.signal }),
          apiClient.namedQueries.list({ signal: controller.signal }),
        ])

        if (Array.isArray(conns)) {
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

        if (Array.isArray(raw)) {
          const mapped: NamedQuery[] = raw.map((q: any) => ({
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
  }, [loadSchema, toast])

  const addTab = useCallback(() => {
    openSqlInNewTab("")
  }, [openSqlInNewTab])

  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const closingTab = tabs.find((t) => t.id === id)
    const newTabs = tabs.filter((t) => t.id !== id)
    setTabs(newTabs)
    // If we are using per-tab pools, release the tab-specific pool on close.
    if (poolMode === "per-scope" && closingTab?.connectionId) {
      void apiClient.connections.releasePools({
        connectionId: closingTab.connectionId,
        poolMode,
        scopeKey: id,
      }).catch(() => { })
    }
    if (activeTab === id) {
      setActiveTab(newTabs[0].id)
    }
  }

  useCommand("tabs.newQuery", () => addTab())

  useCommand("tabs.close", () => {
    if (!activeTab) return
    closeTab(activeTab)
  })

  useCommand("tabs.next", () => {
    if (!tabs.length) return
    const idx = tabs.findIndex((t) => t.id === activeTab)
    const next = tabs[(idx + 1) % tabs.length]
    if (next) setActiveTab(next.id)
  })

  useCommand("tabs.prev", () => {
    if (!tabs.length) return
    const idx = tabs.findIndex((t) => t.id === activeTab)
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
    if (prev) setActiveTab(prev.id)
  })

  useCommand("file.openSql", () => {
    const api = typeof window !== "undefined" ? window.dbconsole?.api?.sqlFile : undefined
    if (!api?.openDialog) return
    void api.openDialog().then((payload: any) => {
      if (payload && typeof payload.sql === "string") {
        openSqlInNewTab(payload.sql, payload.name)
      }
    })
  })

  useCommand("ui.toggleSchemaSidebar", () => setSidebarOpen((prev) => !prev))

  useCommand("ui.openConnections", () => setShowConnectionDialog(true))

  useCommand("ui.focusSidebarSearch", () => {
    const el = typeof document !== "undefined" ? document.getElementById("schema-sidebar-search") : null
    if (el && "focus" in el) (el as any).focus()
  })

  useCommand("ui.showSavedQueriesTab", () => {
    setSidebarOpen(true)
    setSidebarTab("queries")
  })

  useCommand("ui.commandPalette", () => setCommandPaletteOpen(true))

  useCommand("schema.refresh", () => {
    if (activeConnection) void loadSchema(activeConnection)
  })

  useCommand("sync.openSettings", () => setShowSyncSettingsDialog(true))
  useCommand("sync.namedQueriesNow", () => {
    void handleSyncNamedQueries()
  })

  useCommand("ui.focusQueryPanel", () => {
    // Named query tab: prefer focusing first param; if no params, focus Run.
    if (currentTab?.isNamedQuery && currentNamedQuery) {
      if (currentNamedQuery.parameters.length > 0) {
        const el = typeof document !== "undefined"
          ? (document.querySelector('[data-named-query-param="1"]') as HTMLInputElement | null)
          : null
        if (el) {
          el.focus()
          // Put caret at end when a value exists (consistent with SQL editor behavior)
          const len = el.value?.length ?? 0
          try {
            el.setSelectionRange(len, len)
          } catch { }
          return true
        }
      }

      const runBtn = typeof document !== "undefined"
        ? (document.querySelector('[data-named-query-run="1"]') as HTMLButtonElement | null)
        : null
      if (runBtn) {
        runBtn.focus()
        return true
      }
      return false
    }

    // Raw query tab: click the SqlEditor container so it focuses and moves caret to end.
    const editorRoot = typeof document !== "undefined" ? (document.getElementById("sql-editor-main") as HTMLElement | null) : null
    if (editorRoot) {
      editorRoot.click()
      return true
    }
    return false
  })

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
      const saved = await apiClient.namedQueries.save({
        name: namedQuery.name,
        description: namedQuery.description,
        sqlTemplate: namedQuery.query,
        params: namedQuery.parameters,
        defaultConnectionId: activeConnection ?? undefined,
      })

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

      scheduleAutoSyncNamedQueries()
    } catch (e) {
      console.error("Failed to save named query", e)
    }
  }

  const handleUpdateNamedQuery = async (updatedQuery: NamedQuery) => {
    try {
      const saved = await apiClient.namedQueries.update(updatedQuery.id, {
        name: updatedQuery.name,
        description: updatedQuery.description,
        sqlTemplate: updatedQuery.query,
        params: updatedQuery.parameters,
        defaultConnectionId: activeConnection ?? undefined,
      })

      const mappedUpdated: NamedQuery = {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        query: saved.sqlTemplate,
        parameters: saved.params,
      }

      setNamedQueries((prev) => prev.map((q) => (q.id === mappedUpdated.id ? mappedUpdated : q)))

      // Update tabs that are using this named query
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.namedQueryId === mappedUpdated.id) {
            // Determine if we need to update params on the tab if interface changed?
            // For simplified UX, we'll keep existing params if possible, or reset if needed.
            // Here we just update the content/name.
            return {
              ...t,
              name: mappedUpdated.name,
              query: mappedUpdated.query
            }
          }
          return t
        })
      )

      toast({
        title: "Query updated",
        description: "Saved changes to named query."
      })

      scheduleAutoSyncNamedQueries()
    } catch (e: any) {
      console.error("Failed to update named query", e)
      toast({
        variant: "destructive",
        title: "Failed to update query",
        description: e?.message || "Could not save changes."
      })
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
    // Safety: quote identifiers to avoid breakage when table/column names are mixed-case or reserved words.
    const q = quoteIdent
    const base = q(baseTable)

    const joinClauses = joins
      .map((j) => {
        const leftTable = j.leftTable || baseTable
        const rightTable = j.table
        return `${j.joinType} JOIN ${q(rightTable)} ON ${q(leftTable)}.${q(j.leftColumn)} = ${q(rightTable)}.${q(j.rightColumn)}`
      })
      .join("\n")

    const joinQuery = `SELECT *\nFROM ${base}\n${joinClauses}`

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
      void apiClient.connections.releasePools({ connectionId: previous }).catch(() => { })
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

      const data = await apiClient.query.run({
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
      })

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

      const data = await apiClient.query.run({
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
      })

      if (currentTab) {
        // For display, substitute :param occurrences with literals in the template
        const sqlDisplay = Object.entries(params).reduce((acc, [key, value]) => {
          const literal = toSqlLiteral(value)
          // Only replace real named params; avoid matching MACs/hex segments after ':'.
          const pattern = new RegExp(`(^|[^0-9A-Za-z_]):${escapeRegex(key)}\\b`, "g")
          return acc.replace(pattern, (_m, prefix) => `${prefix}${literal}`)
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

  // Handle show/hide query toggle - persist to tab
  const handleShowQueryChange = useCallback((shown: boolean) => {
    // Persist to tab state
    if (activeTab) {
      setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, showQuery: shown } : t))
    }
  }, [activeTab])

  // Handle params expand/collapse - global state
  const handleParamsExpandChange = useCallback((expanded: boolean) => {
    // Update global state
    setGlobalParamsExpanded(expanded)
  }, [])

  return (
    <>
      <div className="h-full w-full bg-stone-50 flex flex-col overflow-hidden">
        {/* Header with tabs and settings */}
        <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-2 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-stone-500 hover:text-stone-700"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <PanelLeft className="h-4 w-4" />
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
                            await apiClient.namedQueries.delete(id)
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
                        onOpenSyncSettings={() => setShowSyncSettingsDialog(true)}
                        onSyncNamedQueries={handleSyncNamedQueries}
                        onRefreshSchema={() => {
                          if (activeConnection) {
                            void loadSchema(activeConnection)
                          }
                        }}
                        schema={schema}
                        activeTab={sidebarTab}
                        onActiveTabChange={setSidebarTab}
                      />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}

            {/* Query and results area */}
            <ResizablePanel defaultSize={95}>
              <div className="h-full flex flex-col overflow-hidden">
                <ResizablePanelGroup direction="vertical">
                  {/* Query editor section */}
                  <ResizablePanel
                    defaultSize={20}
                    minSize={20}
                    className="flex flex-col"
                  >
                    <div className="flex-1 min-h-0 relative">
                      {currentTab?.isNamedQuery && currentNamedQuery ? (
                        <NamedQueryEditor
                          key={`${currentNamedQuery.id}:${currentNamedQuery.query}:${currentNamedQuery.parameters.map((p) => `${p.name}:${p.defaultValue ?? ""}`).join("|")}`}
                          namedQuery={currentNamedQuery}
                          onExecute={executeNamedQuery}
                          onEdit={() => {
                            setEditingNamedQuery(currentNamedQuery)
                            setShowSaveNamedDialog(true)
                          }}
                          paramsExpanded={globalParamsExpanded}
                          onParamsExpandChange={handleParamsExpandChange}
                        />
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
                  </ResizablePanel>

                  <ResizableHandle className="h-px bg-stone-200" />

                  {/* Data grid section */}
                  <ResizablePanel defaultSize={60} minSize={20}>
                    <div className="h-full overflow-hidden border-t border-stone-200 flex flex-col">
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
                        <div className="flex h-full flex-col items-center justify-center text-stone-400 gap-2">
                          {/* Empty state content */}
                          <div className="h-10 w-10 rounded-full bg-stone-100 flex items-center justify-center">
                            <svg className="h-5 w-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                            </svg>
                          </div>
                          <span className="text-sm font-medium">{isRunning ? "Running query..." : "Run a query to see results"}</span>
                          <span className="text-xs text-stone-400">Press ⌘+Enter to execute</span>
                        </div>
                      )}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
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

      <SyncSettingsDialog
        open={showSyncSettingsDialog}
        onOpenChange={setShowSyncSettingsDialog}
        onSaved={() => {
          toast({ title: "Sync settings saved" })
          void handleSyncNamedQueries()
        }}
        onCleared={() => {
          toast({ title: "Sync disabled on this device" })
        }}
      />

      {syncConflicts && (
        <NamedQuerySyncConflictsDialog
          open={showSyncConflictsDialog}
          onOpenChange={setShowSyncConflictsDialog}
          conflicts={syncConflicts as any}
          onApply={applySyncResolutions}
        />
      )}

      <SaveNamedQueryDialog
        key={`${showSaveNamedDialog ? "open" : "closed"}:${editingNamedQuery?.id ?? "new"}:${editingNamedQuery ? "edit" : "create"}`}
        open={showSaveNamedDialog}
        onOpenChange={(open) => {
          setShowSaveNamedDialog(open)
          if (!open) setEditingNamedQuery(null)
        }}
        query={editingNamedQuery ? editingNamedQuery.query : (currentTab?.query || "")}
        mode={editingNamedQuery ? "edit" : "create"}
        initialValues={editingNamedQuery ? {
          name: editingNamedQuery.name,
          description: editingNamedQuery.description,
          parameters: editingNamedQuery.parameters
        } : undefined}
        onSave={(data) => {
          if (editingNamedQuery) {
            void handleUpdateNamedQuery({ ...data, id: editingNamedQuery.id })
          } else {
            void handleSaveAsNamed(data)
          }
        }}
      />

      <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {Object.entries(
            listCommands().reduce((acc, cmd) => {
              const cat = cmd.category ?? "Other"
              acc[cat] = acc[cat] ?? []
              acc[cat].push(cmd)
              return acc
            }, {} as Record<string, ReturnType<typeof listCommands>>),
          ).map(([category, cmds], idx) => (
            <div key={category}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup heading={category}>
                {cmds.map((cmd) => {
                  const raw = shortcuts.getBinding(cmd.id)
                  const parsed = raw ? parseBinding(raw) : null
                  const isMac = typeof navigator !== "undefined" ? /mac/i.test(navigator.platform) : false
                  const label = parsed ? formatBinding(parsed, shortcuts.runtime, { isMac }) : undefined
                  return (
                    <CommandItem
                      key={cmd.id}
                      value={`${cmd.title} ${cmd.id}`}
                      onSelect={() => {
                        shortcuts.invoke(cmd.id)
                        setCommandPaletteOpen(false)
                      }}
                    >
                      <span className="truncate">{cmd.title}</span>
                      {label && <CommandShortcut>{label}</CommandShortcut>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </CommandDialog>

      <MenuHandler />
    </>
  )
}
