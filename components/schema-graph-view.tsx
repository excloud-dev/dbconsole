"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Loader2, Maximize2, Minus, Plus, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { schemaGraphToMermaidErDiagram } from "@/lib/schema-graph/mermaid"
import type { SchemaGraph } from "@/lib/schema-introspection"
import { cn } from "@/lib/utils"

type Props = {
  schema: SchemaGraph | null | undefined
  /** Re-fetch the schema graph from the parent. Optional. */
  onRefresh?: () => void
  className?: string
}

/**
 * Renders a SchemaGraph as a Mermaid `erDiagram` SVG inside a pan/zoom canvas.
 *
 * The renderer is intentionally swappable: this component owns the SchemaGraph
 * → SVG transform via `schemaGraphToMermaidErDiagram` + the dynamic mermaid
 * import. If we ever want to swap to React Flow + elkjs, only this file
 * changes — the data layer (lib/schema-introspection.ts) and the parent
 * component (db-console schema-graph tab) are renderer-agnostic.
 *
 * Pan/zoom is hand-rolled to avoid pulling in another runtime dependency. We
 * track the SVG inside an inner div with `transform: translate(...) scale(...)`
 * and convert wheel/drag events into deltas on that transform.
 */
export function SchemaGraphView({ schema, onRefresh, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Pan/zoom transform.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const mermaidSource = useMemo(() => {
    if (!schema) return ""
    return schemaGraphToMermaidErDiagram(schema)
  }, [schema])

  // Render the mermaid source to SVG. Mermaid is dynamically imported so the
  // (heavy) library only loads when the user actually opens the schema graph.
  useEffect(() => {
    if (!mermaidSource) {
      setSvg(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          er: {
            useMaxWidth: false,
          },
        })
        const id = `dbc-er-${Date.now()}`
        const { svg: rendered } = await mermaid.render(id, mermaidSource)
        if (cancelled) return
        setSvg(rendered)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Failed to render schema graph")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mermaidSource])

  // Reset zoom to fit (best effort: just resets to identity transform). The
  // user can then drag/zoom from there.
  const reset = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [])

  // Mouse wheel → zoom around the cursor.
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    setTransform((cur) => {
      // Convert cursor to "world" coords under current transform.
      const worldX = (cx - cur.x) / cur.scale
      const worldY = (cy - cur.y) / cur.scale
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.min(4, Math.max(0.2, cur.scale * factor))
      // Re-anchor so the world point under the cursor stays put.
      return {
        scale: next,
        x: cx - worldX * next,
        y: cy - worldY * next,
      }
    })
  }, [])

  // Drag to pan.
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: transform.x,
      origY: transform.y,
    }
  }, [transform.x, transform.y])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current
    if (!ds) return
    setTransform((cur) => ({
      ...cur,
      x: ds.origX + (e.clientX - ds.startX),
      y: ds.origY + (e.clientY - ds.startY),
    }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }, [])

  return (
    <div className={cn("h-full w-full flex flex-col bg-card", className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 text-xs">
        <span className="font-medium">Schema graph</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {schema ? `${schema.tables.length} tables · ${schema.foreignKeys.length} relationships` : "Loading…"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setTransform((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
            title="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">
            {Math.round(transform.scale * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setTransform((cur) => ({ ...cur, scale: Math.min(4, cur.scale * 1.2) }))}
            title="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={reset} title="Reset view">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          {onRefresh && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRefresh} title="Refresh schema">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-background select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: dragState.current ? "grabbing" : "grab" }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Rendering schema…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-destructive p-4 text-center">
            <AlertCircle className="h-4 w-4" />
            <div className="text-sm font-medium">Failed to render schema graph</div>
            <div className="text-sm font-mono bg-destructive/10 p-2 rounded max-w-md">{error}</div>
          </div>
        )}

        {!loading && !error && svg && (
          <div
            ref={innerRef}
            className="absolute origin-top-left"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
            // Mermaid output is trusted (we control the source string and use securityLevel: strict).
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  )
}
