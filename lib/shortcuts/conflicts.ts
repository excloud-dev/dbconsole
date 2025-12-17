import type { CommandId, KeyBinding } from "@/lib/shortcuts/types"

export function buildConflictMap(bindings: Record<CommandId, KeyBinding[]>): Record<string, CommandId[]> {
  const map: Record<string, CommandId[]> = {}
  for (const [commandId, list] of Object.entries(bindings) as [CommandId, KeyBinding[]][]) {
    list.forEach((binding) => {
      const key = binding.raw
      if (!map[key]) map[key] = []
      map[key].push(commandId)
    })
  }
  return map
}

export function listConflicts(bindings: Record<CommandId, KeyBinding[]>): Array<{ binding: string; commands: CommandId[] }> {
  const conflicts: Array<{ binding: string; commands: CommandId[] }> = []
  const map = buildConflictMap(bindings)
  for (const [binding, cmds] of Object.entries(map)) {
    if (cmds.length > 1) {
      conflicts.push({ binding, commands: cmds })
    }
  }
  return conflicts
}
