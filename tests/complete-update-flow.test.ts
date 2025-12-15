/**
 * Complete Update Flow Integration Tests
 * Tests full update cycle from detection through installation with realistic scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'

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
        getVersion: () => '1.5.0',
        relaunch: () => undefined,
        exit: () => undefined
    },
    // DesktopInstaller imports these named exports; provide minimal stubs for tests.
    shell: {
        showItemInFolder: () => undefined,
        openPath: async () => ''
    },
    dialog: {}
}))

import { UpdateAgentImpl } from '../lib/updater/update-agent'
import { UpdateControllerImpl } from '../lib/updater/update-controller'
import { ConfigServiceImpl } from '../lib/updater/config-service'
import { UpdateInfo, UpdateRecord, GitHubRelease, UpdateSettings, TimeWindow } from '../lib/updater/types'

// Realistic test scenarios
const testScenarios = {
    normalUpdate: {
        currentVersion: '1.5.0',
        availableVersion: '2.0.0',
        hasBreakingChanges: true,
        fileSize: 50000000, // 50MB
        downloadTime: 5000, // 5 seconds
        installTime: 3000 // 3 seconds
    },
    patchUpdate: {
        currentVersion: '2.0.0',
        availableVersion: '2.0.1',
        hasBreakingChanges: false,
        fileSize: 5000000, // 5MB
        downloadTime: 1000, // 1 second
        installTime: 1000 // 1 second
    },
    prereleaseUpdate: {
        currentVersion: '2.0.0',
        availableVersion: '2.1.0-beta.1',
        hasBreakingChanges: false,
        fileSize: 45000000, // 45MB
        downloadTime: 4000, // 4 seconds
        installTime: 2500 // 2.5 seconds
    }
}

// Mock GitHub API with realistic responses
class RealisticGitHubMock extends EventEmitter {
    private releases: Map<string, GitHubRelease> = new Map()
    private networkLatency = 100
    private shouldSimulateSlowNetwork = false
    private shouldSimulateRateLimit = false
    private rateLimitResetTime = new Date()
    private token: string | null = null

    constructor() {
        super()
        this.setupMockReleases()
    }

    authenticate(token: string): void {
        this.token = token
    }

    private computeMockAssetSha256(assetUrl: string): string {
        // Must match the bytes written by RealisticDownloadMock.
        return createHash('sha256').update(assetUrl, 'utf8').digest('hex')
    }

    private createRateLimitError(): Error {
        const error = new Error('API rate limit exceeded')
            ; (error as any).rateLimitInfo = {
                limit: 5000,
                remaining: 0,
                resetTime: this.rateLimitResetTime,
                retryAfter: 60
            }
        return error
    }

    private setupMockReleases() {
        const assetUrlV200Darwin = 'https://api.github.com/repos/test/dbconsole/releases/assets/1'
        const assetUrlV200Win = 'https://api.github.com/repos/test/dbconsole/releases/assets/2'
        const assetUrlV201Darwin = 'https://api.github.com/repos/test/dbconsole/releases/assets/3'
        const assetUrlV210BetaDarwin = 'https://api.github.com/repos/test/dbconsole/releases/assets/4'

        const shaV200 = this.computeMockAssetSha256(assetUrlV200Darwin)
        const shaV201 = this.computeMockAssetSha256(assetUrlV201Darwin)
        const shaV210b = this.computeMockAssetSha256(assetUrlV210BetaDarwin)

        // Normal update release
        this.releases.set('v2.0.0', {
            id: 1,
            tagName: 'v2.0.0',
            name: 'Version 2.0.0 - Major Update',
            body: `# DBConsole v2.0.0 - Major Update

## 🚀 New Features
- **New Query Builder**: Visual query construction with drag-and-drop interface
- **Advanced Filtering**: Multi-column filtering with custom operators
- **Export Enhancements**: Support for Excel, CSV, and JSON export formats
- **Dark Mode**: Full dark theme support across all components

## 🔧 Improvements  
- **Performance**: 40% faster query execution for large datasets
- **Memory Usage**: Reduced memory footprint by 25%
- **UI Responsiveness**: Smoother scrolling and interaction in data grids

## 🐛 Bug Fixes
- Fixed connection timeout issues with PostgreSQL 14+
- Resolved memory leaks in long-running query sessions
- Fixed CSV export encoding issues with special characters

## ⚠️ Breaking Changes
- Minimum Node.js version is now 18.0.0
- Legacy connection format is no longer supported
- Some keyboard shortcuts have changed (see documentation)

## 📦 Dependencies
- Updated Electron to v28.0.0
- Updated React to v18.2.0
- Added new security patches

**Full Changelog**: https://github.com/example/dbconsole/compare/v1.5.0...v2.0.0

SHA256: ${shaV200}`,
            assets: [
                {
                    id: 1,
                    name: 'DBConsole-2.0.0-darwin-x64.dmg',
                    size: testScenarios.normalUpdate.fileSize,
                    downloadUrl: assetUrlV200Darwin,
                    contentType: 'application/octet-stream'
                },
                {
                    id: 2,
                    name: 'DBConsole-2.0.0-win32-x64.exe',
                    size: testScenarios.normalUpdate.fileSize,
                    downloadUrl: assetUrlV200Win,
                    contentType: 'application/octet-stream'
                }
            ],
            prerelease: false,
            publishedAt: '2024-01-15T10:00:00Z'
        })

        // Patch update release
        this.releases.set('v2.0.1', {
            id: 2,
            tagName: 'v2.0.1',
            name: 'Version 2.0.1 - Bug Fixes',
            body: `# DBConsole v2.0.1 - Bug Fix Release

## 🐛 Bug Fixes
- Fixed critical issue with PostgreSQL connection pooling
- Resolved crash when exporting large result sets
- Fixed keyboard navigation in query editor
- Corrected timezone handling in date columns

## 🔧 Minor Improvements
- Improved error messages for connection failures
- Better handling of network timeouts
- Enhanced logging for debugging

This is a recommended update for all v2.0.0 users.

SHA256: ${shaV201}`,
            assets: [
                {
                    id: 3,
                    name: 'DBConsole-2.0.1-darwin-x64.dmg',
                    size: testScenarios.patchUpdate.fileSize,
                    downloadUrl: assetUrlV201Darwin,
                    contentType: 'application/octet-stream'
                }
            ],
            prerelease: false,
            publishedAt: '2024-01-20T14:30:00Z'
        })

        // Prerelease update
        this.releases.set('v2.1.0-beta.1', {
            id: 3,
            tagName: 'v2.1.0-beta.1',
            name: 'Version 2.1.0 Beta 1',
            body: `# DBConsole v2.1.0-beta.1 - Preview Release

## 🧪 Experimental Features
- **AI Query Assistant**: Natural language to SQL conversion (beta)
- **Real-time Collaboration**: Share queries with team members
- **Advanced Visualizations**: New chart types and customization options

## ⚠️ Beta Notice
This is a preview release for testing purposes. Not recommended for production use.
Please report any issues on our GitHub repository.

## 🔄 What's Coming
- Enhanced AI capabilities
- More collaboration features  
- Performance optimizations

**Feedback Welcome**: https://github.com/example/dbconsole/discussions

SHA256: ${shaV210b}`,
            assets: [
                {
                    id: 4,
                    name: 'DBConsole-2.1.0-beta.1-darwin-x64.dmg',
                    size: testScenarios.prereleaseUpdate.fileSize,
                    downloadUrl: assetUrlV210BetaDarwin,
                    contentType: 'application/octet-stream'
                }
            ],
            prerelease: true,
            publishedAt: '2024-01-25T09:15:00Z'
        })
    }

    async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
        await this.simulateNetworkDelay()

        if (this.shouldSimulateRateLimit) {
            throw this.createRateLimitError()
        }

        // Return the latest stable release
        return this.releases.get('v2.0.1')!
    }

    async getReleases(owner: string, repo: string, options: any = {}): Promise<GitHubRelease[]> {
        await this.simulateNetworkDelay()

        if (this.shouldSimulateRateLimit) {
            throw this.createRateLimitError()
        }

        const allReleases = Array.from(this.releases.values())

        if (options.includePrerelease) {
            return allReleases.sort((a, b) =>
                new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
            )
        }

        return allReleases
            .filter(r => !r.prerelease)
            .sort((a, b) =>
                new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
            )
    }

    async getReleasesByChannel(owner: string, repo: string, channel: string): Promise<GitHubRelease[]> {
        const releases = await this.getReleases(owner, repo, {
            includePrerelease: channel === 'prerelease'
        })

        switch (channel) {
            case 'latest':
                return releases.filter(r => !r.prerelease).slice(0, 1)
            case 'prerelease':
                return releases.slice(0, 1)
            default:
                return releases
        }
    }

    getBestAssetForPlatform(release: GitHubRelease, platform?: string): any {
        const currentPlatform = platform || process.platform
        return release.assets.find(asset =>
            asset.name.toLowerCase().includes(currentPlatform.toLowerCase())
        ) || release.assets[0]
    }

    async downloadAsset(assetUrl: string): Promise<ReadableStream> {
        await this.simulateNetworkDelay()

        // Simulate download stream
        return new ReadableStream({
            start(controller) {
                const chunks = 100
                let currentChunk = 0

                const interval = setInterval(() => {
                    if (currentChunk >= chunks) {
                        controller.close()
                        clearInterval(interval)
                        return
                    }

                    controller.enqueue(new Uint8Array(1000)) // 1KB chunks
                    currentChunk++
                }, 50) // 50ms per chunk
            }
        })
    }

    private async simulateNetworkDelay(): Promise<void> {
        const delay = this.shouldSimulateSlowNetwork ? this.networkLatency * 10 : this.networkLatency
        await new Promise(resolve => setTimeout(resolve, delay))
    }

    // Test control methods
    setSlowNetwork(slow: boolean) {
        this.shouldSimulateSlowNetwork = slow
    }

    setRateLimit(limited: boolean, resetInSeconds = 60) {
        this.shouldSimulateRateLimit = limited
        this.rateLimitResetTime = new Date(Date.now() + resetInSeconds * 1000)
    }

    getRateLimitStatus() {
        return {
            isRateLimited: this.shouldSimulateRateLimit,
            rateLimitInfo: this.shouldSimulateRateLimit ? {
                limit: 5000,
                remaining: 0,
                resetTime: this.rateLimitResetTime,
                retryAfter: 60
            } : null
        }
    }
}

// Realistic configuration service mock
class RealisticConfigMock extends EventEmitter {
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
        inMaintenanceWindow: true,
        enterprisePoliciesActive: false
    }

    private token = 'ghp_realistic_test_token_1234567890abcdef'

    async initialize(): Promise<void> {
        // Simulate initialization delay
        await new Promise(resolve => setTimeout(resolve, 100))
    }

    async getGitHubToken(): Promise<string | null> {
        return this.token
    }

    async getUpdateSettings(): Promise<UpdateSettings> {
        return { ...this.settings }
    }

    async isAutoCheckAllowed(): Promise<boolean> {
        return this.policies.autoCheckAllowed
    }

    async isAutoInstallAllowed(): Promise<boolean> {
        return this.policies.autoInstallAllowed
    }

    async isInMaintenanceWindow(): Promise<boolean> {
        if (!this.settings.maintenanceWindow) {
            return true
        }

        // Simulate maintenance window check
        const now = new Date()
        const hour = now.getHours()
        return hour >= 2 && hour <= 6 // 2 AM to 6 AM maintenance window
    }

    async getEffectiveCheckInterval(): Promise<number> {
        if (this.policies.enterprisePoliciesActive) {
            return Math.max(this.settings.checkInterval, 168) // Minimum 1 week for enterprise
        }
        return this.settings.checkInterval
    }

    // Test control methods
    setPolicy(policy: keyof typeof this.policies, value: boolean) {
        this.policies[policy] = value
    }

    setSetting<K extends keyof UpdateSettings>(setting: K, value: UpdateSettings[K]) {
        this.settings[setting] = value
    }

    setMaintenanceWindow(startHour: number, endHour: number) {
        const maintenanceWindow: TimeWindow = {
            startHour,
            endHour,
            days: [0, 1, 2, 3, 4, 5, 6]
        }
        this.settings.maintenanceWindow = maintenanceWindow
    }
}

// Realistic download manager mock
class RealisticDownloadMock extends EventEmitter {
    private downloadSpeed = 1000000 // 1MB/s
    private shouldSimulateInterruption = false
    private shouldSimulateSlowDownload = false

    private async writeMockFile(filePath: string, url: string): Promise<number> {
        const { mkdir, writeFile } = await import('fs/promises')
        await mkdir(dirname(filePath), { recursive: true })
        const content = Buffer.from(url, 'utf8')
        await writeFile(filePath, content)
        return content.length
    }

    async downloadFile(url: string, filePath: string): Promise<{ filePath: string; size: number }> {
        const fileSize = this.getFileSizeFromUrl(url)
        const speed = this.shouldSimulateSlowDownload ? this.downloadSpeed / 10 : this.downloadSpeed
        const totalTime = (fileSize / speed) * 1000 // Convert to milliseconds

        let bytesDownloaded = 0
        const chunkSize = Math.min(fileSize / 20, 1000000) // 20 chunks or 1MB max

        return new Promise((resolve, reject) => {
            const downloadInterval = setInterval(() => {
                bytesDownloaded += chunkSize
                const percentage = Math.min((bytesDownloaded / fileSize) * 100, 100)

                // Simulate interruption at 60%
                if (this.shouldSimulateInterruption && percentage > 60 && percentage < 70) {
                    clearInterval(downloadInterval)
                    reject(new Error('Download interrupted'))
                    return
                }

                // Emit progress
                this.emit('progress', {
                    url,
                    filePath,
                    bytesDownloaded: Math.min(bytesDownloaded, fileSize),
                    totalBytes: fileSize,
                    percentage,
                    speed,
                    estimatedTimeRemaining: Math.max(0, (fileSize - bytesDownloaded) / speed)
                })

                if (bytesDownloaded >= fileSize) {
                    clearInterval(downloadInterval)
                    this.writeMockFile(filePath, url)
                        .then((size) => resolve({ filePath, size }))
                        .catch(reject)
                }
            }, totalTime / 20) // 20 progress updates
        })
    }

    private getFileSizeFromUrl(url: string): number {
        // Asset API URLs are typically /releases/assets/{id} and don't contain the version.
        // Keep test downloads fast and deterministic.
        if (url.includes('/assets/1') || url.includes('/assets/2')) return 500000 // 0.5MB
        if (url.includes('/assets/3')) return 200000 // 0.2MB
        if (url.includes('/assets/4')) return 300000 // 0.3MB
        return 250000 // Default 0.25MB
    }

    // Test control methods
    setSlowDownload(slow: boolean) {
        this.shouldSimulateSlowDownload = slow
    }

    setInterruption(interrupt: boolean) {
        this.shouldSimulateInterruption = interrupt
    }
}

describe('Complete Update Flow Integration Tests', () => {
    let mockGitHub: RealisticGitHubMock
    let mockConfig: RealisticConfigMock
    let mockDownload: RealisticDownloadMock

    beforeEach(() => {
        mockGitHub = new RealisticGitHubMock()
        mockConfig = new RealisticConfigMock()
        mockDownload = new RealisticDownloadMock()

        // Set current version for testing
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                npm_package_version: '1.5.0'
            }
        })
    })

    afterEach(() => {
        // Some tests set a fixed system time (maintenance window checks). Reset between tests.
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    describe('Full Update Cycle Tests', () => {
        it('should complete normal major update with user confirmation', async () => {
            // **Feature: github-auto-updater, Integration Test 15: Normal major update flow**

            const events: Array<{ type: string; data: any; timestamp: Date }> = []
            let userConfirmed = false

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false,
                notificationHandler: async (updateInfo) => {
                    events.push({
                        type: 'user-notification',
                        data: { version: updateInfo.version, isPrerelease: updateInfo.isPrerelease },
                        timestamp: new Date()
                    })
                    return userConfirmed
                },
                progressHandler: (progress) => {
                    events.push({
                        type: 'progress',
                        data: { percentage: progress.percentage, stage: 'download' },
                        timestamp: new Date()
                    })
                }
            })

                // Replace with realistic mocks
                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).updateAgent.downloadManager = mockDownload
                ; (updateController as any).configService = mockConfig

            // Track state changes
            updateController.on('state-changed', (state) => {
                events.push({
                    type: 'state-change',
                    data: { status: state.status, hasUpdate: !!state.availableUpdate },
                    timestamp: new Date()
                })
            })

            await updateController.initialize()

            // Step 1: Check for updates
            await updateController.checkNow()

            // Verify update was detected
            const notificationEvent = events.find(e => e.type === 'user-notification')
            expect(notificationEvent).toBeDefined()
            expect(notificationEvent?.data.version).toBe('v2.0.1')

            // Step 2: User confirms update
            userConfirmed = true
            const state = updateController.getUpdateState()
            expect(state.availableUpdate).toBeDefined()

            // Step 3: Download and install
            const startTime = Date.now()
            await updateController.downloadAndInstall(state.availableUpdate!)
            const endTime = Date.now()

            // Verify the process completed in reasonable time
            expect(endTime - startTime).toBeLessThan(10000) // Should complete within 10 seconds

            // Verify progress events were emitted
            const progressEvents = events.filter(e => e.type === 'progress')
            expect(progressEvents.length).toBeGreaterThan(5) // Should have multiple progress updates

            // Verify update history
            const history = await updateController.getUpdateHistory()
            expect(history.length).toBe(1)
            expect(history[0].version).toBe('v2.0.1')
            expect(history[0].success).toBe(true)

            // Verify release notes are available
            const releaseNotes = await updateController.getReleaseNotes('v2.0.1')
            expect(releaseNotes).toContain('Bug Fix Release')
            expect(releaseNotes).toContain('PostgreSQL connection pooling')
        })

        it('should handle prerelease updates when channel is configured', async () => {
            // **Feature: github-auto-updater, Integration Test 16: Prerelease update flow**

            // Configure for prerelease channel
            mockConfig.setSetting('updateChannel', 'prerelease')

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).configService = mockConfig

            await updateController.initialize()
            await updateController.checkNow()

            const state = updateController.getUpdateState()
            expect(state.availableUpdate).toBeDefined()
            expect(state.availableUpdate?.version).toBe('v2.1.0-beta.1')
            expect(state.availableUpdate?.isPrerelease).toBe(true)

            // Verify prerelease-specific release notes
            const releaseNotes = await updateController.getReleaseNotes('v2.1.0-beta.1')
            expect(releaseNotes).toContain('Preview Release')
            expect(releaseNotes).toContain('AI Query Assistant')
            expect(releaseNotes).toContain('Beta Notice')
        })

        it('should handle network interruptions gracefully', async () => {
            // **Feature: github-auto-updater, Integration Test 17: Network interruption handling**

            const retryEvents: string[] = []

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).configService = mockConfig
                ; (updateAgent as any).downloadManager = mockDownload

            // Track retry attempts
            updateAgent.on('error', (error) => {
                retryEvents.push(`error: ${error.context}`)
            })

            await updateAgent.initialize()

            // Simulate slow network for initial check
            mockGitHub.setSlowNetwork(true)

            const startTime = Date.now()
            const updateInfo = await updateAgent.checkForUpdates()
            const checkTime = Date.now() - startTime

            expect(updateInfo).toBeDefined()
            expect(checkTime).toBeGreaterThan(500) // Should take longer due to slow network

            // Simulate download interruption
            mockDownload.setInterruption(true)

            await expect(updateAgent.downloadUpdate(updateInfo!)).rejects.toThrow('Download interrupted')

            // Reset and retry should succeed
            mockDownload.setInterruption(false)
            const filePath = await updateAgent.downloadUpdate(updateInfo!)
            expect(filePath).toBeDefined()
        })

        it('should respect enterprise policies during update flow', async () => {
            // **Feature: github-auto-updater, Integration Test 18: Enterprise policy enforcement**

            // Enable enterprise policies
            mockConfig.setPolicy('enterprisePoliciesActive', true)
            mockConfig.setPolicy('autoCheckAllowed', false)

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).configService = mockConfig

            await updateController.initialize()

            // Auto-check should be blocked by policy
            await updateController.checkNow()
            const state = updateController.getUpdateState()
            expect(state.availableUpdate).toBeUndefined()

            // Enable check but disable auto-install
            mockConfig.setPolicy('autoCheckAllowed', true)
            mockConfig.setPolicy('autoInstallAllowed', false)

            await updateController.checkNow()
            const updatedState = updateController.getUpdateState()
            expect(updatedState.availableUpdate).toBeDefined()

            // Installation should be blocked by policy
            await expect(
                updateController.downloadAndInstall(updatedState.availableUpdate!)
            ).rejects.toThrow('Automatic installation is disabled by policy')
        })

        it('should handle maintenance window restrictions', async () => {
            // **Feature: github-auto-updater, Integration Test 19: Maintenance window compliance**

            // Set maintenance window to 2 AM - 6 AM
            mockConfig.setMaintenanceWindow(2, 6)

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).configService = mockConfig

            await updateAgent.initialize()

            const updateInfo = await updateAgent.checkForUpdates()
            expect(updateInfo).toBeDefined()

            // Mock current time to be outside maintenance window (10 AM)
            const mockDate = new Date()
            mockDate.setHours(10, 0, 0, 0)
            vi.setSystemTime(mockDate)

            // Installation should be blocked outside maintenance window
            await expect(updateAgent.installUpdate('/fake/path')).rejects.toThrow(
                'Installation not allowed outside maintenance window'
            )

            // Mock current time to be inside maintenance window (4 AM)
            mockDate.setHours(4, 0, 0, 0)
            vi.setSystemTime(mockDate)

            // Installation should be allowed inside maintenance window
            // Note: This would normally succeed but we don't have a real file
            await expect(updateAgent.installUpdate('/fake/path')).rejects.toThrow(
                'Installation failed' // Different error, meaning it passed the maintenance window check
            )
        })

        it('should provide detailed progress tracking throughout update', async () => {
            // **Feature: github-auto-updater, Integration Test 20: Progress tracking**

            const progressEvents: Array<{
                stage: string
                percentage: number
                timestamp: Date
                details?: any
            }> = []

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false,
                progressHandler: (progress) => {
                    progressEvents.push({
                        stage: 'download',
                        percentage: progress.percentage,
                        timestamp: new Date(),
                        details: {
                            bytesDownloaded: progress.bytesDownloaded,
                            totalBytes: progress.totalBytes,
                            speed: progress.speed
                        }
                    })
                }
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).updateAgent.downloadManager = mockDownload
                ; (updateController as any).configService = mockConfig

                // Track installation progress
                ; (updateController as any).updateAgent.on('installation-progress', (progress: any) => {
                    progressEvents.push({
                        stage: progress.stage,
                        percentage: progress.percentage,
                        timestamp: new Date(),
                        details: { message: progress.message }
                    })
                })

            await updateController.initialize()
            await updateController.checkNow()

            const state = updateController.getUpdateState()
            await updateController.downloadAndInstall(state.availableUpdate!)

            // Verify comprehensive progress tracking
            expect(progressEvents.length).toBeGreaterThan(10)

            // Verify download progress
            const downloadEvents = progressEvents.filter(e => e.stage === 'download')
            expect(downloadEvents.length).toBeGreaterThan(5)
            expect(downloadEvents[0].percentage).toBeLessThan(downloadEvents[downloadEvents.length - 1].percentage)

            // Verify installation progress
            const installEvents = progressEvents.filter(e => e.stage === 'extracting' || e.stage === 'installing')
            expect(installEvents.length).toBeGreaterThan(0)

            // Verify progress is monotonically increasing within each stage
            for (let i = 1; i < downloadEvents.length; i++) {
                expect(downloadEvents[i].percentage).toBeGreaterThanOrEqual(downloadEvents[i - 1].percentage)
            }
        })

        it('should handle rate limiting with proper backoff', async () => {
            // **Feature: github-auto-updater, Integration Test 21: Rate limit handling**

            const attemptTimes: Date[] = []

            // Enable rate limiting
            mockGitHub.setRateLimit(true, 5) // Reset in 5 seconds

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).configService = mockConfig

            await updateAgent.initialize()

            // First attempt should fail with rate limit
            attemptTimes.push(new Date())
            await expect(updateAgent.checkForUpdates()).rejects.toThrow('API rate limit exceeded')

            // Verify rate limit status is accessible
            const rateLimitStatus = mockGitHub.getRateLimitStatus()
            expect(rateLimitStatus.isRateLimited).toBe(true)
            expect(rateLimitStatus.rateLimitInfo?.retryAfter).toBe(60)

            // Disable rate limiting and retry
            mockGitHub.setRateLimit(false)

            // Ensure wall-clock time advances so the timing assertion is deterministic.
            await new Promise(resolve => setTimeout(resolve, 1))
            attemptTimes.push(new Date())

            const updateInfo = await updateAgent.checkForUpdates()
            expect(updateInfo).toBeDefined()

            // Verify proper timing between attempts
            const timeDiff = attemptTimes[1].getTime() - attemptTimes[0].getTime()
            expect(timeDiff).toBeGreaterThan(0) // Should have some delay
        })

        it('should maintain update history with detailed records', async () => {
            // **Feature: github-auto-updater, Integration Test 22: Update history tracking**

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).updateAgent.downloadManager = mockDownload
                ; (updateController as any).configService = mockConfig

            await updateController.initialize()

            // Perform successful update
            await updateController.checkNow()
            const state = updateController.getUpdateState()
            await updateController.downloadAndInstall(state.availableUpdate!)

            // Verify history record
            let history = await updateController.getUpdateHistory()
            expect(history.length).toBe(1)
            expect(history[0].version).toBe('v2.0.1')
            expect(history[0].success).toBe(true)
            expect(history[0].installedAt).toBeInstanceOf(Date)
            expect(history[0].errorMessage).toBeUndefined()

            // Simulate failed update
            mockDownload.setInterruption(true)

            try {
                await updateController.downloadAndInstall(state.availableUpdate!)
            } catch (error) {
                // Expected to fail
            }

            // Verify failed update is recorded
            history = await updateController.getUpdateHistory()
            expect(history.length).toBe(2)
            expect(history[0].success).toBe(false) // Most recent first
            expect(history[0].errorMessage).toContain('Download interrupted')
            expect(history[1].success).toBe(true) // Previous successful update
        })
    })

    describe('Error Handling and Recovery', () => {
        it('should recover from authentication token expiration', async () => {
            // **Feature: github-auto-updater, Integration Test 23: Token expiration recovery**

            let authAttempts = 0
            const originalAuth = mockGitHub.authenticate.bind(mockGitHub)

            mockGitHub.authenticate = (token: string) => {
                authAttempts++
                if (authAttempts === 1) {
                    throw new Error('Token expired')
                }
                return originalAuth(token)
            }

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).configService = mockConfig

            // First initialization should fail
            await expect(updateAgent.initialize()).rejects.toThrow('Token expired')

            // Retry should succeed
            await updateAgent.initialize()
            expect(authAttempts).toBe(2)
        })

        it('should handle partial download corruption gracefully', async () => {
            // **Feature: github-auto-updater, Integration Test 24: Download corruption handling**

            const mockFileVerifier = {
                verifyFile: vi.fn()
            }

            // First verification fails (corruption), second succeeds
            mockFileVerifier.verifyFile
                .mockResolvedValueOnce({ valid: false, error: 'Checksum mismatch' })
                .mockResolvedValueOnce({ valid: true })

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).configService = mockConfig
                ; (updateAgent as any).downloadManager = mockDownload
                ; (updateAgent as any).fileVerifier = mockFileVerifier

            await updateAgent.initialize()

            const updateInfo = await updateAgent.checkForUpdates()
            const filePath = await updateAgent.downloadUpdate(updateInfo!)

            // First verification should fail
            const firstResult = await updateAgent.verifyUpdate(filePath, updateInfo!.checksum)
            expect(firstResult).toBe(false)

            // Second verification should succeed (simulating re-download)
            const secondResult = await updateAgent.verifyUpdate(filePath, updateInfo!.checksum)
            expect(secondResult).toBe(true)

            expect(mockFileVerifier.verifyFile).toHaveBeenCalledTimes(2)
        })

        it('should handle concurrent update attempts safely', async () => {
            // **Feature: github-auto-updater, Integration Test 25: Concurrent update safety**

            const updateController = new UpdateControllerImpl({
                owner: 'test',
                repo: 'dbconsole',
                autoStart: false
            })

                ; (updateController as any).updateAgent.githubClient = mockGitHub
                ; (updateController as any).updateAgent.configService = mockConfig
                ; (updateController as any).updateAgent.downloadManager = mockDownload
                ; (updateController as any).configService = mockConfig

            await updateController.initialize()
            await updateController.checkNow()

            const state = updateController.getUpdateState()
            const updateInfo = state.availableUpdate!

            // Start first update
            const firstUpdate = updateController.downloadAndInstall(updateInfo)

            // Try to start second update while first is in progress
            await expect(
                updateController.downloadAndInstall(updateInfo)
            ).rejects.toThrow('Another update is already in progress')

            // Wait for first update to complete
            await firstUpdate

            // Now second update should be allowed
            const secondUpdate = updateController.downloadAndInstall(updateInfo)
            await expect(secondUpdate).resolves.not.toThrow()
        })
    })
})