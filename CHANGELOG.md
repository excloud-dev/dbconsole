# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- TBD

## v0.1.0 - 2025-12-13

- Desktop: IPC-first backend + Vite renderer (no embedded Next server).
- Web: Backend logic consolidated into `lib/core/*` and reused by `/api/*` routes.
- Packaging: Electron-native `better-sqlite3` shipped separately to avoid ABI mismatches.
- Fixed: SQL editor could appear blank after schema refresh.
- CI: Tag-push GitHub Actions release workflow for macOS arm64.

<!--
Release format:

## v0.1.0 - 2025-12-13
- Added: ...
- Fixed: ...
- Changed: ...
-->
