"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Play, ChevronDown, ChevronUp, FileCode, Copy, Check, Expand, ClipboardCopy, X } from "lucide-react"
import { SqlEditor } from "@/components/sql-editor"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useCommand } from "@/components/shortcuts/useCommand"
import { cleanupTrivialPredicates } from "@/lib/sql/named-query-params"

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

export type NamedQueryParamMeta = {
  dataType?: string
  isNullable?: boolean
  isAuto?: boolean
  isPk?: boolean
  role?: "set" | "where"
  overrideAuto?: boolean
  isNull?: boolean
}

interface NamedQueryEditorProps {
  namedQuery: NamedQuery
  onExecute: (query: NamedQuery, params: Record<string, string>) => void
  onEdit: () => void
  paramsExpanded?: boolean
  onParamsExpandChange?: (expanded: boolean) => void
  mode?: "named" | "generator"
  paramValues?: Record<string, string>
  onParamValuesChange?: (next: Record<string, string>) => void
  paramMeta?: Record<string, NamedQueryParamMeta>
  onParamMetaChange?: (name: string, updates: Partial<NamedQueryParamMeta>) => void
  onSaveGenerator?: () => void
  generatedSql?: string
  onCopyGeneratedSql?: () => void
}

export function NamedQueryEditor({
  namedQuery,
  onExecute,
  onEdit,
  paramsExpanded = true,
  onParamsExpandChange,
  mode = "named",
  paramValues: controlledParamValues,
  onParamValuesChange,
  paramMeta,
  onParamMetaChange,
  onSaveGenerator,
  generatedSql,
  onCopyGeneratedSql,
}: NamedQueryEditorProps) {
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

  const valuesKey = useMemo(
    () => (controlledParamValues ? "" : JSON.stringify(defaultParamValues)),
    [controlledParamValues, defaultParamValues],
  )

  const effectiveParamValues = controlledParamValues ?? paramValues
  const updateParamValues = (next: Record<string, string>) => {
    if (onParamValuesChange) {
      onParamValuesChange(next)
    } else {
      setParamValues(next)
    }
  }

  const handleCopy = () => {
    const textToCopy = queryView === "template" ? namedQuery.query : renderPreview(namedQuery.query, effectiveParamValues)
    navigator.clipboard.writeText(textToCopy)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleExecute = () => {
    onExecute(namedQuery, { ...effectiveParamValues })
  }

  useCommand("query.run", () => handleExecute())
  return (
    <div key={valuesKey} className="flex flex-col h-full bg-card relative group/editor">
      {/* Editor Area (Read-only/Visual) - scrollable */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <div>
              <h3 className="text-lg font-semibold text-foreground leading-none tracking-tight">{namedQuery.name}</h3>
              {namedQuery.description && <p className="text-sm text-muted-foreground mt-1 leading-snug">{namedQuery.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "named" ? (
              <>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground" onClick={onEdit}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground gap-1" onClick={() => setShowQueryModal(true)}>
                  <FileCode className="h-3 w-3" />
                  View SQL
                </Button>
              </>
            ) : (
              <>
                {onSaveGenerator && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground" onClick={onSaveGenerator}>
                    Save
                  </Button>
                )}
                {generatedSql && onCopyGeneratedSql && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground gap-1" onClick={onCopyGeneratedSql}>
                    <ClipboardCopy className="h-3 w-3" />
                    Copy SQL
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              className="h-6 gap-1 text-xs"
              data-named-query-run="1"
              onClick={handleExecute}
            >
              <Play className="h-3 w-3" />
              {mode === "generator" ? "Generate" : "Run"}
            </Button>
          </div>
        </div>
      </div>
      {/* Parameters Footer - collapsible when >6 params (2 rows with 3 columns) */}
      {namedQuery.parameters.length > 0 && (
        <div className="shrink-0 border-t border-border bg-secondary/50 z-10 relative">
          {/* Header - only show expand/collapse toggle when >6 params */}
          {namedQuery.parameters.length > 6 ? (
            <button
              onClick={() => onParamsExpandChange?.(!paramsExpanded)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
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
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
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
            {namedQuery.parameters.map((param, index) => {
              const meta = paramMeta?.[param.name]
              const isAuto = meta?.isAuto
              const isNullable = meta?.isNullable
              const isPk = meta?.isPk
              const overrideAuto = meta?.overrideAuto
              const isNull = meta?.isNull
              const role = meta?.role
              const inputDisabled = Boolean(isNull || (isAuto && !overrideAuto && mode === "generator" && role !== "where"))
              const nullDisabled = Boolean(isAuto && !overrideAuto && mode === "generator" && role !== "where")
              const boolValue = param.type === "boolean" ? effectiveParamValues[param.name] : undefined
              const boolState = boolValue === "true" ? "true" : boolValue === "false" ? "false" : "none"

              return (
                <div key={index} className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1.5 shadow-sm group hover:border-border/80 transition-colors">
                  {/* Parameter Name Chip */}
                  <div className="flex items-center justify-center h-5 px-2 rounded bg-secondary text-xs font-mono font-medium text-muted-foreground border border-border shrink-0" title={param.name}>
                    {param.name}
                  </div>

                  {/* Type Indicator (Subtle) */}
                  <div className="h-4 w-px bg-border shrink-0" />

                  {mode === "generator" && role && (
                    <ToggleGroup
                      type="single"
                      value={role}
                      onValueChange={(v) => v && onParamMetaChange?.(param.name, { role: v as "set" | "where" })}
                      className="bg-secondary border border-border rounded-md p-0.5 h-5"
                    >
                      <ToggleGroupItem value="set" tabIndex={-1} className="text-xs px-1.5 h-4 data-[state=on]:bg-muted data-[state=on]:text-foreground">SET</ToggleGroupItem>
                      <ToggleGroupItem value="where" tabIndex={-1} className="text-xs px-1.5 h-4 data-[state=on]:bg-muted data-[state=on]:text-foreground">WHERE</ToggleGroupItem>
                    </ToggleGroup>
                  )}

                  {/* Value Input */}
                  {param.type === "boolean" ? (
                    <button
                      type="button"
                      disabled={inputDisabled}
                      data-named-query-param={index === 0 ? "1" : undefined}
                      onClick={() => {
                        if (inputDisabled) return
                        const next =
                          boolState === "none" ? "true" : boolState === "true" ? "false" : ""
                        updateParamValues({ ...effectiveParamValues, [param.name]: next })
                      }}
                      className={`h-5 w-6 flex items-center justify-center rounded border text-xs font-mono ${inputDisabled
                        ? "border-border text-muted-foreground/50 bg-secondary cursor-not-allowed"
                        : boolState === "true"
                          ? "border-success/40 text-success bg-success/10"
                          : boolState === "false"
                            ? "border-destructive/40 text-destructive bg-destructive/10"
                            : "border-border text-muted-foreground bg-card hover:bg-secondary"
                        }`}
                      title={boolState === "none" ? "Unset" : boolState === "true" ? "True" : "False"}
                      aria-pressed={boolState !== "none"}
                    >
                      {boolState === "true" && <Check className="h-3 w-3" />}
                      {boolState === "false" && <X className="h-3 w-3" />}
                    </button>
                  ) : (
                    <Input
                      id={param.name}
                      type={param.type === "number" ? "number" : "text"}
                      data-named-query-param={index === 0 ? "1" : undefined}
                      value={effectiveParamValues[param.name] || ""}
                      onChange={(e) => updateParamValues({ ...effectiveParamValues, [param.name]: e.target.value })}
                      placeholder={inputDisabled ? (isAuto ? "auto" : "disabled") : param.type}
                      disabled={inputDisabled}
                      className="flex-1 h-5 bg-transparent border-none text-xs focus-visible:ring-0 p-0 text-foreground placeholder:text-muted-foreground/50 min-w-0 font-mono shadow-none"
                    />
                  )}

                  {mode === "generator" && (
                    <div className="flex items-center gap-1 pl-1">
                      {isPk && (
                        <span className="text-xs uppercase text-warning bg-warning/10 border border-warning/30 rounded px-1 py-0.5">
                          PK
                        </span>
                      )}
                      {isAuto && role !== "where" && (
                        <button
                          className={`text-xs uppercase rounded px-1 py-0.5 border ${overrideAuto ? "bg-success/10 text-success border-success/30" : "bg-secondary text-muted-foreground border-border"}`}
                          onClick={() => onParamMetaChange?.(param.name, { overrideAuto: !overrideAuto })}
                          type="button"
                          tabIndex={-1}
                          title={overrideAuto ? "Override auto-generated column" : "Auto-generated column"}
                        >
                          {overrideAuto ? "Override" : "Auto"}
                        </button>
                      )}
                    <button
                      className={`text-xs uppercase rounded px-1 py-0.5 border ${isNull ? "bg-info/10 text-info border-info/30" : "bg-secondary text-muted-foreground border-border"} ${nullDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                      onClick={() => {
                        if (nullDisabled) return
                        onParamMetaChange?.(param.name, { isNull: !isNull })
                      }}
                      type="button"
                      title="Insert/compare NULL"
                      disabled={nullDisabled}
                      tabIndex={-1}
                    >
                      NULL
                    </button>
                      {isNullable === false && (
                        <span className="text-xs text-destructive">NOT NULL</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )
      }

      <Dialog open={showQueryModal} onOpenChange={setShowQueryModal}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base font-medium">
                <Expand className="h-4 w-4 text-muted-foreground" />
                {namedQuery.name}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-secondary relative group/view-sql">
            {queryView === "template" ? (
              <SqlEditor
                value={namedQuery.query}
                onChange={() => { }}
                readOnly={true}
                className="h-full"
              />
            ) : (
              <SqlEditor
                value={renderPreview(namedQuery.query, effectiveParamValues)}
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
                className="bg-card/90 backdrop-blur-sm border border-border rounded-md p-0.5 shadow-sm"
              >
                <ToggleGroupItem value="template" className="text-xs px-2 h-6 data-[state=on]:bg-secondary data-[state=on]:text-foreground data-[state=on]:shadow-none">Template</ToggleGroupItem>
                <ToggleGroupItem value="rendered" className="text-xs px-2 h-6 data-[state=on]:bg-secondary data-[state=on]:text-foreground data-[state=on]:shadow-none">Rendered</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="p-3 border-t border-border flex justify-end bg-secondary/50 rounded-b-lg">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className={`h-7 text-xs gap-1.5 transition-all duration-300 border ${isCopied
                ? "bg-success/15 text-success border-success/30"
                : "bg-success/5 text-success hover:bg-success/15 border-success/20 hover:border-success/30"
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

  sql = cleanupTrivialPredicates(sql)

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
