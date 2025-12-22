# In-place Auto-Updater Plan (Electron)

## Current Snapshot
- Desktop updater stack lives in `lib/updater/*` with an `ElectronUpdater` wrapper that currently **disables** `autoUpdater` (`enableElectronUpdater: false`) and instead drives a custom GitHub release downloader via `UpdateAgentImpl`.
- Updates pull full GitHub release assets from a private repo using a stored GitHub token, run checksum verification, and hand off to a placeholder installer (`DesktopInstaller.performPlatformSpecificInstallation`).
- Packaging is via `electron-builder` (`electron-builder.yml`) with only a macOS DMG target today; no blockmap/differential artifacts are emitted and the install flow expects a manual relaunch (no in-place swap).

## Feasibility (Electron autoUpdater)
Electron’s `autoUpdater` (per https://www.electronjs.org/docs/latest/api/auto-updater) plus `electron-updater` from electron-builder supports:
- In-place updates with `quitAndInstall`, storing downloads under the user cache and swapping the app bundle.
- Differential/blockmap downloads for macOS zip targets to move only changed chunks instead of full DMGs.
- Private GitHub releases using the existing token workflow already wired into `ConfigService` (no new secrets needed).

Given we already ship from a private GitHub repo and capture a token in `ConfigService`, we can wire the feed URL + headers into `autoUpdater` while keeping existing policy/maintenance-window checks in `UpdateController`, without adding signing/notarization or Windows targets.

## Proposed Plan of Action
1) **Publish artifacts suitable for in-place/differential updates**
   - Update `electron-builder.yml` targets to include macOS `zip` (alongside `dmg`) so blockmap files get generated.
   - Reuse the existing release workflow to upload the zip + blockmap metadata; skip adding an `electron-builder` publish tag/provider block.

2) **Wire `autoUpdater` into the existing updater surface**
   - Flip `enableElectronUpdater` to true once the feed is live; set `autoUpdater.requestHeaders.Authorization` using the token we already store (e.g., `Authorization: token ghp_xxx` for classic PATs, `Authorization: token github_pat_xxx` for fine-grained tokens, or `Authorization: Bearer <oauth_token>` for OAuth flows).
   - Let `UpdateController` continue to enforce maintenance windows, auto-check/install flags, and history, but delegate download/install to `autoUpdater` when available; keep the current GitHub-download path as a fallback.
   - Reuse existing UI events (`download-progress`, `update-available`, `update-notification`) and surface `autoUpdater` progress so the renderer dialogs work unchanged.

3) **Differential / VS Code–style behavior**
   - Rely on electron-builder blockmap artifacts so `autoUpdater` performs chunked downloads; keep a feature flag to fall back to full installers if blockmap fails.
   - Cache location and cleanup are handled by `autoUpdater`; retain our checksum verification as a post-download guard for parity with today’s flow.

4) **Rollout**
   - Start with a single channel (latest) and add prerelease/custom tag support by mapping our existing `updateChannel` setting to the feed URL or GitHub release filter.
   - Add telemetry/logging hooks (we already emit structured logs) for success/failure of `autoUpdater` paths.

5) **Next steps to implement**
   - Extend `electron-builder.yml` with a macOS zip target (no additional publish tag/config needed).
   - Use the existing updater token flow to set `autoUpdater.setFeedURL`/`requestHeaders` with stored owner/repo/token and opt-in via env/feature flag (no new GH token management).
   - Add a small capability check so renderer can show “delta enabled” vs. “full download fallback.”

This plan keeps the existing policy and token plumbing while adding Electron in-place updates with differential downloads on macOS using the current workflow.
