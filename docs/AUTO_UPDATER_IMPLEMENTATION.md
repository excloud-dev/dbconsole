# Auto-Updater Implementation Documentation

## Overview
This document describes the implementation of the in-place auto-updater with differential downloads for DBConsole, following the plan outlined in `AUTO_UPDATER_PLAN.md`.

## Implementation Summary

### What Was Built

#### 1. Electron Builder Configuration
**File**: `electron-builder.yml`
- Added macOS `zip` target alongside existing `dmg` target
- Enables generation of blockmap files for differential downloads
- No configuration changes needed for publish provider

#### 2. ElectronUpdater Integration
**File**: `lib/updater/electron-updater.ts`

##### Key Features:
- **autoUpdater Configuration**: Configures `autoUpdater.setFeedURL()` with GitHub token authentication for private repository access
- **Fallback Mechanism**: Automatically falls back to custom GitHub updater if `autoUpdater` fails
- **Capability Detection**: Runtime detection of differential update support based on platform and configuration
- **Telemetry System**: Comprehensive event tracking for all update paths
- **Feature Flag Support**: Controlled rollout via `ENABLE_ELECTRON_AUTO_UPDATER` environment variable

##### New Public Methods:
```typescript
isDifferentialUpdateSupported(): boolean
getCapabilities(): {
    electronUpdaterEnabled: boolean
    differentialUpdatesSupported: boolean
    platform: string
    inPlaceUpdateSupported: boolean
}
```

##### Telemetry Events:
- `update-check-started`
- `update-check-success-electron`
- `update-check-success-custom`
- `update-check-no-update`
- `update-check-fallback`
- `download-started`
- `download-success-electron`
- `download-success-custom`
- `download-fallback`
- `auto-install-triggered`
- `update-notification-received`
- `update-error`

#### 3. IPC Handler Updates
**File**: `electron/ipc.ts`

##### Changes:
- Added feature flag `ENABLE_ELECTRON_AUTO_UPDATER` for gradual rollout
- Added `dbconsole:updater:capabilities` IPC handler to expose updater features
- Updated initialization to respect feature flag (defaults to `false`)

#### 4. UpdateController Enhancements
**File**: `lib/updater/update-controller.ts`

##### New Public Methods:
```typescript
getOwner(): string
getRepo(): string
```

These methods provide clean access to repository configuration without breaking encapsulation.

## How It Works

### Update Check Flow

1. **Check Initiated**: User triggers update check or background checker runs
2. **Electron AutoUpdater Path** (if enabled):
   - Calls `autoUpdater.checkForUpdates()`
   - Converts `ElectronUpdateInfo` to internal `UpdateInfo` format
   - On success: Returns update info with telemetry
   - On failure: Falls back to custom updater
3. **Custom Updater Path** (fallback or default):
   - Uses GitHub API to check releases
   - Filters by update channel
   - Returns update info if newer version found

### Download Flow

1. **Download Initiated**: User accepts update or auto-install triggered
2. **Electron AutoUpdater Path** (if enabled):
   - Calls `autoUpdater.downloadUpdate()`
   - Uses blockmap for differential downloads on macOS
   - Tracks download duration for telemetry
   - On success: Marks update as downloaded
   - On failure: Falls back to custom updater
3. **Custom Updater Path** (fallback or default):
   - Downloads full release asset via GitHub API
   - Verifies checksum
   - Prepares for installation

### Capability Detection

The system detects differential update support based on:
- `enableElectronUpdater` option is `true`
- `autoUpdater` successfully configured
- Platform is macOS (`darwin`)

## Configuration

### Feature Flag

Enable the new auto-updater via environment variable:
```bash
ENABLE_ELECTRON_AUTO_UPDATER=true
```

### Repository Configuration

Override repository settings for forks:
```bash
GITHUB_REPO_OWNER=your-org
GITHUB_REPO_NAME=your-repo
```

## Testing

### Test Coverage

**File**: `tests/electron-updater-integration.test.ts`
- 24 tests covering all aspects of the integration
- Capability detection for all platforms
- State management validation
- API surface verification
- Both enabled and disabled modes tested

### Running Tests

```bash
npm test -- electron-updater-integration.test.ts
```

## Deployment Strategy

### Phase 1: Controlled Rollout
1. Deploy with `ENABLE_ELECTRON_AUTO_UPDATER=false` (default)
2. Monitor custom updater continues working
3. Select beta testers for phase 2

### Phase 2: Beta Testing
1. Enable for beta testers: `ENABLE_ELECTRON_AUTO_UPDATER=true`
2. Monitor telemetry events for:
   - Success rate of `update-check-success-electron`
   - Fallback frequency (`update-check-fallback`, `download-fallback`)
   - Error rates (`update-error`)
3. Verify differential downloads working (check download duration telemetry)

### Phase 3: Gradual Rollout
1. Enable for 10% of users
2. Monitor for 1 week
3. Increase to 50% if stable
4. Monitor for 1 week
5. Enable for all users if stable

### Phase 4: Make Default
1. Update default to `ENABLE_ELECTRON_AUTO_UPDATER=true`
2. Continue monitoring telemetry
3. Keep fallback mechanism permanently for resilience

## Monitoring

### Key Metrics to Track

1. **Update Check Success Rate**
   - `update-check-success-electron` / total checks
   - Target: >95%

2. **Fallback Rate**
   - `update-check-fallback` + `download-fallback` / total operations
   - Target: <5%

3. **Download Performance**
   - Compare `durationMs` between electron and custom methods
   - Expect 30-70% reduction with differential downloads

4. **Error Rate**
   - `update-error` events / total operations
   - Target: <1%

### Telemetry Access

All telemetry events are emitted via:
```typescript
updater.on('telemetry', (event) => {
    // event.event: event name
    // event.data: event data
    // event.data.capabilities: current capabilities
    // event.timestamp: ISO timestamp
})
```

## Troubleshooting

### AutoUpdater Not Working

**Symptoms**: All updates using custom updater (fallback)

**Checks**:
1. Verify `ENABLE_ELECTRON_AUTO_UPDATER=true`
2. Check GitHub token is configured
3. Verify `dbconsole:updater:capabilities` returns `electronUpdaterEnabled: true`
4. Check logs for "Electron autoUpdater configured successfully"

### Differential Downloads Not Working

**Symptoms**: Full downloads even on macOS

**Checks**:
1. Verify platform is macOS: `process.platform === 'darwin'`
2. Check capabilities: `differentialUpdatesSupported` should be `true`
3. Ensure zip + blockmap files exist in release assets
4. Verify release was built with updated `electron-builder.yml`

### Frequent Fallbacks

**Symptoms**: High rate of fallback telemetry events

**Actions**:
1. Review error messages in fallback events
2. Check GitHub API rate limits
3. Verify token has correct permissions
4. Consider disabling feature flag temporarily

## Security Considerations

1. **Token Storage**: GitHub tokens encrypted using Electron's `safeStorage`
2. **Checksum Verification**: All downloads verified regardless of source
3. **Fallback Security**: Custom updater maintains same security as before
4. **No New Permissions**: Uses existing repository access token

## Future Enhancements

### Potential Improvements

1. **Windows Support**: Add NSIS target with blockmap support
2. **Linux Support**: Add AppImage delta updates
3. **Custom Channels**: Support beta/alpha channels with blockmap
4. **Signature Verification**: Add code signing verification
5. **Download Scheduling**: Smart scheduling based on network conditions

### Not Implemented (By Design)

1. **Auto-restart**: User must manually restart (by plan)
2. **Publishing Config**: Uses existing release workflow (by plan)
3. **Forced Updates**: Respects user preferences (by plan)

## References

- [Original Plan](AUTO_UPDATER_PLAN.md)
- [Electron autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater)
- [electron-updater Documentation](https://www.electron.build/auto-update)
- [Blockmap Documentation](https://github.com/electron-userland/electron-builder/blob/master/docs/auto-update.md#differential-download)
