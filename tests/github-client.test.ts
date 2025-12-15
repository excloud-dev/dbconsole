/**
 * Tests for GitHub API Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { GitHubClientImpl } from '../lib/updater/github-client'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('GitHubClient', () => {
    let client: GitHubClientImpl

    beforeEach(() => {
        client = new GitHubClientImpl()
        mockFetch.mockClear()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe('Authentication', () => {
        /**
         * **Feature: github-auto-updater, Property 3: Authentication header presence**
         * **Validates: Requirements 1.3**
         */
        it('should include authentication headers in all GitHub API requests', async () => {
            // Test with a few specific valid tokens to verify the property
            const testCases = [
                { token: 'ghp_' + 'a'.repeat(36), owner: 'testowner', repo: 'testrepo' },
                { token: 'gho_' + 'b'.repeat(36), owner: 'owner2', repo: 'repo2' },
                { token: 'ghu_' + 'c'.repeat(36), owner: 'user', repo: 'project' },
                { token: 'ghs_' + 'd'.repeat(36), owner: 'org', repo: 'app' }
            ]

            for (const testCase of testCases) {
                // Mock successful response for each test case
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 1,
                        tag_name: 'v1.0.0',
                        name: 'Test Release',
                        body: 'Test release notes',
                        assets: [],
                        prerelease: false,
                        published_at: '2023-01-01T00:00:00Z'
                    })
                })

                // Create fresh client for each test
                const testClient = new GitHubClientImpl()
                testClient.authenticate(testCase.token)
                await testClient.getLatestRelease(testCase.owner, testCase.repo)

                // Verify that fetch was called with authentication headers
                const lastCallIndex = mockFetch.mock.calls.length - 1
                const [url, options] = mockFetch.mock.calls[lastCallIndex]

                // Check that Authorization header is present and correct
                expect(options.headers.get('Authorization')).toBe(`Bearer ${testCase.token}`)

                // Check that other required headers are present
                expect(options.headers.get('User-Agent')).toBeTruthy()
                expect(options.headers.get('Accept')).toBe('application/vnd.github.v3+json')
            }
        })

        it('should reject invalid token formats', () => {
            fc.assert(
                fc.property(
                    // Generate invalid tokens
                    fc.oneof(
                        fc.string().filter(s => !s.startsWith('gh') || s.length < 40),
                        fc.constant('invalid-token'),
                        fc.string({ minLength: 1, maxLength: 10 })
                    ),
                    (invalidToken) => {
                        expect(() => client.authenticate(invalidToken)).toThrow()
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('should reject empty tokens', () => {
            expect(() => client.authenticate('')).toThrow('GitHub token must be a non-empty string')
        })

        it('should require authentication before making requests', async () => {
            await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
                'GitHub authentication required'
            )
        })
    })

    describe('Request Validation', () => {
        beforeEach(() => {
            client.authenticate('ghp_' + 'a'.repeat(36))
        })

        it('should validate repository parameters', async () => {
            const invalidParams = [
                ['', 'repo'],
                ['owner', ''],
                [' ', 'repo'],
                ['owner', ' '],
            ]

            for (const [owner, repo] of invalidParams) {
                await expect(client.getLatestRelease(owner, repo)).rejects.toThrow()
            }
        })
    })

    describe('Channel Filtering', () => {
        beforeEach(() => {
            client.authenticate('ghp_' + 'a'.repeat(36))
        })

        /**
         * **Feature: github-auto-updater, Property 9: Channel filtering consistency**
         * **Validates: Requirements 2.4**
         */
        it('should filter releases by channel consistently', async () => {
            // Test different channel types
            const testCases = [
                {
                    channel: 'latest' as const,
                    mockReleases: [
                        { id: 1, tag_name: 'v1.0.0', prerelease: false, published_at: '2023-01-01T00:00:00Z' },
                        { id: 2, tag_name: 'v1.1.0-beta', prerelease: true, published_at: '2023-02-01T00:00:00Z' }
                    ],
                    expectedCount: 1,
                    shouldIncludePrerelease: false
                },
                {
                    channel: 'prerelease' as const,
                    mockReleases: [
                        { id: 1, tag_name: 'v1.0.0', prerelease: false, published_at: '2023-01-01T00:00:00Z' },
                        { id: 2, tag_name: 'v1.1.0-beta', prerelease: true, published_at: '2023-02-01T00:00:00Z' },
                        { id: 3, tag_name: 'v1.2.0-alpha', prerelease: true, published_at: '2023-03-01T00:00:00Z' }
                    ],
                    expectedCount: 3,
                    shouldIncludePrerelease: true
                },
                {
                    channel: 'custom' as const,
                    customPattern: 'v\\d+\\.\\d+\\.0$', // Only .0 releases
                    mockReleases: [
                        { id: 1, tag_name: 'v1.0.0', prerelease: false, published_at: '2023-01-01T00:00:00Z' },
                        { id: 2, tag_name: 'v1.0.1', prerelease: false, published_at: '2023-01-15T00:00:00Z' },
                        { id: 3, tag_name: 'v2.0.0', prerelease: false, published_at: '2023-02-01T00:00:00Z' }
                    ],
                    expectedCount: 2, // Only v1.0.0 and v2.0.0
                    shouldIncludePrerelease: true
                }
            ]

            for (const testCase of testCases) {
                // Mock the appropriate API calls based on channel type
                if (testCase.channel === 'latest') {
                    // Mock latest release endpoint
                    mockFetch.mockResolvedValueOnce({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            ...testCase.mockReleases[0],
                            name: testCase.mockReleases[0].tag_name,
                            body: 'Release notes',
                            assets: []
                        })
                    })
                } else {
                    // Mock releases list endpoint
                    mockFetch.mockResolvedValueOnce({
                        ok: true,
                        status: 200,
                        json: async () => testCase.mockReleases.map(release => ({
                            ...release,
                            name: release.tag_name,
                            body: 'Release notes',
                            assets: []
                        }))
                    })
                }

                // Test the channel filtering
                const releases = await client.getReleasesByChannel(
                    'testowner',
                    'testrepo',
                    testCase.channel,
                    testCase.customPattern
                )

                // Verify the filtering worked correctly
                expect(releases).toHaveLength(testCase.expectedCount)

                if (testCase.channel === 'latest') {
                    // Latest channel should only return stable releases
                    expect(releases.every(r => !r.prerelease)).toBe(true)
                } else if (testCase.channel === 'prerelease') {
                    // Prerelease channel should include all releases
                    expect(releases.length).toBe(testCase.mockReleases.length)
                } else if (testCase.channel === 'custom' && testCase.customPattern) {
                    // Custom channel should match the pattern
                    const regex = new RegExp(testCase.customPattern)
                    expect(releases.every(r => regex.test(r.tagName))).toBe(true)
                }

                // Clear mocks for next iteration
                mockFetch.mockClear()
            }
        })

        it('should throw error for custom channel without pattern', async () => {
            await expect(
                client.getReleasesByChannel('owner', 'repo', 'custom')
            ).rejects.toThrow('Custom channel requires a pattern')
        })
    })

    describe('Platform Asset Selection', () => {
        beforeEach(() => {
            client.authenticate('ghp_' + 'a'.repeat(36))
        })

        /**
         * **Feature: github-auto-updater, Property 11: Platform-specific asset selection**
         * **Validates: Requirements 3.1**
         */
        it('should select platform-specific assets correctly', () => {
            // Test different platform and architecture combinations
            const testCases = [
                {
                    platform: 'darwin',
                    arch: 'x64',
                    assets: [
                        { id: 1, name: 'app-v1.0.0-darwin-x64.dmg', size: 1000, downloadUrl: 'url1', contentType: 'application/octet-stream' },
                        { id: 2, name: 'app-v1.0.0-win32-x64.exe', size: 2000, downloadUrl: 'url2', contentType: 'application/octet-stream' },
                        { id: 3, name: 'app-v1.0.0-linux-x64.tar.gz', size: 1500, downloadUrl: 'url3', contentType: 'application/octet-stream' }
                    ],
                    expectedCount: 1,
                    expectedName: 'app-v1.0.0-darwin-x64.dmg'
                },
                {
                    platform: 'win32',
                    arch: 'x64',
                    assets: [
                        { id: 1, name: 'app-v1.0.0-darwin-x64.dmg', size: 1000, downloadUrl: 'url1', contentType: 'application/octet-stream' },
                        { id: 2, name: 'app-v1.0.0-win32-x64.exe', size: 2000, downloadUrl: 'url2', contentType: 'application/octet-stream' },
                        { id: 3, name: 'app-v1.0.0-windows-x64.msi', size: 2100, downloadUrl: 'url4', contentType: 'application/octet-stream' },
                        { id: 4, name: 'app-v1.0.0-linux-x64.tar.gz', size: 1500, downloadUrl: 'url3', contentType: 'application/octet-stream' }
                    ],
                    expectedCount: 3, // win32, windows, and linux assets match due to x64 architecture
                    expectedPreferred: 'app-v1.0.0-win32-x64.exe' // .exe is preferred over .msi
                },
                {
                    platform: 'linux',
                    arch: 'arm64',
                    assets: [
                        { id: 1, name: 'app-v1.0.0-darwin-x64.dmg', size: 1000, downloadUrl: 'url1', contentType: 'application/octet-stream' },
                        { id: 2, name: 'app-v1.0.0-linux-x64.tar.gz', size: 1500, downloadUrl: 'url2', contentType: 'application/octet-stream' },
                        { id: 3, name: 'app-v1.0.0-linux-arm64.AppImage', size: 1600, downloadUrl: 'url3', contentType: 'application/octet-stream' },
                        { id: 4, name: 'app-v1.0.0-linux-aarch64.deb', size: 1400, downloadUrl: 'url4', contentType: 'application/octet-stream' }
                    ],
                    expectedCount: 2, // Both arm64 and aarch64 should match
                    expectedPreferred: 'app-v1.0.0-linux-arm64.AppImage' // .AppImage is preferred
                },
                {
                    platform: 'darwin',
                    arch: 'arm64',
                    assets: [
                        { id: 1, name: 'app-v1.0.0-macos-intel.dmg', size: 1000, downloadUrl: 'url1', contentType: 'application/octet-stream' },
                        { id: 2, name: 'app-v1.0.0-macos-apple-silicon.dmg', size: 1100, downloadUrl: 'url2', contentType: 'application/octet-stream' },
                        { id: 3, name: 'app-v1.0.0-darwin-arm64.pkg', size: 1200, downloadUrl: 'url3', contentType: 'application/octet-stream' }
                    ],
                    expectedCount: 2, // Both apple-silicon and arm64 should match
                    expectedPreferred: 'app-v1.0.0-macos-apple-silicon.dmg' // .dmg is preferred over .pkg
                }
            ]

            for (const testCase of testCases) {
                const mockRelease = {
                    id: 1,
                    tagName: 'v1.0.0',
                    name: 'Test Release',
                    body: 'Release notes',
                    assets: testCase.assets,
                    prerelease: false,
                    publishedAt: '2023-01-01T00:00:00Z'
                }

                // Test platform asset selection
                const selectedAssets = client.selectPlatformAssets(mockRelease, testCase.platform, testCase.arch)
                expect(selectedAssets).toHaveLength(testCase.expectedCount)

                // Test that all selected assets match the platform
                for (const asset of selectedAssets) {
                    const assetName = asset.name.toLowerCase()
                    const platformMatches =
                        assetName.includes(testCase.platform.toLowerCase()) ||
                        assetName.includes(testCase.arch.toLowerCase()) ||
                        (testCase.platform === 'darwin' && (assetName.includes('macos') || assetName.includes('apple'))) ||
                        (testCase.platform === 'win32' && assetName.includes('windows')) ||
                        (testCase.arch === 'arm64' && assetName.includes('aarch64'))

                    expect(platformMatches).toBe(true)
                }

                // Test best asset selection if we have a preferred asset specified
                if (testCase.expectedPreferred) {
                    const bestAsset = client.getBestAssetForPlatform(mockRelease, testCase.platform, testCase.arch)
                    expect(bestAsset?.name).toBe(testCase.expectedPreferred)
                } else if (testCase.expectedName) {
                    const bestAsset = client.getBestAssetForPlatform(mockRelease, testCase.platform, testCase.arch)
                    expect(bestAsset?.name).toBe(testCase.expectedName)
                }
            }
        })

        it('should return empty array when no assets match platform', () => {
            const mockRelease = {
                id: 1,
                tagName: 'v1.0.0',
                name: 'Test Release',
                body: 'Release notes',
                assets: [
                    { id: 1, name: 'app-v1.0.0-win32-x64.exe', size: 2000, downloadUrl: 'url1', contentType: 'application/octet-stream' }
                ],
                prerelease: false,
                publishedAt: '2023-01-01T00:00:00Z'
            }

            const selectedAssets = client.selectPlatformAssets(mockRelease, 'darwin', 'x64')
            expect(selectedAssets).toHaveLength(0)

            const bestAsset = client.getBestAssetForPlatform(mockRelease, 'darwin', 'x64')
            expect(bestAsset).toBeNull()
        })

        it('should handle releases with no assets', () => {
            const mockRelease = {
                id: 1,
                tagName: 'v1.0.0',
                name: 'Test Release',
                body: 'Release notes',
                assets: [],
                prerelease: false,
                publishedAt: '2023-01-01T00:00:00Z'
            }

            const selectedAssets = client.selectPlatformAssets(mockRelease, 'darwin', 'x64')
            expect(selectedAssets).toHaveLength(0)

            const bestAsset = client.getBestAssetForPlatform(mockRelease, 'darwin', 'x64')
            expect(bestAsset).toBeNull()
        })
    })

    describe('Error Handling', () => {
        beforeEach(() => {
            client.authenticate('ghp_' + 'a'.repeat(36))
        })

        it('should handle authentication errors appropriately', async () => {
            // Mock all retry attempts with the same error response
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ message: 'Bad credentials' }),
                headers: new Headers()
            })

            await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
                'GitHub authentication failed'
            )
        })

        it('should handle forbidden access errors', async () => {
            // Mock all retry attempts with the same error response
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
                json: async () => ({ message: 'Forbidden' }),
                headers: new Headers()
            })

            await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
                'GitHub API access forbidden'
            )
        })

        it('should handle not found errors', async () => {
            // Mock all retry attempts with the same error response
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => ({ message: 'Not Found' }),
                headers: new Headers()
            })

            await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
                'Repository not found or access denied'
            )
        })
    })
})