# Desktop (IPC) Architecture Plan

Goal

- Desktop Electron app uses IPC (no local Next server).
- Web app still uses HTTP (`app/api/*`).
- Share one “core” backend so logic stays single-source-of-truth.

Decisions (locked in)

- Desktop renderer build: **Vite** (static bundle).
- IPC API shape: **match `/api/*` JSON request/response bodies** (no desktop-only payload redesign).
- Errors: **mirror HTTP status codes** and error bodies:
  - Success returns the same JSON body you’d get from HTTP.
  - Failures surface a status code + body equivalent to HTTP (e.g. `{ error, issues? }`).

Non-goals

- Rewriting UI components for desktop.
- Maintaining two separate implementations of “business logic” (query engine, connections, schema, named queries).

High-level architecture (target)

- **Renderer (UI)**: React + Tailwind bundle (Vite recommended)
  - Calls a single `apiClient` abstraction.
  - Web: `apiClient` uses `fetch("/api/...")`.
  - Desktop: `apiClient` uses `window.dbconsole.api.*` (preload) → IPC.
- **Backend “core” (shared)**: transport-agnostic functions in `lib/core/*`
  - Uses existing server-only modules (`pg`, `better-sqlite3`, etc).
  - No Next/Electron imports.
- **Adapters**
  - Web: `app/api/*/route.ts` parses/validates request → calls `lib/core/*` → `NextResponse.json(...)`.
  - Desktop: `electron/ipc.ts` registers `ipcMain.handle(...)` → calls `lib/core/*` → returns JSON.

Why this is “better desktop”

- No local HTTP server/port management.
- Faster startup + fewer moving parts.
- Cleaner security boundary (renderer gets a narrow API surface).
- Packaging gets simpler (ship a static renderer + main-process backend).

Repo notes (what’s already true today)

- UI is already largely Next-agnostic (no `next/link`, `next/navigation`, etc).
- The main work for desktop is: **replace `fetch("/api/...")` usage** with a shared `apiClient`.
- Current desktop build runs an embedded Next server; this plan replaces that with IPC + static renderer.

---

Plan (incremental, with milestones)

M0 — Decisions (done)

- Vite for desktop renderer.
- IPC request/response JSON matches existing `/api/*`.
- IPC also mirrors HTTP status codes (see “Errors” below).

Acceptance criteria

- Decisions recorded (this section).

Checks you can run (baseline before starting)

- Web regression:
  - `npm test -- run`
  - `npm run lint`
  - `npm run build`
  - `npm run dev` (open `http://localhost:3000`, verify the UI loads and you can run a simple query like `SELECT 1`)
- Optional “real Postgres” coverage (enables skipped tests):
  - `DBCONSOLE_TEST_PG_URL='postgres://user:pass@host:5432/db' npm test -- run`

---

M1 — Extract a shared core backend (web keeps working)

1) Create `lib/core/` modules with transport-agnostic functions:

- `lib/core/connections.ts`
  - `listConnections(): ClientConnectionMeta[]`
  - `createConnection(draft): ClientConnectionMeta`
  - `updateConnection(id, patch): ClientConnectionMeta`
  - `deleteConnection(id): { success: true }`
  - `testConnection(draft): { ok: boolean, error?: string }` (optional: move out of route)
  - `releasePools(payload): { ok: true }`
- `lib/core/named-queries.ts`
  - `listNamedQueries()`
  - `getNamedQuery(id)`
  - `saveNamedQuery(payload)`
  - `deleteNamedQuery(id)`
- `lib/core/schema.ts`
  - `loadSchema(connectionId)`
- `lib/core/query.ts`
  - `runQuery(payload)`

2) Keep implementations calling existing server-only modules:

- Query: `lib/query-engine.ts`
- Schema: `lib/schema-introspection.ts`
- Connections/meta state: `lib/meta-db.ts`, `lib/connections.ts`, `lib/pg-pool.ts`

3) (Optional but recommended) Create shared Zod schemas in `lib/schemas/*`:

- Reuse the same validation for:
  - web routes (`app/api/*/route.ts`)
  - desktop IPC handlers

Acceptance criteria

- `npm run dev` for web still works.
- All `/api/*` routes still behave the same.
- No Electron code depends on Next route handlers.

Status (implemented)

- Implemented shared transport-agnostic core modules under `lib/core/*`:
  - `lib/core/connections.ts`
  - `lib/core/named-queries.ts`
  - `lib/core/query.ts`
  - `lib/core/schema.ts`
  - `lib/core/errors.ts` (typed status + body errors)
- Refactored web route handlers in `app/api/*/route.ts` to call `lib/core/*` (HTTP behavior preserved).
- Kept existing Zod validation at the route layer; core returns/throws errors that map cleanly to HTTP status/body.
- Tooling note: ESLint was updated to ignore generated build artifacts (`dist/**`, `.next/**`) to avoid linting bundled output.

Findings

- Web regression: `npm test -- --run` remains green after the refactor.
- In this sandbox, `next build` with Turbopack can fail due to local port/process restrictions; rerunning with escalated permissions succeeds.
- For M2 (Electron IPC), Electron’s `main.cjs` cannot directly import TypeScript modules using the `@/` path alias; a small bundling step is required to load `lib/core/*` in the main process.

Checks you can run (prove nothing broke + core is used)

- Automated regression:
  - `npm test -- run` (unit + API handler tests should still pass)
  - `npm run lint`
  - `npm run build`
- Manual web smoke:
  - `npm run dev`
  - In the browser: load the app, create/edit/delete a connection, run a query, save/delete a named query.
- Optional “real Postgres” coverage:
  - `DBCONSOLE_TEST_PG_URL='postgres://excloud:Motivate-Requisite-Kung-Earphone0@localhost:5432/excloud' npm test -- run`
  - In the web UI: add that connection (or use env connection) and run `SELECT 1`.

---

M2 — Add desktop IPC handlers + safe preload API

1) Add an IPC registration module (example structure):

- `electron/ipc.ts` registers:
  - `dbconsole:connections:list`
  - `dbconsole:connections:create`
  - `dbconsole:connections:update`
  - `dbconsole:connections:delete`
  - `dbconsole:connections:test`
  - `dbconsole:pools:release`
  - `dbconsole:namedQueries:list/get/save/delete`
  - `dbconsole:schema:load`
  - `dbconsole:query:run`

2) Each handler:

- Validates input (shared Zod schema recommended).
- Calls the `lib/core/*` function.
- Returns JSON-serializable results.
- Mirrors HTTP status codes:
  - Recommended implementation detail: IPC wire returns `{ status: number, body: unknown }`,
    then preload/client unwraps to match HTTP behavior (return body on 2xx, throw/return error body on 4xx/5xx).

3) Preload API (no raw `ipcRenderer` exposure)

- `electron/preload.cjs` exposes:
  - `window.dbconsole.isDesktop = true`
  - `window.dbconsole.api.connections.list()`, etc.
  - `window.dbconsole.api.query.run(payload)`, etc.

Acceptance criteria

- From renderer, you can successfully call **one** IPC endpoint end-to-end (e.g. list connections) and render it.
- `contextIsolation: true`, `nodeIntegration: false` remain.

Status (implemented)

- IPC handlers are registered in the Electron main process (compiled to a CommonJS bundle):
  - Source: `electron/ipc.ts`
  - Bundle output: `dist/electron/ipc.cjs` (generated by `scripts/electron-bundle-ipc.mjs`)
  - Main loads it via `electron/ipc-loader.cjs`
- Preload exposes a narrow surface area:
  - `window.dbconsole.isDesktop = true`
  - `window.dbconsole.api.*` methods that unwrap `{ status, body }` and throw an error with `{ status, body }` on failures
- Dev + packaging scripts build the IPC bundle and ship it:
  - `scripts/electron-dev.mjs` bundles IPC before launching Electron
  - `scripts/electron-prepare.mjs` bundles IPC during packaging prep
  - `electron-builder.yml` includes `dist/electron/ipc.cjs` in app files (asar)

Findings (important)

- Native module ABI mismatch (Node vs Electron) is real for `better-sqlite3`:
  - Electron requires an Electron-ABI build; Next dev requires a Node-ABI build.
  - Example failure observed in a packaged macOS build:
    - `better_sqlite3.node` was compiled with `NODE_MODULE_VERSION 141` (system Node 25), but Electron 39 requires `140`.
  - Solution implemented:
    - Dev: keep a separate Electron-only native tree at `dist/electron/native/deps/node_modules` and load it via `DBCONSOLE_ELECTRON_NATIVE_DIR`.
    - Prod: ship that native tree in the packaged app at `Resources/native/deps` and always set `DBCONSOLE_ELECTRON_NATIVE_DIR` (avoid Electron Builder occasionally packaging a Node-ABI `better-sqlite3`).
    - Packaging note: Electron Builder’s copy filter always excludes a *root* `node_modules` directory in `extraResources`, so the native deps must live under a non-root folder (`deps/node_modules`).
  - Scripts:
    - `npm run electron:prepare-native` prepares Electron-only `better-sqlite3` (output: `dist/electron/native/deps`)
    - `npm run node:rebuild-native` restores Node’s `better-sqlite3` build for web/dev tests if it gets overwritten

Checks you can run (prove IPC works + web still works)

- Automated regression (web still OK):
  - `npm test -- run`
  - `npm run lint`
  - `npm run build`
- Desktop IPC smoke (dev):
  - Run your Electron dev flow (keep using `npm run electron:dev` until M4 replaces the renderer).
  - In Electron DevTools console:
    - `await window.dbconsole.api.connections.list()` returns the same shape as `await fetch('/api/connections').then(r => r.json())`
    - Trigger one known-error case and verify parity:
      - example: call an IPC method with an invalid payload and confirm you can observe `status === 400` and an `{ error, issues? }` body matching HTTP.

---

M3 — Single frontend `apiClient` + shared UI

1) Create a single client layer (example):

- `lib/client/apiClient.ts`
  - exports typed methods matching your existing `/api/*` shape
  - internally delegates to a transport:
    - `httpTransport` (fetch)
    - `ipcTransport` (preload API)
  - normalizes error handling so both transports behave the same:
    - attaches `status` (HTTP status code) to thrown/rejected errors
    - keeps error JSON bodies consistent with the web routes

2) Update UI to use the client layer instead of `fetch("/api/...")`:

- Primary files to touch:
  - `components/db-console.tsx` (most API calls live here)
  - `components/connection-dialog.tsx`

Acceptance criteria

- Web app still works (HTTP routes unchanged).
- Desktop renderer can operate without any `/api/*` fetch calls.
- No duplicated UI components.

Status (implemented)

- Added a shared client abstraction that selects transport automatically:
  - `lib/client/apiClient.ts`
    - Web: uses `fetch("/api/...")`
    - Desktop: uses `window.dbconsole.api.*` (IPC)
    - Normalizes errors to `ApiError` with `status` and `body`
- Refactored UI to use the shared client instead of direct `fetch("/api/...")`:
  - `components/db-console.tsx`
  - `components/connection-dialog.tsx`

Checks you can run (prove web uses HTTP, desktop uses IPC)

- Automated regression:
  - `npm test -- run`
  - `npm run lint`
  - `npm run build`
- Web smoke (HTTP path):
  - `npm run dev`
  - Use browser DevTools → Network: confirm `/api/*` requests occur and succeed while using the UI.
- Desktop smoke (IPC path):
  - Run Electron dev.
  - Use Electron DevTools → Network: confirm **no** `/api/*` requests are made while using the UI.
  - Exercise the main flows: connection CRUD, schema load, run query, named query CRUD.
  - Error parity spot-check:
    - intentionally create an invalid request (e.g. empty connection label) and confirm the UI sees the same error body + status semantics as on web.

---

M4 — Desktop loads a static renderer bundle (no Next server)

1) Add Vite renderer (recommended)

- New folder (example): `desktop/renderer/`
  - `index.html`
  - `src/main.tsx` renders your existing UI (e.g. `<DbConsole />`)
  - imports shared CSS (Tailwind) from `app/globals.css` (or a new shared `styles/app.css`)

2) Handle the few Next-only UI concerns via “entry shell” differences:

- Web keeps:
  - `app/layout.tsx` metadata/viewport
  - `@vercel/analytics/next`
  - Next font loader usage (if desired)
- Desktop Vite entry:
  - no Next metadata/analytics
  - fonts loaded via plain CSS (e.g. `@font-face`) or system fonts

3) Update Electron main:

- Dev: load Vite dev server URL.
- Prod: `win.loadFile(...)` to the built `index.html`.
- Remove/disable embedded Next server startup code for the IPC build variant.

Acceptance criteria

- Desktop starts with **no localhost Next server**.
- Desktop UI fully functional through IPC.
- Packaging includes only:
  - Electron main/preload
  - rebuilt native modules for Electron
  - the static renderer bundle

Status (implemented)

- Added a Vite renderer at `desktop/renderer/` that renders the existing `<DbConsole />`:
  - `desktop/renderer/src/main.tsx`
  - Build output goes to `dist/renderer/`
- Electron now:
  - Dev: loads `ELECTRON_RENDERER_URL` (default `http://127.0.0.1:5173`)
  - Prod: loads `dist/renderer/index.html` (packaged under `Resources/renderer/index.html`)
- Updated dev + packaging scripts:
  - `npm run renderer:dev` / `npm run renderer:build`
  - `npm run electron:dev` now starts the Vite renderer dev server (no Next dev server) and launches Electron
  - `npm run electron:prepare` builds native deps + renderer + IPC bundle for packaging

Notes

- The web app still uses Next (`npm run dev`) unchanged; desktop now uses the Vite renderer + IPC.
- Verified:
  - Renderer makes **0** `/api/*` HTTP calls (IPC-only).
  - Connection CRUD works.
  - Named query CRUD works.
- Fixed two issues found during desktop bring-up:
  - `npm run electron:dev` could exit immediately if another DBConsole instance was running; single-instance lock is now only enforced in packaged apps.
  - Refreshing schema could blank the SQL editor UI (while the query still executed); CodeMirror now seeds state from the latest editor value to prevent losing the visible doc.

Checks you can run (prove “no Next server” + Vite renderer works)

- Automated regression (web still OK):
  - `npm test -- run`
  - `npm run lint`
  - `npm run build`
- Desktop dev (Vite renderer):
  - Start the Vite dev server for the renderer (`npm run renderer:dev`).
  - Start Electron pointed at the Vite dev URL (`npm run electron:dev`).
  - Confirm the app loads and the UI works (through IPC).
- Desktop “prod-like” local check:
  - Build the Vite renderer bundle (add a script, e.g. `npm run renderer:build`).
  - Run Electron loading `index.html` via `win.loadFile(...)`.
  - In Electron DevTools console:
    - `window.location.protocol` should be `file:` (when not using the dev server).
  - Confirm there is no Next server process started/logged.

---

M5 — Packaging, persistence, hardening (polish)

- Persist SQLite under `app.getPath("userData")` (already the direction).
- Ensure native modules are rebuilt for Electron and shipped in `Resources/native/deps` (`better-sqlite3`, any others).
- Lock down preload surface area and validate every IPC payload.
- Add smoke tests for:
  - “query run works”
  - “schema load works”
  - “connection CRUD works”

Status (in progress)

- Packaging: native deps load correctly in the packaged app (no missing module / ABI mismatch for `better-sqlite3`).
- Smoke tested (manual): connection CRUD, named query CRUD.
- Added an app info endpoint for debugging builds:
  - Desktop: `dbconsole:app:info` (IPC)
  - Web: `/api/app-info` (HTTP)
  - Displayed in the settings dialog as “DBConsole vX.Y.Z • build <sha>”.
- Remaining: schema load, query run, persistence across restarts, error parity spot-checks.

Manual smoke checklist (packaged app)

- Startup
  - Launch the packaged `.app` from Finder (not from the build directory via Node).
  - Confirm the app opens without IPC bundle / native module errors.
- Persistence
  - Create/edit/delete a connection, restart the app, confirm the change persisted.
  - Create/edit/delete a named query, restart the app, confirm the change persisted.
- Schema
  - Connect to a DB with a non-trivial schema.
  - Click “refresh schema” and confirm tables/columns populate and autocomplete suggests table/column names.
- Query run (raw)
  - Run `SELECT 1 AS ok`.
  - Run a “top 100” table query from the tables list and verify paging (next page / limit) works.
  - Verify read-only guard blocks writes (e.g. `DELETE FROM ...`) with a clear error.
- Query run (named)
  - Run a named query with params (including blank/optional params) and confirm the rendered SQL and results look correct.
- Error parity spot-check
  - Trigger one “bad request” client error (e.g. invalid payload / missing required field) and ensure the UI surfaces status + message consistently on web and desktop.

Acceptance criteria

- `electron-builder` produces a working macOS app.
- Renderer cannot access Node APIs directly; only allowed IPC calls.

Checks you can run (prove packaging + persistence + native modules)

- Automated regression:
  - `npm test -- run`
  - `npm run lint`
  - `npm run build`
- Packaging smoke:
  - Build the app (e.g. `npm run electron:dist:mac` after it’s updated for the IPC/Vite variant).
  - Launch the built `.app` from `dist/` and verify:
    - app starts without “native module ABI mismatch” errors
    - you can create connections / run queries / save named queries
    - the metadata DB is created under the macOS user data directory (Electron `app.getPath('userData')`)
- Hardening spot-check:
  - Verify Electron `BrowserWindow` still uses `contextIsolation: true`, `nodeIntegration: false`, and the renderer cannot access Node globals.

---

Key decisions to make (recommended defaults)

- **Renderer build system:** Vite for desktop (locked in).
- **API compatibility:** IPC request/response bodies match `/api/*` (locked in).
- **Error parity:** IPC mirrors HTTP status codes + error bodies (locked in).
- **Shared logic:** one `lib/core/*`, two thin adapters (HTTP + IPC).
- **UI sharing:** shared `components/*`, separate tiny entry shells only.
