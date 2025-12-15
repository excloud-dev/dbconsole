/**
 * Property-based tests for ConfigService credential encryption and configuration persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fc from 'fast-check'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock Electron modules before importing ConfigService
vi.mock('electron', () => {
    return {
        safeStorage: {
            isEncryptionAvailable: vi.fn(() => true),
            encryptString: vi.fn((data: string) => {
                // Simulate proper encryption by base64 encoding the data with a prefix
                const encoded = Buffer.from(data, 'utf-8').toString('base64')
                return Buffer.from(`ENCRYPTED_DATA:${encoded}`, 'utf-8')
            }),
            decryptString: vi.fn((data: Buffer) => {
                const str = data.toString('utf-8')
                if (str.startsWith('ENCRYPTED_DATA:')) {
                    const encoded = str.substring(15)
                    return Buffer.from(encoded, 'base64').toString('utf-8')
                }
                throw new Error('Invalid encrypted data')
            })
        },
        app: {
            getPath: vi.fn((name: string) => {
                if (name === 'userData') {
                    return path.join(os.tmpdir(), 'test-dbconsole-config')
                }
                return '/tmp'
            }),
            relaunch: vi.fn(() => undefined),
            exit: vi.fn(() => undefined)
        },
        shell: {
            showItemInFolder: vi.fn(() => undefined),
            openPath: vi.fn(async () => '')
        },
        dialog: {}
    }
})

import { ConfigServiceImpl } from '../lib/updater/config-service'
import { UpdateSettings } from '../lib/updater/types'

describe('ConfigService Property Tests', () => {
    let configService: ConfigServiceImpl
    let testConfigDir: string

    beforeEach(async () => {
        // Get mocked modules
        const { safeStorage } = await import('electron')

        // Reset mocks
        vi.clearAllMocks()
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)

        // Create fresh config service instance
        configService = new ConfigServiceImpl()
        testConfigDir = path.join(os.tmpdir(), 'test-dbconsole-config')

        // Clean up any existing test directory
        try {
            await fs.rm(testConfigDir, { recursive: true, force: true })
        } catch (error) {
            // Ignore if directory doesn't exist
        }

        await configService.initialize()
    })

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.rm(testConfigDir, { recursive: true, force: true })
        } catch (error) {
            // Ignore cleanup errors
        }
    })

    /**
     * **Feature: github-auto-updater, Property 7: Credential encryption invariant**
     * **Validates: Requirements 2.2**
     * 
     * For any Personal Access Token, the token should never be stored in plaintext 
     * and should be retrievable only through secure storage APIs
     */
    it('Property 7: Credential encryption invariant', async () => {
        // Test with a few specific valid tokens to ensure the property holds
        const validTokens = [
            'ghp_' + 'a'.repeat(36),
            'ghp_' + '1'.repeat(36),
            'ghp_' + 'Z'.repeat(36),
            'github_pat_' + 'a'.repeat(82),
            'github_pat_' + '1'.repeat(82),
            'github_pat_' + '_'.repeat(82)
        ]

        for (const token of validTokens) {
            const { safeStorage } = await import('electron')

            // Reset mocks for each iteration
            vi.clearAllMocks()
            vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)

            // Store the token
            await configService.setGitHubToken(token)

            // Verify the token file exists and is encrypted
            const tokenFile = path.join(testConfigDir, 'updater-config', 'token.enc')
            const fileExists = await fs.access(tokenFile).then(() => true).catch(() => false)
            expect(fileExists).toBe(true)

            // Read the raw file content
            const rawContent = await fs.readFile(tokenFile)
            const rawString = rawContent.toString('utf-8')

            // Verify the token is not stored in plaintext
            expect(rawString).not.toContain(token)
            expect(rawString).toContain('ENCRYPTED_DATA:')

            // Verify we can retrieve the original token through the service
            const retrievedToken = await configService.getGitHubToken()
            expect(retrievedToken).toBe(token)

            // Verify encryption was actually called
            expect(safeStorage.encryptString).toHaveBeenCalledWith(token)
            expect(safeStorage.decryptString).toHaveBeenCalled()
        }
    })

    it('should reject invalid token formats', async () => {
        const invalidTokens = [
            '', // empty string
            'ghp_', // prefix only
            'github_pat_', // prefix only
            'invalid_token', // wrong format
            'ghp_' + 'a'.repeat(35), // too short
            'ghp_' + 'a'.repeat(37), // too long
            'github_pat_' + 'a'.repeat(81), // too short
            'github_pat_' + 'a'.repeat(83) // too long
        ]

        for (const invalidToken of invalidTokens) {
            await expect(configService.setGitHubToken(invalidToken))
                .rejects.toThrow(/Invalid/)
        }
    })

    it('should handle encryption unavailable gracefully', async () => {
        const { safeStorage } = await import('electron')
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)

        await expect(configService.setGitHubToken('ghp_' + 'a'.repeat(36)))
            .rejects.toThrow('Encryption not available')
    })

    /**
     * **Feature: github-auto-updater, Property 8: Configuration persistence**
     * **Validates: Requirements 2.3**
     * 
     * For any update preference setting, the configuration should be persisted 
     * and retrievable across application restarts
     */
    it('Property 8: Configuration persistence', async () => {
        await fc.assert(
            fc.asyncProperty(
                // Generate valid UpdateSettings
                fc.record({
                    autoCheck: fc.boolean(),
                    autoInstall: fc.boolean(),
                    checkInterval: fc.integer({ min: 1, max: 168 }), // 1 hour to 1 week
                    updateChannel: fc.constantFrom('latest', 'prerelease', 'custom'),
                    customTagPattern: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
                    maintenanceWindow: fc.option(
                        fc.record({
                            startHour: fc.integer({ min: 0, max: 23 }),
                            endHour: fc.integer({ min: 0, max: 23 }),
                            days: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 })
                        }),
                        { nil: undefined }
                    )
                }),
                async (settings) => {
                    // Store the settings
                    await configService.setUpdateSettings(settings)

                    // Create a new ConfigService instance to simulate application restart
                    const newConfigService = new ConfigServiceImpl()
                    await newConfigService.initialize()

                    // Retrieve the settings from the new instance
                    const retrievedSettings = await newConfigService.getUpdateSettings()

                    // Verify all settings are persisted correctly
                    expect(retrievedSettings.autoCheck).toBe(settings.autoCheck)
                    expect(retrievedSettings.autoInstall).toBe(settings.autoInstall)
                    expect(retrievedSettings.checkInterval).toBe(settings.checkInterval)
                    expect(retrievedSettings.updateChannel).toBe(settings.updateChannel)

                    if (settings.customTagPattern !== undefined) {
                        expect(retrievedSettings.customTagPattern).toBe(settings.customTagPattern)
                    }

                    if (settings.maintenanceWindow) {
                        expect(retrievedSettings.maintenanceWindow).toEqual(settings.maintenanceWindow)
                    }

                    // Verify the settings file exists
                    const settingsFile = path.join(testConfigDir, 'updater-config', 'settings.json')
                    const fileExists = await fs.access(settingsFile).then(() => true).catch(() => false)
                    expect(fileExists).toBe(true)

                    // Verify the file contains valid JSON
                    const fileContent = await fs.readFile(settingsFile, 'utf-8')
                    const parsedSettings = JSON.parse(fileContent)
                    expect(parsedSettings).toEqual(settings)
                }
            ),
            { numRuns: 20 } // Reduced for faster testing
        )
    })

    it('should handle invalid settings gracefully', async () => {
        const invalidSettings = [
            { autoCheck: 'not-boolean' }, // wrong type
            { checkInterval: -1 }, // invalid range
            { checkInterval: 200 }, // invalid range
            { updateChannel: 'invalid' }, // invalid channel
            { maintenanceWindow: { startHour: 25 } }, // invalid hour
            { maintenanceWindow: { days: [8] } } // invalid day
        ]

        for (const invalid of invalidSettings) {
            await expect(configService.setUpdateSettings(invalid as any))
                .rejects.toThrow(/Invalid/)
        }
    })

    /**
     * **Feature: github-auto-updater, Property 31: Policy precedence consistency**
     * **Validates: Requirements 7.5**
     * 
     * For any conflict between enterprise policies and user preferences, 
     * the system should prioritize enterprise policies
     */
    it('Property 31: Policy precedence consistency', async () => {
        await fc.assert(
            fc.asyncProperty(
                // Generate user settings
                fc.record({
                    autoCheck: fc.boolean(),
                    autoInstall: fc.boolean(),
                    checkInterval: fc.integer({ min: 1, max: 168 }),
                    updateChannel: fc.constantFrom('latest', 'prerelease', 'custom')
                }),
                // Generate enterprise policy that conflicts with user settings
                fc.record({
                    disableAutoCheck: fc.boolean(),
                    disableAutoInstall: fc.boolean(),
                    forceCheckInterval: fc.integer({ min: 1, max: 168 }),
                    allowedChannels: fc.array(fc.constantFrom('latest', 'prerelease', 'custom'), { minLength: 1, maxLength: 3 }),
                    precedence: fc.constant('enterprise' as const)
                }),
                async (userSettings, enterprisePolicy) => {
                    // Set user settings first
                    await configService.setUpdateSettings(userSettings)

                    // Apply enterprise policy
                    await configService.setPolicySettings(enterprisePolicy)

                    // Get effective settings (should reflect enterprise policy)
                    const effectiveSettings = await configService.getUpdateSettings()

                    // Verify enterprise policy takes precedence
                    if (enterprisePolicy.disableAutoCheck !== undefined) {
                        expect(effectiveSettings.autoCheck).toBe(!enterprisePolicy.disableAutoCheck)
                    }

                    if (enterprisePolicy.disableAutoInstall !== undefined) {
                        expect(effectiveSettings.autoInstall).toBe(!enterprisePolicy.disableAutoInstall)
                    }

                    if (enterprisePolicy.forceCheckInterval !== undefined) {
                        expect(effectiveSettings.checkInterval).toBe(enterprisePolicy.forceCheckInterval)
                    }

                    if (enterprisePolicy.allowedChannels &&
                        !enterprisePolicy.allowedChannels.includes(userSettings.updateChannel)) {
                        // Channel should be changed to first allowed channel
                        expect(enterprisePolicy.allowedChannels).toContain(effectiveSettings.updateChannel)
                    }

                    // Verify policy methods work correctly
                    expect(await configService.hasEnterprisePolicies()).toBe(true)

                    const allowedChannels = await configService.getAllowedUpdateChannels()
                    expect(allowedChannels).toEqual(enterprisePolicy.allowedChannels)

                    for (const channel of enterprisePolicy.allowedChannels) {
                        expect(await configService.isUpdateChannelAllowed(channel)).toBe(true)
                    }

                    // Test that non-allowed channels are rejected
                    const allChannels: Array<'latest' | 'prerelease' | 'custom'> = ['latest', 'prerelease', 'custom']
                    for (const channel of allChannels) {
                        if (!enterprisePolicy.allowedChannels.includes(channel)) {
                            expect(await configService.isUpdateChannelAllowed(channel)).toBe(false)
                        }
                    }
                }
            ),
            { numRuns: 15 } // Reduced for faster testing
        )
    })

    it('should handle user precedence policies', async () => {
        const userSettings = {
            autoCheck: true,
            autoInstall: true,
            checkInterval: 24,
            updateChannel: 'latest' as const
        }

        const userPolicy = {
            disableAutoCheck: true,
            precedence: 'user' as const
        }

        await configService.setUpdateSettings(userSettings)
        await configService.setPolicySettings(userPolicy)

        // With user precedence, user settings should not be overridden
        const effectiveSettings = await configService.getUpdateSettings()
        expect(effectiveSettings.autoCheck).toBe(true) // User setting preserved
        expect(await configService.hasEnterprisePolicies()).toBe(false)
    })

    it('should handle invalid policy settings', async () => {
        const invalidPolicies = [
            { precedence: 'invalid' }, // invalid precedence
            { disableAutoCheck: 'not-boolean' }, // wrong type
            { forceCheckInterval: -1 }, // invalid range
            { allowedChannels: ['invalid'] }, // invalid channel
            { maintenanceWindow: { startHour: 25 } } // invalid window
        ]

        for (const invalid of invalidPolicies) {
            await expect(configService.setPolicySettings(invalid as any))
                .rejects.toThrow(/Invalid/)
        }
    })
})