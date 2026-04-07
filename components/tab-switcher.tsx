"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, FileCode, Loader2, Pin, Search } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { connectionColor, connectionHue } from "@/lib/color/connection-color"
import { cn } from "@/lib/utils"
import type { Tab } from "./query-tabs"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: Tab[]
  /** Lookup map of connectionId → human label, for the right-hand pill. */
  connectionLabels?: Record<string, string>
  onPickTab: (id: string) => void
}

// ---------------------------------------------------------------------------
// Concept: the tab switcher is a researcher's index card box pulled out from
// under the tab bar. Calm chrome, dense rows, monospace where it carries
// information (SQL preview, row counts), sans where it carries identity.
//
// Key choices that distinguish it from generic cmdk:
//   1. Top-anchored, not vertically centered. The tabs live at the top of the
//      window — the switcher should "drop down" from there, not float in the
//      middle of nothing.
//   2. Left-edge marker on the active row instead of a flat colored block.
//      Two pixels of solid color > a 100%-opacity mint slab.
//   3. The selected row's body expands to show 4 lines of SQL. Other rows
//      get one collapsed line. This is the only animation in the whole UI.
//   4. Real <kbd> hints in the footer with the actual key labels for this
//      platform. ⌘ on mac, Ctrl on win/linux.
//   5. The header counts open tabs *and* breaks them down by connection. So
//      the switcher tells you about the shape of your workspace before you
//      even type anything.
// ---------------------------------------------------------------------------

function fuzzyMatch(haystack: string, needle: string): { score: number; matched: boolean } {
  if (!needle) return { score: 0, matched: true }
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  // Direct substring is the strongest signal.
  const idx = h.indexOf(n)
  if (idx >= 0) {
    // Earlier matches score higher; word-boundary matches score even higher.
    const wordBoundary = idx === 0 || /[\s._/]/.test(h[idx - 1] ?? "")
    return { matched: true, score: 1000 - idx + (wordBoundary ? 200 : 0) }
  }
  // Subsequence fallback: every char of needle appears in haystack in order.
  let hi = 0
  let consecutive = 0
  let bestRun = 0
  let lastMatch = -1
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni]
    let found = -1
    for (let j = hi; j < h.length; j++) {
      if (h[j] === ch) { found = j; break }
    }
    if (found < 0) return { matched: false, score: 0 }
    if (lastMatch >= 0 && found === lastMatch + 1) consecutive++
    else consecutive = 1
    bestRun = Math.max(bestRun, consecutive)
    lastMatch = found
    hi = found + 1
  }
  return { matched: true, score: 100 + bestRun * 10 }
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
const MOD = isMac ? "⌘" : "Ctrl"

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-border bg-muted/60 text-[10px] font-mono text-muted-foreground tabular-nums">
      {children}
    </kbd>
  )
}

export function TabSwitcher({ open, onOpenChange, tabs, connectionLabels, onPickTab }: Props) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Reset state on open + autofocus the input. We don't use cmdk because we
  // want full control over the row layout and the selected-row expansion.
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      // Defer to next frame so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Score and rank tabs against the query.
  const scored = useMemo(() => {
    if (!query.trim()) {
      return tabs.map((tab, idx) => ({ tab, score: -idx, matched: true }))
    }
    return tabs
      .map((tab) => {
        const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] ?? "" : ""
        // Search across name (highest weight), connection, and a bounded
        // slice of the SQL.
        const fields = [
          { text: tab.name, weight: 3 },
          { text: connLabel, weight: 2 },
          { text: (tab.query || "").slice(0, 1500), weight: 1 },
        ]
        let best = { matched: false, score: 0 }
        for (const f of fields) {
          const m = fuzzyMatch(f.text, query)
          if (m.matched && m.score * f.weight > best.score) {
            best = { matched: true, score: m.score * f.weight }
          }
        }
        return { tab, ...best }
      })
      .filter((r) => r.matched)
      .sort((a, b) => b.score - a.score)
  }, [tabs, query, connectionLabels])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Connection breakdown for the header context line. e.g. "3 prod · 2 staging".
  const connBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tabs) {
      const k = t.connectionId ? connectionLabels?.[t.connectionId] ?? t.connectionId : "unbound"
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([k, v]) => ({ label: k, count: v }))
  }, [tabs, connectionLabels])

  const pick = useCallback(
    (id: string) => {
      onPickTab(id)
      onOpenChange(false)
    },
    [onPickTab, onOpenChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (scored.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, scored.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const row = scored[activeIndex]
        if (row) pick(row.tab.id)
      } else if (e.key === "Home") {
        e.preventDefault()
        setActiveIndex(0)
      } else if (e.key === "End") {
        e.preventDefault()
        setActiveIndex(scored.length - 1)
      } else if (e.key === "PageDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 5, scored.length - 1))
      } else if (e.key === "PageUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 5))
      }
    },
    [scored, activeIndex, pick],
  )

  // Scroll the active row into view when it changes.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Top-anchored, not centered. 12vh from the top so it feels like
          // it's dropping out from under the tab bar instead of floating.
          "top-[12vh] translate-y-0 max-w-[680px] w-[92vw]",
          // Custom chrome — no rounded-2xl, just a tight border.
          "p-0 gap-0 border border-border rounded-md overflow-hidden shadow-2xl",
        )}
        showCloseButton={false}
      >
        {/* Header: search input + workspace context line ------------------ */}
        <div className="flex items-center gap-3 px-4 h-11 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Switch to a tab"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/50"
            aria-label="Search tabs"
          />
        </div>
        <div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 border-b border-border bg-muted/20 flex items-center gap-2 flex-wrap">
          <span className="tabular-nums">
            {scored.length} of {tabs.length}
          </span>
          {connBreakdown.length > 0 && <span className="text-muted-foreground/40">·</span>}
          {connBreakdown.map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40">·</span>}
              <span className="tabular-nums">{c.count}</span>
              <span className="normal-case tracking-normal">{c.label}</span>
            </span>
          ))}
        </div>

        {/* Result list ---------------------------------------------------- */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1" role="listbox" aria-label="Open tabs">
          {scored.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground font-mono">
              <span className="opacity-50">no tabs match `{query}`</span>
            </div>
          ) : (
            scored.map(({ tab }, idx) => {
              const isCursor = idx === activeIndex
              const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] : null
              const stripeColor = tab.connectionId ? connectionColor(tab.connectionId) : null
              const hue = tab.connectionId ? connectionHue(tab.connectionId) : null

              const sqlPreview = (tab.query || "").trim()
              const sqlLines = sqlPreview.split("\n")

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
                <div
                  key={tab.id}
                  data-row-index={idx}
                  role="option"
                  aria-selected={isCursor}
                  onClick={() => pick(tab.id)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    "relative flex items-start gap-3 mx-1 px-3 py-2 cursor-pointer rounded-sm",
                    isCursor && "bg-muted/50",
                  )}
                  style={
                    isCursor && hue !== null
                      ? { backgroundColor: `hsl(${hue}, 60%, 50%, 0.08)` }
                      : undefined
                  }
                >
                  {/* Active row marker — 2px solid bar in the connection color
                      anchored to the left edge. The strongest visual cue
                      without any background fill. */}
                  {isCursor && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                      style={{ backgroundColor: stripeColor ?? "hsl(var(--primary))" }}
                    />
                  )}

                  {/* Connection pip */}
                  {stripeColor ? (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0 mt-[7px]"
                      style={{ backgroundColor: stripeColor }}
                    />
                  ) : (
                    <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 mt-[7px]" />
                  )}

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {tab.pinned && (
                        <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />
                      )}
                      <span className="text-sm font-medium truncate flex-1">{tab.name}</span>
                      {connLabel && (
                        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 flex-shrink-0">
                          {connLabel}
                        </span>
                      )}
                    </div>

                    {/* SQL preview. Inactive rows: one line. Cursor row: up to
                        4 lines, with the first non-blank line ahead. */}
                    {sqlPreview && (
                      <div
                        className={cn(
                          "mt-1 font-mono text-[11px] text-muted-foreground/80 leading-relaxed",
                          isCursor ? "whitespace-pre overflow-hidden" : "truncate",
                        )}
                      >
                        {isCursor ? (
                          <>
                            {sqlLines.slice(0, 4).join("\n")}
                            {sqlLines.length > 4 && (
                              <span className="text-muted-foreground/40">{"\n… "}+{sqlLines.length - 4} more lines</span>
                            )}
                          </>
                        ) : (
                          sqlPreview.replace(/\s+/g, " ").slice(0, 120)
                        )}
                      </div>
                    )}

                    {/* Status footer for the cursor row only. Keeps inactive
                        rows compact. */}
                    {isCursor && tab.lastRun && (
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        {StatusIcon && (
                          <StatusIcon
                            className={cn(
                              "h-3 w-3 flex-shrink-0",
                              tab.lastRun.status === "error" && "text-destructive",
                              tab.lastRun.status === "ok" && "text-emerald-600 dark:text-emerald-400",
                              tab.lastRun.status === "running" && "animate-spin",
                            )}
                          />
                        )}
                        {tab.lastRun.status === "ok" && tab.lastRun.rowCount !== undefined && (
                          <span className="tabular-nums">{tab.lastRun.rowCount.toLocaleString()} rows</span>
                        )}
                        {tab.lastRun.status === "ok" && tab.lastRun.durationMs !== undefined && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="tabular-nums">{tab.lastRun.durationMs}ms</span>
                          </>
                        )}
                        {tab.lastRun.status === "error" && (
                          <span className="text-destructive">failed</span>
                        )}
                        {tab.lastRun.status === "running" && <span>running…</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer: keyboard hints ---------------------------------------- */}
        <div className="flex items-center justify-between px-4 h-9 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              open
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>{MOD}</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>P</Kbd>
              overview
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>esc</Kbd>
              close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
