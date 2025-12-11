"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Play, BookmarkPlus } from "lucide-react"
import { SqlEditor } from "@/components/sql-editor"

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
}

export function QueryEditor({ query, onChange, onRun, onSaveAsNamed, isNamedQuery, schema, params = [], onParamsChange, paramLabels = [] }: QueryEditorProps) {
  const updateParam = (index: number, updates: Partial<{ type: "string" | "number" | "boolean"; value: string }>) => {
    if (!onParamsChange) return
    const next = params.map((p, i) => (i === index ? { ...p, ...updates } : p))
    onParamsChange(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">SQL Query</span>
        <div className="flex items-center gap-2">
          {!isNamedQuery && query.trim() && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-stone-600 border-stone-200 hover:bg-accent/20 hover:text-accent-foreground hover:border-accent bg-transparent"
              onClick={onSaveAsNamed}
            >
              <BookmarkPlus className="h-3 w-3" />
              Save as Named
            </Button>
          )}
          <Button size="sm" className="h-7 gap-1.5 bg-stone-800 hover:bg-stone-900 text-white" onClick={onRun}>
            <Play className="h-3 w-3" />
            Run
          </Button>
        </div>
      </div>
      <SqlEditor
        value={query}
        onChange={onChange}
        onExecute={onRun}
        schema={schema}
      />

      {!isNamedQuery && onParamsChange && params.length > 0 && (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600">Parameters (positional $1, $2 …)</span>
          </div>
          {params.map((param, idx) => (
            <div key={idx} className="grid grid-cols-6 gap-2 items-center">
              <div className="col-span-1 flex flex-col">
                <span className="text-xs text-stone-500">#{idx + 1}</span>
                {paramLabels[idx] && (
                  <span className="text-[10px] text-stone-400 truncate" title={paramLabels[idx]}>
                    {paramLabels[idx]}
                  </span>
                )}
              </div>
              <select
                className="col-span-2 h-8 rounded border border-stone-200 text-sm bg-white px-2"
                value={param.type}
                onChange={(e) => updateParam(idx, { type: e.target.value as any })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <Input
                className="col-span-3 h-8"
                value={param.value}
                onChange={(e) => updateParam(idx, { value: e.target.value })}
                placeholder={`Value for $${idx + 1}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
