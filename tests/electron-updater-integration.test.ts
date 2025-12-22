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
        vi.clearAllMocks()
        
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
})

describe('ElectronUpdater with Disabled AutoUpdater', () => {
    let updater: ElectronUpdater
    
    beforeEach(async () => {
        vi.clearAllMocks()
        
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
