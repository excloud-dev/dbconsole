"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Pin } from "lucide-react"
import { connectionColor } from "@/lib/color/connection-color"
import { cn } from "@/lib/utils"
import type { Tab } from "./query-tabs"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: Tab[]
  connectionLabels?: Record<string, string>
  onPickTab: (id: string) => void
}

// ============================================================================
// LOCKED DESIGN SYSTEM (matches sortable-tab.tsx + tab-overview.tsx)
// TYPE: text-base, text-sm, text-xs only.
// COLOR: text-foreground, text-muted-foreground, text-foreground/40 only.
// SPACING: 4px multiples — gap-2/3/4/6, p-3/4/6/8.
// RADIUS: rounded-md.
// ============================================================================
//
// The switcher is a custom fixed-position overlay (no Dialog primitive). The
// shadcn DialogContent forces sm:max-w-lg + center-translate, both of which
// fight what we want. Top-anchored at 12vh, max-w-[880px], centered.

// ----------------------------------------------------------------------------
// Fuzzy match — substring + word-boundary boost + subsequence fallback.
// ----------------------------------------------------------------------------

function fuzzyMatch(haystack: string, needle: string): { score: number; matched: boolean } {
  if (!needle) return { score: 0, matched: true }
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const idx = h.indexOf(n)
  if (idx >= 0) {
    const wordBoundary = idx === 0 || /[\s._/"'-]/.test(h[idx - 1] ?? "")
    return { matched: true, score: 1000 - idx + (wordBoundary ? 200 : 0) }
  }
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
const MOD = isMac ? "⌘" : "ctrl"

export function TabSwitcher({ open, onOpenChange, tabs, connectionLabels, onPickTab }: Props) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // No manual body-scroll lock — DialogPrimitive handles it.

  const distinctConnections = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tabs) {
      if (!t.connectionId) continue
      if (!seen.has(t.connectionId)) {
        seen.set(t.connectionId, connectionLabels?.[t.connectionId] ?? t.connectionId)
      }
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [tabs, connectionLabels])
  const showInlineConn = distinctConnections.length > 1

  const scored = useMemo(() => {
    if (!query.trim()) {
      return tabs.map((tab, idx) => ({ tab, score: -idx, matched: true }))
    }
    return tabs
      .map((tab) => {
        const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] ?? "" : ""
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

  useEffect(() => { setActiveIndex(0) }, [query])

  const pick = useCallback(
    (id: string) => { onPickTab(id); onOpenChange(false) },
    [onPickTab, onOpenChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
        return
      }
      if (scored.length === 0) return
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, scored.length - 1))
      } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
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
    [scored, activeIndex, pick, onOpenChange],
  )

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          aria-label="Switch tab"
          // We want focus to land on our own input, not on the first tab
          // result. preventDefault inside onOpenAutoFocus blocks radix's
          // auto-focus and our own requestAnimationFrame focuses the input.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          className="fixed left-1/2 top-[15vh] z-[60] -translate-x-1/2 w-[92vw] max-w-[640px] flex flex-col rounded-md border border-border bg-popover shadow-2xl overflow-hidden focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Switch tab</DialogPrimitive.Title>
        {/* Search input — focal but tight. ----------------------------- */}
        <div className="flex items-center gap-3 px-4 h-11 border-b border-border">
          <span aria-hidden className="text-foreground/40 leading-none select-none font-mono text-sm">
            ❯
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Switch to tab"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-foreground/40 caret-foreground"
            aria-label="Search tabs"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <div className="text-xs tabular-nums text-muted-foreground">
            {scored.length}/{tabs.length}
          </div>
        </div>

        {/* Result list ---------------------------------------------------- */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-1"
          role="listbox"
          aria-label="Open tabs"
        >
          {scored.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-xs text-muted-foreground">No tabs match</div>
              {query && (
                <div className="mt-1 text-xs text-foreground/40 font-mono">&ldquo;{query}&rdquo;</div>
              )}
            </div>
          ) : (
            scored.map(({ tab }, idx) => {
              const isCursor = idx === activeIndex
              const connLabel = tab.connectionId ? connectionLabels?.[tab.connectionId] : null
              const dotColor = tab.connectionId ? connectionColor(tab.connectionId) : null

              const oneLine = (tab.query || "").replace(/\s+/g, " ").trim().slice(0, 200)

              return (
                <div
                  key={tab.id}
                  data-row-index={idx}
                  role="option"
                  aria-selected={isCursor}
                  onClick={() => pick(tab.id)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    // Flush full-width row. Active state is JUST a darker bg.
                    // Every row has the EXACT SAME shape — no expand/collapse
                    // on cursor move. The user (rightly) hates layout shifts.
                    "px-4 py-1.5 cursor-pointer transition-colors",
                    isCursor ? "bg-muted" : "hover:bg-muted/40",
                  )}
                >
                  {/* Title row — text-foreground, no font-weight change on cursor */}
                  <div className="flex items-center gap-2">
                    {dotColor && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                    )}
                    {tab.pinned && (
                      <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0" aria-hidden />
                    )}
                    <span className="text-sm truncate flex-1 min-w-0 text-foreground">
                      {tab.name}
                    </span>
                    {showInlineConn && connLabel && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">{connLabel}</span>
                    )}
                    {tab.lastRun?.status === "ok" && tab.lastRun.rowCount !== undefined && (
                      <span className="text-xs tabular-nums text-muted-foreground flex-shrink-0">
                        {tab.lastRun.rowCount.toLocaleString()}
                      </span>
                    )}
                    {tab.lastRun?.status === "error" && (
                      <span className="text-xs text-destructive flex-shrink-0">failed</span>
                    )}
                    {tab.lastRun?.status === "running" && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">running</span>
                    )}
                  </div>

                  {/* SQL preview — single line for every row, no expansion */}
                  {oneLine && (
                    <div className="mt-0.5 ml-3.5 text-xs font-mono text-muted-foreground truncate">
                      {oneLine}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer hints --------------------------------------------------- */}
        <div className="flex items-center justify-between px-4 h-8 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="font-mono text-foreground/80">↑↓</kbd> nav
            </span>
            <span>
              <kbd className="font-mono text-foreground/80">↵</kbd> open
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span>
              <kbd className="font-mono text-foreground/80">{MOD}⇧P</kbd> overview
            </span>
            <span>
              <kbd className="font-mono text-foreground/80">esc</kbd> close
            </span>
          </div>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
