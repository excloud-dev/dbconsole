"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Database, Plus, Trash2, TestTube, Check, X } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { ClientConnectionMeta } from "@/lib/connections"
import { useToast } from "@/hooks/use-toast"
import { apiClient, type AppInfo } from "@/lib/client/apiClient"
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog"

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
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    if (!open) return
    let canceled = false
    apiClient.app.info().then((info: AppInfo) => {
      if (canceled) return
      setAppInfo(info)
    }).catch(() => {
      if (canceled) return
      setAppInfo(null)
    })
    return () => {
      canceled = true
    }
  }, [open])

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
      await apiClient.connections.delete(id)
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
      const result = await apiClient.connections.test({
        label: editingConnection.label,
        host: editingConnection.host,
        port: editingConnection.port,
        database: editingConnection.database,
        username: editingConnection.username,
        password: editingConnection.password,
        readOnly: editingConnection.readOnly,
      })

      if (result.ok) {
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
          description: result.error || "Could not connect to the database with the provided settings.",
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
          <DialogHeader className="pb-2 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground" />
              Database Connections
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto py-4" style={{ maxHeight: 'calc(80vh - 10rem)' }}>
            <div className="flex gap-5 min-h-[320px]">
              {/* Connection list */}
              <div className="w-56 border-r border-border pr-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3 px-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground" onClick={handleAddConnection}>
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
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      )}
                    >
                      <div className="relative flex items-center justify-center">
                        <Database
                          className={cn(
                            "h-3.5 w-3.5",
                            editingConnection?.id === conn.id ? "text-foreground" : "text-muted-foreground"
                          )}
                        />
                        {activeConnection === conn.id && (
                          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-emerald-500 rounded-full ring-1 ring-background" />
                        )}
                      </div>
                      <span className="truncate flex-1">{conn.label}</span>
                    </button>
                  ))}
                  {connections.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4 italic">No connections</p>
                  )}
                </div>
              </div>

              {/* Connection form */}
              <div className="flex-1 pl-2">
                {editingConnection ? (
                  <div className="h-full flex flex-col">
                    <div className="pb-4 mb-4 border-b border-border flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Connection Details</h3>
                        <p className="text-xs text-muted-foreground">Configure connection parameters</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
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
                          <Label htmlFor="name" className="text-xs font-medium text-muted-foreground">
                            Connection Name
                          </Label>
                          <Input
                            id="name"
                            value={editingConnection.label}
                            onChange={(e) => handleUpdateConnection({ label: e.target.value })}
                            className="h-8 bg-background border-border focus:border-ring focus:ring-ring/20"
                            placeholder="My Production DB"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="host" className="text-xs font-medium text-muted-foreground">
                              Host
                            </Label>
                            <Input
                              id="host"
                              value={editingConnection.host}
                              onChange={(e) => handleUpdateConnection({ host: e.target.value })}
                              className="h-8 bg-background border-border"
                              placeholder="localhost"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="port" className="text-xs font-medium text-muted-foreground">
                              Port
                            </Label>
                            <Input
                              id="port"
                              value={editingConnection.port}
                              onChange={(e) => handleUpdateConnection({ port: e.target.value })}
                              className="h-8 bg-background border-border"
                              placeholder="5432"
                            />
                          </div>
                        </div>

                        <div className="grid gap-1.5">
                          <Label htmlFor="database" className="text-xs font-medium text-muted-foreground">
                            Database Name
                          </Label>
                          <Input
                            id="database"
                            value={editingConnection.database}
                            onChange={(e) => handleUpdateConnection({ database: e.target.value })}
                            className="h-8 bg-background border-border"
                            placeholder="postgres"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="user" className="text-xs font-medium text-muted-foreground">
                              Username
                            </Label>
                            <Input
                              id="user"
                              value={editingConnection.username}
                              onChange={(e) => handleUpdateConnection({ username: e.target.value })}
                              className="h-8 bg-background border-border"
                              placeholder="postgres"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                              Password
                            </Label>
                            <Input
                              id="password"
                              type="password"
                              value={editingConnection.password}
                              onChange={(e) => handleUpdateConnection({ password: e.target.value })}
                              className="h-8 bg-background border-border"
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
                            testStatus === "success" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900 hover:text-emerald-800 dark:hover:text-emerald-300 hover:border-emerald-300 dark:hover:border-emerald-700" :
                              testStatus === "error" ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20" : ""
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
                        <div className="text-xs font-medium text-muted-foreground mb-1">Connection usage</div>
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
                              className="text-[10px] h-6 px-2 rounded-full border border-border data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary hover:bg-secondary hover:text-foreground transition-colors"
                            >
                              {opt.label}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Single = 1 connection total; Shared = pool re-used across tabs; Per Tab = dedicated connection per tab.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center mb-3">
                      <Database className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                    <p className="font-medium text-muted-foreground">Select a connection to edit</p>
                    <Button variant="link" onClick={handleAddConnection} className="text-muted-foreground hover:text-foreground h-auto p-0 mt-1 text-xs underline decoration-border hover:decoration-foreground">
                      or create new
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {appInfo && (
            <div className="mt-2 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">DBConsole v{appInfo.version}</span>
                {appInfo.buildSha && <span className="text-muted-foreground/70">build {appInfo.buildSha}</span>}
              </div>
              {appInfo.runtime?.electron && <span className="text-muted-foreground/70">Electron {appInfo.runtime.electron}</span>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShortcuts(true)}>
              Keyboard Shortcuts
            </Button>
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

                  try {
                    const saved = isNew
                      ? await apiClient.connections.create({
                        label: payload.label,
                        host: payload.host,
                        port: payload.port,
                        database: payload.database,
                        username: payload.username,
                        password: editingConnection.password,
                        readOnly: payload.readOnly,
                      })
                      : await apiClient.connections.update(editingConnection.id!, payload)
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
            >
              Connect
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
      <KeyboardShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
    </Dialog>
  )
}
