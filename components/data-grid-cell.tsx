"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  bytesToBase64,
  bytesToHex,
  formatRange,
  humanizeInterval,
  pgTypeKind,
  type PgTypeKind,
} from "@/lib/pg-types"

type Props = {
  value: unknown
  /** Postgres type OID for this column, or 0/undefined for plain text. */
  typeOid?: number
}

/**
 * Compact, type-aware renderer for a single data grid cell.
 *
 * Picks a renderer based on the column's pg type OID. Anything we don't have
 * a specific renderer for falls through to the original `formatScalar` (which
 * matches the pre-Phase-3 behavior so the upgrade is a strict superset).
 *
 * Renderers are intentionally inline (single file) — they're small and the
 * grid renders thousands of cells, so a single import path keeps the bundle
 * tight and the dispatch hot path predictable.
 */
export function DataGridCell({ value, typeOid }: Props) {
  if (value === null) {
    return <span className="text-muted-foreground/50 italic">NULL</span>
  }
  if (value === undefined) {
    return <span className="text-muted-foreground/50 italic">—</span>
  }

  const kind: PgTypeKind = pgTypeKind(typeOid)

  switch (kind) {
    case "jsonb":
    case "json":
      return <JsonCell value={value} />
    case "uuid":
      return <UuidCell value={String(value)} />
    case "bytea":
      return <ByteaCell value={value} />
    case "interval":
      return <IntervalCell value={value} />
    case "int4range":
    case "int8range":
    case "numrange":
    case "tsrange":
    case "tstzrange":
    case "daterange":
      return <RangeCell value={value} />
    case "inet":
    case "cidr":
      return <span className="font-mono text-xs">{String(value)}</span>
    case "array":
      return <ArrayCell value={value} />
    case "scalar":
    default:
      return <ScalarCell value={value} />
  }
}

// ---- scalar -----------------------------------------------------------------

function ScalarCell({ value }: { value: unknown }) {
  if (typeof value === "object") {
    // Object that wasn't classified as jsonb/json/range/etc — likely an array
    // or struct from a custom type. Stringify so the row keeps height.
    try {
      return <span>{JSON.stringify(value)}</span>
    } catch {
      return <span>[Object]</span>
    }
  }
  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>
  }
  return <span>{String(value)}</span>
}

// ---- json / jsonb -----------------------------------------------------------

function JsonCell({ value }: { value: unknown }) {
  // Compact one-line preview by default. The full tree lives in the existing
  // CellDetailDialog which the parent grid opens on click — we keep this cell
  // dense so columns don't blow out.
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    text = "[unserializable]"
  }
  return (
    <span className="font-mono text-xs text-success truncate" title={text}>
      {text}
    </span>
  )
}

// ---- uuid -------------------------------------------------------------------

function UuidCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 group/uuid">
      <span className="font-mono text-xs">{value}</span>
      <button
        type="button"
        className="opacity-0 group-hover/uuid:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        title="Copy UUID"
        aria-label="Copy UUID"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  )
}

// ---- bytea ------------------------------------------------------------------

function ByteaCell({ value }: { value: unknown }) {
  const [mode, setMode] = useState<"hex" | "b64">("hex")
  const text = mode === "hex" ? bytesToHex(value) : bytesToBase64(value)
  const sizeBytes =
    value instanceof Uint8Array
      ? value.length
      : typeof value === "string"
        ? value.startsWith("\\x")
          ? (value.length - 2) / 2
          : value.length
        : null
  return (
    <span className="inline-flex items-center gap-1 group/bytea">
      <span className="font-mono text-xs text-muted-foreground">{sizeBytes !== null ? `${sizeBytes}B` : ""}</span>
      <span className="font-mono text-xs truncate" title={text}>
        {text}
      </span>
      <button
        type="button"
        className="opacity-0 group-hover/bytea:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-xs uppercase font-mono"
        onClick={(e) => {
          e.stopPropagation()
          setMode((m) => (m === "hex" ? "b64" : "hex"))
        }}
        title={`Switch to ${mode === "hex" ? "base64" : "hex"}`}
      >
        {mode === "hex" ? "b64" : "hex"}
      </button>
    </span>
  )
}

// ---- interval ---------------------------------------------------------------

function IntervalCell({ value }: { value: unknown }) {
  return <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{humanizeInterval(value)}</span>
}

// ---- range ------------------------------------------------------------------

function RangeCell({ value }: { value: unknown }) {
  return <span className="font-mono text-xs text-violet-700 dark:text-violet-400">{formatRange(value)}</span>
}

// ---- array ------------------------------------------------------------------

function ArrayCell({ value }: { value: unknown }) {
  // pg returns arrays as JS arrays directly (when rowMode='array' isn't in
  // play for the cells themselves). Render up to 6 elements as chips.
  const arr = Array.isArray(value) ? value : null
  if (!arr) {
    return <ScalarCell value={value} />
  }
  if (arr.length === 0) {
    return <span className="text-muted-foreground/60 italic text-xs">empty array</span>
  }
  const shown = arr.slice(0, 6)
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((item, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex items-center rounded-sm bg-muted px-1 py-0 text-xs font-mono",
            "text-foreground border border-border max-w-[120px] truncate",
          )}
          title={item == null ? "NULL" : String(item)}
        >
          {item == null ? "NULL" : String(item)}
        </span>
      ))}
      {arr.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{arr.length - shown.length}</span>
      )}
    </span>
  )
}
