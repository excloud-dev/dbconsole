"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Play, BookmarkPlus } from "lucide-react"
import { SqlEditor } from "@/components/sql-editor"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Check, X } from "lucide-react"

interface SchemaInfo {
  tables: { name: string; schema: string }[]
  columns: { name: string; table: { name: string; schema: string }; dataType: string }[]
}

interface QueryEditorProps {
  query: string
  onChange: (query: string) => void
  onRun: () => void
  onSaveAsNamed: () => void
  isNamedQuery?: boolean
  schema?: SchemaInfo | null
  params?: Array<{ type: "string" | "number" | "boolean"; value: string }>
  onParamsChange?: (params: Array<{ type: "string" | "number" | "boolean"; value: string }>) => void
  paramLabels?: string[]
  onLineCountChange?: (lines: number) => void
}

export function QueryEditor({ query, onChange, onRun, onSaveAsNamed, isNamedQuery, schema, params = [], onParamsChange, paramLabels = [], onLineCountChange }: QueryEditorProps) {
  const updateParam = (index: number, updates: Partial<{ type: "string" | "number" | "boolean"; value: string }>) => {
    if (!onParamsChange) return
    const next = params.map((p, i) => (i === index ? { ...p, ...updates } : p))
    onParamsChange(next)
  }
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden relative group/editor">
      <div className="flex-1 min-h-0 relative">
        <SqlEditor
          value={query}
          onChange={onChange}
          onExecute={onRun}
          schema={schema}
          className="h-full w-full"
          domId="sql-editor-main"
          onLineCountChange={onLineCountChange}
        />

        {/* Floating Actions */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 transition-opacity opacity-0 group-hover/editor:opacity-100">
          {!isNamedQuery && query.trim() && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-stone-600 border-stone-200 hover:bg-white hover:text-stone-900 bg-white/90 backdrop-blur shadow-sm"
              onClick={onSaveAsNamed}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save
            </Button>
          )}
          <Button size="sm" className="h-7 gap-1.5 bg-stone-800 hover:bg-stone-900 text-white shadow-md transition-transform active:scale-95" onClick={onRun}>
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
        </div>
      </div>

      {!isNamedQuery && onParamsChange && params.length > 0 && (
        <div className="border-t border-stone-200 bg-stone-50/50 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto max-h-[160px]">
          {params.map((param, idx) => (
            <div key={idx} className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-md px-2 py-1.5 shadow-sm group hover:border-stone-300 transition-colors">
              {/* Index Chip */}
              <div className="flex items-center justify-center h-5 w-6 rounded bg-stone-100 text-[10px] font-mono font-medium text-stone-500 border border-stone-200 shrink-0" title={`Parameter $${idx + 1}`}>
                ${idx + 1}
              </div>

              {/* Type Select */}
              <Select value={param.type} onValueChange={(v) => updateParam(idx, { type: v as "string" | "number" | "boolean" })}>
                <SelectTrigger className="h-5 w-[42px] border-none bg-transparent p-0 text-[10px] text-stone-400 font-medium hover:text-stone-700 focus:ring-0 shadow-none data-[placeholder]:text-stone-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string" className="text-xs">text</SelectItem>
                  <SelectItem value="number" className="text-xs">num</SelectItem>
                  <SelectItem value="boolean" className="text-xs">bool</SelectItem>
                </SelectContent>
              </Select>

              <div className="h-4 w-px bg-stone-100 shrink-0" />

              {/* Value Input */}
              {param.type === "boolean" ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = param.value === "" ? "true" : param.value === "true" ? "false" : ""
                    updateParam(idx, { value: next })
                  }}
                  className={`h-5 w-6 flex items-center justify-center rounded border text-[10px] font-mono ${param.value === "true"
                    ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                    : param.value === "false"
                      ? "border-rose-300 text-rose-700 bg-rose-50"
                      : "border-stone-200 text-stone-400 bg-white hover:bg-stone-50"
                    }`}
                  title={param.value === "" ? "Unset" : param.value === "true" ? "True" : "False"}
                  aria-pressed={param.value !== ""}
                >
                  {param.value === "true" && <Check className="h-3 w-3" />}
                  {param.value === "false" && <X className="h-3 w-3" />}
                </button>
              ) : (
                <input
                  className="flex-1 bg-transparent border-none text-xs focus:ring-0 p-0 text-stone-800 placeholder:text-stone-300 min-w-0 outline-none font-mono"
                  value={param.value}
                  onChange={(e) => updateParam(idx, { value: e.target.value })}
                  placeholder="Value..."
                />
              )}

              {/* Label Hint (if distinct from value) */}
              {paramLabels[idx] && (
                <span className="text-[9px] text-stone-400 truncate max-w-[60px] select-none" title={paramLabels[idx]}>
                  {paramLabels[idx]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
