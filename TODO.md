# TODO

## Desktop App / Packaging
- [ ] Explore tauri instead of electron for leaner dmg and maybe perf?
- [ ] Explore native packaging with native swiftui appkit views. May need to build a custom bridge?? or get rid of ipc.
- [ ] Make updater better. Try to get vscode style updates! Currenly its very primitive.
- [x] Electron app.
- [x] Figure out if we need a seperate node_modules and setup for electron
- [x] Reduce desktop bundle size by packaging Electron from a minimal `dist/electron/app` (own `package.json`) and setting `directories.app` in `electron-builder.yml` so root (Next/web) deps don’t get bundled.
- [x] Disable/strip sourcemaps in release builds (Vite renderer + IPC bundle) and stop shipping `dist/electron/ipc.cjs.map`.
- [x] Updater

## API & Backend
- [ ] Allow for exporting named queries
- [x] Syncer api endpoint to allow syncing of named queries. Need to handle conflict resolution properly. Add a diff panel for this.
- [x] Create sort of an SDK lib package for the API. And use that instead of doing fetch everytime. [apiClient]
- [x] Encrypt the connection passwords somehow
- [x] Explore if we need some sort of auth prob using cloudflare access. -> No

## Query & Data Handling
- [ ] Filter/Order in data grid.
- [ ] Fix the query info in data grid table to show the actual query executed.
- [ ] Auto add params to saved query from where clauses and not just :mac things.
- [ ] Allow updating/deleting in certain DB connections (For eg local). So like a readonly toggle for connections.
- [ ] Allow returning all rows in datagrid. Like NO limit option.
- [ ] Allow opening+running sql files with a bunch of queries.
- [x] Add a way to export the query results to a CSV file.

## UI/UX Improvements
- [ ] When cells are highlighed, it looks a little off. investigate.
- [ ] Fix fullscreen datagrid view. 
- [ ] Fix setting modal styling, make it consistent with the rest of the app.
- [ ] Fix the toggle columns modal/dialog thing.
- [ ] Explore allowing for both SET and WHERE for same column in UPDATE queries
- [x] Dark mode!
- [x] Fix the sidebar styling. make it consistent with the rest of the app.
- [x] If i press the view button and a query if the same query exists dont do anything just execute again
- [x] Shortcuts! But want to do this via a seperate interface if possible so we can remap shortcuts from settings if needed. Disable some for web or have sensible defaults for web vs desktop.
- [x] Add support to open sql files in desktop.
- [x] Add an option to generate/create INSERT and UPDATE queries to run.
- [x] Selecting another connection and running should run the query using that connection!
- [x] Remember last used connection
- [x] Allow rearranging tabs
- [x] Tabs not scrolling properly. cannot scroll em and generate button goes out of view if too many tabs.
- [x] Need a confirmation that query has run. Everytime i run it.
