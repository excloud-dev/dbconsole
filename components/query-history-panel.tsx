"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Clock, History, Loader2, RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  apiClient,
  type QueryHistoryFilter,
  type QueryHistoryResult,
  type QueryHistoryRow,
  type QueryHistoryStatus,
} from "@/lib/client/apiClient"
import { cn } from "@/lib/utils"

type Connection = { id: string; label: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
  /** Default connection filter when opening the panel. Pass `null` to show all. */
  defaultConnectionId?: string | null
  /** Called when the user clicks a row — opens the SQL in a new query tab. */
  onOpenInTab?: (sql: string, connectionId: string) => void
}

const STATUS_META: Record<QueryHistoryStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  ok: { label: "OK", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  error: { label: "Error", icon: AlertCircle, className: "text-destructive" },
  timeout: { label: "Timeout", icon: Clock, className: "text-amber-600 dark:text-amber-400" },
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—"
  if (ms < 1) return "<1 ms"
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const deltaSec = Math.round((Date.now() - then) / 1000)
  if (deltaSec < 5) return "just now"
  if (deltaSec < 60) return `${deltaSec}s ago`
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function previewSql(sql: string): string {
  // Collapse whitespace so the preview stays on one line in the list.
  return sql.replace(/\s+/g, " ").trim().slice(0, 200)
}

export function QueryHistoryPanel({
  open,
  onOpenChange,
  connections,
  defaultConnectionId,
  onOpenInTab,
}: Props) {
  const [data, setData] = useState<QueryHistoryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterConnectionId, setFilterConnectionId] = useState<string | "all">(
    defaultConnectionId ?? "all",
  )
  const [filterStatus, setFilterStatus] = useState<QueryHistoryStatus | "all">("all")
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)

  const connectionsById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of connections) map.set(c.id, c.label)
    return map
  }, [connections])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload: QueryHistoryFilter = { limit: 200 }
      if (filterConnectionId !== "all") payload.connectionId = filterConnectionId
      if (filterStatus !== "all") payload.status = filterStatus
      if (search.trim()) payload.search = search.trim()
      const result = await apiClient.history.list(payload)
      setData(result)
      setActiveIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history")
    } finally {
      setLoading(false)
    }
  }, [filterConnectionId, filterStatus, search])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    // Reset filter connection when the default prop changes while the panel is open.
    if (defaultConnectionId !== undefined) {
      setFilterConnectionId(defaultConnectionId ?? "all")
    }
  }, [open, defaultConnectionId])

  const openRow = useCallback(
    (row: QueryHistoryRow) => {
      if (!onOpenInTab) return
      onOpenInTab(row.sql, row.connectionId)
      onOpenChange(false)
    },
    [onOpenInTab, onOpenChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!data?.rows.length) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, data.rows.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const row = data.rows[activeIndex]
        if (row) openRow(row)
      } else if (e.key === "Home") {
        e.preventDefault()
        setActiveIndex(0)
      } else if (e.key === "End") {
        e.preventDefault()
        setActiveIndex(data.rows.length - 1)
      }
    },
    [data, activeIndex, openRow],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Query history
          </SheetTitle>
          <SheetDescription className="text-xs">
            Recent executions from this device. Click or press Enter to re-open a query in a new tab.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 flex-wrap">
          <Select value={filterConnectionId} onValueChange={(v) => setFilterConnectionId(v)}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All connections</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as QueryHistoryStatus | "all")}>
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              <SelectItem value="ok" className="text-xs">OK</SelectItem>
              <SelectItem value="error" className="text-xs">Error</SelectItem>
              <SelectItem value="timeout" className="text-xs">Timeout</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[180px]">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void load()
                }
              }}
              placeholder="Search SQL or error…"
              className="h-7 text-xs pr-7"
            />
            {search && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <div
          className="flex-1 overflow-auto outline-none"
          tabIndex={0}
          onKeyDown={onKeyDown}
          role="listbox"
          aria-label="Query history"
        >
          {error && (
            <div className="p-4 m-4 border border-destructive/30 bg-destructive/5 rounded-md text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive mb-1">
                <AlertCircle className="h-3.5 w-3.5" /> Failed to load
              </div>
              <div className="font-mono break-words">{error}</div>
            </div>
          )}

          {!error && data && data.rows.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No history entries match these filters. Run a few queries and they'll show up here.
            </div>
          )}

          {!error && data && data.rows.length > 0 && (
            <ul className="text-xs divide-y divide-border">
              {data.rows.map((row, idx) => {
                const meta = STATUS_META[row.status] ?? STATUS_META.ok
                const Icon = meta.icon
                const active = idx === activeIndex
                return (
                  <li
                    key={row.id}
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "px-3 py-2 cursor-pointer hover:bg-muted/40 focus:outline-none",
                      active && "bg-muted/60",
                    )}
                    onClick={() => {
                      setActiveIndex(idx)
                      openRow(row)
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.className)} aria-hidden />
                      <span className={cn("font-semibold uppercase tracking-wide text-[10px]", meta.className)}>
                        {meta.label}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground truncate">
                        {connectionsById.get(row.connectionId) ?? row.connectionId}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{formatRelativeTime(row.createdAt)}</span>
                      <span className="ml-auto text-muted-foreground whitespace-nowrap">
                        {row.rowsReturned !== undefined ? `${row.rowsReturned.toLocaleString()} rows` : ""}
                        {row.rowsReturned !== undefined && row.durationMs !== undefined ? " · " : ""}
                        {formatDuration(row.durationMs)}
                      </span>
                    </div>
                    <div className="font-mono text-muted-foreground break-words line-clamp-2">
                      {previewSql(row.sql)}
                    </div>
                    {row.status !== "ok" && row.errorMessage && (
                      <div className="font-mono text-destructive/80 text-[11px] mt-1 break-words line-clamp-2">
                        {row.errorMessage}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {data && (
          <div className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>
              Showing {data.rows.length} of {data.total.toLocaleString()} entries
              {data.hasMore ? " (more available — narrow filters to see)" : ""}
            </span>
            <span className="hidden sm:inline">↑ ↓ to navigate · Enter to open</span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
