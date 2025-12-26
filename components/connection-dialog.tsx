"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
const DRAFTS_STORAGE_KEY = "dbconsole:connection-drafts:v1"

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
  const [drafts, setDrafts] = useState<ConnectionDraft[]>([])
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    if (!open) return
    try {
      const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY)
      if (!raw) {
        setDrafts([])
        return
      }
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        setDrafts([])
        return
      }
      const sanitized = parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : `draft-${Date.now()}`,
          label: typeof item.label === "string" ? item.label : "New Connection",
          host: typeof item.host === "string" ? item.host : "localhost",
          port: typeof item.port === "string" ? item.port : "5432",
          database: typeof item.database === "string" ? item.database : "",
          username: typeof item.username === "string" ? item.username : "",
          password: typeof item.password === "string" ? item.password : "",
          readOnly: typeof item.readOnly === "boolean" ? item.readOnly : true,
          from: "ui" as const,
        }))
      setDrafts(sanitized)
    } catch {
      setDrafts([])
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    try {
      window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
    } catch {
      // ignore storage failures
    }
  }, [open, drafts])

  useEffect(() => {
    if (!open) return
    if (editingConnection) return
    if (drafts.length > 0) {
      setEditingConnection(drafts[0])
      return
    }
    if (connections.length === 0) return
    const first = connections[0]
    setEditingConnection({
      id: first.id,
      label: first.label,
      host: first.host ?? "localhost",
      port: first.port !== undefined ? String(first.port) : "5432",
      database: first.database ?? "",
      username: first.username ?? "",
      password: "",
      readOnly: first.readOnly,
      from: first.from,
    })
  }, [open, connections, drafts, editingConnection])

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

  const createDraftConnection = (): ConnectionDraft => ({
    id: `draft-${Date.now()}`,
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
    const newConn = createDraftConnection()
    setDrafts((prev) => [newConn, ...prev])
    setEditingConnection(newConn)
  }

  const handleDeleteConnection = async (id?: string) => {
    if (!id) return
    if (id.startsWith("draft-")) {
      setDrafts((prev) => prev.filter((draft) => draft.id !== id))
      if (editingConnection?.id === id) {
        setEditingConnection(null)
      }
      return
    }
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

  const requestDeleteConnection = (id?: string, label?: string) => {
    if (!id) return
    if (id.startsWith("draft-")) {
      void handleDeleteConnection(id)
      return
    }
    setPendingDelete({ id, label: label || "this connection" })
    setConfirmDeleteOpen(true)
  }

  const handleUpdateConnection = (updates: Partial<ConnectionDraft>) => {
    if (!editingConnection) return
    const updated = { ...editingConnection, ...updates }
    setEditingConnection(updated)
    if (updated.id?.startsWith("draft-")) {
      setDrafts((prev) => prev.map((draft) => (draft.id === updated.id ? updated : draft)))
    }
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
      <DialogContent
        className="!max-w-3xl !w-[860px] max-h-[82vh] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col h-full">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground" />
              Database Connections
            </DialogTitle>
            <DialogDescription>
              Manage saved connections and connection pooling behavior
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
              {/* Connection list */}
              <div className="border-r border-border/70 bg-secondary/30 flex flex-col">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={handleAddConnection}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1.5">
                  {drafts.length > 0 && (
                    <div className="pt-1">
                      <div className="px-1.5 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Drafts
                      </div>
                      <div className="space-y-1">
                        {drafts.map((draft) => (
                          <button
                            key={draft.id}
                            onClick={() => setEditingConnection(draft)}
                            className={cn(
                              "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors border",
                              editingConnection?.id === draft.id
                                ? "bg-background border-border text-foreground shadow-xs"
                                : "bg-transparent border-transparent text-muted-foreground hover:bg-background/80 hover:text-foreground"
                            )}
                          >
                            <div className="relative flex items-center justify-center">
                              <Database className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-blue-500 rounded-full ring-1 ring-background" />
                            </div>
                            <span className="truncate flex-1">{draft.label || "New Connection"}</span>
                            <span className="text-[10px] uppercase tracking-wide text-primary/70">Draft</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {drafts.length > 0 && connections.length > 0 && (
                    <div className="pt-2">
                      <div className="px-1.5 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Saved
                      </div>
                    </div>
                  )}
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
                        "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors border",
                        editingConnection?.id === conn.id
                          ? "bg-background border-border text-foreground shadow-xs"
                          : "bg-transparent border-transparent text-muted-foreground hover:bg-background/80 hover:text-foreground"
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
                      {conn.from === "env" && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Env</span>
                      )}
                    </button>
                  ))}
                  {connections.length === 0 && drafts.length === 0 && (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground italic">
                      No connections yet
                    </div>
                  )}
                </div>
              </div>

              {/* Connection form */}
              <div className="flex flex-col h-full bg-background">
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  {editingConnection ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Connection Details</h3>
                          <p className="text-xs text-muted-foreground">Configure connection parameters</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          onClick={() => requestDeleteConnection(editingConnection.id, editingConnection.label)}
                          disabled={editingConnection.from === "env"}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Delete
                        </Button>
                      </div>

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

                      <div className="rounded-md border border-border/70 bg-secondary/30 px-3 py-2">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-medium text-muted-foreground">Connection Test</div>
                            <div className="text-xs text-muted-foreground">
                              Validate the connection before saving.
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                              "gap-2 h-8",
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
                              ? "Testing..."
                              : testStatus === "success"
                                ? "Connection OK"
                                : testStatus === "error"
                                  ? "Connection Failed"
                                  : "Test Connection"}
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-md border border-border/70 bg-secondary/30 px-3 py-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-muted-foreground">Connection Usage</div>
                            <div className="text-[11px] text-muted-foreground">
                              Choose how connections are shared between tabs.
                            </div>
                          </div>
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
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            {
                              key: "single",
                              title: "Single",
                              description: "One shared connection for the app.",
                            },
                            {
                              key: "shared",
                              title: "Shared",
                              description: "Pool reused across tabs.",
                            },
                            {
                              key: "per-scope",
                              title: "Per Tab",
                              description: "Dedicated connection per tab.",
                            },
                          ].map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => onPoolModeChange(opt.key as PoolMode)}
                              className={cn(
                                "rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
                                poolMode === opt.key
                                  ? "border-primary/60 bg-background text-foreground shadow-xs"
                                  : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground hover:border-border"
                              )}
                            >
                              <div className="text-[11px] font-medium">{opt.title}</div>
                              <div className="text-[10px] text-muted-foreground">{opt.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm">
                      <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center mb-3">
                        <Database className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <p className="font-medium text-muted-foreground">Select a connection to edit</p>
                      <Button
                        variant="link"
                        onClick={handleAddConnection}
                        className="text-muted-foreground hover:text-foreground h-auto p-0 mt-1 text-xs underline decoration-border hover:decoration-foreground"
                      >
                        or create new
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border sm:justify-between">
            {appInfo ? (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">DBConsole v{appInfo.version}</span>
                {appInfo.buildSha && <span className="text-muted-foreground/70">build {appInfo.buildSha}</span>}
                {appInfo.runtime?.electron && <span className="text-muted-foreground/70">Electron {appInfo.runtime.electron}</span>}
              </div>
            ) : (
              <div className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
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

                  const isDraft = editingConnection.id?.startsWith("draft-") ?? false
                  const isNew = !editingConnection.id || isDraft

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
                      if (isDraft) {
                        setDrafts((prev) => prev.filter((draft) => draft.id !== editingConnection.id))
                      }
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
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {pendingDelete?.label ?? "this connection"} from your saved connections.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDeleteConnection(pendingDelete?.id)
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <KeyboardShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
    </Dialog>
  )
}
