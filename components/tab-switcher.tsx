"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FileCode, Loader2, Pin, Search } from "lucide-react"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { connectionColor } from "@/lib/color/connection-color"
import { cn } from "@/lib/utils"
import type { Tab } from "./query-tabs"
import type { TabGroup } from "@/lib/tab-store"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: Tab[]
  groups?: TabGroup[]
  /** Lookup map of connectionId → human label, for the right-hand pill. */
  connectionLabels?: Record<string, string>
  onPickTab: (id: string) => void
}

/**
 * Command-palette-style fuzzy switcher over open tabs. Indexed fields:
 * tab name, the SQL body, the connection label, the group name. Each result
 * row shows the tab title, a connection color dot, the group dot if any,
 * and a compact second line summarizing connection / status / row count.
 *
 * Wired to the `ui.commandPalette` shortcut (Mod+K on web, Mod+P on desktop —
 * the latter is the locked decision to keep ⌘P out of browser print on web).
 */
export function TabSwitcher({ open, onOpenChange, tabs, groups, connectionLabels, onPickTab }: Props) {
  const [query, setQuery] = useState("")

  // Reset the query whenever the dialog opens.
  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const groupLookup = useMemo(() => {
    const m = new Map<string, TabGroup>()
    for (const g of groups ?? []) m.set(g.id, g)
    return m
  }, [groups])

  // We let cmdk handle the fuzzy filter via its built-in scoring against
  // the `value` we pass to each item. Concatenating searchable fields into
  // the value string is the standard cmdk pattern.
  const items = useMemo(
    () =>
      tabs.map((tab) => {
        const g = tab.groupId ? groupLookup.get(tab.groupId) : undefined
        const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] : undefined
        // Truncate the SQL we feed to cmdk so we don't pay for matching against
        // multi-MB pasted scripts.
        const sqlBlob = (tab.query || "").slice(0, 2000)
        const value = [tab.name, connLabel ?? "", g?.name ?? "", sqlBlob].join(" ").toLowerCase()
        return { tab, group: g, connLabel, value }
      }),
    [tabs, groupLookup, connectionLabels],
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Switch to a tab… (search by name, SQL, connection, group)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
          <Search className="h-4 w-4 mx-auto mb-2 opacity-60" />
          No tabs match &ldquo;{query}&rdquo;
        </CommandEmpty>
        <CommandGroup heading={`${tabs.length} open tab${tabs.length === 1 ? "" : "s"}`}>
          {items.map(({ tab, group, connLabel, value }) => {
            const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : "transparent"
            const sqlPreview = (tab.query || "").replace(/\s+/g, " ").trim().slice(0, 120)

            const StatusIcon =
              tab.lastRun?.status === "running"
                ? Loader2
                : tab.lastRun?.status === "error"
                  ? AlertCircle
                  : tab.lastRun?.status === "ok"
                    ? CheckCircle2
                    : tab.isSchemaGraph
                      ? FileCode
                      : null

            return (
              <CommandItem
                key={tab.id}
                value={value}
                onSelect={() => {
                  onPickTab(tab.id)
                  onOpenChange(false)
                }}
                className="flex flex-col items-start gap-1 py-2"
              >
                <div className="flex items-center gap-2 w-full min-w-0">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stripeColor }}
                    aria-hidden
                  />
                  {tab.pinned && <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />}
                  <span className="font-medium text-sm truncate flex-1">{tab.name}</span>
                  {StatusIcon && (
                    <StatusIcon
                      className={cn(
                        "h-3 w-3 flex-shrink-0",
                        tab.lastRun?.status === "error" && "text-destructive",
                        tab.lastRun?.status === "ok" && "text-emerald-600 dark:text-emerald-400",
                        tab.lastRun?.status === "running" && "animate-spin text-muted-foreground",
                      )}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground w-full min-w-0">
                  {connLabel && (
                    <span className="truncate flex-shrink-0">{connLabel}</span>
                  )}
                  {group && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="inline-flex items-center gap-1 flex-shrink-0">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: group.color }}
                        />
                        {group.name}
                      </span>
                    </>
                  )}
                  {tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="flex-shrink-0">
                        {tab.lastRun.rowCount.toLocaleString()} rows
                      </span>
                    </>
                  )}
                  {sqlPreview && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="font-mono truncate">{sqlPreview}</span>
                    </>
                  )}
                </div>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
