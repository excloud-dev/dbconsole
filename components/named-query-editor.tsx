"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Play, Bookmark, Code2, ChevronDown, ChevronUp } from "lucide-react"

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
}

export function NamedQueryEditor({ namedQuery, onExecute }: NamedQueryEditorProps) {
  const defaultParamValues = useMemo(() => {
    const defaults: Record<string, string> = {}
    namedQuery.parameters.forEach((p) => {
      defaults[p.name] = p.defaultValue || ""
    })
    return defaults
  }, [namedQuery])

  const [paramValues, setParamValues] = useState<{ [key: string]: string }>(defaultParamValues)
  const [showQuery, setShowQuery] = useState(false)

  // Reset params when the named query changes
  useEffect(() => {
    setParamValues(defaultParamValues)
  }, [defaultParamValues])

  const handleExecute = () => {
    // Process optional parameters
    // If a parameter is empty, we try to neutralize its condition
    // Strategy: Look for "col = :param" (ignoring whitespace) and replace with "1=1"
    let processedQuery = namedQuery
    const processedParams = { ...paramValues }

    namedQuery.parameters.forEach((p) => {
      const val = paramValues[p.name]
      if (!val || val.trim() === "") {
        // Parameter is empty. Try to neutralize.
        // Regex matches: word characters (column), optional space, =, optional space, :paramName
        // Case insensitive
        // Regex matches: anything that looks like "col = :param"
        // [^=]+ match column (greedy until =), \s*=\s*, :paramName
        // We use a slightly more permissive regex for the column part to catch "table.col"
        const regex = new RegExp(`[\\w.]+\\s*=\\s*:${p.name}\\b`, "gi")
        if (regex.test(processedQuery.query)) {
          console.log(`Neutralizing empty parameter: ${p.name}`)
          // Replace with 1=1 to make the condition always true (ignoring the filter)
          const newQueryString = processedQuery.query.replace(regex, "1=1")
          processedQuery = { ...processedQuery, query: newQueryString }
        }
      }
    })

    onExecute(processedQuery, processedParams)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleExecute()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with name and description */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-accent-foreground fill-accent" />
          <div>
            <h3 className="font-medium text-stone-800">{namedQuery.name}</h3>
            {namedQuery.description && <p className="text-xs text-stone-500 mt-0.5">{namedQuery.description}</p>}
          </div>
        </div>
        <Button size="sm" className="h-7 gap-1.5 bg-stone-800 hover:bg-stone-900 text-white" onClick={handleExecute}>
          <Play className="h-3 w-3" />
          Run
        </Button>
      </div>

      {/* Parameter inputs */}
      {namedQuery.parameters.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {namedQuery.parameters.map((param) => (
            <div key={param.name} className="space-y-1.5">
              <Label htmlFor={param.name} className="text-xs text-stone-600">
                {param.name}
                <span className="ml-1 text-stone-400 font-mono">({param.type})</span>
              </Label>
              <Input
                id={param.name}
                type={param.type === "number" ? "number" : "text"}
                value={paramValues[param.name] || ""}
                onChange={(e) => setParamValues({ ...paramValues, [param.name]: e.target.value })}
                placeholder={`Enter ${param.name}`}
                className="h-8 text-sm bg-white border-stone-200 focus:border-accent focus:ring-accent"
                onKeyDown={handleKeyDown}
              />
            </div>
          ))}
        </div>
      )}

      {/* Collapsible query preview */}
      <div className="rounded-md border border-stone-200 bg-stone-50 overflow-hidden">
        <button
          onClick={() => setShowQuery(!showQuery)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-stone-500 hover:bg-stone-100 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Code2 className="h-3 w-3" />
            <span>View Query Template</span>
          </div>
          {showQuery ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showQuery && (
          <div className="px-3 pb-3">
            <pre className="text-xs font-mono text-stone-600 whitespace-pre-wrap">{namedQuery.query}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
