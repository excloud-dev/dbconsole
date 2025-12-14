"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Play, ChevronDown, ChevronUp, FileCode, Copy, Check, Expand } from "lucide-react"
import { SqlEditor } from "@/components/sql-editor"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

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
  onEdit: () => void
  paramsExpanded?: boolean
  onParamsExpandChange?: (expanded: boolean) => void
}

export function NamedQueryEditor({ namedQuery, onExecute, onEdit, paramsExpanded = true, onParamsExpandChange }: NamedQueryEditorProps) {
  const defaultParamValues = useMemo(() => {
    const defaults: Record<string, string> = {}
    namedQuery.parameters.forEach((p) => {
      defaults[p.name] = p.defaultValue || ""
    })
    return defaults
  }, [namedQuery])

  const [paramValues, setParamValues] = useState<{ [key: string]: string }>(defaultParamValues)
  const [queryView, setQueryView] = useState<"template" | "rendered">("template")
  const [showQueryModal, setShowQueryModal] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = () => {
    const textToCopy = queryView === "template" ? namedQuery.query : renderPreview(namedQuery.query, paramValues)
    navigator.clipboard.writeText(textToCopy)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleExecute = () => {
    onExecute(namedQuery, { ...paramValues })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleExecute()
    }
  }
  return (
    <div className="flex flex-col h-full bg-white relative group/editor">
      {/* Editor Area (Read-only/Visual) - scrollable */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <div>
              <h3 className="text-lg font-semibold text-stone-900 leading-none tracking-tight">{namedQuery.name}</h3>
              {namedQuery.description && <p className="text-sm text-stone-500 mt-1 leading-snug">{namedQuery.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-xs text-stone-400 hover:text-stone-700" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-stone-400 hover:text-stone-700 gap-1" onClick={() => setShowQueryModal(true)}>
              <FileCode className="h-3 w-3" />
              View SQL
            </Button>
            <Button
              size="sm"
              className="h-6 gap-1 bg-stone-800 hover:bg-stone-900 text-white text-xs"
              onClick={handleExecute}
            >
              <Play className="h-3 w-3" />
              Run
            </Button>
          </div>
        </div>
      </div>
      {/* Parameters Footer - collapsible when >6 params (2 rows with 3 columns) */}
      {namedQuery.parameters.length > 0 && (
        <div className="shrink-0 border-t border-stone-200 bg-stone-50/50 z-10 relative">
          {/* Header - only show expand/collapse toggle when >6 params */}
          {namedQuery.parameters.length > 6 ? (
            <button
              onClick={() => onParamsExpandChange?.(!paramsExpanded)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 transition-colors"
            >
              <span>Parameters ({namedQuery.parameters.length})</span>
              <span className="flex items-center gap-1">
                {paramsExpanded ? (
                  <><ChevronUp className="h-3 w-3" /> Collapse</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Expand</>
                )}
              </span>
            </button>
          ) : (
            <div className="px-3 py-1.5 text-xs font-medium text-stone-500">
              Parameters ({namedQuery.parameters.length})
            </div>
          )}
          {/* Parameters grid - only apply max-height when >6 params and collapsed */}
          <div
            className={cn(
              "px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 transition-all duration-200",
              namedQuery.parameters.length > 6 && !paramsExpanded && "max-h-[95px] overflow-y-auto"
            )}
          >
            {namedQuery.parameters.map((param, index) => (
              <div key={index} className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-md px-2 py-1.5 shadow-sm group hover:border-stone-300 transition-colors">
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
        </div>
      )
      }

      <Dialog open={showQueryModal} onOpenChange={setShowQueryModal}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-stone-100 flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base font-medium">
                <Expand className="h-4 w-4 text-stone-500" />
                {namedQuery.name}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-stone-50 relative group/view-sql">
            {queryView === "template" ? (
              <SqlEditor
                value={namedQuery.query}
                onChange={() => { }}
                readOnly={true}
                className="h-full"
              />
            ) : (
              <SqlEditor
                value={renderPreview(namedQuery.query, paramValues)}
                onChange={() => { }}
                readOnly={true}
                className="h-full"
              />
            )}
            <div className="absolute bottom-4 right-6 opacity-0 group-hover/view-sql:opacity-100 transition-opacity duration-200">
              <ToggleGroup
                type="single"
                value={queryView}
                onValueChange={(v) => v && setQueryView(v as "template" | "rendered")}
                className="bg-white/90 backdrop-blur-sm border border-stone-200 rounded-md p-0.5 shadow-sm"
              >
                <ToggleGroupItem value="template" className="text-xs px-2 h-6 data-[state=on]:bg-stone-100 data-[state=on]:text-stone-900 data-[state=on]:shadow-none">Template</ToggleGroupItem>
                <ToggleGroupItem value="rendered" className="text-xs px-2 h-6 data-[state=on]:bg-stone-100 data-[state=on]:text-stone-900 data-[state=on]:shadow-none">Rendered</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="p-3 border-t border-stone-100 flex justify-end bg-stone-50/50 rounded-b-lg">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className={`h-7 text-xs gap-1.5 transition-all duration-300 border ${isCopied
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : "bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100 border-emerald-100 hover:border-emerald-200"
                }`}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {isCopied ? "Copied!" : "Copy SQL"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div >
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
