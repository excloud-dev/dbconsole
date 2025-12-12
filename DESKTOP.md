# DBConsole Desktop (Electron)

This repo can be run both as:

- a normal Next.js web app (server-hosted), and
- a packaged macOS desktop app (Electron) that runs the same Next.js app locally.

## Prereqs

- Node.js (see `package.json` engines in dependencies like `better-sqlite3`)
- `npm install`

## Web app (unchanged)

- Dev: `npm run dev`
- Prod: `npm run build && npm run start`

## Electron (dev)

Runs `next dev` and then launches Electron pointed at it:

- `npm run electron:dev`

You can change the port with `ELECTRON_PORT=3000`.

## Electron (packaged)

1. Build a standalone Next server bundle for packaging:
   - `npm run electron:prepare`
2. Create a macOS build (DMG):
   - `npm run electron:dist:mac`

### Metadata DB location (important)

For desktop, `electron/main.cjs` sets `DBCONSOLE_META_SQLITE_PATH` to Electron’s
`userData` directory by default so the app always writes the SQLite metadata DB
to a user-writable location.

