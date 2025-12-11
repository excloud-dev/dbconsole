"use client"

import { useState, useEffect, useMemo, useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Play, Bookmark, Code2, ChevronDown, ChevronUp } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export interface NamedQueryParameter {
  name: string
  type: "string" | "number" | "boolean"
  defaultValue?: string
}

export interface NamedQuery {
  id: string
  name: string
  description?: string
  query: string
  parameters: NamedQueryParameter[]
}

interface NamedQueryEditorProps {
  namedQuery: NamedQuery
  onExecute: (query: NamedQuery, params: Record<string, string>) => void
  onLineCountChange?: (lines: number) => void
}

export function NamedQueryEditor({ namedQuery, onExecute, onLineCountChange }: NamedQueryEditorProps) {
  const defaultParamValues = useMemo(() => {
    const defaults: Record<string, string> = {}
    namedQuery.parameters.forEach((p) => {
      defaults[p.name] = p.defaultValue || ""
    })
    return defaults
  }, [namedQuery])

  const [paramValues, setParamValues] = useState<{ [key: string]: string }>(defaultParamValues)
  const [showQuery, setShowQuery] = useState(false)
  const [queryView, setQueryView] = useState<"template" | "rendered">("template")
  const [containerMinHeight, setContainerMinHeight] = useState<number>(160)
  const preRef = useRef<HTMLElement | null>(null)

  // Reset params when the named query changes
  useEffect(() => {
    setParamValues(defaultParamValues)
  }, [defaultParamValues])

  const handleExecute = () => {
    onExecute(namedQuery, { ...paramValues })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleExecute()
    }
  }

  const toggleQuery = () => {
    const nextState = !showQuery
    setShowQuery(nextState)
  }

  // Measure once when query is shown or content changes; no observers to avoid loops.
  useLayoutEffect(() => {
    if (!showQuery) return
    const el = preRef.current
    if (!el) return

    const measure = () => {
      // Simple measured height with small buffer
      const rectHeight = el.scrollHeight
      const needed = Math.max(rectHeight + 24, 200)
      setContainerMinHeight(needed)
    }

    // Next frame to ensure layout is ready
    requestAnimationFrame(measure)
  }, [showQuery, queryView, namedQuery.query, paramValues])

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden relative group/editor">
      <div className="flex-1 min-h-[100px] relative flex flex-col">
        {/* Editor Area (Read-only/Visual) */}
        <div
      className="flex-1 overflow-hidden p-4 transition-[min-height] duration-200 ease-out"
      style={{
        minHeight: showQuery ? containerMinHeight : 160,
      }}
    >
          <div className="flex items-center gap-2 mb-4">
            <Bookmark className="h-5 w-5 text-accent-foreground fill-accent" />
            <div>
              <h3 className="text-lg font-semibold text-stone-900 leading-none tracking-tight">{namedQuery.name}</h3>
              {namedQuery.description && <p className="text-sm text-stone-500 mt-1 leading-snug">{namedQuery.description}</p>}
            </div>
          </div>

          {/* Collapsible query preview */}
          <div className="space-y-2">
            <button
              onClick={toggleQuery}
              className="flex items-center gap-2 text-xs font-medium text-stone-500 hover:text-stone-800 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                <span>{showQuery ? "Hide Query" : "Show Query"}</span>
              </div>
              {showQuery ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {showQuery && (
              <div className="relative group/preview">
                <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/preview:opacity-100 transition-opacity">
                  <ToggleGroup
                    type="single"
                    value={queryView}
                    onValueChange={(v) => v && setQueryView(v as "template" | "rendered")}
                    className="h-6 bg-white/90 backdrop-blur border border-stone-200 shadow-sm rounded-md p-0.5"
                  >
                    <ToggleGroupItem value="template" className="text-[10px] px-2 h-5">Template</ToggleGroupItem>
                    <ToggleGroupItem value="rendered" className="text-[10px] px-2 h-5">Rendered</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <pre
                  className="text-xs font-mono text-stone-700 whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded-md p-3 max-h-60 overflow-auto"
                  ref={preRef as any}
                >
                  {queryView === "template" ? namedQuery.query : renderPreview(namedQuery.query, paramValues)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Floating Run Button */}
        <div className="absolute bottom-4 right-4 z-20">
          <Button
            size="sm"
            className="h-7 gap-1.5 bg-stone-800 hover:bg-stone-900 text-white shadow-md transition-transform active:scale-95"
            onClick={handleExecute}
          >
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
        </div>
      </div>

      {/* Parameters Footer */}
      {namedQuery.parameters.length > 0 && (
        <div className="border-t border-stone-200 bg-stone-50/50 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto max-h-[160px] z-10 relative">
          {namedQuery.parameters.map((param) => (
            <div key={param.name} className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-md px-2 py-1.5 shadow-sm group hover:border-stone-300 transition-colors">
              {/* Parameter Name Chip */}
              <div className="flex items-center justify-center h-5 px-2 rounded bg-stone-100 text-[10px] font-mono font-medium text-stone-500 border border-stone-200 shrink-0" title={param.name}>
                {param.name}
              </div>

              {/* Type Indicator (Subtle) */}
              <div className="h-4 w-px bg-stone-100 shrink-0" />

              {/* Value Input */}
              <Input
                id={param.name}
                type={param.type === "number" ? "number" : "text"}
                value={paramValues[param.name] || ""}
                onChange={(e) => setParamValues({ ...paramValues, [param.name]: e.target.value })}
                placeholder={param.type}
                className="flex-1 h-5 bg-transparent border-none text-xs focus-visible:ring-0 p-0 text-stone-800 placeholder:text-stone-300 min-w-0 font-mono shadow-none"
                onKeyDown={handleKeyDown}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")

// Local preview renderer mirrors server behavior for optional params and literal substitution.
function renderPreview(template: string, params: Record<string, string>): string {
  let sql = template
  for (const [name, val] of Object.entries(params)) {
    if (val === undefined || val === null || val.trim() === "") {
      const escaped = escapeRegex(name)
      const patterns = [
        new RegExp(`([\\w."\\\`]+)\\s*=\\s*:${escaped}(::[\\w]+)?`, "gi"),
        new RegExp(`:${escaped}\\s*=\\s*([\\w."\\\`]+)`, "gi"),
        new RegExp(`([\\w."\\\`]+)\\s+(?:ILIKE|LIKE)\\s*:${escaped}`, "gi"),
        new RegExp(`([\\w."\\\`]+)\\s+IN\\s*\\(\\s*:${escaped}\\s*\\)`, "gi"),
      ]
      for (const pat of patterns) {
        sql = sql.replace(pat, "1=1")
      }
    }
  }

  const placeholderRegex = /(^|[^0-9A-Za-z_]):([a-zA-Z_][a-zA-Z0-9_]*)/g
  return sql.replace(placeholderRegex, (_m, prefix, key) => `${prefix}${toSqlLiteral(params[key] ?? null)}`)
}

function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return "NULL"
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}
