export type Runtime = 'web' | 'desktop'

export type ModifierKey = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt'

export interface KeyBinding {
  raw: string
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface CommandDef {
  id: CommandId
  title: string
  description?: string
  category?: string
  allowInInputs?: boolean
  preventDefault?: boolean
  defaultBindings: Partial<Record<Runtime, string[]>>
}

export type CommandId =
  | 'query.run'
  | 'results.copySelection'
  | 'ui.focusSidebarSearch'
  | 'ui.showSavedQueriesTab'
  | 'ui.commandPalette'
  | 'schema.refresh'
  | 'sync.openSettings'
  | 'sync.namedQueriesNow'
  | 'results.toggleFullscreen'
  | 'results.showExecutedSql'
  | 'results.pageNext'
  | 'results.pagePrev'
  | 'results.clearSelection'
  | 'ui.focusQueryPanel'
  | 'tabs.newQuery'
  | 'tabs.close'
  | 'tabs.next'
  | 'tabs.prev'
  | 'tabs.jump1'
  | 'tabs.jump2'
  | 'tabs.jump3'
  | 'tabs.jump4'
  | 'tabs.jump5'
  | 'tabs.jump6'
  | 'tabs.jump7'
  | 'tabs.jump8'
  | 'tabs.jump9'
  | 'tabs.switch'
  | 'tabs.overview'
  | 'ui.toggleSchemaSidebar'
  | 'ui.openConnections'
  | 'file.openSql'

