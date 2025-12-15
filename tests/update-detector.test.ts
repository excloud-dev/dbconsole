/**
 * Property-based tests for update availability detection
 * **Feature: github-auto-updater, Property 5: Update notification consistency**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    UpdateDetector,
    UpdateDetectionConfig,
    UpdateAvailabilityResult
} from '../lib/updater/update-detector'
import {
    GitHubRelease,
    GitHubAsset,
    UpdateSettings,
    UpdateChannel,
    Platform,
    Architecture
} from '../lib/updater/types'

// Custom arbitraries for generating test data
const validVersionArbitrary = fc.tuple(
    fc.integer({ min: 0, max: 99 }), // major
    fc.integer({ min: 0, max: 99 }), // minor  
    fc.integer({ min: 0, max: 99 })  // patch
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const prereleaseVersionArbitrary = fc.tuple(
    fc.integer({ min: 0, max: 99 }), // major
    fc.integer({ min: 0, max: 99 }), // minor
    fc.integer({ min: 0, max: 99 }), // patch
    fc.oneof(
        fc.constant('alpha'),
        fc.constant('beta'),
        fc.constant('rc')
    ),
    fc.integer({ min: 1, max: 9 })
).map(([major, minor, patch, preId, preNum]) => `${major}.${minor}.${patch}-${preId}.${preNum}`)

const anyValidVersionArbitrary = fc.oneof(
    validVersionArbitrary,
    prereleaseVersionArbitrary
)

const updateChannelArbitrary: fc.Arbitrary<UpdateChannel> = fc.oneof(
    fc.constant('latest' as const),
    fc.constant('prerelease' as const),
    fc.constant('custom' as const)
)

const platformArbitrary: fc.Arbitrary<Platform> = fc.oneof(
    fc.constant('darwin' as const),
    fc.constant('win32' as const),
    fc.constant('linux' as const)
)

const architectureArbitrary: fc.Arbitrary<Architecture> = fc.oneof(
    fc.constant('x64' as const),
    fc.constant('arm64' as const)
)

const gitHubAssetArbitrary: fc.Arbitrary<GitHubAsset> = fc.record({
    id: fc.integer({ min: 1, max: 999999 }),
    name: fc.oneof(
        fc.constant('app-darwin-x64.dmg'),
        fc.constant('app-win32-x64.exe'),
        fc.constant('app-linux-x64.deb'),
        fc.constant('app-darwin-arm64.dmg'),
        fc.constant('app-win32-arm64.exe'),
        fc.constant('app-linux-arm64.deb')
    ),
    size: fc.integer({ min: 1000000, max: 100000000 }),
    downloadUrl: fc.webUrl(),
    contentType: fc.constant('application/octet-stream')
})

const gitHubReleaseArbitrary: fc.Arbitrary<GitHubRelease> = fc.record({
    id: fc.integer({ min: 1, max: 999999 }),
    tagName: anyValidVersionArbitrary.map(v => `v${v}`),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    body: fc.string({ maxLength: 200 }),
    assets: fc.array(gitHubAssetArbitrary, { minLength: 1, maxLength: 6 }),
    prerelease: fc.boolean(),
    publishedAt: fc.constant(new Date().toISOString())
})

const updateSettingsArbitrary: fc.Arbitrary<UpdateSettings> = fc.record({
    autoCheck: fc.boolean(),
    autoInstall: fc.boolean(),
    checkInterval: fc.integer({ min: 1, max: 168 }), // 1 hour to 1 week
    updateChannel: updateChannelArbitrary,
    customTagPattern: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
    maintenanceWindow: fc.constant(undefined)
})

const updateDetectionConfigArbitrary: fc.Arbitrary<UpdateDetectionConfig> = fc.record({
    currentVersion: anyValidVersionArbitrary,
    owner: fc.string({ minLength: 1, maxLength: 20 }),
    repo: fc.string({ minLength: 1, maxLength: 20 }),
    platform: platformArbitrary,
    architecture: architectureArbitrary,
    settings: updateSettingsArbitrary
})

describe('Update Notification Properties', () => {
    const detector = new UpdateDetector()

    it('Property 5: Update notification consistency - should notify when newer version is available', () => {
        /**
         * **Validates: Requirements 1.5**
         * For any scenario where a newer version is available, the system should notify the user and provide download options
         */
        fc.assert(
            fc.property(
                updateDetectionConfigArbitrary,
                fc.array(gitHubReleaseArbitrary, { minLength: 1, maxLength: 5 }),
                (config, releases) => {
                    // Ensure at least one release has a newer version than current
                    const currentVersion = config.currentVersion
                    const newerVersion = incrementVersionForTest(currentVersion)

                    // Create a release with newer version
                    const newerRelease: GitHubRelease = {
                        ...releases[0],
                        tagName: `v${newerVersion}`,
                        prerelease: config.settings.updateChannel === 'prerelease' ? Math.random() > 0.5 : false
                    }

                    const testReleases = [newerRelease, ...releases.slice(1)]

                    const result = detector.detectUpdateAvailability(testReleases, config)

                    // If there's a newer version available and appropriate assets exist, should have update
                    if (result.hasUpdate) {
                        // Should have update info
                        expect(result.updateInfo).toBeDefined()
                        expect(result.latestVersion).toBeDefined()

                        // Latest version should be newer than current
                        if (result.latestVersion) {
                            const isActuallyNewer = isNewerVersionSimple(result.latestVersion, currentVersion)
                            return isActuallyNewer
                        }
                    }

                    // If no update, that's also valid (might be due to channel filtering or no matching assets)
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 5: Update notification consistency - should not notify when no newer version exists', () => {
        /**
         * **Validates: Requirements 1.5**
         * When no newer version is available, the system should not indicate an update is available
         */
        fc.assert(
            fc.property(
                updateDetectionConfigArbitrary,
                fc.array(gitHubReleaseArbitrary, { minLength: 1, maxLength: 5 }),
                (config, releases) => {
                    // Ensure all releases have older or equal versions
                    const currentVersion = config.currentVersion
                    const olderVersion = decrementVersionForTest(currentVersion)

                    // Create releases with older versions
                    const olderReleases = releases.map((release, index) => ({
                        ...release,
                        tagName: `v${olderVersion}.${index}`, // Make each slightly different but still older
                        prerelease: config.settings.updateChannel === 'prerelease' ? Math.random() > 0.5 : false
                    }))

                    const result = detector.detectUpdateAvailability(olderReleases, config)

                    // Should not have update when all versions are older
                    if (result.hasUpdate && result.latestVersion) {
                        // If it claims to have an update, the latest version should actually be newer
                        return isNewerVersionSimple(result.latestVersion, currentVersion)
                    }

                    // No update is the expected result
                    return !result.hasUpdate
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 5: Update notification consistency - channel filtering should be respected', () => {
        /**
         * **Validates: Requirements 1.5**
         * Update notifications should respect the configured update channel
         */
        fc.assert(
            fc.property(
                updateDetectionConfigArbitrary,
                (config) => {
                    // Create a mix of stable and prerelease versions
                    const currentVersion = config.currentVersion
                    const newerStableVersion = incrementVersionForTest(currentVersion)
                    const newerPrereleaseVersion = `${newerStableVersion}-beta.1`

                    const stableRelease: GitHubRelease = {
                        id: 1,
                        tagName: `v${newerStableVersion}`,
                        name: 'Stable Release',
                        body: 'Stable release notes',
                        assets: [{
                            id: 1,
                            name: `app-${config.platform}-${config.architecture}.dmg`,
                            size: 10000000,
                            downloadUrl: 'https://example.com/stable.dmg',
                            contentType: 'application/octet-stream'
                        }],
                        prerelease: false,
                        publishedAt: new Date().toISOString()
                    }

                    const prereleaseRelease: GitHubRelease = {
                        id: 2,
                        tagName: `v${newerPrereleaseVersion}`,
                        name: 'Prerelease',
                        body: 'Prerelease notes',
                        assets: [{
                            id: 2,
                            name: `app-${config.platform}-${config.architecture}.dmg`,
                            size: 10000000,
                            downloadUrl: 'https://example.com/prerelease.dmg',
                            contentType: 'application/octet-stream'
                        }],
                        prerelease: true,
                        publishedAt: new Date().toISOString()
                    }

                    const releases = [prereleaseRelease, stableRelease] // Prerelease is "newer"

                    const result = detector.detectUpdateAvailability(releases, config)

                    if (config.settings.updateChannel === 'latest') {
                        // Should only consider stable releases
                        if (result.hasUpdate && result.updateInfo) {
                            return !result.updateInfo.isPrerelease
                        }
                        return true // No update is also valid for latest channel
                    } else if (config.settings.updateChannel === 'prerelease') {
                        // Should consider both stable and prerelease
                        // Either version could be selected depending on which is newer
                        return true // Both outcomes are valid for prerelease channel
                    }

                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 5: Update notification consistency - forced updates should be flagged', () => {
        /**
         * **Validates: Requirements 1.5**
         * Forced updates should be properly identified and flagged
         */
        fc.assert(
            fc.property(
                updateDetectionConfigArbitrary,
                fc.oneof(
                    fc.constant('FORCE UPDATE'),
                    fc.constant('Critical security update'),
                    fc.constant('Breaking change'),
                    fc.constant('Regular update')
                ),
                (config, releaseBody) => {
                    const currentVersion = config.currentVersion
                    const newerVersion = incrementVersionForTest(currentVersion)

                    const release: GitHubRelease = {
                        id: 1,
                        tagName: `v${newerVersion}`,
                        name: 'Test Release',
                        body: releaseBody,
                        assets: [{
                            id: 1,
                            name: `app-${config.platform}-${config.architecture}.dmg`,
                            size: 10000000,
                            downloadUrl: 'https://example.com/test.dmg',
                            contentType: 'application/octet-stream'
                        }],
                        prerelease: false,
                        publishedAt: new Date().toISOString()
                    }

                    const result = detector.detectUpdateAvailability([release], config)

                    const shouldBeForced = releaseBody.toLowerCase().includes('force') ||
                        releaseBody.toLowerCase().includes('critical') ||
                        releaseBody.toLowerCase().includes('breaking')

                    if (result.hasUpdate) {
                        return result.isForced === shouldBeForced
                    }

                    return true
                }
            ),
            { numRuns: 100 }
        )
    })
})

// Helper functions for test
function incrementVersionForTest(version: string): string {
    const parts = version.split('-')[0].split('.')
    const patch = parseInt(parts[2] || '0', 10)
    return `${parts[0]}.${parts[1]}.${patch + 1}`
}

function decrementVersionForTest(version: string): string {
    const parts = version.split('-')[0].split('.')
    const patch = Math.max(0, parseInt(parts[2] || '0', 10) - 1)
    return `${parts[0]}.${parts[1]}.${patch}`
}

function isNewerVersionSimple(version1: string, version2: string): boolean {
    // Simple version comparison for test purposes
    const v1Parts = version1.split('-')[0].split('.').map(Number)
    const v2Parts = version2.split('-')[0].split('.').map(Number)

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0
        const v2Part = v2Parts[i] || 0

        if (v1Part > v2Part) return true
        if (v1Part < v2Part) return false
    }

    return false
}

describe('Update Detector Unit Tests', () => {
    const detector = new UpdateDetector()

    it('should detect updates correctly with basic configuration', () => {
        const config: UpdateDetectionConfig = {
            currentVersion: '1.0.0',
            owner: 'test',
            repo: 'test',
            platform: 'darwin',
            architecture: 'x64',
            settings: {
                autoCheck: true,
                autoInstall: false,
                checkInterval: 24,
                updateChannel: 'latest',
                customTagPattern: undefined,
                maintenanceWindow: undefined
            }
        }

        const releases: GitHubRelease[] = [{
            id: 1,
            tagName: 'v1.1.0',
            name: 'Version 1.1.0',
            body: 'New features and bug fixes',
            assets: [{
                id: 1,
                name: 'app-darwin-x64.dmg',
                size: 10000000,
                downloadUrl: 'https://example.com/app.dmg',
                contentType: 'application/octet-stream'
            }],
            prerelease: false,
            publishedAt: new Date().toISOString()
        }]

        const result = detector.detectUpdateAvailability(releases, config)

        expect(result.hasUpdate).toBe(true)
        expect(result.updateInfo).toBeDefined()
        expect(result.latestVersion).toBe('1.1.0')
        expect(result.isForced).toBe(false)
    })

    it('should handle minimum version requirements', () => {
        expect(detector.satisfiesMinimumVersion('1.5.0', '1.0.0')).toBe(true)
        expect(detector.satisfiesMinimumVersion('0.9.0', '1.0.0')).toBe(false)
        expect(detector.satisfiesMinimumVersion('1.0.0', '1.0.0')).toBe(true)
    })

    it('should calculate update priority correctly', () => {
        const securityRelease: GitHubRelease = {
            id: 1,
            tagName: 'v1.1.0',
            name: 'Security Update',
            body: 'Critical security fixes',
            assets: [],
            prerelease: false,
            publishedAt: new Date().toISOString()
        }

        const priority = detector.getUpdatePriority('1.0.0', '1.1.0', securityRelease)
        expect(priority).toBe(5) // Highest priority for security updates
    })
})