"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Column,
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { rowsToCsv, rowsToMarkdownTable } from "@/lib/csv"

// Helper to escape CSV values for clipboard
function escapeCsvValue(value: string): string {
  const NEEDS_QUOTING_REGEX = /[\n\r",]/g
  if (!NEEDS_QUOTING_REGEX.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
import { CellDetailDialog } from "./cell-detail-dialog"
import { Checkbox } from "@/components/ui/checkbox"

import { ChevronLeft, ChevronRight, Loader2, Copy, FileDown, EyeOff, Columns, Check, Eye, SlidersHorizontal, Maximize2, Minimize2, Info, ChevronDown, Table, AlertTriangle } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCommand } from "@/components/shortcuts/useCommand"

interface DataGridProps {
  columns: string[]
  data: Record<string, unknown>[]
  loading?: boolean
  error?: string | null
  /**
   * Set when the engine clipped the result. `at` is the row cap that was applied;
   * `requestedLimit` echoes the user's LIMIT (if any) so the banner can explain
   * which one is biting. `onSwitchToStream`, when provided, surfaces a button on
   * the banner that re-runs the same query as a server-side cursor.
   */
  truncated?: { at: number; requestedLimit?: number; onSwitchToStream?: () => void } | null
  /**
   * Set when the active result is being streamed via a server-side cursor. The
   * grid renders a "Load more" footer that fetches the next batch and appends.
   */
  streaming?: {
    rowsSent: number
    hasMore: boolean
    loading?: boolean
    onLoadMore: () => void
    onClose?: () => void
  } | null
  executedSql?: string
  pagination?: {
    limit?: number
    offset: number
    total?: number
  }
  onPageChange?: (newOffset: number) => void
  onLimitChange?: (newLimit: number | null) => void
}

// Helper to format cell values properly
function formatCellValue(value: unknown): React.ReactNode {
  if (value === null) {
    return <span className="text-muted-foreground/50 italic">NULL</span>
  }
  if (value === undefined) {
    return <span className="text-muted-foreground/50 italic">—</span>
  }
  if (typeof value === "object") {
    // Handle objects and arrays by JSON stringifying them
    try {
      return JSON.stringify(value)
    } catch {
      return "[Object]"
    }
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  return String(value)
}

function calculateColumnWidths(columns: string[], data: Record<string, unknown>[]) {
  const sizing: Record<string, number> = {}
  const SAMPLE_SIZE = 100
  const MIN_CUTOFF = 150
  const MAX_CAP = 500

  columns.forEach((col, index) => {
    const colId = `${col}-${index}`
    let maxWidth = col.length * 9 + 32 // Header width approx

    // Sample data
    const sample = data.slice(0, SAMPLE_SIZE)
    for (const row of sample) {
      const val = row[col]
      const text = val === null ? "NULL" : String(val)
      const width = text.length * 8 + 32 // Cell width approx
      if (width > maxWidth) maxWidth = width
      if (maxWidth >= MAX_CAP) break // Optimization
    }

    // Apply Logic: Max of (calculated, cutoff), clamped to Cap
    sizing[colId] = Math.min(Math.max(maxWidth, MIN_CUTOFF), MAX_CAP)
  })
  return sizing
}

type ColumnFieldMeta = { field?: string }

function resolveColumnField(column: Column<Record<string, unknown>, unknown>): string {
  const meta = column.columnDef.meta as ColumnFieldMeta | undefined
  if (meta?.field) return meta.field
  const header = column.columnDef.header
  if (header) return String(header)
  return column.id
}

function formatTimestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const dateSegment = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timeSegment = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${dateSegment}-${timeSegment}`
}

export function DataGrid({ columns: rawColumns, data, loading, error, truncated, streaming, executedSql, pagination, onPageChange, onLimitChange }: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({})
  const [detailCell, setDetailCell] = useState<{ content: unknown; column: string; executedSql?: string } | null>(null)

  // Selection State
  type Point = { r: number; c: number }
  const [selection, setSelection] = useState<{ start: Point; end: Point } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Track last clicked row for Shift+Click range selection
  const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)


  // Smart sizing effect
  useEffect(() => {
    if (data.length > 0) {
      const nextSizing = calculateColumnWidths(rawColumns, data)
      const isSizingEqual = (a: Record<string, number>, b: Record<string, number>) => {
        const aKeys = Object.keys(a)
        const bKeys = Object.keys(b)
        if (aKeys.length !== bKeys.length) return false
        for (const key of aKeys) {
          if (a[key] !== b[key]) return false
        }
        return true
      }
      setColumnSizing((prev) => (isSizingEqual(prev, nextSizing) ? prev : nextSizing))
    }
  }, [rawColumns, data])

  // Helpers
  const isCellSelected = (r: number, c: number) => {
    if (!selection) return false
    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)
    return r >= minR && r <= maxR && c >= minC && c <= maxC
  }

  const isRowSelected = (r: number) => {
    if (!selection) return false
    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)
    const visibleCols = getVisibleColumnFields()
    if (visibleCols.length === 0) return false
    const lastVisibleIndex = visibleCols.length - 1
    // Row is selected if the selection spans the full row width (all visible columns)
    return r >= minR && r <= maxR && minC === 0 && maxC === lastVisibleIndex
  }

  const isAllSelected = () => {
    if (!selection) return false
    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)
    const visibleCols = getVisibleColumnFields()
    if (visibleCols.length === 0) return false
    const lastVisibleIndex = visibleCols.length - 1
    return minR === 0 && maxR === data.length - 1 && minC === 0 && maxC === lastVisibleIndex
  }

  // Copy helpers
  const stringifyVal = useCallback((val: unknown) => {
    if (val === null) return ""
    if (typeof val === "object") return JSON.stringify(val)
    return String(val)
  }, [])

  // Mouse Handlers for Drag Selection (Global Up)
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", handleGlobalMouseUp)
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp)
  }, [])

  // Handle Escape to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isFullscreen])

  const handleMouseDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click
    e.preventDefault()
    setIsDragging(true)

    const isShift = e.shiftKey

    if (isShift && selection) {
      setSelection({ ...selection, end: { r, c } })
    } else if (e.metaKey || e.ctrlKey) {
      setSelection({ start: { r, c }, end: { r, c } })
    } else {
      setSelection({ start: { r, c }, end: { r, c } })
    }
    setLastSelectedRow(r)
  }

  const handleMouseEnter = (r: number, c: number) => {
    if (isDragging && selection) {
      setSelection({ ...selection, end: { r, c } })
    }
  }

  // Memoize columns definition
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      rawColumns.map((col, index) => ({
        id: `${col}-${index}`,
        header: col,
        size: 100,
        minSize: 70,
        maxSize: 600,
        accessorFn: (row) => row[col],
        cell: (info) => formatCellValue(info.getValue()),
        meta: { executedSql, field: col },
      })),
    [rawColumns, executedSql],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    onColumnVisibilityChange: setColumnVisibility, // Enable visibility handler
    defaultColumn: {
      size: 100,
      minSize: 70,
      maxSize: 600,
    },
    state: {
      sorting,
      columnSizing,
      columnVisibility,
    },
  })

  const getVisibleColumnFields = useCallback(() => {
    return table.getVisibleLeafColumns().map((column) => resolveColumnField(column))
  }, [table])

  const downloadCsv = useCallback(() => {
    if (data.length === 0) return

    const visibleFields = getVisibleColumnFields()
    if (visibleFields.length === 0) return

    const csv = rowsToCsv(visibleFields, data)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `dbconsole-results-${formatTimestampForFilename(new Date())}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [data, getVisibleColumnFields])

  const handleSmartCopy = useCallback((includeHeaders: boolean = true) => {
    if (!selection || data.length === 0) return

    const visibleColumns = getVisibleColumnFields()
    if (visibleColumns.length === 0) return

    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)

    // Get selected column headers
    const selectedColumns = []
    for (let c = minC; c <= maxC; c++) {
      const colName = visibleColumns[c]
      if (colName) selectedColumns.push(colName)
    }

    const numRows = maxR - minR + 1
    const numCols = maxC - minC + 1

    // Only include headers if:
    // - Explicitly requested (includeHeaders=true) AND
    // - Selection spans multiple columns OR multiple rows
    // Single cell or single column of cells = no headers
    const shouldIncludeHeaders = includeHeaders && (numCols > 1 || numRows > 1)

    // Build CSV
    const rows: string[] = []

    // Add header row only if needed
    if (shouldIncludeHeaders) {
      rows.push(selectedColumns.map(col => escapeCsvValue(col)).join(","))
    }

    // Add data rows
    for (let r = minR; r <= maxR; r++) {
      const rowData = data[r]
      const rowVals: string[] = []
      for (let c = minC; c <= maxC; c++) {
        const colName = visibleColumns[c]
        if (!colName) continue

        const val = rowData[colName]
        rowVals.push(escapeCsvValue(stringifyVal(val)))
      }
      rows.push(rowVals.join(","))
    }

    const csv = rows.join("\n")

    setIsCopied(true)
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = setTimeout(() => setIsCopied(false), 2000)

    navigator.clipboard.writeText(csv).catch(() => { })
  }, [data, getVisibleColumnFields, selection, stringifyVal])

  const handleCopyAsTable = useCallback(() => {
    if (!selection || data.length === 0) return

    const visibleColumns = getVisibleColumnFields()
    if (visibleColumns.length === 0) return

    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)

    // Get selected column headers
    const selectedColumns = []
    for (let c = minC; c <= maxC; c++) {
      const colName = visibleColumns[c]
      if (colName) selectedColumns.push(colName)
    }

    // Build rows for the selected range
    const selectedRows: Record<string, unknown>[] = []
    for (let r = minR; r <= maxR; r++) {
      const rowData = data[r]
      const filteredRow: Record<string, unknown> = {}
      for (const col of selectedColumns) {
        filteredRow[col] = rowData[col]
      }
      selectedRows.push(filteredRow)
    }

    const markdown = rowsToMarkdownTable(selectedColumns, selectedRows)

    setIsCopied(true)
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = setTimeout(() => setIsCopied(false), 2000)

    navigator.clipboard.writeText(markdown).catch(() => { })
  }, [data, getVisibleColumnFields, selection])

  const handleCopyAsTabbed = useCallback(() => {
    if (!selection || data.length === 0) return

    const visibleColumns = getVisibleColumnFields()
    if (visibleColumns.length === 0) return

    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)

    // Get selected column headers
    const selectedColumns = []
    for (let c = minC; c <= maxC; c++) {
      const colName = visibleColumns[c]
      if (colName) selectedColumns.push(colName)
    }

    const numRows = maxR - minR + 1
    const numCols = maxC - minC + 1
    const shouldIncludeHeaders = numCols > 1 || numRows > 1

    // Build TSV (tab-separated)
    const rows: string[] = []

    if (shouldIncludeHeaders) {
      rows.push(selectedColumns.join("\t"))
    }

    for (let r = minR; r <= maxR; r++) {
      const rowData = data[r]
      const rowVals: string[] = []
      for (let c = minC; c <= maxC; c++) {
        const colName = visibleColumns[c]
        if (!colName) continue
        const val = rowData[colName]
        rowVals.push(stringifyVal(val))
      }
      rows.push(rowVals.join("\t"))
    }

    const tsv = rows.join("\n")

    setIsCopied(true)
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = setTimeout(() => setIsCopied(false), 2000)

    navigator.clipboard.writeText(tsv).catch(() => { })
  }, [data, getVisibleColumnFields, selection, stringifyVal])

  useCommand("results.copySelection", (e) => {
    // Only handle if grid has selection
    if (!selection) return false

    // Check if there's a text selection anywhere (user selecting text in query editor)
    const textSelection = window.getSelection()
    if (textSelection && textSelection.toString().length > 0) {
      // User has text selected somewhere, let native copy work
      return false
    }

    // Check if focus is in an input or textarea with selection
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      // If there's text in the input/textarea, let native copy work
      const hasSelection = activeElement.selectionStart !== activeElement.selectionEnd
      if (hasSelection) return false
    }

    e.preventDefault()

    // Smart copy: single cell = plain data, multiple cells = table
    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)
    const numRows = maxR - minR + 1
    const numCols = maxC - minC + 1

    if (numRows === 1 && numCols === 1) {
      // Single cell: just copy the value, no headers, no table
      handleSmartCopy(false)
    } else {
      // Multiple cells: copy as TSV (tab-separated)
      handleCopyAsTabbed()
    }

    return true
  })



  useCommand("results.toggleFullscreen", () => {
    if (isFullscreen) {
      setIsFullscreen(false)
      return true
    }
    return false
  })

  useCommand("results.showExecutedSql", () => {
    if (!executedSql) return false
    setDetailCell({ content: executedSql, column: "Executed SQL", executedSql })
    return true
  })

  useCommand("results.pageNext", () => {
    if (!onPageChange || !pagination) return false
    const limit = pagination.limit
    if (limit === undefined) return false
    const offset = pagination.offset ?? 0
    const total = pagination.total
    const next = offset + limit
    if (total !== undefined && next >= total) return false
    onPageChange(next)
    return true
  })

  useCommand("results.pagePrev", () => {
    if (!onPageChange || !pagination) return false
    const limit = pagination.limit
    if (limit === undefined) return false
    const offset = pagination.offset ?? 0
    const prev = Math.max(0, offset - limit)
    if (prev === offset) return false
    onPageChange(prev)
    return true
  })

  useCommand("results.clearSelection", () => {
    if (detailCell) return false
    if (!selection) return false
    setSelection(null)
    return true
  })

  // Loading/Error Checks
  if (loading && data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/70" />
        <span className="text-sm">Running query...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive p-4 text-center">
        <div className="text-sm font-medium">Query Failed</div>
        <div className="text-xs font-mono bg-destructive/10 p-2 rounded">{error}</div>
      </div>
    )
  }

  if (rawColumns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Run a query to see results</div>
    )
  }

  // Pagination vars
  const totalRows = pagination?.total
  const limit = pagination?.limit
  const offset = pagination?.offset ?? 0
  const hasLimit = typeof limit === "number"
  const safeLimit = limit ?? 1
  const currentPage = hasLimit ? Math.floor(offset / safeLimit) + 1 : 1
  const totalPages = hasLimit && totalRows !== undefined ? Math.ceil(totalRows / safeLimit) : undefined
  const showPagination = !!pagination && !!onPageChange
  const limitValue = hasLimit ? String(limit) : "all"
  const rowsDescription = hasLimit
    ? totalRows !== undefined
      ? `${offset + 1}-${Math.min(offset + data.length, totalRows)} of ${totalRows}`
      : `${offset + 1}-${offset + data.length} rows`
    : totalRows !== undefined
      ? `All ${data.length} rows of ${totalRows}`
      : `All ${data.length} rows`
  const navLimit = limit ?? 0

  // Handlers for Gutter
  const handleGutterMouseDown = (rowIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const colsCount = getVisibleColumnFields().length
    if (colsCount === 0) return

    if (e.shiftKey && selection) {
      setIsDragging(true)
      setSelection({
        start: selection.start,
        end: { r: rowIdx, c: colsCount - 1 }
      })
    } else {
      // Toggle Logic
      const isCurrentlySelected = selection &&
        selection.start.r === rowIdx &&
        selection.end.r === rowIdx &&
        selection.start.c === 0 &&
        selection.end.c === colsCount - 1

      if (isCurrentlySelected) {
        setSelection(null)
        setIsDragging(false)
      } else {
        setIsDragging(true)
        setSelection({
          start: { r: rowIdx, c: 0 },
          end: { r: rowIdx, c: colsCount - 1 }
        })
      }
    }
  }

  return (
    <>
      <div
        ref={gridContainerRef}
        className={cn(
          "flex flex-col bg-card transition-all duration-300 ease-in-out",
          isFullscreen
            ? "fixed inset-0 sm:inset-2 z-50 border border-border overflow-hidden animate-in fade-in duration-200"
            : "h-full w-full bg-card",
        )}
      >

        {truncated && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate flex-1">
              Result clipped to <strong>{truncated.at.toLocaleString()}</strong> rows.
              {truncated.requestedLimit !== undefined
                ? ` Your LIMIT was ${truncated.requestedLimit.toLocaleString()}; the engine cap is the smaller value.`
                : " Increase DBCONSOLE_MAX_ROWS or add a LIMIT / OFFSET to page through more."}
            </span>
            {truncated.onSwitchToStream && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] border-amber-500/40 hover:bg-amber-500/20"
                onClick={truncated.onSwitchToStream}
              >
                Stream all rows →
              </Button>
            )}
          </div>
        )}

        {streaming && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
          >
            <Loader2 className={cn("h-3.5 w-3.5 shrink-0", streaming.loading && "animate-spin")} aria-hidden />
            <span className="truncate flex-1">
              Streaming via server cursor — <strong>{streaming.rowsSent.toLocaleString()}</strong> rows fetched.
              {!streaming.hasMore && " End of result reached."}
            </span>
            {streaming.onClose && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] hover:bg-blue-500/20"
                onClick={streaming.onClose}
              >
                Close stream
              </Button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto relative select-none" onMouseLeave={() => setIsDragging(false)}>
          <table
            className="w-full border-collapse text-sm"
            style={{ width: table.getTotalSize() + 40 }} // Extra width for gutter
          >
            <thead className="sticky top-0 bg-secondary z-20 shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {/* Gutter Header: Select All */}
                  <th
                    className={cn(
                      "sticky left-0 z-30 w-10 min-w-[40px] px-0 border-b border-r border-border cursor-pointer transition-colors",
                      // Fix: if all selected, using standard hover might look bad.
                      isAllSelected()
                        ? "bg-secondary hover:bg-secondary/80"
                        : "bg-secondary hover:bg-secondary/80"
                    )}
                    onClick={() => {
                      if (isAllSelected()) {
                        setSelection(null)
                      } else {
                        setSelection({
                          start: { r: 0, c: 0 },
                          end: { r: data.length - 1, c: rawColumns.length - 1 }
                        })
                      }
                    }}
                  >
                    <div
                      className={cn(
                        "h-full w-full flex items-center justify-center text-[10px] font-mono select-none gap-2",
                        isAllSelected() ? "text-foreground font-bold" : "text-muted-foreground"
                      )}
                    >
                      <span>ALL</span>
                    </div>
                  </th>

                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{ width: header.getSize() }}
                      className="relative px-3 py-2 text-left text-xs font-semibold text-foreground border-b border-r border-border bg-secondary select-none group"
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <div className="flex items-center flex-1 min-w-0 gap-2">
                          <span className="truncate">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground font-mono select-none flex-shrink-0">
                            {header.index + 1}
                          </span>
                        </div>

                        {/* Hide Column Button - Animated Reveal */}
                        <div className="w-0 overflow-hidden opacity-0 group-hover:w-5 group-hover:opacity-100 transition-all duration-300 ease-in-out flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              header.column.toggleVisibility(false)
                            }}
                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors outline-none"
                            title="Hide Column"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Resize Handle */}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => {
                          const columnId = header.column.id
                          const headerText = String(header.column.columnDef.header || "")
                          const headerWidth = headerText.length * 9 + 48

                          let maxContentWidth = headerWidth
                          const colName = String(header.column.columnDef.header || "")
                          data.slice(0, 100).forEach((row) => {
                            const cellValue = row[colName]
                            const textLength = cellValue === null ? 4 : String(cellValue).length
                            const cellWidth = textLength * 8.5 + 32
                            maxContentWidth = Math.max(maxContentWidth, cellWidth)
                          })

                          setColumnSizing((prev) => ({
                            ...prev,
                            [columnId]: Math.min(Math.max(maxContentWidth, 30), 800),
                          }))
                        }}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none transition-colors",
                          "hover:bg-muted-foreground/50 group-hover:bg-muted-foreground/30",
                          header.column.getIsResizing() && "bg-muted-foreground/60",
                        )}
                      />
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, rowIdx) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    rowIdx % 2 === 0 ? "bg-card" : "bg-muted/30",
                    // We remove hover effect on row to focus on cell selection? Or keep it?
                    "hover:bg-muted/50"
                  )}
                >
                  {/* Gutter Cell */}
                  <td
                    className="sticky left-0 z-10 w-10 min-w-[40px] bg-secondary border-r border-border text-center text-[10px] text-muted-foreground cursor-pointer hover:bg-muted user-select-none font-mono"
                    onMouseDown={(e) => handleGutterMouseDown(rowIdx, e)}
                    onMouseEnter={(e) => {
                      if (isDragging) {
                        // Update selection to span to this row
                        // We need access to current selection start.
                        // Fortunately 'selection' is in closure but might be stale if using handleMouseEnter?
                        // Actually it's fine since we render on every change.
                        if (selection) {
                          // Extend to this row, keeping the same horizontal span
                          setSelection({
                            ...selection,
                            end: { r: rowIdx, c: selection.end.c }
                          })
                        }
                      }
                    }}
                  >
                    {(offset || 0) + rowIdx + 1}
                  </td>

                  {row.getVisibleCells().map((cell, colIdx) => {
                    const isSelected = isCellSelected(rowIdx, colIdx)
                    return (
                      <td
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                        }}
                        className={cn(
                          "px-3 py-1.5 text-foreground font-mono text-sm border-r border-border/50 whitespace-nowrap overflow-hidden text-ellipsis max-w-0 cursor-default",
                          isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30"
                        )}
                        onMouseDown={(e) => handleMouseDown(rowIdx, colIdx, e)}
                        onMouseEnter={() => handleMouseEnter(rowIdx, colIdx)}
                        onDoubleClick={() => {
                          setDetailCell({
                            content: cell.getValue(),
                            column: cell.column.columnDef.header as string,
                            executedSql
                          })
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="flex items-center justify-between px-3 py-2 bg-secondary border-t border-border select-none"
          onDoubleClick={() => setIsFullscreen(!isFullscreen)}
        >
          {/* LEFT: Actions */}
          <div className="flex items-center gap-2" onDoubleClick={(e) => e.stopPropagation()}>
            {/* Copy Dropdown Button */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={!selection}
                className={cn(
                  "h-7 gap-1.5 transition-all duration-300 border rounded-r-none border-r-0",
                  isCopied
                    ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                    : "bg-card text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950 border-emerald-100 dark:border-emerald-900 hover:border-emerald-200/50 shadow-sm",
                  !selection && "opacity-50 grayscale cursor-not-allowed bg-secondary border-border text-muted-foreground shadow-none"
                )}
                onClick={() => handleSmartCopy()}
              >
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="text-xs font-medium">{isCopied ? "Copied!" : "Copy"}</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selection}
                    className={cn(
                      "h-7 px-1.5 transition-all duration-300 border rounded-l-none",
                      isCopied
                        ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                        : "bg-card text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950 border-emerald-100 dark:border-emerald-900 hover:border-emerald-200/50 shadow-sm",
                      !selection && "opacity-50 grayscale cursor-not-allowed bg-secondary border-border text-muted-foreground shadow-none"
                    )}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onClick={() => handleSmartCopy()} className="gap-2 text-xs">
                    <Copy className="h-3.5 w-3.5" />
                    Copy as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyAsTable} className="gap-2 text-xs">
                    <Table className="h-3.5 w-3.5" />
                    Copy as Table
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyAsTabbed} className="gap-2 text-xs">
                    <Columns className="h-3.5 w-3.5" />
                    Copy as TSV
                  </DropdownMenuItem>

                </DropdownMenuContent>

              </DropdownMenu>
            </div>


            <Button
              variant="ghost"
              size="sm"
              disabled={data.length === 0}
              className="h-7 gap-1.5 border border-border text-muted-foreground hover:bg-muted hover:text-foreground shadow-sm"
              onClick={downloadCsv}
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Download CSV</span>
            </Button>

            <div className="h-4 w-px bg-border mx-2" />

            {executedSql && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Show executed SQL"
                onClick={() => executedSql && setDetailCell({ content: executedSql, column: "Executed SQL", executedSql })}
              >
                <Info className="h-4 w-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>

            {/* View/Columns Options */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted" title="View Options">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-auto p-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Toggle Columns
                </div>
                {table.getAllLeafColumns().map(column => {
                  return (
                    <DropdownMenuItem
                      key={column.id}
                      className="text-xs gap-2 cursor-pointer focus:bg-secondary"
                      onSelect={(e) => {
                        e.preventDefault()
                        column.toggleVisibility(!column.getIsVisible())
                      }}
                    >
                      <Checkbox
                        checked={column.getIsVisible()}
                        onCheckedChange={(val) => column.toggleVisibility(!!val)}
                        className="data-[state=checked]:bg-emerald-100 dark:data-[state=checked]:bg-emerald-950 data-[state=checked]:text-emerald-700 dark:data-[state=checked]:text-emerald-400 data-[state=checked]:border-emerald-200 dark:data-[state=checked]:border-emerald-800 border-border"
                      />
                      <span className="truncate flex-1">{column.id}</span>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* RIGHT: Pagination */}
          <div className="flex items-center gap-4" onDoubleClick={(e) => e.stopPropagation()}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

            {streaming && (
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                  {streaming.rowsSent.toLocaleString()} rows{streaming.hasMore ? "" : " (end)"}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  disabled={!streaming.hasMore || streaming.loading}
                  onClick={streaming.onLoadMore}
                >
                  {streaming.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}

            {!streaming && showPagination && (
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                  {rowsDescription}
                </div>

                <div className="h-4 w-px bg-border mx-2" />

                <Select
                  value={limitValue}
                  onValueChange={(v) => {
                    if (v === "all") {
                      onLimitChange?.(null)
                      return
                    }
                    const parsed = Number(v)
                    if (!Number.isFinite(parsed)) return
                    onLimitChange?.(parsed)
                  }}
                >
                  <SelectTrigger className="h-6 w-auto gap-1.5 px-2 text-xs border-transparent bg-transparent hover:bg-muted focus:ring-0">
                    <span className="text-muted-foreground">Limit:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-0.5">
                  {hasLimit ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={navLimit === 0 || offset === 0 || loading}
                        onClick={() => onPageChange(Math.max(0, offset - navLimit))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-muted-foreground min-w-[3ch] text-center">{currentPage}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={navLimit === 0 || (totalRows !== undefined && offset + navLimit >= totalRows) || loading}
                        onClick={() => onPageChange(offset + navLimit)}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground font-medium">Showing all rows</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {detailCell && (
          <CellDetailDialog
            open={!!detailCell}
            onOpenChange={(open) => !open && setDetailCell(null)}
            content={detailCell.content}
            columnName={detailCell.column}
          />
        )}
      </div>
    </>
  )
}
