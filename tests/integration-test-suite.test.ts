/**
 * Integration Test Suite for GitHub Auto-Updater
 * Tests complete update workflows from check to installation with mock GitHub API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock Electron module first
vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => {
            switch (name) {
                case 'temp':
                    return tmpdir()
                case 'userData':
                    return join(tmpdir(), 'test-user-data')
                default:
                    return tmpdir()
            }
        },
        getVersion: () => '1.0.0',
        relaunch: () => undefined,
        exit: () => undefined
    },
    shell: {
        showItemInFolder: () => undefined,
        openPath: async () => ''
    },
    dialog: {}
}))

import { UpdateAgentImpl, UpdateAgentOptions } from '../lib/updater/update-agent'
import { UpdateControllerImpl, UpdateControllerOptions } from '../lib/updater/update-controller'
import { GitHubClientImpl } from '../lib/updater/github-client'
import { ConfigServiceImpl } from '../lib/updater/config-service'
import { UpdateInfo, GitHubRelease, GitHubAsset, UpdateSettings } from '../lib/updater/types'

// Mock GitHub API responses
const mockGitHubRelease: GitHubRelease = {
    id: 12345,
    tagName: 'v2.0.0',
    name: 'Version 2.0.0',
    body: '# Release Notes\n\n- Added new features\n- Fixed bugs\n- Improved performance\n\nSHA256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    assets: [
        {
            id: 1,
            name: 'dbconsole-2.0.0-darwin-x64.dmg',
            size: 50000000,
            downloadUrl: 'https://api.github.com/repos/test/repo/releases/assets/1',
            contentType: 'application/octet-stream'
        },
        {
            id: 2,
            name: 'dbconsole-2.0.0-win32-x64.exe',
            size: 45000000,
            downloadUrl: 'https://api.github.com/repos/test/repo/releases/assets/2',
            contentType: 'application/octet-stream'
        }
    ],
    prerelease: false,
    publishedAt: '2024-01-15T10:00:00Z'
}

const mockUpdateInfo: UpdateInfo = {
    version: 'v2.0.0',
    releaseNotes: mockGitHubRelease.body,
    downloadUrl: mockGitHubRelease.assets[0].downloadUrl,
    checksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    publishedAt: new Date(mockGitHubRelease.publishedAt),
    isPrerelease: false
}

// Mock implementations
class MockGitHubClient extends EventEmitter {
    private authenticated = false
    private shouldFailAuth = false
    private shouldFailRequest = false
    private rateLimited = false

    authenticate(token: string): void {
        if (this.shouldFailAuth) {
            throw new Error('Authentication failed')
        }
        this.authenticated = true
    }

    async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
        if (!this.authenticated) {
            throw new Error('Authentication required')
        }
        if (this.shouldFailRequest) {
            throw new Error('Network error')
        }
        if (this.rateLimited) {
            const error = new Error('Rate limit exceeded')
                ; (error as any).rateLimitInfo = {
                    limit: 5000,
                    remaining: 0,
                    resetTime: new Date(Date.now() + 3600000),
                    retryAfter: 60
                }
            throw error
        }
        return mockGitHubRelease
    }

    async getReleases(owner: string, repo: string, options: any = {}): Promise<GitHubRelease[]> {
        const release = await this.getLatestRelease(owner, repo)
        return [release]
    }

    async getReleasesByChannel(owner: string, repo: string, channel: string): Promise<GitHubRelease[]> {
        const releases = await this.getReleases(owner, repo)
        if (channel === 'prerelease') {
            return releases
        }
        return releases.filter(r => !r.prerelease)
    }

    getBestAssetForPlatform(release: GitHubRelease, platform?: string, arch?: string): GitHubAsset | null {
        const currentPlatform = platform || process.platform
        const asset = release.assets.find(a => a.name.includes(currentPlatform))
        return asset || release.assets[0]
    }

    async downloadAsset(assetUrl: string): Promise<ReadableStream> {
        if (this.shouldFailRequest) {
            throw new Error('Download failed')
        }
        // Mock readable stream
        return new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]))
                controller.close()
            }
        })
    }

    getRateLimitStatus() {
        return {
            isRateLimited: this.rateLimited,
            rateLimitInfo: this.rateLimited ? {
                limit: 5000,
                remaining: 0,
                resetTime: new Date(Date.now() + 3600000),
                retryAfter: 60
            } : null
        }
    }

    // Test control methods
    setAuthFailure(shouldFail: boolean) {
        this.shouldFailAuth = shouldFail
    }

    setRequestFailure(shouldFail: boolean) {
        this.shouldFailRequest = shouldFail
    }

    setRateLimited(isLimited: boolean) {
        this.rateLimited = isLimited
    }
}

class MockConfigService extends EventEmitter {
    private token: string | null = 'ghp_test_token_1234567890abcdef'
    private settings: UpdateSettings = {
        autoCheck: true,
        autoInstall: false,
        checkInterval: 24,
        updateChannel: 'latest',
        customTagPattern: undefined,
        maintenanceWindow: undefined
    }
    private policies = {
        autoCheckAllowed: true,
        autoInstallAllowed: true,
        inMaintenanceWindow: true
    }

    async initialize(): Promise<void> {
        // Mock initialization
    }

    async getGitHubToken(): Promise<string | null> {
        return this.token
    }

    async setGitHubToken(token: string): Promise<void> {
        this.token = token
    }

    async getUpdateSettings(): Promise<UpdateSettings> {
        return { ...this.settings }
    }

    async setUpdateSettings(settings: Partial<UpdateSettings>): Promise<void> {
        this.settings = { ...this.settings, ...settings }
    }

    async isAutoCheckAllowed(): Promise<boolean> {
        return this.policies.autoCheckAllowed
    }

    async isAutoInstallAllowed(): Promise<boolean> {
        return this.policies.autoInstallAllowed
    }

    async isInMaintenanceWindow(): Promise<boolean> {
        return this.policies.inMaintenanceWindow
    }

    async getEffectiveCheckInterval(): Promise<number> {
        return this.settings.checkInterval
    }

    // Test control methods
    setToken(token: string | null) {
        this.token = token
    }

    setPolicyValue(policy: keyof typeof this.policies, value: boolean) {
        this.policies[policy] = value
    }

    setSettingValue<K extends keyof UpdateSettings>(setting: K, value: UpdateSettings[K]) {
        this.settings[setting] = value
    }
}

class MockDownloadManager extends EventEmitter {
    private shouldFailDownload = false
    private downloadProgress = 0

    async downloadFile(url: string, filePath: string): Promise<{ filePath: string; size: number }> {
        if (this.shouldFailDownload) {
            throw new Error('Download failed')
        }

        // Simulate download progress
        const progressInterval = setInterval(() => {
            this.downloadProgress += 20
            this.emit('progress', {
                url,
                filePath,
                bytesDownloaded: this.downloadProgress * 1000,
                totalBytes: 100000,
                percentage: this.downloadProgress,
                speed: 1000000,
                estimatedTimeRemaining: (100 - this.downloadProgress) / 20
            })

            if (this.downloadProgress >= 100) {
                clearInterval(progressInterval)
                this.downloadProgress = 0
            }
        }, 100)

        // Wait for download to complete
        await new Promise(resolve => setTimeout(resolve, 600))

        return {
            filePath,
            size: 100000
        }
    }

    setDownloadFailure(shouldFail: boolean) {
        this.shouldFailDownload = shouldFail
    }
}

class MockFileVerifier {
    private shouldFailVerification = false

    async verifyFile(filePath: string, verification: any): Promise<{ valid: boolean; error?: string }> {
        if (this.shouldFailVerification) {
            return {
                valid: false,
                error: 'Checksum mismatch'
            }
        }
        return { valid: true }
    }

    setVerificationFailure(shouldFail: boolean) {
        this.shouldFailVerification = shouldFail
    }
}

class MockDesktopInstaller extends EventEmitter {
    private shouldFailInstallation = false

    async installUpdate(filePath: string, version: string): Promise<{ success: boolean; installedVersion?: string; error?: string; requiresRestart?: boolean }> {
        if (this.shouldFailInstallation) {
            return {
                success: false,
                error: 'Installation failed'
            }
        }

        // Simulate installation progress
        setTimeout(() => {
            this.emit('progress', {
                stage: 'extracting',
                percentage: 50,
                message: 'Extracting files...'
            })
        }, 100)

        setTimeout(() => {
            this.emit('progress', {
                stage: 'installing',
                percentage: 100,
                message: 'Installing update...'
            })
        }, 200)

        await new Promise(resolve => setTimeout(resolve, 300))

        return {
            success: true,
            installedVersion: version,
            requiresRestart: true
        }
    }

    async restartApplication(delay: number): Promise<void> {
        // Mock restart - just wait for the delay
        await new Promise(resolve => setTimeout(resolve, delay))
    }

    setInstallationFailure(shouldFail: boolean) {
        this.shouldFailInstallation = shouldFail
    }
}

describe('Integration Test Suite - GitHub Auto-Updater', () => {
    let mockGitHubClient: MockGitHubClient
    let mockConfigService: MockConfigService
    let mockDownloadManager: MockDownloadManager
    let mockFileVerifier: MockFileVerifier
    let mockDesktopInstaller: MockDesktopInstaller

    beforeEach(() => {
        // Reset all mocks
        mockGitHubClient = new MockGitHubClient()
        mockConfigService = new MockConfigService()
        mockDownloadManager = new MockDownloadManager()
        mockFileVerifier = new MockFileVerifier()
        mockDesktopInstaller = new MockDesktopInstaller()

        // Mock the current version to be older than the mock release
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                npm_package_version: '1.0.0'
            }
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('End-to-End Update Workflow', () => {
        it('should complete full update cycle from detection through installation', async () => {
            // **Feature: github-auto-updater, Integration Test 1: Complete update workflow**

            const events: string[] = []

            // Create update agent with mocked dependencies
            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoCheck: false // Disable auto-check for controlled testing
            })

                // Replace internal services with mocks
                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService
                ; (updateAgent as any).downloadManager = mockDownloadManager
                ; (updateAgent as any).fileVerifier = mockFileVerifier
                ; (updateAgent as any).desktopInstaller = mockDesktopInstaller

            // Set up event tracking
            updateAgent.on('update-available', () => events.push('update-available'))
            updateAgent.on('download-complete', () => events.push('download-complete'))
            updateAgent.on('verification-complete', () => events.push('verification-complete'))
            updateAgent.on('installation-complete', () => events.push('installation-complete'))

            // Initialize the agent
            await updateAgent.initialize()

            // Step 1: Check for updates
            const updateInfo = await updateAgent.checkForUpdates()
            expect(updateInfo).toBeDefined()
            expect(updateInfo?.version).toBe('v2.0.0')
            expect(events).toContain('update-available')

            // Step 2: Download the update
            const filePath = await updateAgent.downloadUpdate(updateInfo!)
            expect(filePath).toBeDefined()
            expect(events).toContain('download-complete')

            // Step 3: Verify the download
            const isValid = await updateAgent.verifyUpdate(filePath, updateInfo!.checksum)
            expect(isValid).toBe(true)
            expect(events).toContain('verification-complete')

            // Step 4: Install the update
            await updateAgent.installUpdate(filePath)
            expect(events).toContain('installation-complete')

            // Verify the complete workflow executed
            expect(events).toEqual([
                'update-available',
                'download-complete',
                'verification-complete',
                'installation-complete'
            ])
        })

        it('should handle authentication errors gracefully', async () => {
            // **Feature: github-auto-updater, Integration Test 2: Authentication error handling**

            mockGitHubClient.setAuthFailure(true)
            mockConfigService.setToken('invalid_token')

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService

            await expect(updateAgent.initialize()).rejects.toThrow('Authentication failed')
        })

        it('should handle network failures with retry logic', async () => {
            // **Feature: github-auto-updater, Integration Test 3: Network failure handling**

            let attemptCount = 0
            const originalGetLatestRelease = mockGitHubClient.getLatestRelease.bind(mockGitHubClient)

            mockGitHubClient.getLatestRelease = async (owner: string, repo: string) => {
                attemptCount++
                if (attemptCount < 3) {
                    throw new Error('Network error')
                }
                return originalGetLatestRelease(owner, repo)
            }

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService

            await updateAgent.initialize()

            // Should eventually succeed after retries
            const updateInfo = await updateAgent.checkForUpdates()
            expect(updateInfo).toBeDefined()
            expect(attemptCount).toBe(3) // Should have retried twice before succeeding
        })

        it('should respect rate limiting', async () => {
            // **Feature: github-auto-updater, Integration Test 4: Rate limit handling**

            mockGitHubClient.setRateLimited(true)

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService

            await updateAgent.initialize()

            await expect(updateAgent.checkForUpdates()).rejects.toThrow('Rate limit exceeded')

            // Verify rate limit status is accessible
            const rateLimitStatus = mockGitHubClient.getRateLimitStatus()
            expect(rateLimitStatus.isRateLimited).toBe(true)
            expect(rateLimitStatus.rateLimitInfo).toBeDefined()
        })

        it('should handle file verification failures', async () => {
            // **Feature: github-auto-updater, Integration Test 5: File verification failure**

            mockFileVerifier.setVerificationFailure(true)

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService
                ; (updateAgent as any).downloadManager = mockDownloadManager
                ; (updateAgent as any).fileVerifier = mockFileVerifier

            await updateAgent.initialize()

            const updateInfo = await updateAgent.checkForUpdates()
            const filePath = await updateAgent.downloadUpdate(updateInfo!)

            const isValid = await updateAgent.verifyUpdate(filePath, updateInfo!.checksum)
            expect(isValid).toBe(false)
        })

        it('should handle installation failures with proper error reporting', async () => {
            // **Feature: github-auto-updater, Integration Test 6: Installation failure handling**

            mockDesktopInstaller.setInstallationFailure(true)

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService
                ; (updateAgent as any).downloadManager = mockDownloadManager
                ; (updateAgent as any).fileVerifier = mockFileVerifier
                ; (updateAgent as any).desktopInstaller = mockDesktopInstaller

            await updateAgent.initialize()

            const updateInfo = await updateAgent.checkForUpdates()
            const filePath = await updateAgent.downloadUpdate(updateInfo!)
            await updateAgent.verifyUpdate(filePath, updateInfo!.checksum)

            await expect(updateAgent.installUpdate(filePath)).rejects.toThrow('Installation failed')
        })
    })

    describe('UpdateController Integration', () => {
        it('should orchestrate complete update workflow with user notifications', async () => {
            // **Feature: github-auto-updater, Integration Test 7: UpdateController workflow**

            const notifications: any[] = []
            let userApprovedUpdate = false

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false,
                notificationHandler: async (updateInfo) => {
                    notifications.push({ type: 'update-available', updateInfo })
                    return userApprovedUpdate
                },
                progressHandler: (progress) => {
                    notifications.push({ type: 'progress', progress })
                }
            })

                // Replace internal services with mocks
                ; (updateController as any).updateAgent.githubClient = mockGitHubClient
                ; (updateController as any).updateAgent.configService = mockConfigService
                ; (updateController as any).updateAgent.downloadManager = mockDownloadManager
                ; (updateController as any).updateAgent.fileVerifier = mockFileVerifier
                ; (updateController as any).updateAgent.desktopInstaller = mockDesktopInstaller
                ; (updateController as any).configService = mockConfigService

            await updateController.initialize()

            // Test manual check without auto-install
            await updateController.checkNow()
            expect(notifications.length).toBeGreaterThan(0)
            expect(notifications[0].type).toBe('update-available')

            // Test with user approval
            userApprovedUpdate = true
            const updateInfo = notifications[0].updateInfo
            await updateController.downloadAndInstall(updateInfo)

            // Verify update history was recorded
            const history = await updateController.getUpdateHistory()
            expect(history.length).toBe(1)
            expect(history[0].version).toBe('v2.0.0')
            expect(history[0].success).toBe(true)
        })

        it('should handle policy enforcement correctly', async () => {
            // **Feature: github-auto-updater, Integration Test 8: Policy enforcement**

            // Disable auto-check policy
            mockConfigService.setPolicyValue('autoCheckAllowed', false)

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHubClient
                ; (updateController as any).updateAgent.configService = mockConfigService
                ; (updateController as any).configService = mockConfigService

            await updateController.initialize()

            // Check should be skipped due to policy
            const updateInfo = await updateController.checkNow()
            expect(updateInfo).toBeNull()

            // Test auto-install policy
            mockConfigService.setPolicyValue('autoCheckAllowed', true)
            mockConfigService.setPolicyValue('autoInstallAllowed', false)

            const actualUpdateInfo = await (updateController as any).updateAgent.checkForUpdates()

            // Should throw when trying to install due to policy
            await expect(updateController.downloadAndInstall(actualUpdateInfo)).rejects.toThrow('Automatic installation is disabled by policy')
        })

        it('should provide formatted release notes', async () => {
            // **Feature: github-auto-updater, Integration Test 9: Release notes formatting**

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHubClient
                ; (updateController as any).updateAgent.configService = mockConfigService
                ; (updateController as any).configService = mockConfigService

            await updateController.initialize()

            // Trigger update check to populate current update info
            await updateController.checkNow()

            // Test different formats
            const markdownNotes = await updateController.displayReleaseNotes('v2.0.0', 'markdown')
            expect(markdownNotes).toContain('# Release Notes')
            expect(markdownNotes).toContain('Added new features')

            const plainNotes = await updateController.displayReleaseNotes('v2.0.0', 'plain')
            expect(plainNotes).not.toContain('#')
            expect(plainNotes).toContain('Added new features')

            const htmlNotes = await updateController.displayReleaseNotes('v2.0.0', 'html')
            expect(htmlNotes).toContain('<h1>')
            expect(htmlNotes).toContain('Added new features')
        })
    })

    describe('Cross-Platform Compatibility', () => {
        it('should select correct assets for different platforms', async () => {
            // **Feature: github-auto-updater, Integration Test 10: Cross-platform asset selection**

            const platforms = ['darwin', 'win32', 'linux']
            const architectures = ['x64', 'arm64']

            for (const platform of platforms) {
                for (const arch of architectures) {
                    const asset = mockGitHubClient.getBestAssetForPlatform(
                        mockGitHubRelease,
                        platform,
                        arch
                    )

                    expect(asset).toBeDefined()

                    if (platform === 'darwin' && arch === 'x64') {
                        expect(asset?.name).toContain('darwin')
                        expect(asset?.name).toContain('x64')
                    }
                }
            }
        })

        it('should handle platform-specific installation paths', async () => {
            // **Feature: github-auto-updater, Integration Test 11: Platform-specific installation**

            const platforms = ['darwin', 'win32', 'linux']

            for (const platform of platforms) {
                const updateAgent = new UpdateAgentImpl({
                    owner: 'test',
                    repo: 'dbconsole',
                    platform: platform as any
                })

                    ; (updateAgent as any).githubClient = mockGitHubClient
                    ; (updateAgent as any).configService = mockConfigService
                    ; (updateAgent as any).downloadManager = mockDownloadManager
                    ; (updateAgent as any).fileVerifier = mockFileVerifier
                    ; (updateAgent as any).desktopInstaller = mockDesktopInstaller

                await updateAgent.initialize()

                const updateInfo = await updateAgent.checkForUpdates()
                expect(updateInfo).toBeDefined()

                // Verify platform-specific asset selection
                const selectedAsset = mockGitHubClient.getBestAssetForPlatform(
                    mockGitHubRelease,
                    platform
                )
                expect(selectedAsset).toBeDefined()
            }
        })
    })

    describe('Error Recovery and Resilience', () => {
        it('should recover from temporary network failures', async () => {
            // **Feature: github-auto-updater, Integration Test 12: Network failure recovery**

            let failureCount = 0
            const maxFailures = 2

            const originalGetLatestRelease = mockGitHubClient.getLatestRelease.bind(mockGitHubClient)
            mockGitHubClient.getLatestRelease = async (owner: string, repo: string) => {
                if (failureCount < maxFailures) {
                    failureCount++
                    throw new Error('Temporary network failure')
                }
                return originalGetLatestRelease(owner, repo)
            }

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService

            await updateAgent.initialize()

            // Should eventually succeed after retries
            const updateInfo = await updateAgent.checkForUpdates()
            expect(updateInfo).toBeDefined()
            expect(failureCount).toBe(maxFailures)
        })

        it('should handle download resumption after interruption', async () => {
            // **Feature: github-auto-updater, Integration Test 13: Download resumption**

            let downloadAttempts = 0
            const originalDownloadFile = mockDownloadManager.downloadFile.bind(mockDownloadManager)

            mockDownloadManager.downloadFile = async (url: string, filePath: string) => {
                downloadAttempts++
                if (downloadAttempts === 1) {
                    throw new Error('Download interrupted')
                }
                return originalDownloadFile(url, filePath)
            }

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService
                ; (updateAgent as any).downloadManager = mockDownloadManager

            await updateAgent.initialize()

            const updateInfo = await updateAgent.checkForUpdates()

            // First download should fail, but retry should succeed
            await expect(updateAgent.downloadUpdate(updateInfo!)).rejects.toThrow('Download interrupted')

            // Reset for successful retry
            const filePath = await updateAgent.downloadUpdate(updateInfo!)
            expect(filePath).toBeDefined()
            expect(downloadAttempts).toBe(2)
        })

        it('should maintain state consistency during failures', async () => {
            // **Feature: github-auto-updater, Integration Test 14: State consistency**

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHubClient
                ; (updateAgent as any).configService = mockConfigService
                ; (updateAgent as any).downloadManager = mockDownloadManager
                ; (updateAgent as any).fileVerifier = mockFileVerifier

            await updateAgent.initialize()

            // Initial state should be idle
            let state = updateAgent.getState()
            expect(state.status).toBe('idle')

            // State should change during operations
            const checkPromise = updateAgent.checkForUpdates()

            // State should be checking during the operation
            state = updateAgent.getState()
            expect(state.status).toBe('checking')

            await checkPromise

            // State should return to idle after completion
            state = updateAgent.getState()
            expect(state.status).toBe('idle')
            expect(state.availableUpdate).toBeDefined()

            // Test error state handling
            mockDownloadManager.setDownloadFailure(true)

            try {
                await updateAgent.downloadUpdate(state.availableUpdate!)
            } catch (error) {
                // State should reflect error
                state = updateAgent.getState()
                expect(state.status).toBe('error')
                expect(state.error).toContain('Download failed')
            }
        })
    })
})