"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  getSortedRowModel,
  SortingState,
  ColumnDef,
} from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CellDetailDialog } from "./cell-detail-dialog"
import { Checkbox } from "@/components/ui/checkbox"

import { ChevronLeft, ChevronRight, Loader2, Copy, FileDown, EyeOff, Columns, Check, Eye, SlidersHorizontal, Maximize2, Minimize2, Info } from "lucide-react"
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

interface DataGridProps {
  columns: string[]
  data: Record<string, unknown>[]
  loading?: boolean
  error?: string | null
  executedSql?: string
  pagination?: {
    limit: number
    offset: number
    total?: number
  }
  onPageChange?: (newOffset: number) => void
  onLimitChange?: (newLimit: number) => void
}

// Helper to format cell values properly
function formatCellValue(value: unknown): React.ReactNode {
  if (value === null) {
    return <span className="text-stone-300 italic">NULL</span>
  }
  if (value === undefined) {
    return <span className="text-stone-300 italic">—</span>
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

export function DataGrid({ columns: rawColumns, data, loading, error, executedSql, pagination, onPageChange, onLimitChange }: DataGridProps) {
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
    // Row is selected if the selection spans the full row width (all columns)
    return r >= minR && r <= maxR && minC === 0 && maxC === rawColumns.length - 1
  }

  const isAllSelected = () => {
    if (!selection) return false
    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)

    return minR === 0 && maxR === data.length - 1 && minC === 0 && maxC === rawColumns.length - 1
  }

  // Copy helpers
  const stringifyVal = useCallback((val: unknown) => {
    if (val === null) return ""
    if (typeof val === "object") return JSON.stringify(val)
    return String(val)
  }, [])

  const handleSmartCopy = useCallback(() => {
    // User Logic: "copy button should only copy selected"
    // If nothing selected, we do NOT copy all.
    if (!selection || !data || data.length === 0) return

    const minR = Math.min(selection.start.r, selection.end.r)
    const maxR = Math.max(selection.start.r, selection.end.r)
    const minC = Math.min(selection.start.c, selection.end.c)
    const maxC = Math.max(selection.start.c, selection.end.c)

    const visibleCols = rawColumns

    let tsv = ""
    for (let r = minR; r <= maxR; r++) {
      const rowData = data[r]
      const rowVals: string[] = []
      for (let c = minC; c <= maxC; c++) {
        const colName = visibleCols[c]
        if (columnVisibility[colName] === false) continue

        const val = rowData[colName]
        // Use stringifyVal to fix [object Object] bug
        rowVals.push(stringifyVal(val))
      }
      tsv += rowVals.join("\t") + "\n"
    }

    navigator.clipboard.writeText(tsv).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }, [columnVisibility, data, rawColumns, selection, stringifyVal])

  // Keyboard support for Copy
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        if (selection) {
          e.preventDefault() // Prevent browser copy
          handleSmartCopy()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleSmartCopy, selection])

  // Mouse Handlers for Drag Selection (Global Up)
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", handleGlobalMouseUp)
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp)
  }, [])

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
        meta: { executedSql },
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

  // Loading/Error Checks
  if (loading && data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-400">
        <Loader2 className="h-6 w-6 animate-spin text-stone-300" />
        <span className="text-sm">Running query...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-red-500 p-4 text-center">
        <div className="text-sm font-medium">Query Failed</div>
        <div className="text-xs font-mono bg-red-50 p-2 rounded">{error}</div>
      </div>
    )
  }

  if (rawColumns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-stone-400 text-sm">Run a query to see results</div>
    )
  }

  // Pagination vars
  const totalRows = pagination?.total
  const limit = pagination?.limit || 100
  const offset = pagination?.offset || 0
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = totalRows ? Math.ceil(totalRows / limit) : undefined
  const showPagination = pagination && onPageChange

  // Handlers for Gutter
  const handleGutterMouseDown = (rowIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const colsCount = rawColumns.length

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
      {isFullscreen && (
        <div className="h-full w-full rounded-lg border border-dashed border-stone-200 bg-stone-50/50 flex items-center justify-center text-sm text-stone-400">
          Viewing in fullscreen
        </div>
      )}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[2px] animate-in fade-in duration-500"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      <div
        className={cn(
          "flex flex-col bg-white transition-all duration-300 ease-in-out",
          isFullscreen
            ? "fixed inset-0 sm:inset-6 z-50 rounded-xl border border-stone-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-300"
            : "h-full w-full bg-white",
        )}
      >
        <div className="flex-1 overflow-auto relative select-none" onMouseLeave={() => setIsDragging(false)}>
          <table
            className="w-full border-collapse text-sm"
            style={{ width: table.getTotalSize() + 40 }} // Extra width for gutter
          >
            <thead className="sticky top-0 bg-stone-100 z-20 shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {/* Gutter Header: Select All */}
                  <th
                    className={cn(
                      "sticky left-0 z-30 w-10 min-w-[40px] px-0 border-b border-r border-stone-200 cursor-pointer transition-colors",
                      // Fix: if all selected, using standard hover might look bad.
                      isAllSelected()
                        ? "bg-stone-100 hover:bg-stone-200"
                        : "bg-stone-100 hover:bg-stone-200"
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
                    <div className={cn(
                      "h-full w-full flex items-center justify-center text-[10px] font-mono",
                      isAllSelected() ? "text-stone-700 font-bold" : "text-stone-400"
                    )}>
                      ALL
                    </div>
                  </th>

                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{ width: header.getSize() }}
                      className="relative px-3 py-2 text-left text-xs font-semibold text-stone-700 border-b border-r border-stone-200 bg-stone-100 select-none group"
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <div className="flex items-center flex-1 min-w-0 gap-2">
                          <span className="truncate">
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          <span className="ml-auto text-[10px] text-stone-500 font-mono select-none flex-shrink-0">
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
                            className="p-0.5 hover:bg-stone-200 rounded text-stone-400 hover:text-stone-600 transition-colors outline-none"
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
                          "hover:bg-stone-400 group-hover:bg-stone-300",
                          header.column.getIsResizing() && "bg-stone-500",
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
                    "border-b border-stone-100 transition-colors",
                    rowIdx % 2 === 0 ? "bg-white" : "bg-stone-50/50",
                    // We remove hover effect on row to focus on cell selection? Or keep it?
                    "hover:bg-stone-50/50"
                  )}
                >
                  {/* Gutter Cell */}
                  <td
                    className="sticky left-0 z-10 w-10 min-w-[40px] bg-stone-50 border-r border-stone-200 text-center text-[10px] text-stone-400 cursor-pointer hover:bg-stone-200 user-select-none font-mono"
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
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : undefined,
                          boxShadow: isSelected ? 'inset 0 0 0 1px rgba(59, 130, 246, 0.3)' : undefined
                        }}
                        className={cn(
                          "px-3 py-1.5 text-stone-700 font-mono text-sm border-r border-stone-100 whitespace-nowrap overflow-hidden text-ellipsis max-w-0 cursor-default",
                          isSelected && "selection-highlight"
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
          className="flex items-center justify-between px-3 py-2 bg-stone-50 border-t border-stone-200 select-none"
          onDoubleClick={() => setIsFullscreen(!isFullscreen)}
        >
          {/* LEFT: Actions */}
          <div className="flex items-center gap-2" onDoubleClick={(e) => e.stopPropagation()}>
            {/* Smart Copy Button */}
            <Button
              variant="ghost"
              size="sm"
              disabled={!selection} // Only active if selected
              className={cn(
                "h-7 gap-1.5 transition-all duration-300 border",
                isCopied
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : "bg-white text-emerald-700 hover:bg-emerald-100 border-emerald-100 hover:border-emerald-200/50 shadow-sm",
                !selection && "opacity-50 grayscale cursor-not-allowed bg-stone-100 border-stone-200 text-stone-400 shadow-none"
              )}
              onClick={handleSmartCopy}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="text-xs font-medium">{isCopied ? "Copied!" : "Copy Selected"}</span>
            </Button>

            <div className="h-4 w-px bg-stone-300/60 mx-2" />

            {executedSql && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-stone-500 hover:text-stone-700"
                title="Show executed SQL"
                onClick={() => executedSql && setDetailCell({ content: executedSql, column: "Executed SQL", executedSql })}
              >
                <Info className="h-4 w-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-stone-500 hover:text-stone-700 hover:bg-stone-200/50"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>

            {/* View/Columns Options */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-stone-500 hover:text-stone-700 hover:bg-stone-200/50" title="View Options">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-[300px] overflow-auto p-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-stone-500">
                  Toggle Columns
                </div>
                {table.getAllLeafColumns().map(column => {
                  return (
                    <DropdownMenuItem
                      key={column.id}
                      className="text-xs gap-2 cursor-pointer focus:bg-stone-100"
                      onSelect={(e) => {
                        e.preventDefault()
                        column.toggleVisibility(!column.getIsVisible())
                      }}
                    >
                      <Checkbox
                        checked={column.getIsVisible()}
                        onCheckedChange={(val) => column.toggleVisibility(!!val)}
                        className="data-[state=checked]:bg-emerald-100 data-[state=checked]:text-emerald-700 data-[state=checked]:border-emerald-200 border-stone-300"
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
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400" />}

            {showPagination && (
              <div className="flex items-center gap-2">
                <div className="text-xs text-stone-500 font-medium whitespace-nowrap">
                  {totalRows !== undefined
                    ? `${offset + 1}-${Math.min(offset + data.length, totalRows)} of ${totalRows}`
                    : `${data.length} rows`
                  }
                </div>

                <div className="h-4 w-px bg-stone-300/60 mx-2" />

                <Select value={String(limit)} onValueChange={(v) => onLimitChange?.(Number(v))}>
                  <SelectTrigger className="h-6 w-auto gap-1.5 px-2 text-xs border-transparent bg-transparent hover:bg-stone-200/50 focus:ring-0">
                    <span className="text-stone-400">Limit:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={offset === 0 || loading}
                    onClick={() => onPageChange(Math.max(0, offset - limit))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-stone-500 min-w-[3ch] text-center">{currentPage}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={(totalRows !== undefined && offset + limit >= totalRows) || loading}
                    onClick={() => onPageChange(offset + limit)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
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
