import type { CommandDef, CommandId, Runtime } from './types'



const commands: CommandDef[] = [
  {
    id: 'query.run',
    title: 'Run query',
    description: 'Execute the active SQL or named query',
    category: 'Query',
    allowInInputs: true,
    defaultBindings: {
      web: ['Mod+Enter'],
      desktop: ['Mod+Enter'],
    },
  },
  {
    id: 'results.copySelection',
    title: 'Copy results selection',
    description: 'Copy the selected grid cells',
    category: 'Results',
    allowInInputs: true,
    // Only prevent default if we *actually* copy (grid has selection)
    preventDefault: false,
    defaultBindings: {
      // Only triggers when the grid has a selection; otherwise normal copy should work.
      web: ['Mod+C'],
      desktop: ['Mod+C'],
    },
  },
  {
    id: 'ui.focusSidebarSearch',
    title: 'Focus sidebar search',
    description: 'Focus the “Search tables & queries…” input',
    category: 'UI',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+F'],
    },
  },
  {
    id: 'ui.showSavedQueriesTab',
    title: 'Show saved queries (sidebar)',
    description: 'Switch sidebar to the Saved queries tab',
    category: 'UI',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Ctrl+Shift+Q'],
    },
  },
  {
    id: 'ui.commandPalette',
    title: 'Open command palette',
    description: 'Search and run any command (use Switch Tab for tabs only)',
    category: 'UI',
    allowInInputs: true,
    defaultBindings: {
      // Web: ⌘K is taken by tabs.switch, the command list palette moves to
      // ⌘⇧K. Desktop: ⌘K is still free since the tab switcher uses ⌘P.
      web: ['Mod+Shift+K'],
      desktop: ['Mod+K'],
    },
  },
  {
    id: 'schema.refresh',
    title: 'Refresh schema',
    description: 'Reload schema for the active connection',
    category: 'Schema',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['F5'],
    },
  },
  {
    id: 'sync.openSettings',
    title: 'Open sync settings',
    description: 'Open the sync settings dialog',
    category: 'Sync',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'sync.namedQueriesNow',
    title: 'Sync saved queries now',
    description: 'Run saved query sync immediately',
    category: 'Sync',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'results.toggleFullscreen',
    title: 'Toggle results fullscreen',
    category: 'Results',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'results.showExecutedSql',
    title: 'Show executed SQL',
    category: 'Results',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'results.pageNext',
    title: 'Next results page',
    category: 'Results',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'results.pagePrev',
    title: 'Previous results page',
    category: 'Results',
    allowInInputs: true,
    defaultBindings: {},
  },
  {
    id: 'results.clearSelection',
    title: 'Clear results selection',
    category: 'Results',
    allowInInputs: true,
    // Don't steal Escape when a dialog is open; the handler will no-op and we won't consume.
    preventDefault: false,
    defaultBindings: {
      web: ['Escape'],
      desktop: ['Escape'],
    },
  },
  {
    id: 'ui.focusQueryPanel',
    title: 'Focus query panel',
    description: 'Focus the query editor (or named query params / run button)',
    category: 'UI',
    // Avoid hijacking typing; this is a navigation shortcut.
    defaultBindings: {
      web: ['/'],
      desktop: ['/'],
    },
  },
  {
    id: 'tabs.newQuery',
    title: 'New query tab',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+T'],
    },
  },
  {
    id: 'tabs.close',
    title: 'Close current tab',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+W'],
    },
  },
  {
    id: 'tabs.next',
    title: 'Next tab',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Ctrl+Tab'],
    },
  },
  {
    id: 'tabs.prev',
    title: 'Previous tab',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Ctrl+Shift+Tab'],
    },
  },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
    id: `tabs.jump${n}` as CommandId,
    title: `Jump to tab ${n}`,
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      desktop: [`Mod+${n}`],
      web: [`Mod+${n}`],
    },
  })),
  {
    id: 'tabs.switch',
    title: 'Switch tab…',
    description: 'Open the fuzzy tab switcher (search by name, SQL, connection, group)',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      // Desktop: ⌘P. Browsers steal ⌘P for print, so the web build uses ⌘K
      // and the existing command-list palette moves to ⌘⇧K (overridable in
      // shortcut settings).
      desktop: ['Mod+P'],
      web: ['Mod+K'],
    },
  },
  {
    id: 'tabs.overview',
    title: 'Tab overview',
    description: 'Open a card grid of all open tabs',
    category: 'Tabs',
    allowInInputs: true,
    defaultBindings: {
      // Browsers don't intercept ⌘⇧P, so we can use the same binding on
      // both runtimes.
      desktop: ['Mod+Shift+P'],
      web: ['Mod+Shift+P'],
    },
  },
  {
    id: 'ui.toggleSchemaSidebar',
    title: 'Toggle schema sidebar',
    category: 'UI',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+S'],
    },
  },
  {
    id: 'ui.openConnections',
    title: 'Open connections/settings',
    category: 'UI',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+,'],
    },
  },
  {
    id: 'file.openSql',
    title: 'Open SQL file',
    category: 'File',
    allowInInputs: true,
    defaultBindings: {
      desktop: ['Mod+O'],
    },
  },
]

const commandMap: Record<CommandId, CommandDef> = commands.reduce((acc, cmd) => {
  acc[cmd.id] = cmd
  return acc
}, {} as Record<CommandId, CommandDef>)

export function getCommandDef(id: CommandId): CommandDef {
  return commandMap[id]
}

export function listCommands(): CommandDef[] {
  return commands
}

export function getDefaultBindings(id: CommandId, runtime: Runtime): string[] {
  const def = getCommandDef(id)
  const bindings = def.defaultBindings[runtime]
  return Array.isArray(bindings) ? bindings : []
}

