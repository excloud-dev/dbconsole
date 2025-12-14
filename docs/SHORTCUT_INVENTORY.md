# Shortcut Inventory + Initial `commandId` List

This file captures (1) **what keyboard shortcuts exist today in code**, and (2) the **initial command IDs** we should standardize on when building a remappable shortcuts system.

Last updated: 2025-12-14

---

## Existing shortcuts in the repo (current code)

| Area | Keys | What it does | Scope / when active | Runtime | Source | Notes | Proposed `commandId` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SQL editor | `Mod+Enter` (CodeMirror: `Mod-Enter`) | Execute the current SQL (raw query editor) | CodeMirror editor is focused | Web + Desktop | `components/sql-editor.tsx` | Uses CodeMirror `keymap.of` extension; not centrally configurable | `query.run` |
| Named query | `Mod+Enter` | Execute the named query | Only when a param `<Input>` is focused | Web + Desktop | `components/named-query-editor.tsx` | Local `onKeyDown`; doesn’t work if focus is elsewhere in the named query view | `query.run` (or `namedQuery.run` if we decide to split later) |
| Results grid | `Mod+C` | Copy the selected cells as TSV | Global `window.keydown` while `DataGrid` is mounted, **only** intercepts when a grid selection exists | Web + Desktop | `components/data-grid.tsx` | Calls `preventDefault()` only if selection exists; currently not focus-scoped (uses `window`) | `results.copySelection` |
| Sidebar (currently unused) | `Mod+B` | Toggle sidebar open/closed | Global `window.keydown` while `SidebarProvider` is mounted | Web + Desktop (if used) | `components/ui/sidebar.tsx` | This sidebar system doesn’t appear to be wired into `DbConsole` yet; also `Cmd+B` is browser-reserved (Bookmarks) on web | `ui.toggleSchemaSidebar` |
| Carousel (component-local) | `ArrowLeft` / `ArrowRight` | Scroll carousel prev/next | Only when carousel container receives the keydown capture | Web + Desktop | `components/ui/carousel.tsx` | Likely **not** part of the user-remappable app shortcuts (it’s widget keyboard support) | _Out of scope_ |

---

## Initial `commandId` list (v1)

This is the initial set to put in the command registry (even if some ship unbound on web).

### Query / execution

- `query.run`: Execute the “current” query in the active tab (raw query tab or named query tab).
- `query.saveAsNamed`: Open “Save named query” flow for current raw SQL (likely **unbound on web** by default).

### Results

- `results.copySelection`: Copy current results selection (TSV).
- `results.toggleFullscreen`: Toggle results grid fullscreen (optional; currently button-only).

### Tabs

- `tabs.newQuery`: Create a new raw query tab.
- `tabs.close`: Close the active tab (no-op if only one tab).
- `tabs.next`: Activate next tab.
- `tabs.prev`: Activate previous tab.

### UI / dialogs

- `ui.openConnections`: Open the current “Settings” dialog (connections manager).
- `ui.toggleSchemaSidebar`: Toggle the left schema/named-query sidebar (desktop-friendly; likely **unbound on web** by default).

---

## Suggested new shortcuts (based on existing UI)

These are “high leverage” additions that map cleanly onto what already exists in `DbConsole`, `SchemasSidebar`, and `DataGrid`.

| `commandId` | Action | Desktop default | Web default | Where it maps in code | Notes |
| --- | --- | --- | --- | --- | --- |
| `ui.commandPalette` | Open command palette (commands/search) | `Mod+K` | `Mod+K` | _Command palette UI exists_ in `components/ui/command.tsx` | Great escape hatch: lets us avoid binding lots of risky web shortcuts. |
| `ui.openConnections` | Open Connections/Settings dialog | `Mod+,` | _Unbound_ | Settings button in `components/db-console.tsx` | `Mod+,` conflicts with browser preferences on web. |
| `ui.toggleSchemaSidebar` | Toggle schema sidebar | `Mod+\\` | _Unbound_ | Sidebar toggle button in `components/db-console.tsx` | Avoid `Mod+B` on web (bookmarks/bold); `Mod+\\` is a common “toggle sidebar” binding. |
| `ui.focusSidebarSearch` | Focus “Search tables & queries…” | `Mod+F` | _Unbound_ | Search input in `components/schemas-sidebar.tsx` | On web `Mod+F` should stay browser Find. |
| `tabs.newQuery` | New query tab | `Mod+T` | _Unbound_ | “+” button in `components/query-tabs.tsx` | On web `Mod+T` opens a browser tab. |
| `tabs.close` | Close active tab | `Mod+W` | _Unbound_ | Close button in `components/query-tabs.tsx` + `closeTab()` in `components/db-console.tsx` | On web `Mod+W` closes the browser tab. |
| `tabs.next` / `tabs.prev` | Next/previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | _Unbound_ | Active tab in `components/db-console.tsx` | Keep desktop-only by default; browser reserves these. |
| `schema.refresh` | Refresh schema for active connection | `F5` (or unbound) | _Unbound_ | Refresh icon in `components/schemas-sidebar.tsx` → `loadSchema()` in `components/db-console.tsx` | Consider leaving unbound and relying on command palette if `F5` is annoying on macOS laptops. |
| `sync.openSettings` | Open sync settings | _Unbound_ | _Unbound_ | Key icon in `components/schemas-sidebar.tsx` → `SyncSettingsDialog` in `components/db-console.tsx` | Good palette command; avoid default binding until we know preferred workflow. |
| `sync.namedQueriesNow` | Sync saved queries now | _Unbound_ | _Unbound_ | Sync icon in `components/schemas-sidebar.tsx` → `handleSyncNamedQueries()` in `components/db-console.tsx` | Good palette command; can show toast/progress. |
| `results.toggleFullscreen` | Toggle results fullscreen | _Unbound_ | _Unbound_ | Fullscreen button in `components/data-grid.tsx` | Candidate binding: `Shift+Enter` (grid scoped) or `F` (grid scoped) if we later add focus. |
| `results.showExecutedSql` | Open “Executed SQL” viewer | _Unbound_ | _Unbound_ | Info button in `components/data-grid.tsx` | Nice for debugging; likely palette-first. |
| `results.pageNext` / `results.pagePrev` | Next/prev page | _Unbound_ | _Unbound_ | Pagination chevrons in `components/data-grid.tsx` | Candidate binding: `PageDown`/`PageUp` (grid scoped). |
| `results.clearSelection` | Clear current grid selection | `Escape` | `Escape` | Selection state in `components/data-grid.tsx` | `Esc` already closes dialogs; only run when no modal is open + selection exists. |
| `ui.focusQueryPanel` | Focus query editor or params/run button | `/` | `/` | Focus management in `components/db-console.tsx` or `components/query-editor.tsx` | Focuses the active query panel. Raw query: focuses editor and moves caret to end. Named query: focuses first param if present, otherwise focuses Run. |

## Notes / decisions to confirm before implementation

- **Single vs split execute commands:** this doc proposes one `query.run` that executes whatever is active; if we want different keybindings for raw vs named execution later, we can add `namedQuery.run` and keep `query.run` as an alias/migration path.
- **Sidebar shortcut scope:** we should only bind `ui.toggleSchemaSidebar` when `DbConsole` owns the sidebar state (not the unused `components/ui/sidebar.tsx` provider), otherwise the command won’t do anything.
