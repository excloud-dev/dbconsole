# In-place Auto-Updater Plan (Electron)

## Current Snapshot
- Desktop updater stack lives in `lib/updater/*` with an `ElectronUpdater` wrapper that currently **disables** `autoUpdater` (`enableElectronUpdater: false`) and instead drives a custom GitHub release downloader via `UpdateAgentImpl`.
- Updates pull full GitHub release assets from a private repo using a stored GitHub token, run checksum verification, and hand off to a placeholder installer (`DesktopInstaller.performPlatformSpecificInstallation`).
- Packaging is via `electron-builder` (`electron-builder.yml`) with only a macOS DMG target today; no blockmap/differential artifacts are emitted and the install flow expects a manual relaunch (no in-place swap).

## Feasibility (Electron autoUpdater)
Electron’s `autoUpdater` (per https://www.electronjs.org/docs/latest/api/auto-updater) plus `electron-updater` from electron-builder supports:
- In-place updates with `quitAndInstall`, storing downloads under the user cache and swapping the app bundle.
- Differential/blockmap downloads for macOS zip and Windows NSIS/NSIS-web targets to move only changed chunks instead of full DMGs/installers.
- Private GitHub releases when provided an access token (`requestHeaders` / `GH_TOKEN`) and publish config that points to the private repo.

Given we already ship from a private GitHub repo and capture a token in `ConfigService`, we can wire the feed URL + headers into `autoUpdater` while keeping existing policy/maintenance-window checks in `UpdateController`.

## Proposed Plan of Action
1) **Publish artifacts suitable for in-place/differential updates**
   - Update `electron-builder.yml` targets to include macOS `zip` (in addition to `dmg`) and Windows `nsis`/`nsis-web` so blockmap files get generated.
   - Add a `publish` section (GitHub provider, owner/repo from env, `private: true`, `releaseType` per channel) and ensure CI uploads `.yml`/`.blockmap` metadata alongside binaries.
   - Keep signing/notarization intact so `autoUpdater` can trust the downloaded bundles.

2) **Wire `autoUpdater` into the existing updater surface**
   - Flip `enableElectronUpdater` to true once the feed is live; set `autoUpdater.requestHeaders.Authorization = Bearer <token>` using the token we already store.
   - Let `UpdateController` continue to enforce maintenance windows, auto-check/install flags, and history, but delegate download/install to `autoUpdater` when available; keep the current GitHub-download path as a fallback.
   - Reuse existing UI events (`download-progress`, `update-available`, `update-notification`) and surface `autoUpdater` progress so the renderer dialogs work unchanged.

3) **Differential / VS Code–style behavior**
   - Rely on electron-builder blockmap artifacts so `autoUpdater` performs chunked downloads; keep a feature flag to fall back to full installers if blockmap fails.
   - Cache location and cleanup are handled by `autoUpdater`; retain our checksum verification as a post-download guard for parity with today’s flow.

4) **Rollout and safety**
   - Start with a single channel (latest) and add prerelease/custom tag support by mapping our existing `updateChannel` setting to the feed URL or GitHub release filter.
   - Add telemetry/logging hooks (we already emit structured logs) for success/failure of `autoUpdater` paths to gate rollout.
   - Maintain the current manual install path during the transition and remove it once CI publishes delta-friendly artifacts for two consecutive releases without regressions.

5) **Next steps to implement**
   - Extend `electron-builder.yml` with zip/nsis-web targets and publish config; add CI secrets for `GH_TOKEN` with release permissions.
   - Teach `ElectronUpdater` to set `autoUpdater.setFeedURL`/`requestHeaders` using stored owner/repo/token and opt-in via env/feature flag.
   - Add a small capability check so renderer can show “delta enabled” vs. “full download fallback.”

This plan keeps the existing policy and token plumbing, adds official Electron in-place updates with differential downloads, and preserves the custom path as a fallback while we validate the new pipeline.
