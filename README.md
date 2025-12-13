# DBConsole

DBConsole is a lightweight **read-only Postgres console** with a modern UI for exploring schemas, running queries, and saving reusable “named queries”.

It can run as:

- **macOS desktop app** (Electron + Vite renderer + IPC backend)
- **Web app** (Next.js)

## Features

- **Postgres connection manager** (label/host/port/db/user/password)
- **Schema explorer**
  - Search tables and saved queries
  - Browse columns with PK/FK indicators
  - “Join Builder” that suggests joins from foreign keys
- **Query workspace**
  - Multiple tabs
  - Per-tab pagination (`LIMIT/OFFSET`) + optional total row count
  - Connection pool modes (`shared`, `single`, `per-scope`)
- **Read-only safety guardrails**
  - Only `SELECT` / `WITH` queries are allowed (blocks `INSERT/UPDATE/DELETE/...`)
  - Blocks multi-statement queries (`;`)
- **Parameters**
  - Raw SQL supports positional params (`$1`, `$2`, …) with UI inputs
  - Named queries support `:param` placeholders with typed params and defaults
  - Optional params: empty values automatically neutralize simple predicates (best-effort)
  - View **Template vs Rendered** SQL + copy-to-clipboard
- **Results grid**
  - Column resize + hide/show
  - Range selection + copy (TSV + CSV)
  - Fullscreen mode
  - Cell detail viewer
  - “Executed SQL” viewer (what was actually run)

## Install (macOS desktop)

1. Download the latest `.dmg` from GitHub Releases.
2. Drag `DBConsole.app` into `/Applications`.
3. Launch it.

## Usage (quick start)

1. Open **Settings** → add a Postgres connection.
2. Select a connection from the sidebar.
3. Browse tables, or open a query tab and run:
   - `SELECT 1 AS ok`
4. Save a reusable query via **Save Named Query** and run it with params later.

## Development

Prereqs: Node.js + npm.

### Web app

- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm run start`

### Desktop app (Electron)

- Dev (starts Vite + Electron): `npm run electron:dev`
- Package (DMG): `npm run electron:dist:mac`
  - Apple Silicon build: `npm run electron:dist:mac -- --arm64`

### Tests / lint

- Tests: `npm test`
- Lint: `npm run lint`

## Data & configuration

DBConsole stores local metadata (connections, named queries, query run logs) in a SQLite DB:

- Env override: `DBCONSOLE_META_SQLITE_PATH`
- Defaults:
  - **Desktop:** Electron `userData` directory (for example on macOS: `~/Library/Application Support/DBConsole/dbconsole-meta.sqlite`)
  - **Web/dev:** `./dbconsole-meta.sqlite`

---

## macOS note (GitHub builds): “DBConsole is damaged and can’t be opened”

This project’s GitHub releases are **not signed/notarized**. If macOS blocks the app after you copy it to `/Applications`, remove the quarantine attribute:

```sh
xattr -dr com.apple.quarantine "/Applications/DBConsole.app"
```

If it still won’t open, try clearing all extended attributes:

```sh
xattr -cr "/Applications/DBConsole.app"
```
