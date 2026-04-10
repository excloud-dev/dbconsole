"use client"

import { useState } from "react"
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
  const [name, setName] = useState(() => (mode === "edit" && initialValues ? initialValues.name : ""))
  const [description, setDescription] = useState(() => (mode === "edit" && initialValues ? initialValues.description || "" : ""))
  const [query, setQuery] = useState(() => initialQuery)
  const [parameters, setParameters] = useState<NamedQueryParameter[]>(() => {
    if (mode === "edit" && initialValues) return initialValues.parameters

    const detectedParams = initialQuery.match(/:(\w+)/g)?.map((p) => p.slice(1)) || []
    const uniqueParams = [...new Set(detectedParams)]
    return uniqueParams.map((p) => ({ name: p, type: "string" }))
  })


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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-accent-foreground" />
            {mode === "edit" ? "Edit Named Query" : "Save as Named Query"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 px-4 py-4 min-h-0">
          <div className="flex-none space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Get User Orders"
                className="border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Fetches all orders for a specific user"
                className="border-border"
              />
            </div>

            <div className="space-y-2">
              <Label>SQL Query</Label>
              <div className="border border-border rounded-md overflow-hidden h-[180px]">
                <SqlEditor
                  value={query}
                  onChange={setQuery}
                  className="h-full"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code>:paramName</code> for named parameters.
              </p>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 gap-2">
            <div className="flex items-center justify-between flex-shrink-0">
              <Label>Parameters</Label>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addParameter}>
                <Plus className="h-3 w-3 mr-1" />
                Add Parameter
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 pr-2 -mr-2">
              {parameters.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No parameters defined.
                </p>
              ) : (
                <div className="space-y-2 pb-2">
                  {parameters.map((param, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={param.name}
                        onChange={(e) => updateParameter(index, { name: e.target.value })}
                        placeholder="Parameter name"
                        className="h-8 text-sm border-border flex-1 font-mono"
                      />
                      <Select
                        value={param.type}
                        onValueChange={(v) => updateParameter(index, { type: v as NamedQueryParameter["type"] })}
                      >
                        <SelectTrigger className="h-8 w-24 text-sm border-border">
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
                        className="h-8 text-sm border-border w-24"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
        </div>

        <DialogFooter className="p-4 border-t border-border bg-secondary/50 flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {mode === "edit" ? "Update Query" : "Save Query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
