# Changelog

All notable changes to this project will be documented in this file.

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
