"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Bookmark } from "lucide-react"
import type { NamedQuery, NamedQueryParameter } from "./named-query-editor"
import { Textarea } from "@/components/ui/textarea"
import { SqlEditor } from "./sql-editor"

interface SaveNamedQueryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onSave: (namedQuery: Omit<NamedQuery, "id">) => void
  mode?: "create" | "edit"
  initialValues?: {
    name: string
    description?: string
    parameters: NamedQueryParameter[]
  }
}

export function SaveNamedQueryDialog({ open, onOpenChange, query: initialQuery, onSave, mode = "create", initialValues }: SaveNamedQueryDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [query, setQuery] = useState("")
  const [parameters, setParameters] = useState<NamedQueryParameter[]>([])

  // Reset/Initialize state when dialog opens or props change
  useEffect(() => {
    if (open) {
      if (mode === "edit" && initialValues) {
        setName(initialValues.name)
        setDescription(initialValues.description || "")
        setParameters(initialValues.parameters)
        setQuery(initialQuery) // In edit mode, initialQuery is the existing query
      } else {
        // Create mode
        setName("")
        setDescription("")
        setParameters([]) // We'll detect params from query
        setQuery(initialQuery)

        // Auto-detect params for convenience in create mode
        const detectedParams = initialQuery.match(/:(\w+)/g)?.map((p) => p.slice(1)) || []
        const uniqueParams = [...new Set(detectedParams)]
        if (uniqueParams.length > 0) {
          setParameters(uniqueParams.map(p => ({ name: p, type: "string" })))
        }
      }
    }
  }, [open, mode, initialValues, initialQuery])


  const addParameter = () => {
    setParameters([...parameters, { name: "", type: "string" }])
  }

  const updateParameter = (index: number, updates: Partial<NamedQueryParameter>) => {
    setParameters(parameters.map((p, i) => (i === index ? { ...p, ...updates } : p)))
  }

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      query,
      parameters,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-accent-foreground" />
            {mode === "edit" ? "Edit Named Query" : "Save as Named Query"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Get User Orders"
              className="border-stone-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Fetches all orders for a specific user"
              className="border-stone-200"
            />
          </div>

          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <Label>SQL Query</Label>
            <div className="flex-1 border border-stone-200 rounded-md overflow-hidden min-h-[150px]">
              <SqlEditor
                value={query}
                onChange={setQuery}
                className="h-full"
              />
            </div>
            <p className="text-[10px] text-stone-500">
              Use <code>:paramName</code> for named parameters.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Parameters</Label>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addParameter}>
                <Plus className="h-3 w-3 mr-1" />
                Add Parameter
              </Button>
            </div>

            {parameters.length === 0 ? (
              <p className="text-xs text-stone-500 italic">
                No parameters defined.
              </p>
            ) : (
              <div className="space-y-2">
                {parameters.map((param, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={param.name}
                      onChange={(e) => updateParameter(index, { name: e.target.value })}
                      placeholder="Parameter name"
                      className="h-8 text-sm border-stone-200 flex-1 font-mono"
                    />
                    <Select
                      value={param.type}
                      onValueChange={(v) => updateParameter(index, { type: v as NamedQueryParameter["type"] })}
                    >
                      <SelectTrigger className="h-8 w-24 text-sm border-stone-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                        <SelectItem value="boolean">boolean</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={param.defaultValue || ""}
                      onChange={(e) => updateParameter(index, { defaultValue: e.target.value })}
                      placeholder="Default"
                      className="h-8 text-sm border-stone-200 w-24"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-stone-400 hover:text-red-500"
                      onClick={() => removeParameter(index)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim()}
            className="bg-stone-800 hover:bg-stone-900 text-white"
          >
            {mode === "edit" ? "Update Query" : "Save Query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
