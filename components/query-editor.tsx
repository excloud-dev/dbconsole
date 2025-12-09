"use client"

import { Button } from "@/components/ui/button"
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
}

export function QueryEditor({ query, onChange, onRun, onSaveAsNamed, isNamedQuery, schema }: QueryEditorProps) {
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
    </div>
  )
}

