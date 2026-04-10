"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Copy, Loader2, RefreshCw, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiClient, ApiError, asQueryErrorBody, type SlowQueryResult, type SlowQuerySort } from "@/lib/client/apiClient"
import { useToast } from "@/hooks/use-toast"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string | null
  /** Called when the user clicks a row to "open in a new tab". */
  onOpenInTab?: (sql: string) => void
}

const SORT_LABEL: Record<SlowQuerySort, string> = {
  mean_time: "Mean time",
  total_time: "Total time",
  calls: "Calls",
  rows: "Rows returned",
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  if (ms < 1) return `${ms.toFixed(2)} ms`
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${(ms / 60_000).toFixed(2)} min`
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString()
}

export function SlowQueryPanel({ open, onOpenChange, connectionId, onOpenInTab }: Props) {
  const { toast } = useToast()
  const [data, setData] = useState<SlowQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SlowQuerySort>("mean_time")
  const [limit] = useState(50)

  const load = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiClient.diagnostics.slowQueries({ connectionId, sort, limit })
      setData(result)
    } catch (e) {
      const detail = asQueryErrorBody(e)
      const message = detail?.error ?? (e instanceof ApiError ? e.message : "Failed to load slow queries")
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [connectionId, sort, limit])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" /> Slow queries
          </SheetTitle>
          <SheetDescription className="text-xs">
            Top {limit} statements by {SORT_LABEL[sort].toLowerCase()}, sourced from{" "}
            <code className="font-mono">pg_stat_statements</code>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
          <Select value={sort} onValueChange={(v) => setSort(v as SlowQuerySort)}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as SlowQuerySort[]).map((key) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {SORT_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {!connectionId && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Select a connection to inspect slow queries.
            </div>
          )}

          {connectionId && error && (
            <div className="p-4 m-4 border border-destructive/30 bg-destructive/5 rounded-md text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive mb-1">
                <AlertCircle className="h-3.5 w-3.5" /> Failed to load
              </div>
              <div className="font-mono break-words">{error}</div>
            </div>
          )}

          {connectionId && !error && data && data.installed === false && (
            <div className="p-6 space-y-3">
              <div className="text-sm font-medium">pg_stat_statements is not installed on this database.</div>
              <p className="text-xs text-muted-foreground">
                Run the following as a Postgres superuser to enable per-query timing data. After enabling it, the
                extension also requires <code className="font-mono">shared_preload_libraries = 'pg_stat_statements'</code>{" "}
                in postgresql.conf and a server restart.
              </p>
              <pre className="bg-muted/40 border border-border rounded p-3 text-xs font-mono whitespace-pre-wrap">
                {data.installSnippet}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(data.installSnippet)
                  toast({ title: "Copied", description: "Install snippet copied to clipboard" })
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy snippet
              </Button>
            </div>
          )}

          {connectionId && !error && data && data.installed === true && data.rows.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              pg_stat_statements is installed but has no recorded statements yet. Run some queries against this database
              and try again.
            </div>
          )}

          {connectionId && !error && data && data.installed === true && data.rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-secondary z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Query</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Mean</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Total</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Calls</th>
                  <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Rows</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.queryId}
                    className="border-b border-border hover:bg-muted/40 cursor-pointer"
                    onClick={() => onOpenInTab?.(row.query)}
                    title="Click to open this query in a new tab"
                  >
                    <td className="px-3 py-2 font-mono align-top max-w-[420px]">
                      <div className="line-clamp-3 break-words">{row.query}</div>
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatMs(row.meanTimeMs)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatMs(row.totalTimeMs)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatNumber(row.calls)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatNumber(row.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
