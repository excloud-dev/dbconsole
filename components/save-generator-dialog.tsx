"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sparkles } from "lucide-react"

interface SaveGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: {
    name: string
    description?: string
  }
  onSave: (data: { name: string; description?: string }) => void
  mode?: "create" | "edit"
}

export function SaveGeneratorDialog({ open, onOpenChange, initialValues, onSave, mode = "create" }: SaveGeneratorDialogProps) {
  const defaults = useMemo(
    () => ({
      name: initialValues?.name ?? "",
      description: initialValues?.description ?? "",
    }),
    [initialValues?.description, initialValues?.name],
  )
  const [name, setName] = useState(defaults.name)
  const [description, setDescription] = useState(defaults.description)

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
            {mode === "edit" ? "Update Generated Query" : "Save Generated Query"}
          </DialogTitle>
        </DialogHeader>

        <div key={`${defaults.name}:${defaults.description}`} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="generator-name">Name</Label>
            <Input
              id="generator-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Insert User Row"
              className="border-stone-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="generator-description">Description (optional)</Label>
            <Input
              id="generator-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short reminder for this generator"
              className="border-stone-200"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()} className="bg-stone-800 hover:bg-stone-900 text-white">
            {mode === "edit" ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
