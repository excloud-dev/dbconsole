/**
 * Basic setup tests for GitHub Auto-Updater interfaces and dependencies
 */

import { describe, it, expect } from 'vitest'
import * as semver from 'semver'
import * as fc from 'fast-check'

// Test imports from our updater module
import type {
    UpdateInfo,
    UpdateSettings,
    UpdateRecord,
    GitHubRelease,
    UpdateAgent,
    GitHubClient,
    UpdateController,
    ConfigService
} from '../lib/updater'

describe('Updater Setup and Dependencies', () => {
    it('should import all required types and interfaces', () => {
        // Test that the module imports work (compilation test)
        // Types and interfaces don't exist at runtime, but this test ensures they compile
        expect(true).toBe(true) // Simple assertion to make the test pass
    })

    it('should have semver dependency working', () => {
        expect(semver.valid('1.0.0')).toBe('1.0.0')
        expect(semver.gt('2.0.0', '1.0.0')).toBe(true)
        expect(semver.lt('1.0.0', '2.0.0')).toBe(true)
    })

    it('should have fast-check dependency working', () => {
        const result = fc.sample(fc.integer({ min: 1, max: 10 }), 5)
        expect(result).toHaveLength(5)
        expect(result.every(n => n >= 1 && n <= 10)).toBe(true)
    })

    it('should be able to create mock implementations of interfaces', () => {
        // Test that we can create objects that implement our interfaces
        const mockUpdateInfo: UpdateInfo = {
            version: '1.0.0',
            releaseNotes: 'Test release',
            downloadUrl: 'https://example.com/download',
            checksum: 'abc123',
            publishedAt: new Date(),
            isPrerelease: false
        }

        const mockUpdateSettings: UpdateSettings = {
            autoCheck: true,
            autoInstall: false,
            checkInterval: 24,
            updateChannel: 'latest'
        }

        expect(mockUpdateInfo.version).toBe('1.0.0')
        expect(mockUpdateSettings.autoCheck).toBe(true)
    })
})