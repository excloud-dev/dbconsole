# TODO

## Desktop App / Packaging
- [x] Electron app.
- [x] Figure out if we need a seperate node_modules and setup for electron
- [x] Reduce desktop bundle size by packaging Electron from a minimal `dist/electron/app` (own `package.json`) and setting `directories.app` in `electron-builder.yml` so root (Next/web) deps don’t get bundled.
- [x] Disable/strip sourcemaps in release builds (Vite renderer + IPC bundle) and stop shipping `dist/electron/ipc.cjs.map`.
- [ ] Explore tauri instead of electron for leaner dmg and maybe perf?
- [ ] Explore native packaging with native swiftui appkit views. May need to build a custom bridge?? or get rid of ipc.
- [x] Updater
- [ ] Make updater better. Try to get vscode style updates! Currenly its very primitive.

## API & Backend
- [x] Syncer api endpoint to allow syncing of named queries. Need to handle conflict resolution properly. Add a diff panel for this.
- [x] Create sort of an SDK lib package for the API. And use that instead of doing fetch everytime. [apiClient]
- [ ] Explore if we need some sort of auth prob using cloudflare access.
- [x] Encrypt the connection passwords somehow

## Query & Data Handling
- [ ] Fix the query info in data grid table to show the actual query executed.
- [ ] Auto add params to saved query from where clauses and not just :mac things.
- [ ] Add a way to export the query results to a CSV file.
- [ ] Filter/Order in data grid.

## UI/UX Improvements
- [x] Fix the sidebar styling. make it consistent with the rest of the app.
- [ ] Fix setting modal styling, make it consistent with the rest of the app.
- [x] Shortcuts! But want to do this via a seperate interface if possible so we can remap shortcuts from settings if needed. Disable some for web or have sensible defaults for web vs desktop.
- [ ] Add support to open sql files in desktop.
- [ ] Dark mode!
- [ ] Fix fullscreen datagrid view. 
- [ ] When cells are highlighed, it looks a little off. investigate.
- [ ] Fix the toggle columns modal/dialog thing.