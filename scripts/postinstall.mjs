import { spawnSync } from 'node:child_process'

function isTruthy(v) {
    if (!v) return false
    const s = String(v).trim().toLowerCase()
    return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

// Server installs (install.sh / make install) should skip Electron postinstall work.
// This avoids failures on minimal hosts and speeds up installs.
const skip =
    isTruthy(process.env.DBCONSOLE_SKIP_POSTINSTALL) ||
    isTruthy(process.env.DBCONSOLE_SKIP_ELECTRON_POSTINSTALL) ||
    isTruthy(process.env.DBCONSOLE_SERVER_INSTALL)

if (skip) {
    console.log('[postinstall] Skipping (DBCONSOLE_SKIP_POSTINSTALL/DBCONSOLE_SERVER_INSTALL set)')
    process.exit(0)
}

function run(cmd, args) {
    const res = spawnSync(cmd, args, { stdio: 'inherit' })
    if (res.error) throw res.error
    if (typeof res.status === 'number' && res.status !== 0) process.exit(res.status)
}

// Keep existing behavior for desktop/electron dev workflows
run(process.execPath, ['scripts/electron-init-app-dir.mjs'])

// Use local electron-builder without downloading anything
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
run(npx, ['--no-install', 'electron-builder', 'install-app-deps'])


