"use client"

import { Database, ChevronDown, Plus, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ClientConnectionMeta } from "@/lib/connections"

interface ConnectionSelectorProps {
  connections: ClientConnectionMeta[]
  activeConnection: string | null
  onSelect: (id: string) => void
  onManage: () => void
}

export function ConnectionSelector({ connections, activeConnection, onSelect, onManage }: ConnectionSelectorProps) {
  const current = connections.find((c) => c.id === activeConnection)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 border-border text-muted-foreground bg-transparent">
          <Database className={`h-3.5 w-3.5 ${current ? "text-success" : "text-muted-foreground"}`} />
          <span className="max-w-32 truncate">{current?.label || "No connection"}</span>
          {current && !current.readOnly && (
            <PencilLine className="h-3 w-3 text-warning" aria-label="Writes allowed" />
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {connections.map((conn) => (
          <DropdownMenuItem
            key={conn.id}
            onClick={() => onSelect(conn.id)}
            className={activeConnection === conn.id ? "bg-secondary" : ""}
          >
            <Database
              className={`h-3.5 w-3.5 mr-2 ${activeConnection === conn.id ? "text-success" : "text-muted-foreground"}`}
            />
            <span className="truncate flex-1">{conn.label}</span>
            {!conn.readOnly && (
              <span
                className="ml-2 text-[10px] font-medium uppercase tracking-wide text-warning border border-warning/40 bg-warning/10 rounded px-1 leading-4"
                title="Writes allowed"
              >
                RW
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {connections.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onManage}>
          <Plus className="h-3.5 w-3.5 mr-2" />
          Manage connections...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
