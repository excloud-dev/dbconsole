"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Database, Plus, Trash2, TestTube, Check, X } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { ClientConnectionMeta } from "@/lib/connections"
import { useToast } from "@/hooks/use-toast"

type PoolMode = "single" | "shared" | "per-scope"

export interface ConnectionDraft {
  id?: string
  label: string
  host: string
  port: string
  database: string
  username: string
  password: string
  readOnly: boolean
  from: "env" | "ui"
}

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: ClientConnectionMeta[]
  activeConnection: string | null
  onConnectionsChange: (connections: ClientConnectionMeta[]) => void
  onConnect: (id: string) => void
  poolMode: PoolMode
  onPoolModeChange: (mode: PoolMode) => void
}

export function ConnectionDialog({
  open,
  onOpenChange,
  connections,
  activeConnection,
  onConnectionsChange,
  onConnect,
  poolMode,
  onPoolModeChange,
}: ConnectionDialogProps) {
  const { toast } = useToast()
  const [editingConnection, setEditingConnection] = useState<ConnectionDraft | null>(null)
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle")

  const createNewConnection = (): ConnectionDraft => ({
    label: "New Connection",
    host: "localhost",
    port: "5432",
    database: "",
    username: "",
    password: "",
    readOnly: true,
    from: "ui",
  })

  const handleAddConnection = () => {
    const newConn = createNewConnection()
    setEditingConnection(newConn)
  }

  const handleDeleteConnection = async (id?: string) => {
    if (!id) return
    if (editingConnection?.from === "env") {
      toast({
        variant: "destructive",
        title: "Env connections are read-only",
        description: "You can only delete connections created in the UI.",
      })
      return
    }
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Failed to delete connection")
      }
      onConnectionsChange(connections.filter((c) => c.id !== id))
      if (editingConnection?.id === id) {
        setEditingConnection(null)
      }
      toast({ title: "Connection deleted" })
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e?.message || "Could not delete connection",
      })
    }
  }

  const handleUpdateConnection = (updates: Partial<ConnectionDraft>) => {
    if (!editingConnection) return
    const updated = { ...editingConnection, ...updates }
    setEditingConnection(updated)
  }

  const handleTestConnection = async () => {
    try {
      if (!editingConnection) return
      setTestStatus("testing")
      const res = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editingConnection.label,
          host: editingConnection.host,
          port: editingConnection.port,
          database: editingConnection.database,
          username: editingConnection.username,
          password: editingConnection.password,
          readOnly: editingConnection.readOnly,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }

      if (body.ok) {
        setTestStatus("success")
        toast({
          title: "Connection successful",
          description: "We connected to your database successfully.",
        })
      } else {
        setTestStatus("error")
        toast({
          variant: "destructive",
          title: "Connection failed",
          description: body.error || "Could not connect to the database with the provided settings.",
        })
      }
    } catch (e: any) {
      setTestStatus("error")
      toast({
        variant: "destructive",
        title: "Connection test error",
        description: e?.message || "Something went wrong while testing the connection.",
      })
    } finally {
      setTimeout(() => setTestStatus("idle"), 2000)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-2xl !w-[700px] max-h-[80vh] sm:!max-w-2xl">
        <div className="flex flex-col h-full">
          <DialogHeader className="pb-2 border-b border-stone-100">
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-stone-600" />
              Database Connections
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto py-4" style={{ maxHeight: 'calc(80vh - 10rem)' }}>
            <div className="flex gap-5 min-h-[320px]">
              {/* Connection list */}
              <div className="w-56 border-r border-stone-200 pr-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3 px-2">
                  <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Connections</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-stone-400 hover:text-stone-700" onClick={handleAddConnection}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() =>
                        setEditingConnection({
                          id: conn.id,
                          label: conn.label,
                          host: conn.host ?? "localhost",
                          port: conn.port !== undefined ? String(conn.port) : "5432",
                          database: conn.database ?? "",
                          username: conn.username ?? "",
                          password: "",
                          readOnly: conn.readOnly,
                          from: conn.from,
                        })
                      }
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors border border-transparent",
                        editingConnection?.id === conn.id
                          ? "bg-stone-100 text-stone-900 font-medium"
                          : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                      )}
                    >
                      <div className="relative flex items-center justify-center">
                        <Database
                          className={cn(
                            "h-3.5 w-3.5",
                            editingConnection?.id === conn.id ? "text-stone-700" : "text-stone-400"
                          )}
                        />
                        {activeConnection === conn.id && (
                          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-emerald-500 rounded-full ring-1 ring-white" />
                        )}
                      </div>
                      <span className="truncate flex-1">{conn.label}</span>
                    </button>
                  ))}
                  {connections.length === 0 && (
                    <p className="text-xs text-stone-400 text-center py-4 italic">No connections</p>
                  )}
                </div>
              </div>

              {/* Connection form */}
              <div className="flex-1 pl-2">
                {editingConnection ? (
                  <div className="h-full flex flex-col">
                    <div className="pb-4 mb-4 border-b border-stone-100 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-stone-800">Connection Details</h3>
                        <p className="text-xs text-stone-500">Configure connection parameters</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-stone-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                          onClick={() => handleDeleteConnection(editingConnection.id)}
                          disabled={editingConnection.from === "env"}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                      <div className="space-y-3">
                        <div className="grid gap-1.5">
                          <Label htmlFor="name" className="text-xs font-medium text-stone-600">
                            Connection Name
                          </Label>
                          <Input
                            id="name"
                            value={editingConnection.label}
                            onChange={(e) => handleUpdateConnection({ label: e.target.value })}
                            className="h-8 bg-white border-stone-200 focus:border-stone-400 focus:ring-stone-400/20"
                            placeholder="My Production DB"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="host" className="text-xs font-medium text-stone-600">
                              Host
                            </Label>
                            <Input
                              id="host"
                              value={editingConnection.host}
                              onChange={(e) => handleUpdateConnection({ host: e.target.value })}
                              className="h-8 bg-white border-stone-200"
                              placeholder="localhost"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="port" className="text-xs font-medium text-stone-600">
                              Port
                            </Label>
                            <Input
                              id="port"
                              value={editingConnection.port}
                              onChange={(e) => handleUpdateConnection({ port: e.target.value })}
                              className="h-8 bg-white border-stone-200"
                              placeholder="5432"
                            />
                          </div>
                        </div>

                        <div className="grid gap-1.5">
                          <Label htmlFor="database" className="text-xs font-medium text-stone-600">
                            Database Name
                          </Label>
                          <Input
                            id="database"
                            value={editingConnection.database}
                            onChange={(e) => handleUpdateConnection({ database: e.target.value })}
                            className="h-8 bg-white border-stone-200"
                            placeholder="postgres"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="user" className="text-xs font-medium text-stone-600">
                              Username
                            </Label>
                            <Input
                              id="user"
                              value={editingConnection.username}
                              onChange={(e) => handleUpdateConnection({ username: e.target.value })}
                              className="h-8 bg-white border-stone-200"
                              placeholder="postgres"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="password" className="text-xs font-medium text-stone-600">
                              Password
                            </Label>
                            <Input
                              id="password"
                              type="password"
                              value={editingConnection.password}
                              onChange={(e) => handleUpdateConnection({ password: e.target.value })}
                              className="h-8 bg-white border-stone-200"
                              placeholder="••••••••"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full gap-2 h-8",
                            testStatus === "success" ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 hover:border-green-300" :
                              testStatus === "error" ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : ""
                          )}
                          onClick={handleTestConnection}
                          disabled={testStatus === "testing"}
                        >
                          {testStatus === "testing" ? (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : testStatus === "success" ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : testStatus === "error" ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <TestTube className="h-3.5 w-3.5" />
                          )}
                          {testStatus === "testing"
                            ? "Testing Connection..."
                            : testStatus === "success"
                              ? "Connection Successful"
                              : testStatus === "error"
                                ? "Connection Failed"
                                : "Test Connection"}
                        </Button>
                      </div>

                      <div className="pt-3">
                        <div className="text-xs font-medium text-stone-600 mb-1">Connection usage</div>
                        <ToggleGroup
                          type="single"
                          value={poolMode}
                          onValueChange={(v) => v && onPoolModeChange(v as PoolMode)}
                          className="flex gap-1 bg-transparent p-0 border-none justify-start"
                        >
                          {[
                            { key: "single", label: "Single" },
                            { key: "shared", label: "Shared" },
                            { key: "per-scope", label: "Per Tab" },
                          ].map((opt) => (
                            <ToggleGroupItem
                              key={opt.key}
                              value={opt.key}
                              className="text-[10px] h-6 px-2 rounded-full border border-stone-200 data-[state=on]:bg-stone-800 data-[state=on]:text-white data-[state=on]:border-stone-800 hover:bg-stone-50 hover:text-stone-900 transition-colors"
                            >
                              {opt.label}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        <p className="text-[11px] text-stone-500 mt-1">
                          Single = 1 connection total; Shared = pool re-used across tabs; Per Tab = dedicated connection per tab.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-stone-400 text-sm">
                    <div className="h-10 w-10 rounded-full bg-stone-50 flex items-center justify-center mb-3">
                      <Database className="h-5 w-5 text-stone-300" />
                    </div>
                    <p className="font-medium text-stone-500">Select a connection to edit</p>
                    <Button variant="link" onClick={handleAddConnection} className="text-stone-500 hover:text-stone-800 h-auto p-0 mt-1 text-xs underline decoration-stone-300 hover:decoration-stone-500">
                      or create new
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (editingConnection) {
                  if (editingConnection.from === "env") {
                    toast({
                      variant: "destructive",
                      title: "Env connections are read-only",
                      description: "You can only edit connections created in the UI.",
                    })
                    return
                  }
                  const payload = {
                    label: editingConnection.label,
                    host: editingConnection.host,
                    port: editingConnection.port,
                    database: editingConnection.database,
                    username: editingConnection.username,
                    readOnly: editingConnection.readOnly,
                    ...(editingConnection.password ? { password: editingConnection.password } : {}),
                  }

                  const isNew = !editingConnection.id
                  const url = isNew
                    ? "/api/connections"
                    : `/api/connections/${encodeURIComponent(editingConnection.id!)}`
                  const method = isNew ? "POST" : "PUT"

                  try {
                    const res = await fetch(url, {
                      method,
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    })

                    if (!res.ok) {
                      const body = (await res.json().catch(() => ({}))) as { error?: string }
                      throw new Error(body.error || "Failed to save connection")
                    }

                    const saved = (await res.json()) as ClientConnectionMeta
                    if (isNew) {
                      onConnectionsChange([...connections, saved])
                    } else {
                      onConnectionsChange(connections.map((c) => (c.id === saved.id ? saved : c)))
                    }
                    onConnect(saved.id)
                    toast({
                      title: isNew ? "Connection saved" : "Connection updated",
                      description: `${saved.label || saved.id}`,
                    })
                  } catch (e: any) {
                    toast({
                      variant: "destructive",
                      title: "Failed to save connection",
                      description: e?.message || "Could not save the connection.",
                    })
                    return
                  }
                  onOpenChange(false)
                }
              }}
              disabled={!editingConnection}
              className="bg-stone-800 hover:bg-stone-900"
            >
              Connect
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
