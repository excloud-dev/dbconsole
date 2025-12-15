/**
 * Property-based tests for UpdateController orchestration layer
 * **Feature: github-auto-updater, Property 22: Update history persistence**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Mock all dependencies first
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test'),
        getVersion: vi.fn(() => '1.0.0'),
        relaunch: vi.fn(() => undefined),
        exit: vi.fn(() => undefined)
    },
    shell: {
        showItemInFolder: vi.fn(() => undefined),
        openPath: vi.fn(async () => '')
    },
    dialog: {},
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((str) => Buffer.from(str, 'utf8')),
        decryptString: vi.fn((buffer) => buffer.toString('utf8'))
    }
}))

vi.mock('fs/promises', () => ({
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn()
}))

vi.mock('../lib/updater/github-client', () => ({
    GitHubClientImpl: class MockGitHubClient {
        authenticate = vi.fn()
        getReleasesByChannel = vi.fn().mockResolvedValue([])
        getBestAssetForPlatform = vi.fn().mockReturnValue(null)
    }
}))

vi.mock('../lib/updater/download-manager', () => ({
    DownloadManager: class MockDownloadManager {
        on = vi.fn()
        downloadFile = vi.fn().mockResolvedValue({ filePath: '/tmp/test-file' })
    }
}))

vi.mock('../lib/updater/file-integrity', () => ({
    FileIntegrityVerifier: class MockFileIntegrityVerifier {
        verifyFile = vi.fn().mockResolvedValue({ valid: true })
    }
}))

vi.mock('../lib/updater/version-utils', () => ({
    VersionUtils: class MockVersionUtils {
        isNewerVersion = vi.fn().mockReturnValue(false)
    }
}))

vi.mock('../lib/updater/config-service', () => ({
    ConfigServiceImpl: class MockConfigService {
        initialize = vi.fn().mockResolvedValue(undefined)
        getGitHubToken = vi.fn().mockResolvedValue('ghp_test_token_1234567890123456789012345678')
        getUpdateSettings = vi.fn().mockResolvedValue({
            autoCheck: true,
            autoInstall: false,
            checkInterval: 24,
            updateChannel: 'latest'
        })
        isAutoCheckAllowed = vi.fn().mockResolvedValue(true)
        getEffectiveCheckInterval = vi.fn().mockResolvedValue(24)
        isAutoInstallAllowed = vi.fn().mockResolvedValue(true)
        isInMaintenanceWindow = vi.fn().mockResolvedValue(true)
    }
}))

vi.mock('../lib/updater/update-agent', () => ({
    UpdateAgentImpl: class MockUpdateAgent {
        public state: any

        constructor() {
            this.state = { status: 'idle', currentVersion: '1.0.0' }
        }

        async initialize() {
            return Promise.resolve()
        }

        async startBackgroundChecker() {
            return Promise.resolve()
        }

        stopBackgroundChecker() {
            // no-op
        }

        async downloadUpdate() {
            return Promise.resolve('/tmp/test-file')
        }

        async verifyUpdate() {
            return Promise.resolve(true)
        }

        async installUpdate() {
            // Fast mock installation - no delay
            return Promise.resolve()
        }

        getState() {
            return this.state
        }

        on() {
            return this
        }

        emit() {
            return true
        }
    }
}))
// Now import the actual classes
import { UpdateControllerImpl, UpdateControllerOptions } from '../lib/updater/update-controller'
import { UpdateInfo, UpdateRecord } from '../lib/updater/types'

// Custom arbitraries for generating test data
const versionArbitrary = fc.string({ minLength: 3, maxLength: 10 })
    .filter(s => s.trim().length >= 3 && /^[a-zA-Z0-9._-]+$/.test(s.trim()))
    .map(s => `v${s.trim().replace(/^v+/, '')}`) // Remove any existing v prefix before adding one

const updateInfoArbitrary: fc.Arbitrary<UpdateInfo> = fc.record({
    version: versionArbitrary,
    releaseNotes: fc.string({ minLength: 10, maxLength: 500 })
        .filter(s => s.trim().length >= 5 && /[a-zA-Z0-9]/.test(s)), // Ensure it contains alphanumeric characters
    downloadUrl: fc.webUrl(),
    checksum: fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
        .map(arr => arr.map(n => n.toString(16)).join('')),
    publishedAt: fc.date(),
    isPrerelease: fc.boolean()
})

const updateControllerOptionsArbitrary: fc.Arbitrary<UpdateControllerOptions> = fc.record({
    owner: fc.string({ minLength: 2, maxLength: 20 })
        .filter(s => s.trim().length >= 2 && /^[a-zA-Z0-9_-]+$/.test(s.trim()) && s.trim() !== '-'),
    repo: fc.string({ minLength: 2, maxLength: 20 })
        .filter(s => s.trim().length >= 2 && /^[a-zA-Z0-9_-]+$/.test(s.trim()) && s.trim() !== '0'),
    autoStart: fc.boolean()
})

describe('UpdateController Update History Properties', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('Property 22: Update history persistence - should maintain update records across operations', async () => {
        /**
         * **Feature: github-auto-updater, Property 22: Update history persistence**
         * **Validates: Requirements 5.5**
         * For any completed update operation, the system should record the update in the history log with timestamp and outcome
         */
        await fc.assert(
            fc.asyncProperty(
                updateControllerOptionsArbitrary,
                fc.array(updateInfoArbitrary, { minLength: 1, maxLength: 3 }),
                async (options, updateInfos) => {
                    const controller = new UpdateControllerImpl(options)

                    try {
                        // Initialize the controller
                        await controller.initialize()

                        // Get initial history (should be empty)
                        const initialHistory = await controller.getUpdateHistory()
                        expect(initialHistory).toEqual([])

                        // Simulate multiple update operations
                        const expectedRecords: UpdateRecord[] = []

                        for (const updateInfo of updateInfos) {
                            try {
                                // Attempt to download and install
                                await controller.downloadAndInstall(updateInfo)

                                // If successful, expect a success record
                                expectedRecords.unshift({
                                    version: updateInfo.version,
                                    installedAt: expect.any(Date),
                                    success: true
                                })
                            } catch (error) {
                                // If failed, expect a failure record
                                expectedRecords.unshift({
                                    version: updateInfo.version,
                                    installedAt: expect.any(Date),
                                    success: false,
                                    errorMessage: expect.any(String)
                                })
                            }
                        }

                        // Get final history
                        const finalHistory = await controller.getUpdateHistory()

                        // Verify that history contains all expected records
                        expect(finalHistory).toHaveLength(expectedRecords.length)

                        // Verify each record exists and has correct structure
                        for (let i = 0; i < expectedRecords.length; i++) {
                            const actualRecord = finalHistory[i]
                            const expectedRecord = expectedRecords[i]

                            expect(actualRecord.version).toBe(expectedRecord.version)
                            expect(actualRecord.success).toBe(expectedRecord.success)
                            expect(actualRecord.installedAt).toBeInstanceOf(Date)

                            if (!expectedRecord.success) {
                                expect(actualRecord.errorMessage).toBeDefined()
                                expect(typeof actualRecord.errorMessage).toBe('string')
                            }
                        }

                        // Verify chronological ordering (newest first)
                        for (let i = 1; i < finalHistory.length; i++) {
                            expect(finalHistory[i - 1].installedAt.getTime())
                                .toBeGreaterThanOrEqual(finalHistory[i].installedAt.getTime())
                        }

                    } finally {
                        // Clean up
                        controller.stopBackgroundChecker()
                    }
                }
            ),
            { numRuns: 10, timeout: 10000 }
        )
    })

    it('Property 20: Release notes retrieval - should fetch and format release notes correctly', async () => {
        /**
         * **Feature: github-auto-updater, Property 20: Release notes retrieval**
         * **Validates: Requirements 5.2**
         * For any available update, the system should fetch and display the associated release notes from the GitHub release
         */
        await fc.assert(
            fc.asyncProperty(
                updateControllerOptionsArbitrary,
                versionArbitrary,
                fc.string({ minLength: 10, maxLength: 500 })
                    .filter(s => s.trim().length >= 5 && /[a-zA-Z0-9]/.test(s)), // Ensure meaningful content
                async (options, version, releaseNotes) => {
                    const controller = new UpdateControllerImpl(options)

                    try {
                        // Initialize the controller
                        await controller.initialize()

                        // Set up mock update info with cleaned release notes
                        const cleanedReleaseNotes = releaseNotes.trim()
                        const updateInfo: UpdateInfo = {
                            version,
                            releaseNotes: cleanedReleaseNotes,
                            downloadUrl: 'https://example.com/download',
                            checksum: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                            publishedAt: new Date(),
                            isPrerelease: false
                        }

                            // Simulate having current update info
                            ; (controller as any).currentUpdateInfo = updateInfo

                        // Get release notes - this should always work
                        const retrievedNotes = await controller.getReleaseNotes(version)

                        // Verify that release notes are returned and formatted
                        expect(retrievedNotes).toBeDefined()
                        expect(typeof retrievedNotes).toBe('string')
                        expect(retrievedNotes.length).toBeGreaterThan(0)

                        // Should contain the version in the formatted output
                        expect(retrievedNotes).toContain(version)

                        // Should contain the original release notes content
                        if (cleanedReleaseNotes.length > 0) {
                            // If original notes are not empty, they should be included
                            expect(retrievedNotes).toContain(cleanedReleaseNotes)
                        } else {
                            // If original notes are empty, should have a default message
                            expect(retrievedNotes).toMatch(/no release notes/i)
                        }

                        // Test formatted release info
                        const releaseInfo = await controller.getFormattedReleaseInfo(version)
                        expect(releaseInfo.version).toBe(version)
                        expect(releaseInfo.releaseNotes).toBeDefined()
                        expect(releaseInfo.publishedAt).toBeInstanceOf(Date)
                        expect(typeof releaseInfo.isPrerelease).toBe('boolean')

                        // Test different display formats
                        const markdownNotes = await controller.displayReleaseNotes(version, 'markdown')
                        const plainNotes = await controller.displayReleaseNotes(version, 'plain')
                        const htmlNotes = await controller.displayReleaseNotes(version, 'html')

                        expect(markdownNotes).toBeDefined()
                        expect(plainNotes).toBeDefined()
                        expect(htmlNotes).toBeDefined()

                        // All formats should contain the version
                        expect(markdownNotes).toContain(version)
                        expect(plainNotes).toContain(version)
                        expect(htmlNotes).toContain(version)

                        // HTML format should contain HTML tags
                        expect(htmlNotes).toMatch(/<[^>]+>/)

                    } finally {
                        // Clean up
                        controller.stopBackgroundChecker()
                    }
                }
            ),
            { numRuns: 20, timeout: 5000 }
        )
    })

    it('Property 21: Update completion notification - should display notification with version and key changes', async () => {
        /**
         * **Feature: github-auto-updater, Property 21: Update completion notification**
         * **Validates: Requirements 5.4**
         * For any successfully completed update, the system should display a notification containing the new version number and key changes
         */
        await fc.assert(
            fc.asyncProperty(
                updateControllerOptionsArbitrary,
                updateInfoArbitrary,
                async (options, updateInfo) => {
                    const controller = new UpdateControllerImpl(options)
                    let completionNotification: any = null

                    try {
                        // Initialize the controller
                        await controller.initialize()

                        // Set up notification listener to capture completion notifications
                        controller.on('notification', (notification) => {
                            if (notification.type === 'installation-complete') {
                                completionNotification = notification
                            }
                        })

                        // Perform the update installation
                        await controller.downloadAndInstall(updateInfo)

                        // Verify that a completion notification was emitted
                        expect(completionNotification).toBeDefined()
                        expect(completionNotification).not.toBeNull()

                        // Verify notification structure
                        expect(completionNotification.type).toBe('installation-complete')
                        expect(completionNotification.timestamp).toBeInstanceOf(Date)
                        expect(completionNotification.data).toBeDefined()

                        const notificationData = completionNotification.data

                        // Verify that the notification contains the version number
                        expect(notificationData.version).toBe(updateInfo.version)
                        expect(typeof notificationData.version).toBe('string')
                        expect(notificationData.version.length).toBeGreaterThan(0)

                        // Verify that the notification contains release notes
                        expect(notificationData.releaseNotes).toBeDefined()
                        expect(typeof notificationData.releaseNotes).toBe('string')
                        expect(notificationData.releaseNotes.length).toBeGreaterThan(0)

                        // Verify that the notification contains a formatted message
                        expect(notificationData.formattedMessage).toBeDefined()
                        expect(typeof notificationData.formattedMessage).toBe('string')
                        expect(notificationData.formattedMessage).toContain(updateInfo.version)
                        expect(notificationData.formattedMessage).toMatch(/update complete/i)

                        // Verify that key changes are extracted and included
                        expect(notificationData.keyChanges).toBeDefined()
                        expect(Array.isArray(notificationData.keyChanges)).toBe(true)

                        // If the release notes contain bullet points or changes, they should be extracted
                        if (updateInfo.releaseNotes.includes('- ') ||
                            updateInfo.releaseNotes.includes('* ') ||
                            updateInfo.releaseNotes.match(/^\d+\./m) ||
                            updateInfo.releaseNotes.match(/^(Added|Fixed|Changed|Improved|Updated|New|Enhanced):/im)) {
                            expect(notificationData.keyChanges.length).toBeGreaterThan(0)
                        }

                        // Verify metadata is included (may be undefined if not available)
                        if (notificationData.publishedAt !== undefined) {
                            expect(notificationData.publishedAt).toBeInstanceOf(Date)
                        }
                        if (notificationData.isPrerelease !== undefined) {
                            expect(typeof notificationData.isPrerelease).toBe('boolean')
                        }

                        // Verify that the notification data matches the update info when available
                        if (notificationData.publishedAt !== undefined) {
                            expect(notificationData.publishedAt).toEqual(updateInfo.publishedAt)
                        }
                        if (notificationData.isPrerelease !== undefined) {
                            expect(notificationData.isPrerelease).toBe(updateInfo.isPrerelease)
                        }

                        // Verify that the formatted message contains appropriate completion indicators
                        expect(notificationData.formattedMessage).toMatch(/🎉|complete|success|install/i)

                        // Verify that the notification timestamp is recent (within last few seconds)
                        const timeDiff = Date.now() - completionNotification.timestamp.getTime()
                        expect(timeDiff).toBeLessThan(5000) // Within 5 seconds

                    } finally {
                        // Clean up
                        controller.stopBackgroundChecker()
                    }
                }
            ),
            { numRuns: 15, timeout: 8000 }
        )
    })
})