"use client"

import { Database, ChevronDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Connection } from "./connection-dialog"

interface ConnectionSelectorProps {
  connections: Connection[]
  activeConnection: string | null
  onSelect: (id: string) => void
  onManage: () => void
}

export function ConnectionSelector({ connections, activeConnection, onSelect, onManage }: ConnectionSelectorProps) {
  const current = connections.find((c) => c.id === activeConnection)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 border-stone-200 text-stone-600 bg-transparent">
          <Database className={`h-3.5 w-3.5 ${current ? "text-green-600" : "text-stone-400"}`} />
          <span className="max-w-32 truncate">{current?.name || "No connection"}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {connections.map((conn) => (
          <DropdownMenuItem
            key={conn.id}
            onClick={() => onSelect(conn.id)}
            className={activeConnection === conn.id ? "bg-stone-100" : ""}
          >
            <Database
              className={`h-3.5 w-3.5 mr-2 ${activeConnection === conn.id ? "text-green-600" : "text-stone-400"}`}
            />
            <span className="truncate">{conn.name}</span>
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
