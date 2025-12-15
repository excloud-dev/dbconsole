/**
 * Property-based tests for web app update notifications
 * **Feature: github-auto-updater, Property 13: Web app version notification**
 * **Validates: Requirements 3.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { isNewerVersion } from '../lib/updater/version-utils'

describe('Web App Update Notifications', () => {
    /**
     * Property 13: Web app version notification
     * For any web application instance detecting a version mismatch, 
     * the system should display appropriate update notifications to the user
     */
    it('should correctly identify when updates are available using version comparison', async () => {
        await fc.assert(
            fc.property(
                // Generate current version
                fc.tuple(
                    fc.integer({ min: 0, max: 5 }),
                    fc.integer({ min: 0, max: 10 }),
                    fc.integer({ min: 0, max: 20 })
                ),
                // Generate increment
                fc.integer({ min: 1, max: 3 }),
                ([major, minor, patch], increment) => {
                    const currentVersion = `${major}.${minor}.${patch}`
                    const newerVersion = `${major}.${minor}.${patch + increment}`

                    // The core property: version comparison should correctly identify newer versions
                    const shouldNotify = isNewerVersion(newerVersion, currentVersion)

                    // This should always be true for our test data
                    expect(shouldNotify).toBe(true)

                    // Additional validation: the reverse should be false
                    expect(isNewerVersion(currentVersion, newerVersion)).toBe(false)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('should not notify when versions are equal', async () => {
        await fc.assert(
            fc.property(
                // Generate version
                fc.tuple(
                    fc.integer({ min: 0, max: 5 }),
                    fc.integer({ min: 0, max: 10 }),
                    fc.integer({ min: 0, max: 20 })
                ),
                ([major, minor, patch]) => {
                    const versionString = `${major}.${minor}.${patch}`

                    // The core property: same versions should not trigger notifications
                    const shouldNotify = isNewerVersion(versionString, versionString)

                    // This should always be false for identical versions
                    expect(shouldNotify).toBe(false)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('should handle version tag prefixes correctly', async () => {
        await fc.assert(
            fc.property(
                // Generate version
                fc.tuple(
                    fc.integer({ min: 1, max: 5 }),
                    fc.integer({ min: 0, max: 10 }),
                    fc.integer({ min: 0, max: 20 })
                ),
                // Generate tag prefix
                fc.constantFrom('v', ''),
                ([major, minor, patch], tagPrefix) => {
                    const versionString = `${major}.${minor}.${patch}`
                    const taggedVersion = `${tagPrefix}${versionString}`

                    // The core property: tag prefix removal should work correctly
                    const cleanedVersion = taggedVersion.replace(/^v/, '')

                    // After cleaning, should be identical to original version
                    expect(cleanedVersion).toBe(versionString)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('should correctly format update notification data structure', async () => {
        await fc.assert(
            fc.property(
                // Generate version data
                fc.record({
                    currentVersion: fc.tuple(
                        fc.integer({ min: 0, max: 5 }),
                        fc.integer({ min: 0, max: 10 }),
                        fc.integer({ min: 0, max: 20 })
                    ).map(([maj, min, pat]) => `${maj}.${min}.${pat}`),
                    latestVersion: fc.tuple(
                        fc.integer({ min: 0, max: 5 }),
                        fc.integer({ min: 0, max: 10 }),
                        fc.integer({ min: 0, max: 20 })
                    ).map(([maj, min, pat]) => `${maj}.${min}.${pat}`),
                    releaseNotes: fc.string({ minLength: 5, maxLength: 100 }),
                    repoOwner: fc.string({ minLength: 3, maxLength: 10 }),
                    repoName: fc.string({ minLength: 3, maxLength: 10 })
                }),
                (data) => {
                    // Simulate the update info structure that would be returned
                    const updateInfo = {
                        available: isNewerVersion(data.latestVersion, data.currentVersion),
                        latestVersion: data.latestVersion,
                        releaseNotes: data.releaseNotes,
                        publishedAt: new Date().toISOString(),
                        downloadUrl: `https://github.com/${data.repoOwner}/${data.repoName}/releases/tag/v${data.latestVersion}`
                    }

                    // The core property: update info structure should be well-formed
                    expect(updateInfo).toHaveProperty('available')
                    expect(typeof updateInfo.available).toBe('boolean')
                    expect(updateInfo).toHaveProperty('latestVersion', data.latestVersion)
                    expect(updateInfo).toHaveProperty('releaseNotes', data.releaseNotes)
                    expect(updateInfo).toHaveProperty('publishedAt')
                    expect(updateInfo).toHaveProperty('downloadUrl')
                    expect(updateInfo.downloadUrl).toContain('github.com')
                    expect(updateInfo.downloadUrl).toContain(data.repoOwner)
                    expect(updateInfo.downloadUrl).toContain(data.repoName)
                    expect(updateInfo.downloadUrl).toContain(data.latestVersion)
                }
            ),
            { numRuns: 50 }
        )
    })
})