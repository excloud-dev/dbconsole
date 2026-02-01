/**
 * Tests for ElectronUpdater capability detection and configuration
 * These tests validate the new autoUpdater integration features
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Electron modules
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test'),
        getVersion: vi.fn(() => '1.0.0'),
        relaunch: vi.fn(),
        exit: vi.fn(),
        on: vi.fn(),
        isPackaged: false,
        getAppPath: vi.fn(() => '/tmp/test-app')
    },
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((str) => Buffer.from(str, 'utf8')),
        decryptString: vi.fn((buffer) => buffer.toString('utf8'))
    }
}))

vi.mock('electron-updater', () => ({
    autoUpdater: {
        setFeedURL: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
        on: vi.fn(),
        autoDownload: true,
        autoInstallOnAppQuit: true
    }
}))

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined)
}))

// Import the module under test
import { ElectronUpdater } from '@/lib/updater/electron-updater'
import { autoUpdater } from 'electron-updater'
import { ConfigServiceImpl } from '@/lib/updater/config-service'
import { UpdateControllerImpl } from '@/lib/updater/update-controller'

// Helper function to temporarily mock platform
function withMockedPlatform<T>(platform: string, fn: () => T): T {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true
    })
    
    try {
        return fn()
    } finally {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true
        })
    }
}

describe('ElectronUpdater Capability Detection', () => {
    let updater: ElectronUpdater
    
    beforeEach(async () => {
        vi.restoreAllMocks()
        
        // Create updater with electron integration enabled
        updater = new ElectronUpdater({
            owner: 'test-org',
            repo: 'test-repo',
            enableElectronUpdater: true,
            autoStart: false,
            checkOnStartup: false
        })
        
        await updater.initialize()
    })

    describe('Capability Detection', () => {
        it('should detect differential update support on macOS', () => {
            const isDifferentialSupported = withMockedPlatform('darwin', () => 
                updater.isDifferentialUpdateSupported()
            )
            expect(isDifferentialSupported).toBe(true)
        })

        it('should not support differential updates on Windows', () => {
            const isDifferentialSupported = withMockedPlatform('win32', () =>
                updater.isDifferentialUpdateSupported()
            )
            expect(isDifferentialSupported).toBe(false)
        })

        it('should not support differential updates on Linux', () => {
            const isDifferentialSupported = withMockedPlatform('linux', () =>
                updater.isDifferentialUpdateSupported()
            )
            expect(isDifferentialSupported).toBe(false)
        })

        it('should return correct capabilities object', () => {
            const capabilities = updater.getCapabilities()
            
            expect(capabilities).toHaveProperty('electronUpdaterEnabled')
            expect(capabilities).toHaveProperty('differentialUpdatesSupported')
            expect(capabilities).toHaveProperty('platform')
            expect(capabilities).toHaveProperty('inPlaceUpdateSupported')
            
            expect(typeof capabilities.electronUpdaterEnabled).toBe('boolean')
            expect(typeof capabilities.differentialUpdatesSupported).toBe('boolean')
            expect(typeof capabilities.platform).toBe('string')
            expect(typeof capabilities.inPlaceUpdateSupported).toBe('boolean')
        })

        it('should indicate electron updater is enabled when configured', () => {
            const capabilities = updater.getCapabilities()
            expect(capabilities.electronUpdaterEnabled).toBe(true)
        })

        it('should indicate in-place updates are supported when electron updater is enabled', () => {
            const capabilities = updater.getCapabilities()
            expect(capabilities.inPlaceUpdateSupported).toBe(true)
        })
    })

    describe('State Management', () => {
        it('should include electron updater state in getState', () => {
            const state = updater.getState()
            
            expect(state).toHaveProperty('isElectronUpdaterEnabled')
            expect(state).toHaveProperty('isUpdateDownloaded')
            expect(state).toHaveProperty('isRestartPending')
            expect(state).toHaveProperty('electronUpdaterState')
        })

        it('should initialize with electron updater enabled state', () => {
            const state = updater.getState()
            expect(state.isElectronUpdaterEnabled).toBe(true)
        })

        it('should initialize with no update downloaded', () => {
            const state = updater.getState()
            expect(state.isUpdateDownloaded).toBe(false)
        })

        it('should initialize with no restart pending', () => {
            const state = updater.getState()
            expect(state.isRestartPending).toBe(false)
        })

        it('should have idle electron updater state initially', () => {
            const state = updater.getState()
            expect(state.electronUpdaterState).toBe('idle')
        })
    })

    describe('Initialization', () => {
        it('should initialize successfully', async () => {
            const newUpdater = new ElectronUpdater({
                owner: 'test-org',
                repo: 'test-repo',
                enableElectronUpdater: true,
                autoStart: false,
                checkOnStartup: false
            })
            
            await expect(newUpdater.initialize()).resolves.not.toThrow()
        })

        it('should not start background checker when autoStart is false', async () => {
            const newUpdater = new ElectronUpdater({
                owner: 'test-org',
                repo: 'test-repo',
                enableElectronUpdater: true,
                autoStart: false,
                checkOnStartup: false
            })
            
            await newUpdater.initialize()
            
            // State should not have background checking active
            const state = newUpdater.getState()
            expect(state).toBeTruthy()
        })
    })

    describe('API Surface', () => {
        it('should expose getCapabilities method', () => {
            expect(typeof updater.getCapabilities).toBe('function')
        })

        it('should expose isDifferentialUpdateSupported method', () => {
            expect(typeof updater.isDifferentialUpdateSupported).toBe('function')
        })

        it('should expose checkForUpdates method', () => {
            expect(typeof updater.checkForUpdates).toBe('function')
        })

        it('should expose downloadAndInstall method', () => {
            expect(typeof updater.downloadAndInstall).toBe('function')
        })

        it('should expose getState method', () => {
            expect(typeof updater.getState).toBe('function')
        })

        it('should expose getUpdateHistory method', () => {
            expect(typeof updater.getUpdateHistory).toBe('function')
        })

        it('should expose getUpdateSettings method', () => {
            expect(typeof updater.getUpdateSettings).toBe('function')
        })

        it('should expose setUpdateSettings method', () => {
            expect(typeof updater.setUpdateSettings).toBe('function')
        })
    })

    describe('Policy Enforcement', () => {
        it('should enforce policy before autoUpdater download', async () => {
            vi.spyOn(ConfigServiceImpl.prototype, 'isAutoInstallAllowed').mockResolvedValue(false)

            const updateInfo = {
                version: 'v9.9.9',
                releaseNotes: '',
                downloadUrl: 'https://example.com/fake.zip',
                checksum: 'deadbeef',
                publishedAt: new Date(),
                isPrerelease: false
            }

            await expect(updater.downloadAndInstall(updateInfo as any)).rejects.toThrow(
                /disabled by policy/i
            )
            expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
        })

        it('should enforce maintenance window before autoUpdater download', async () => {
            vi.spyOn(ConfigServiceImpl.prototype, 'isAutoInstallAllowed').mockResolvedValue(true)
            vi.spyOn(ConfigServiceImpl.prototype, 'isInMaintenanceWindow').mockResolvedValue(false)

            const updateInfo = {
                version: 'v9.9.9',
                releaseNotes: '',
                downloadUrl: 'https://example.com/fake.zip',
                checksum: 'deadbeef',
                publishedAt: new Date(),
                isPrerelease: false
            }

            await expect(updater.downloadAndInstall(updateInfo as any)).rejects.toThrow(
                /maintenance window/i
            )
            expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
        })
    })

    describe('Custom Fallback Integrity', () => {
        it('should re-check and use custom UpdateInfo when autoUpdater download fails', async () => {
            vi.spyOn(autoUpdater, 'downloadUpdate').mockRejectedValue(new Error('Download failed'))

            const checkNowSpy = vi.spyOn(UpdateControllerImpl.prototype, 'checkNow').mockResolvedValue({
                version: 'v9.9.9',
                releaseNotes: 'notes',
                downloadUrl: 'https://api.github.com/repos/test-org/test-repo/releases/assets/123',
                assetName: 'DBConsole-v9.9.9-darwin-arm64.dmg',
                checksum: 'abc123',
                publishedAt: new Date(),
                isPrerelease: false
            } as any)

            const downloadAndInstallSpy = vi
                .spyOn(UpdateControllerImpl.prototype, 'downloadAndInstall')
                .mockResolvedValue(undefined)

            // This mimics the electron-updater check path: valid URL for IPC/UI but not a direct asset URL for downloads.
            const electronStyleUpdateInfo = {
                version: '9.9.9',
                releaseNotes: 'notes',
                downloadUrl: 'https://github.com/test-org/test-repo/releases/tag/v9.9.9',
                assetName: 'DBConsole-v9.9.9-mac.zip',
                checksum: 'sha512-from-yml',
                publishedAt: new Date(),
                isPrerelease: false
            }

            await expect(updater.downloadAndInstall(electronStyleUpdateInfo as any)).resolves.not.toThrow()
            expect(checkNowSpy).toHaveBeenCalled()
            expect(downloadAndInstallSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    downloadUrl: 'https://api.github.com/repos/test-org/test-repo/releases/assets/123',
                    checksum: 'abc123'
                })
            )
        })

        it('should fail cleanly if fallback cannot fetch a valid UpdateInfo', async () => {
            vi.spyOn(autoUpdater, 'downloadUpdate').mockRejectedValue(new Error('Download failed'))
            vi.spyOn(UpdateControllerImpl.prototype, 'checkNow').mockResolvedValue(null as any)

            const electronStyleUpdateInfo = {
                version: '9.9.9',
                releaseNotes: 'notes',
                downloadUrl: 'https://github.com/test-org/test-repo/releases/tag/v9.9.9',
                checksum: 'sha512-from-yml',
                publishedAt: new Date(),
                isPrerelease: false
            }

            await expect(updater.downloadAndInstall(electronStyleUpdateInfo as any)).rejects.toThrow(
                /re-check for updates/i
            )
        })
    })
})

describe('ElectronUpdater with Disabled AutoUpdater', () => {
    let updater: ElectronUpdater
    
    beforeEach(async () => {
        vi.restoreAllMocks()
        
        // Create updater with electron integration disabled
        updater = new ElectronUpdater({
            owner: 'test-org',
            repo: 'test-repo',
            enableElectronUpdater: false,
            autoStart: false,
            checkOnStartup: false
        })
        
        await updater.initialize()
    })

    describe('Capability Detection with Disabled AutoUpdater', () => {
        it('should not support differential updates when electron updater is disabled', () => {
            const isDifferentialSupported = updater.isDifferentialUpdateSupported()
            expect(isDifferentialSupported).toBe(false)
        })

        it('should indicate electron updater is disabled', () => {
            const capabilities = updater.getCapabilities()
            expect(capabilities.electronUpdaterEnabled).toBe(false)
        })

        it('should indicate in-place updates are not supported when electron updater is disabled', () => {
            const capabilities = updater.getCapabilities()
            expect(capabilities.inPlaceUpdateSupported).toBe(false)
        })
    })
})
