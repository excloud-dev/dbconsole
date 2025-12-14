# Changelog

All notable changes to this project will be documented in this file.

## v0.2.1 - 2025-12-14

- fix: ensure leading empty lines are removed from extracted release notes for cleaner output (c0fcbfe)
- feat: implement centralized keyboard shortcut stack, enhance UI with lucide-powered chips, and polish desktop experience with new file associations and metadata tweaks (5aac760)

## v0.3.0 - 2025-12-14

- feat: landed the centralized keyboard shortcut stack (`lib/shortcuts/*`, `ShortcutsProvider`, `useCommand`, `/api/shortcuts` route, desktop IPC/preload bindings, `apiClient` plumbing, `SHORTCUTS.md`) and wired it into both runtimes (`WebShortcutsRoot`, desktop renderer provider) plus the new “Keyboard Shortcuts” dialog off the Connections modal.
- feat: UI improvements for shortcuts — lucide-powered `kbd` chips (Shift/Enter/Tab/Esc/Delete), improved capture dialog, and documentation updates in `README`/`SHORTCUT_INVENTORY.md` to describe the defaults plus new `/` focus behavior.
- minor: desktop polish — new `app://` protocol, slicing “use client” directives for the renderer, chunked Vite output, enriched Electron menu (Cmd/Ctrl+O to open SQL scripts), `.sql` file open helpers (IPC, types, CLI + Finder handling), mac file associations/icon, and metadata/scripting tweaks so packaged builds inherit the new focus areas.

## v0.2.0 - 2025-12-14

- feat: end-to-end encrypted (E2E) named-query sync via “sync phrase” + sync relay endpoints (`/api/sync/named-queries/pull|push`)
- feat: “sync server only” mode for running the web app purely as a low-profile sync relay (`DBCONSOLE_SYNC_SERVER_ONLY=1`) + install script support (`--sync-server-only`)
- feat: conflict resolution UX improvements (3-way merge base to reduce constant conflicts, conflict dialog shows parameter definitions)
- feat: encryption-at-rest for locally stored secrets (connection passwords, sync phrase/settings)
- feat: auto-sync on named query create/edit + option to leave/opt-out of a sync chain
- feat: deletion sync is optional and off by default (safer cross-device behavior)

## v0.1.2 - 2025-12-13

- chore: add README (6c6b8ec)
- feat: optimize Electron app packaging by creating a minimal app directory, reducing bundle size, and disabling sourcemaps in production builds (1079fd0)
- chore: update postinstall script to initialize app directory before installing dependencies (421dd76)

## v0.1.1 - 2025-12-13

- init (c649d26)
- feat: Add systemd service and installation script for DBConsole, and adjust Next.js type reference path. (778efd3)
- feat: Add install/redeploy modes and custom port configuration to install script (1b00dbb)
- fix: port: (6174086)
- fix: exposed to internet (6cbe55e)
- fix: listen on TS (102a811)
- feat: Add executed SQL display to data grid and implement template/rendered view for named queries. (c1c6076)
- Add hostname (ac33071)
- feat: a bunch of changes! overhaul the thing (043a7ea)
- fix: install (b0bce25)
- feat: Use `pg_catalog` for more reliable schema introspection and add qualified table names for robust FK handling. (0d251ee)
- fix: some named queries (521e9c3)
- feat: add edit for named queries (6baa95c)
- refactor: prevent redundant column sizing updates and stabilize editor height management (e0b1557)
- feat: Improve Save Named Query dialog layout and parameter scrolling, and delete the old implementation plan. (dfcc1c9)
- chore: run npm audit  # Please enter the commit message for your changes. Lines starting (d924eae)
- feat: add electron support and also fix ui a little (9cb780f)
- feat: implement IPC architecture for desktop app, consolidate backend logic, and enhance packaging process (7f7983c)
- refactor: update default sizes in db-console and enhance named query editor with parameter reset on change (2b9a0ad)
- chore: update CHANGELOG structure and modify release script to insert new sections correctly (2709942)
- chore: clean changelog (3a301a2)
