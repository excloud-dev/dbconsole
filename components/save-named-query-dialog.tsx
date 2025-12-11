"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Bookmark } from "lucide-react"
import type { NamedQuery, NamedQueryParameter } from "./named-query-editor"

interface SaveNamedQueryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onSave: (namedQuery: Omit<NamedQuery, "id">) => void
}

export function SaveNamedQueryDialog({ open, onOpenChange, query, onSave }: SaveNamedQueryDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [parameters, setParameters] = useState<NamedQueryParameter[]>([])

  // Parse parameters from query (looks for :paramName pattern)
  const detectedParams = query.match(/:(\w+)/g)?.map((p) => p.slice(1)) || []
  const uniqueDetectedParams = [...new Set(detectedParams)]

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
    // Reset form
    setName("")
    setDescription("")
    setParameters([])
    onOpenChange(false)
  }

  // Auto-populate parameters from detected ones
  const autoPopulateParams = () => {
    const newParams = uniqueDetectedParams.map((p) => ({
      name: p,
      type: "string" as const,
    }))
    setParameters(newParams)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-accent-foreground" />
            Save as Named Query
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

          <div className="space-y-2">
            <Label>Query Preview</Label>
            <pre className="p-3 rounded-md bg-stone-50 border border-stone-200 text-xs font-mono text-stone-700 whitespace-pre-wrap max-h-32 overflow-auto">
              {query}
            </pre>
            {uniqueDetectedParams.length > 0 && (
              <p className="text-xs text-stone-500 mt-2">
                Detected parameters: {uniqueDetectedParams.map((p) => <code key={p} className="bg-stone-100 px-1 py-0.5 rounded text-stone-700 mx-0.5">:{p}</code>)}
                <button onClick={autoPopulateParams} className="ml-2 text-xs font-medium text-stone-600 hover:text-stone-800 bg-stone-100 hover:bg-stone-200 px-2 py-0.5 rounded transition-colors">
                  Auto-add all
                </button>
              </p>
            )}
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
                No parameters defined. Add parameters to allow dynamic values.
              </p>
            ) : (
              <div className="space-y-2">
                {parameters.map((param, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={param.name}
                      onChange={(e) => updateParameter(index, { name: e.target.value })}
                      placeholder="Parameter name"
                      className="h-8 text-sm border-stone-200 flex-1"
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
            Save Query
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
