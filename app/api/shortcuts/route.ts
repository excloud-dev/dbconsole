import { NextResponse } from "next/server"
import { z } from "zod"
import {
  OverridesRecordSchema,
  getShortcutsKeymap,
  resetAllShortcutsOverrides,
  resetShortcutsOverride,
  setShortcutsKeymap,
  setShortcutsOverride,
} from "@/lib/core/shortcuts-settings"
import type { CommandId, Runtime } from "@/lib/shortcuts/types"

export const runtime = "nodejs"

const RuntimeSchema = z.enum(["web", "desktop"])

const PayloadSchema = z.object({
  // Full replacement for specific runtimes
  overrides: z
    .object({
      web: OverridesRecordSchema.optional(),
      desktop: OverridesRecordSchema.optional(),
    })
    .partial()
    .optional(),
  // Targeted update
  runtime: RuntimeSchema.optional(),
  commandId: z.string().optional(),
  binding: z.union([z.string().min(1), z.null()]).optional(),
  reset: z.boolean().optional(),
  resetAll: z.boolean().optional(),
})

export async function GET() {
  return NextResponse.json({
    version: 1,
    overrides: {
      web: getShortcutsKeymap("web"),
      desktop: getShortcutsKeymap("desktop"),
    },
  })
}

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const parsed = PayloadSchema.parse(json)

    // Full runtime override set (web/desktop maps)
    if (parsed.overrides && Object.keys(parsed.overrides).length > 0) {
      if (parsed.overrides.web) setShortcutsKeymap("web", parsed.overrides.web)
      if (parsed.overrides.desktop) setShortcutsKeymap("desktop", parsed.overrides.desktop)
      return NextResponse.json({ ok: true })
    }

    // Targeted mutation requires runtime
    if (parsed.runtime) {
      const runtime = parsed.runtime as Runtime
      if (parsed.resetAll) {
        resetAllShortcutsOverrides(runtime)
        return NextResponse.json({ ok: true })
      }

      if (parsed.commandId) {
        const commandId = parsed.commandId as CommandId
        if (parsed.reset) {
          resetShortcutsOverride(runtime, commandId)
          return NextResponse.json({ ok: true })
        }
        if (parsed.binding !== undefined) {
          setShortcutsOverride(runtime, commandId, parsed.binding)
          return NextResponse.json({ ok: true })
        }
      }
    }

    return NextResponse.json({ error: "No-op payload" }, { status: 400 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid shortcuts payload", issues: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to update shortcuts" }, { status: 500 })
  }
}

