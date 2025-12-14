# Shortcuts / Keybindings Plan

Goal: move all keyboard shortcuts behind a single “shortcuts interface” so we can (1) ship sensible defaults for **web vs desktop**, (2) let users remap/disable shortcuts via Settings, and (3) avoid scattering `keydown` handlers across components.

---

## What we have today

- `components/sql-editor.tsx`: CodeMirror keymap uses `Mod-Enter` to execute.
- `components/named-query-editor.tsx`: `onKeyDown` on param inputs uses `Mod+Enter` to execute.
- `components/data-grid.tsx`: `window.keydown` intercepts `Mod+C` to copy selected grid range.
- `components/ui/sidebar.tsx`: has `Mod+B`, but this component currently isn’t imported/used anywhere.

Pain points:

- Not configurable (no Settings UI, no persistence).
- Hard to reason about conflicts (multiple listeners, editor vs global).
- Web vs desktop constraints aren’t encoded (browser-reserved shortcuts, desktop-only actions).

---

## Design principles

- **Commands over keys:** code references stable `commandId`s; keys are just bindings.
- **One dispatcher:** a single runtime service handles `keydown` and routes to commands.
- **Scopes/contexts:** shortcuts can be global or only active in certain UI contexts (grid focused, editor focused, etc).
- **Platform-aware defaults:** different default keymaps for `web` and `desktop` (and optionally mac vs non-mac).
- **User overrides are additive:** store only overrides (and “disabled”), fall back to defaults.
- **No surprises on web:** default web keymap should avoid common browser-reserved combos (`Mod+W`, `Mod+T`, `Mod+L`, `Mod+R`, `Mod+P`, etc).

---

## Proposed architecture

### 1) Command registry (source of truth)

Create a small registry of commands with metadata + default bindings.

Suggested files:

- `lib/shortcuts/commands.ts` – `CommandDef[]` (id, title, category, description, default bindings by runtime).
- `lib/shortcuts/types.ts` – shared types (`CommandId`, `Keybinding`, `Keymap`, `ShortcutScope`).

Example command IDs (initial set):

- `query.run` – run current SQL (default: `Mod+Enter` on both).
- `namedQuery.run` – run named query (default: `Mod+Enter` on both).
- `results.copySelection` – copy grid selection as TSV (default: `Mod+C`, but only when grid selection exists).
- `ui.toggleSchemaSidebar` – show/hide schema sidebar (desktop default only; leave unbound on web initially).
- `ui.openConnections` – open Settings/Connections dialog (desktop default: `Mod+,`; web default: unbound).
- `tabs.newQuery` / `tabs.close` / `tabs.next` / `tabs.prev` (desktop defaults; web defaults likely unbound).

Notes:

- Keep command IDs stable and versioned only by adding new IDs, not renaming.
- Make command availability explicit (`availableIn: ['web','desktop']` or `desktopOnly: true`).

### 2) Keybinding format + matching

We need a single string format we can:

- display in UI (“Press shortcut…”)
- store in settings
- match against `KeyboardEvent`
- (optionally) translate to CodeMirror format

Proposal:

- Human/storage format: `Mod+Enter`, `Shift+Mod+K`, `Alt+1`, `Ctrl+Shift+P`
- Normalize to a canonical internal form:
  - modifiers set (`mod`, `shift`, `alt`, `ctrl`, `meta`)
  - key (normalized `event.key`, with some translation for arrows, escape, etc)

Suggested files:

- `lib/shortcuts/parse.ts` – parse string ↔ structured form.
- `lib/shortcuts/match.ts` – `matches(event, binding): boolean` + normalization helpers.
- `lib/shortcuts/format.ts` – display formatting (mac glyphs optional) + per-platform “Mod”.

Web safety rule:

- Prefer not to bind defaults that conflict with browser/OS shortcuts; allow user overrides anyway.

### 3) Runtime dispatcher + hooks (the “separate interface”)

Create a provider that owns:

- current merged keymap (defaults + overrides)
- command handler registrations
- global `keydown` listener with context gating

Suggested files:

- `components/shortcuts/ShortcutsProvider.tsx`
- `components/shortcuts/useCommand.ts` – register handler(s) for a `commandId`
- `components/shortcuts/useBinding.ts` – read the *current* binding for a command (for UI display)

Dispatcher behavior:

- `keydown` → normalize → find matching command(s) → resolve conflicts → run handler
- Don’t fire if:
  - user is in a text input/textarea/contenteditable **unless** command explicitly allows it
  - `event.repeat` (for “single shot” commands) unless explicitly allowed
- Prefer “more specific scope” over global when multiple handlers exist.

Context gating (initial):

- `global`
- `editor.sql` (CodeMirror focused)
- `grid.results` (DataGrid focused / selection exists)

### 4) Persistence (settings) + API/IPC plumbing

Store user overrides in `dbconsole_settings` (see `lib/meta-db.ts`) under a versioned key:

- `shortcuts.keymap.v1`

Schema (suggested):

```ts
type StoredKeymapV1 = {
  version: 1
  overrides: {
    // per runtime so web and desktop can diverge safely
    web?: Record<string, string | null>      // commandId -> binding or null (disabled)
    desktop?: Record<string, string | null>
  }
}
```

Plumbing pattern mirrors `syncer.settings`:

- Web API:
  - `GET /api/shortcuts` → returns stored keymap blob (or empty/default)
  - `POST /api/shortcuts` → saves overrides (validated with `zod`)
- Desktop IPC:
  - `dbconsole:shortcuts:get`
  - `dbconsole:shortcuts:set`
- Desktop preload + client:
  - expose under `window.dbconsole.api.shortcuts.get/set`
  - add `apiClient.shortcuts.get/set` with desktop fallback (see `lib/client/apiClient.ts`)

### 5) Settings UI (“Keyboard Shortcuts”)

Add a new Settings section/dialog for shortcuts:

- Search box (filter by command title/id)
- Group by category (Query, Results, Tabs, UI, Desktop-only)
- Show:
  - command name
  - current binding (or “Unbound”)
  - default binding (subtle)
  - conflicts indicator (same binding used elsewhere in same scope/runtime)
- Actions:
  - “Edit” (capture a new keybinding)
  - “Disable” (set to `null`)
  - “Reset” (remove override)
  - “Reset all”

Key capture UX:

- Modal that listens for next `keydown`, shows interpreted combo, allows “Confirm / Cancel”.
- Provide “Escape to cancel” and a “Clear binding” button.
- Validate against reserved combos on web (warn; allow if user insists, but be transparent that browser may ignore).

### 6) Integration points (migration away from ad-hoc listeners)

Incrementally migrate existing behavior to commands:

- `components/sql-editor.tsx`
  - Generate CodeMirror execute keymap from current binding for `query.run`
  - Rebuild/update CodeMirror extension when binding changes (or re-create EditorView)
- `components/named-query-editor.tsx`
  - Replace `onKeyDown` with `useCommand('namedQuery.run', ...)` scoped to the component (or keep `onKeyDown` but consult central binding matcher)
- `components/data-grid.tsx`
  - Replace `window.keydown` with a scoped `results.copySelection` handler that only activates when the grid is focused/has selection

Keep the migration low-risk:

- Phase 1 can support both (central + old listeners) behind a flag, then remove old listeners once stable.

### 7) Desktop niceties (optional, later)

Once the core system exists, desktop can get “native-feeling” shortcuts:

- Build an Electron `Menu` with accelerators sourced from the current keymap.
- For app-level shortcuts that should work regardless of focus, consider `webContents.before-input-event` (preferred over `globalShortcut` unless truly global).
- Keep the renderer command IDs as the single source of behavior; the menu should dispatch command IDs to the renderer.

---

## Current status (Dec 2025)

**Implemented (v1 foundation):**

- Central shortcuts core:
  - `lib/shortcuts/types.ts` (`CommandId`, `KeyBinding`, `Runtime`, etc).
  - `lib/shortcuts/commands.ts` with initial command set and desktop defaults (e.g. `query.run`, `tabs.*`, `ui.toggleSchemaSidebar`, `ui.openConnections`, `file.openSql`).
  - `lib/shortcuts/parse.ts` / `lib/shortcuts/match.ts` / `lib/shortcuts/format.ts` for parsing, matching, and rendering keybindings.
- Runtime dispatcher + hooks (desktop):
  - `components/shortcuts/ShortcutsProvider.tsx` with a global `keydown` listener and command dispatch.
  - `components/shortcuts/useCommand.ts` and `components/shortcuts/useBinding.ts`.
  - Wired into the **desktop Vite renderer** (`desktop/renderer/src/main.tsx`), so desktop gets unified shortcuts.
- Desktop integration points:
  - `DbConsole` uses commands for:
    - `tabs.newQuery` / `tabs.close` / `tabs.next` / `tabs.prev`.
    - `ui.toggleSchemaSidebar` (toggle left sidebar).
    - `ui.openConnections` (open connections/settings dialog).
    - `file.openSql` (trigger native “Open SQL…” dialog and open file contents in a new query tab).

**Not yet implemented (future work):**

- Shortcuts persistence + settings:
  - No `shortcuts.keymap.v1` storage yet (no `lib/core/shortcuts-settings.ts`).
  - No `/api/shortcuts` web route or `dbconsole:shortcuts:get/set` IPC handlers.
  - No “Keyboard Shortcuts” settings UI for listing/editing bindings or showing conflicts.
- Web runtime wiring:
  - `ShortcutsProvider` is not yet wired into the Next.js app shell; web still relies on existing ad-hoc handlers.
- Component-level migrations:
  - `SqlEditor` still uses a local CodeMirror `Mod-Enter` keymap instead of consulting the central `query.run` binding.
  - `NamedQueryEditor` still uses a local `onKeyDown` for `Mod+Enter`.
  - `DataGrid` still uses a `window.keydown` listener for `Mod+C` instead of a scoped `results.copySelection` command.
- Niceties / polish:
  - No conflict detection UI yet (we don’t surface when two commands share the same binding).
  - Electron menu accelerators are currently defined directly in `electron/main.cjs` (e.g. “Open SQL…”), not yet driven from the central keymap.

## Implementation checklist (suggested order)

- [x] Inventory all existing shortcuts and decide initial `commandId` list.  
      (See `SHORTCUT_INVENTORY.md`; kept in sync with `lib/shortcuts/commands.ts`.)
- [x] Add `lib/shortcuts/*` (types + parse/match/format + command registry + defaults).
- [x] Add `ShortcutsProvider` + `useCommand`/`useBinding` hooks; wire into `DbConsole` for the **desktop Vite renderer**.
- [ ] Wire `ShortcutsProvider` into the Next.js app shell so web uses the same shortcuts interface.
- [ ] Add persistence: `lib/core/shortcuts-settings.ts` using `dbconsole_settings` + zod validation.
- [ ] Add web API route `app/api/shortcuts/route.ts`.
- [ ] Add desktop IPC handlers + preload exposure + `apiClient.shortcuts.get/set`.
- [ ] Build Settings UI section for shortcuts (list + editor modal).
- [ ] Migrate `SqlEditor` execute binding to use the central binding.
- [ ] Migrate DataGrid copy-selection shortcut to a scoped command.
- [ ] Migrate NamedQueryEditor execute shortcut to a scoped command.
- [ ] Add conflict detection + UI warnings.
- [ ] (Optional) Electron menu integration with accelerators sourced from keymap.

---

## Testing notes

- Unit tests (Vitest) for `parse/match/format`:
  - round-trips (`string → parsed → string`)
  - `Mod` behavior on mac vs non-mac
  - edge keys (Escape, Enter, Arrow keys)
  - conflict resolution ordering
- Lightweight component tests (if present) or manual QA script:
  - verify defaults on web don’t break browser
  - verify desktop overrides persist and apply after reload
  - verify CodeMirror execute binding updates after remap

