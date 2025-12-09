# dbconsole / database-console-app – Implementation Plan

_Last updated: 2025-12-09_

This file explains:

- What already exists in this repo.
- What’s still missing relative to the vision in `AGENT_STATE.md`.
- A concrete, ordered plan to finish the app.

The goal is to keep the existing UI and design system intact and simply wire it up to real Postgres targets and a SQLite metadata DB, following the constraints in `AGENT_STATE.md`.

---

## 1. Current snapshot

**Tech / stack**

- Next.js **16** app in this repo root.
- React **19**, TypeScript, Tailwind CSS v4 with shadcn-style component library under `components/ui`.
- Design system is set up in `app/globals.css` and used consistently across the custom components.

**Layout & main screen**

- `app/page.tsx` renders `<DbConsole />` full-screen.
- `components/db-console.tsx` composes the app shell:
  - Collapsible left sidebar (`SchemasSidebar`).
  - Query tabs (`QueryTabs`).
  - Raw SQL editor (`QueryEditor`).
  - Named query view (`NamedQueryEditor`).
  - Results grid (`DataGrid`).
  - Connection settings dialog (`ConnectionDialog`).
  - Save-as-named-query dialog (`SaveNamedQueryDialog`).

**What’s implemented in the UI (client-side only for now)**

- **Connections UI**
  - `ConnectionDialog` lets you create/edit/delete connection objects (id, name, host, port, db, user, password, ssl).
  - `DbConsole` keeps a local list of `connections` and `activeConnection` in React state.
  - `SchemasSidebar` shows current connection and lets you switch between them.
  - `ConnectionSelector` exists as a reusable dropdown component but is not yet wired into `DbConsole`.

- **Schema/sidebar & join helper UI**
  - `SchemasSidebar` shows a tables list plus "Saved Queries" for quick access.
  - It uses a hard-coded `mockTables` array (users/orders/products/order_items/sessions) for table/column metadata.
  - Per-table **Join Builder** button opens `JoinBuilderDialog`.
  - `JoinBuilderDialog` lets you:
    - See a visual chain of joined tables.
    - Add/remove joins along FK-like relationships (also driven from the mock schema).
    - Choose join type (INNER/LEFT/RIGHT/FULL).
    - Emit a join configuration back to `DbConsole`, which then creates a new query tab with a generated SQL `SELECT ... JOIN ... LIMIT 100;`.

- **Query tabs & editors**
  - `QueryTabs` renders multi-tab query sessions with support for closing and adding tabs.
  - `QueryEditor` provides a simple textarea SQL editor:
    - "Run" button currently just logs to `console.log`.
    - "Save as Named" opens `SaveNamedQueryDialog` if the query is non-empty.
  - `SaveNamedQueryDialog` lets you name a query, give it a description, and define parameters:
    - Auto-detects `:paramName` patterns in the SQL and can auto-populate the parameter list.
    - Lets you choose type (string/number/boolean) and default.
  - `DbConsole` maintains an in-memory array of `namedQueries` and uses it to:
    - Open named queries as tabs.
    - Keep track of which tabs are tied to which named queries (`isNamedQuery`, `namedQueryId`).
  - `NamedQueryEditor` renders a form for parameters, can render the parameterized SQL template, and on "Run":
    - Builds the final query string by doing a naive `:param` string replacement.
    - Calls `onExecute`, which in `DbConsole` is currently just `console.log`.

- **Results grid**
  - `DataGrid` is a styled, virtual-agnostic table component.
  - `DbConsole` currently passes a **static** `results` object with fake columns/rows.
  - No wiring yet between query execution and `DataGrid` – it’s always showing the mock data.

**Server-side / data layer state**

- There are **no `app/api/*` route handlers**.
- There is **no server-side Postgres or SQLite client code**.
- There is **no metadata DB** for connections/named queries/logs.
- No environment-variable parsing logic is present.
- `AGENT_STATE.md` still describes an earlier world where there was no Next.js app yet; the section _“3. Current state of `dbconsole` in the repo”_ is now outdated for this project. The rest of its functional requirements are still applicable.

---

## 2. Gaps vs the target described in `AGENT_STATE.md`

### 2.1. Connections & metadata DB

Missing pieces:

- **Env-based connections**
  - No parsing of `DBCONSOLE_CONNECTIONS_JSON` from env.
  - No concept of `from: 'env' | 'ui'` or `readOnly: boolean` beyond simple booleans.
- **UI-defined connections in SQLite**
  - No SQLite file, no schema for `dbconsole_connections`.
  - UI currently holds connection definitions entirely in client memory; nothing persists.
- **Separation of server vs client data**
  - Full connection details (host, database, user, password) exist client-side.
  - There is no server-only storage of `url` that is never sent to the browser.

### 2.2. Query engine (read-only Postgres access)

Missing pieces:

- **No `/api/query/run` endpoint** to execute SQL:
  - No concept of input kinds: `{ kind: 'raw' }` vs `{ kind: 'named' }`.
  - No enforcement of **read-only SQL** (only SELECT/WITH), or single-statement checks.
  - No query timeout or row limit enforcement.
- **No Postgres client** (`pg` or similar) wired up on the server.
- **No logging of query runs** to `dbconsole_query_runs`.

### 2.3. Schema introspection & join helper

Missing pieces:

- **No schema introspection** against target Postgres connections:
  - No `SchemaGraph` building from `information_schema` / `pg_catalog`.
  - No `/api/schema?connectionId=...` route.
- **Join helper not connected to real metadata**:
  - `SchemasSidebar` and `JoinBuilderDialog` currently rely on `mockTables`, not on the actual DB schema.
  - No way to refresh schema for a given connection.

### 2.4. Named queries & catalog

Missing pieces:

- **No `dbconsole_queries` / `dbconsole_query_runs` tables** in the SQLite metadata DB.
- **No server API** to create/list/update/delete named queries:
  - UI saves named queries only in memory.
  - Query execution for named queries is not hooked to the server or to the metadata DB.

### 2.5. Observability, safety, and UX glue

Missing pieces:

- No centralized error handling or user-visible error messages for:
  - Connection failures.
  - SQL errors.
  - Env misconfiguration.
- No use of existing toast/snackbar utilities (`sonner`, `hooks/use-toast`) for success/error feedback.
- No query history / recent runs UI (optional but useful for power users).
- No clear indication in the UI that **all queries are read-only**.

---

## 3. Implementation plan (ordered, incremental)

This is organized roughly in the order you should implement things. Each step should be small enough to verify with manual tests and keep the current UI look & feel.

### 3.1. Core dependencies & environment wiring

1. **Add DB clients (when you’re ready to implement the backend):**
   - Use the package manager, **never edit `package.json` by hand**:
     - Add Postgres client: `pg` (or similar) via `npm i pg`.
     - Add SQLite client: e.g. `better-sqlite3` or `sqlite3` via `npm i <driver>`.
   - Before installing, confirm latest compatible versions with Next.js 16 and Node runtime.

2. **Environment variables & `.env` conventions:**
   - Support (server-side only):
     - `DBCONSOLE_CONNECTIONS_JSON` – JSON array of env-defined connections with full URLs.
     - `DBCONSOLE_META_SQLITE_PATH` – absolute or relative path to the metadata SQLite file. If unset, default to a local path like `./dbconsole-meta.sqlite` inside the app root.
   - Keep these variables documented at the top of the repo (README or this plan) and ensure they are never referenced from client components.

3. **Metadata DB bootstrap helper:**
   - Create `lib/meta-db.ts` (server-only) that:
     - Opens/creates the SQLite file at `DBCONSOLE_META_SQLITE_PATH`.
     - Runs idempotent migrations on first access to create:
       - `dbconsole_connections`.
       - `dbconsole_queries`.
       - `dbconsole_query_runs`.
     - Exposes typed helpers such as:
       - `getUiConnections()` / `createConnection()` / `updateConnection()` / `deleteConnection()`.
       - `getNamedQueries()` / `getNamedQuery(id)` / `upsertNamedQuery()` / `deleteNamedQuery()`.
       - `logQueryRun(...)` for audit logging.

### 3.2. Connection model & routes

4. **Unified connection type & env parsing (server-only):**
   - Create `lib/connections.ts` with types inspired by `AGENT_STATE.md`:

     ```ts
     type ConnectionOrigin = 'env' | 'ui'

     type DbConnection = {
       id: string
       label: string
       kind: 'postgres'
       from: ConnectionOrigin
       readOnly: boolean
       // server-only fields
       url: string
     }
     ```

   - Implement:
     - `loadEnvConnections()` – parses `DBCONSOLE_CONNECTIONS_JSON`, maps to `DbConnection[]` with `from: 'env'`.
     - `loadUiConnections()` – reads from `dbconsole_connections` in SQLite and returns `DbConnection[]` with `from: 'ui'`.
     - `getAllConnections()` – merges env and UI connections into one list.
     - `getConnectionById(id)` – returns a single connection (server-only, includes `url`).

5. **Connections API routes:**
   - Add route handlers under `app/api/connections`:
     - `GET /api/connections`
       - Returns a **client-safe** shape: no `url`, only `id`, `label`, `kind`, `from`, `readOnly`.
     - `POST /api/connections`
       - Creates a new UI connection in SQLite.
       - Accepts structured fields like `host`, `port`, `database`, `user`, `password`, `ssl`, and constructs a Postgres URL server-side.
       - Returns the new connection in the client-safe shape.
     - `PUT /api/connections/[id]`
       - Updates an existing UI connection (env connections are read-only; reject edits for `from: 'env'`).
     - `DELETE /api/connections/[id]`
       - Deletes a UI connection by id (again, env connections cannot be deleted).

6. **Wire `DbConsole` & `ConnectionDialog` to the API:**
   - Replace the hard-coded `connections` state in `DbConsole` with state that is initialized via a fetch to `/api/connections`.
   - Update `ConnectionDialog` to call the above API routes instead of mutating in-memory state only.
   - Ensure that:
     - Passwords and full URLs never appear in React state that is rendered to the client; only safe metadata does.
     - Env-defined connections are shown in the list but rendered as read-only (no delete, limited editing UI).

### 3.3. Named queries & metadata-backed catalog

7. **Metadata schema for named queries & logs:**
   - Implement the tables sketched in `AGENT_STATE.md` inside the SQLite DB:
     - `dbconsole_queries` – stores named queries and their parameter metadata.
     - `dbconsole_query_runs` – stores execution logs (named or ad-hoc).

8. **Named queries API routes:**
   - Add `app/api/named-queries` handlers:
     - `GET /api/named-queries` – list of named queries (id, name, description, maybe default connection).
     - `POST /api/named-queries` – create a new named query from the Save dialog.
   - Add `app/api/named-queries/[id]` handlers:
     - `GET` – details for a single named query.
     - `PUT` – update name/description/query/params.
     - `DELETE` – delete a named query.

9. **Wire UI components to named queries API:**
   - `DbConsole`:
     - On mount, fetch `/api/named-queries` and populate the `namedQueries` list instead of the current hard-coded sample data.
   - `SaveNamedQueryDialog`:
     - On save, call `POST /api/named-queries`.
     - On success, update local `namedQueries` state and close the dialog.
   - `NamedQueryEditor`:
     - Keep the current UX, but have `onExecute` call the query engine (see next section) rather than `console.log`.

### 3.4. Read-only query engine & `/api/query/run`

10. **SQL safety utilities (server-only):**
    - Add `lib/sql/safety.ts` with helpers like:
      - `isReadOnlySql(sql: string): boolean` – enforce:
        - Trimmed, lower-cased SQL starts with `select` or `with`.
        - No additional statements separated by `;` (only allow a trailing semicolon at most).
        - Optionally, reject certain keywords entirely (`insert`, `update`, `delete`, `alter`, `drop`, `truncate`, etc.).
      - `normalizeSql(sql: string): string` – trim, normalize whitespace, etc., for logging.

11. **Query engine implementation:**
    - Create `lib/query-engine.ts`:
      - Input types:
        - `RawQueryInput = { kind: 'raw'; sql: string; connectionId: string }`.
        - `NamedQueryInput = { kind: 'named'; queryId: string; params: Record<string, unknown>; connectionId?: string }`.
      - Core function:

        ```ts
        async function runQuery(input: RawQueryInput | NamedQueryInput): Promise<QueryResult>
        ```

        where `QueryResult` includes:
        - `columns: string[]`.
        - `rows: Record<string, unknown>[]`.
        - `rowCount: number`.
        - `durationMs: number`.

      - Behaviour:
        - Resolve `connectionId` to a `DbConnection` via `getConnectionById`.
        - For `kind: 'raw'`:
          - Enforce `isReadOnlySql` before executing.
        - For `kind: 'named'`:
          - Load the named query from SQLite.
          - Safely interpolate params (either with parameter placeholders or well-sanitized string replacement, depending on `pg` usage).
        - Execute SQL via the Postgres client with:
          - A **timeout** (e.g. 5–10 seconds).
          - A **row limit** (e.g. apply `LIMIT` if absent, or cap what you return to the client).
        - Always log into `dbconsole_query_runs` (even on failure).

12. **`/api/query/run` route handler:**
    - Add `app/api/query/run/route.ts`:
      - Accepts `POST` with a JSON body validated by `zod` (already available in dependencies).
      - Delegates to `runQuery`.
      - Returns `200` with `{ columns, rows, rowCount, durationMs }` on success.
      - Returns `4xx/5xx` errors with a structured error payload and a message suitable for displaying in a toast.

13. **Wire `QueryEditor` and `NamedQueryEditor` to the query engine:**
    - In `DbConsole`:
      - Replace the static `results` state with **per-tab** query results:
        - Extend `Tab` or maintain a parallel `tabResults: Record<Tab['id'], QueryResult | null>`.
      - When a query is executed:
        - Determine the input shape ({ kind: 'raw' | 'named', ... }).
        - Call `fetch('/api/query/run', { method: 'POST', ... })` from the client.
        - Set the result for the active tab on success; store any error message alongside the tab.
      - Pass the active tab’s result into `DataGrid` instead of the static mock data.
    - Add simple loading/error indicators in the UI (see 3.6 below).

### 3.5. Schema introspection & join helper hookup

14. **Schema introspection helper (server-only):**
    - Implement `lib/schema-introspection.ts`:
      - Given a `DbConnection`, query Postgres system catalogs (`information_schema`/`pg_catalog`) to build a `SchemaGraph`:

        ```ts
        type TableRef = { schema: string; name: string }

        type ColumnInfo = {
          table: TableRef
          name: string
          dataType: string
          isNullable: boolean
        }

        type ForeignKeyEdge = {
          from: TableRef
          fromColumn: string
          to: TableRef
          toColumn: string
        }

        type SchemaGraph = {
          tables: TableRef[]
          columns: ColumnInfo[]
          foreignKeys: ForeignKeyEdge[]
        }
        ```

      - Keep the queries simple and well-indexed; you only need enough fidelity to power the sidebar and join helper.

15. **`/api/schema` route handler:**
    - Add `app/api/schema/route.ts`:
      - `GET /api/schema?connectionId=...`.
      - Resolves connection, builds `SchemaGraph`, returns JSON (possibly simplified to only what the UI needs).

16. **Wire `SchemasSidebar` and `JoinBuilderDialog` to real schema data:**
    - Replace `mockTables` with a prop-driven `tables` array, supplied by `DbConsole`.
    - In `DbConsole`:
      - On `activeConnection` change, fetch `/api/schema?connectionId=...`.
      - Store the resulting tables/columns/FKs in state and pass down to `SchemasSidebar`.
    - Update `JoinBuilderDialog` usage to consume the real tables instead of the mock schema.

### 3.6. UX, error handling, and polish

17. **Loading & error states:**
    - Use existing design primitives (`Button`, `Spinner` if available, `Alert`, etc.) to add:
      - Loading spinners / disabled states while:
        - Running a query.
        - Loading schema.
        - Fetching/saving connections.
      - Error banners or inline messages when API calls fail.

18. **Toasts & notifications:**
    - Use `sonner` or the existing `hooks/use-toast` helper to show:
      - Success message when a query completes.
      - Error message when a query fails (with a concise, non-leaky message).
      - Success/error for connection tests and named query saves.

19. **Read-only affordances:**
    - Make it visually obvious that the console is **read-only**:
      - Add a small "Read-only" badge in the header.
      - Optionally show the role name or connection label with a lock icon when it’s known to be read-only.

20. **Small UI refinements (optional, design-system aligned):**
    - Use `ConnectionSelector` in the header if it fits better than the current sidebar dropdown.
    - Add small hints/tooltips for advanced actions (join builder, save-as-named, etc.).

### 3.7. Testing, validation, and docs

21. **Type-level and runtime validation:**
    - Ensure all server modules are type-safe with strict TypeScript.
    - Use `zod` schemas for:
      - API request/response validation (`/api/query/run`, `/api/schema`, `/api/connections`, `/api/named-queries`).
      - Environment variable parsing (so startup fails loudly on bad configs).

22. **Minimal automated tests (as time allows):**
    - Add lightweight tests for pure helpers:
      - `isReadOnlySql`.
      - SQL normalization and input parsers.
      - Schema introspection transformers (given fake catalog rows → expected `SchemaGraph`).

23. **Operational notes / README:**
    - Add a short `README.md` describing:
      - Required env vars with examples.
      - How to run the app in dev (`npm install`, `npm run dev`).
      - How to configure one or two sample connections (e.g., local Postgres with a read-only user).
      - Any deployment-specific notes (e.g., where to mount the SQLite file in production).

---

## 4. Summary

- The **UI shell and design language are largely complete** and should be preserved.
- The remaining work is almost entirely **backend and wiring**:
  - Add Postgres + SQLite support.
  - Implement connection management, schema introspection, and a safe read-only query engine.
  - Persist named queries and logs in the SQLite metadata DB.
  - Replace mocked data and `console.log` calls with real API calls, preserving the existing UX.

Following the steps above should get you from the current polished mock UI to a fully functional, safe, read-only internal database console for excloud, without changing the visual design or introducing new frontend stacks.