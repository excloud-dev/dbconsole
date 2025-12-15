/**
 * GitHub API Client for private repository access
 * Handles authentication and API communication for the auto-updater system
 */

import { GitHubClient } from './interfaces'
import { GitHubRelease, GitHubAsset, ReleaseOptions } from './types'
import { NetworkResilience, RetryOptions } from './network-resilience'

export interface GitHubClientOptions {
    baseUrl?: string
    timeout?: number
    userAgent?: string
}

export class GitHubClientImpl implements GitHubClient {
    private token: string | null = null
    private readonly baseUrl: string
    private readonly timeout: number
    private readonly userAgent: string
    private readonly networkResilience: NetworkResilience

    constructor(options: GitHubClientOptions = {}) {
        this.baseUrl = options.baseUrl || 'https://api.github.com'
        this.timeout = options.timeout || 30000 // 30 seconds
        this.userAgent = options.userAgent || 'DBConsole-Updater/1.0.0'
        this.networkResilience = new NetworkResilience()
    }

    /**
     * Set the GitHub Personal Access Token for authentication
     */
    authenticate(token: string): void {
        if (!token || typeof token !== 'string') {
            throw new Error('GitHub token must be a non-empty string')
        }

        const trimmed = token.trim()
        if (!trimmed) {
            throw new Error('GitHub token must be a non-empty string')
        }

        // Flexible token format validation:
        // - Classic tokens: ghp_/gho_/ghu_/ghs_
        // - Fine-grained tokens: github_pat_
        // Permissive enough for tests, but rejects obviously invalid strings.
        const tokenPattern = /^(gh[pous]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})$/
        if (!tokenPattern.test(trimmed)) {
            throw new Error('Invalid GitHub token format')
        }

        this.token = trimmed
        this.log('Authentication token set successfully')
    }

    /**
     * Get the latest release for a repository
     */
    async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
        this.validateAuthentication()
        this.validateRepoParams(owner, repo)

        const url = `${this.baseUrl}/repos/${owner}/${repo}/releases/latest`
        this.log(`Fetching latest release from: ${url}`)

        return this.networkResilience.withRetry(async () => {
            const response = await this.makeRequest(url)
            const release = await this.parseReleaseResponse(response)
            this.log(`Successfully fetched latest release: ${release.tagName}`)
            return release
        }, { maxRetries: 3 })
    }

    /**
     * Get releases for a repository with optional filtering
     */
    async getReleases(owner: string, repo: string, options: ReleaseOptions = {}): Promise<GitHubRelease[]> {
        this.validateAuthentication()
        this.validateRepoParams(owner, repo)

        const params = new URLSearchParams()
        if (options.perPage) params.append('per_page', options.perPage.toString())
        if (options.page) params.append('page', options.page.toString())

        const url = `${this.baseUrl}/repos/${owner}/${repo}/releases${params.toString() ? '?' + params.toString() : ''}`
        this.log(`Fetching releases from: ${url}`)

        return this.networkResilience.withRetry(async () => {
            const response = await this.makeRequest(url)
            const releases = await this.parseReleasesResponse(response)

            // Filter by prerelease if specified
            const filteredReleases = options.includePrerelease
                ? releases
                : releases.filter(release => !release.prerelease)

            this.log(`Successfully fetched ${filteredReleases.length} releases`)
            return filteredReleases
        }, { maxRetries: 3 })
    }

    /**
     * Download a release asset
     */
    async downloadAsset(assetUrl: string): Promise<ReadableStream> {
        this.validateAuthentication()
        if (!assetUrl || typeof assetUrl !== 'string') {
            throw new Error('Asset URL must be a non-empty string')
        }

        this.log(`Downloading asset from: ${assetUrl}`)

        return this.networkResilience.withRetry(async () => {
            const response = await this.makeRequest(assetUrl, {
                headers: {
                    'Accept': 'application/octet-stream'
                }
            })

            if (!response.body) {
                throw new Error('No response body received for asset download')
            }

            this.log('Asset download stream created successfully')
            return response.body
        }, { maxRetries: 5, maxDelay: 60000 }) // More retries and longer delays for downloads
    }

    /**
     * Make an authenticated HTTP request to the GitHub API
     */
    private async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
        const headers = new Headers(options.headers)

        // Add authentication header
        if (this.token) {
            headers.set('Authorization', `Bearer ${this.token}`)
        }

        // Add standard headers
        headers.set('User-Agent', this.userAgent)
        headers.set('Accept', 'application/vnd.github.v3+json')

        const requestOptions: RequestInit = {
            ...options,
            headers,
            signal: AbortSignal.timeout(this.timeout)
        }

        this.log(`Making ${options.method || 'GET'} request to: ${url}`)

        const response = await fetch(url, requestOptions)

        // Log response details
        this.log(`Response status: ${response.status} ${response.statusText}`)

        if (!response.ok) {
            await this.handleErrorResponse(response)
        }

        return response
    }

    /**
     * Parse a single release response from GitHub API
     */
    private async parseReleaseResponse(response: Response): Promise<GitHubRelease> {
        const data = await response.json()
        return this.transformReleaseData(data)
    }

    /**
     * Parse multiple releases response from GitHub API
     */
    private async parseReleasesResponse(response: Response): Promise<GitHubRelease[]> {
        const data = await response.json()
        if (!Array.isArray(data)) {
            throw new Error('Expected array of releases from GitHub API')
        }
        return data.map(release => this.transformReleaseData(release))
    }

    /**
     * Transform GitHub API release data to our internal format
     */
    private transformReleaseData(data: any): GitHubRelease {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid release data received from GitHub API')
        }

        const assets: GitHubAsset[] = (data.assets || []).map((asset: any) => ({
            id: asset.id,
            name: asset.name,
            size: asset.size,
            downloadUrl: asset.url, // Use API URL for authenticated downloads
            contentType: asset.content_type
        }))

        return {
            id: data.id,
            tagName: data.tag_name,
            name: data.name || data.tag_name,
            body: data.body || '',
            assets,
            prerelease: Boolean(data.prerelease),
            publishedAt: data.published_at
        }
    }

    /**
     * Handle error responses from GitHub API
     */
    private async handleErrorResponse(response: Response): Promise<never> {
        let errorMessage = `GitHub API request failed: ${response.status} ${response.statusText}`

        try {
            const errorData = await response.json()
            if (errorData.message) {
                errorMessage += ` - ${errorData.message}`
            }
        } catch {
            // Ignore JSON parsing errors for error responses
        }

        // Parse rate limit headers if present
        if (response.status === 403) {
            const rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
            const rateLimitReset = response.headers.get('x-ratelimit-reset')
            const retryAfter = response.headers.get('retry-after')

            if (rateLimitRemaining === '0' || retryAfter) {
                const error = new Error('GitHub API rate limit exceeded')
                    // Attach rate limit info to error for NetworkResilience to parse
                    ; (error as any).rateLimitInfo = {
                        limit: 5000, // GitHub default
                        remaining: parseInt(rateLimitRemaining || '0'),
                        resetTime: rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000) : new Date(Date.now() + 60 * 60 * 1000),
                        retryAfter: retryAfter ? parseInt(retryAfter) : undefined
                    }
                this.log(`Rate limit exceeded. Remaining: ${rateLimitRemaining}, Reset: ${rateLimitReset}`)
                throw error
            }
        }

        // Handle specific error cases
        if (response.status === 401) {
            throw new Error('GitHub authentication failed. Please check your Personal Access Token.')
        } else if (response.status === 403) {
            throw new Error('GitHub API access forbidden. Check token permissions or rate limits.')
        } else if (response.status === 404) {
            throw new Error('Repository not found or access denied. Verify repository name and token permissions.')
        } else if (response.status >= 500) {
            throw new Error('GitHub API server error. Please try again later.')
        }

        throw new Error(errorMessage)
    }

    /**
     * Validate that authentication is set up
     */
    private validateAuthentication(): void {
        if (!this.token) {
            throw new Error('GitHub authentication required. Call authenticate() with a valid token first.')
        }
    }

    /**
     * Validate repository owner and name parameters
     */
    private validateRepoParams(owner: string, repo: string): void {
        if (!owner || typeof owner !== 'string' || owner.trim().length === 0) {
            throw new Error('Repository owner must be a non-empty string')
        }
        if (!repo || typeof repo !== 'string' || repo.trim().length === 0) {
            throw new Error('Repository name must be a non-empty string')
        }
    }

    /**
     * Get releases filtered by channel (latest, prerelease, or custom pattern)
     */
    async getReleasesByChannel(owner: string, repo: string, channel: 'latest' | 'prerelease' | 'custom', customPattern?: string): Promise<GitHubRelease[]> {
        this.validateAuthentication()
        this.validateRepoParams(owner, repo)

        this.log(`Fetching releases for channel: ${channel}`)

        try {
            let releases: GitHubRelease[]

            if (channel === 'latest') {
                // Get only the latest stable release
                const latestRelease = await this.getLatestRelease(owner, repo)
                releases = latestRelease.prerelease ? [] : [latestRelease]
            } else if (channel === 'prerelease') {
                // Get all releases including prereleases
                releases = await this.getReleases(owner, repo, { includePrerelease: true })
            } else if (channel === 'custom' && customPattern) {
                // Get all releases and filter by custom pattern
                const allReleases = await this.getReleases(owner, repo, { includePrerelease: true })
                const regex = new RegExp(customPattern)
                releases = allReleases.filter(release => regex.test(release.tagName))
            } else {
                throw new Error('Custom channel requires a pattern')
            }

            this.log(`Successfully filtered ${releases.length} releases for channel: ${channel}`)
            return releases
        } catch (error) {
            this.log(`Error fetching releases by channel: ${error}`)
            throw error
        }
    }

    /**
     * Select platform-specific assets from a release
     */
    selectPlatformAssets(release: GitHubRelease, platform: string, arch: string): GitHubAsset[] {
        if (!release.assets || release.assets.length === 0) {
            this.log('No assets found in release')
            return []
        }

        this.log(`Selecting assets for platform: ${platform}, architecture: ${arch}`)

        const matchingAssets = release.assets.filter(asset => {
            return this.isAssetForPlatform(asset.name, platform, arch)
        })

        this.log(`Found ${matchingAssets.length} matching assets for ${platform}-${arch}`)
        return matchingAssets
    }

    /**
     * Check if an asset name matches the specified platform and architecture
     */
    private isAssetForPlatform(assetName: string, platform: string, arch: string): boolean {
        const name = assetName.toLowerCase()
        const normalizedPlatform = platform.toLowerCase()
        const normalizedArch = arch.toLowerCase()

        // Check platform match
        let platformMatch = false
        switch (normalizedPlatform) {
            case 'darwin':
            case 'macos':
                platformMatch = /\.(dmg|pkg)$/i.test(name) ||
                    /(darwin|mac|osx)/i.test(name)
                break
            case 'win32':
            case 'windows':
                platformMatch = /\.(exe|msi)$/i.test(name) ||
                    /(win|windows)/i.test(name)
                break
            case 'linux':
                platformMatch = /\.(tar\.gz|tar\.xz|deb|rpm|appimage)$/i.test(name) ||
                    /linux/i.test(name)
                break
            default:
                platformMatch = name.includes(normalizedPlatform)
        }

        if (!platformMatch) {
            return false
        }

        // Check architecture match
        let archMatch = false
        switch (normalizedArch) {
            case 'x64':
                archMatch = /(x64|x86_64|amd64|intel)/i.test(name)
                break
            case 'arm64':
                archMatch = /(arm64|aarch64|apple.*silicon)/i.test(name)
                break
            case 'x86':
            case 'ia32':
                archMatch = /(x86|ia32|win32)/i.test(name) && !/(x64|x86_64)/i.test(name)
                break
            case 'arm':
                archMatch = /arm/i.test(name) && !/arm64/i.test(name)
                break
            default:
                archMatch = name.includes(normalizedArch)
        }

        return platformMatch && archMatch
    }

    /**
     * Get the best matching asset for the current platform
     */
    getBestAssetForPlatform(release: GitHubRelease, platform?: string, arch?: string): GitHubAsset | null {
        const currentPlatform = platform || this.detectPlatform()
        const currentArch = arch || this.detectArchitecture()

        const platformAssets = this.selectPlatformAssets(release, currentPlatform, currentArch)

        if (platformAssets.length === 0) {
            this.log(`No assets found for platform ${currentPlatform}-${currentArch}`)
            return null
        }

        // Prefer specific file types based on platform
        const preferredAsset = this.selectPreferredAsset(platformAssets, currentPlatform)

        this.log(`Selected asset: ${preferredAsset.name}`)
        return preferredAsset
    }

    /**
     * Get platform-specific file patterns for asset matching
     */
    private getPlatformPatterns(platform: string, arch: string): RegExp[] {
        const patterns: RegExp[] = []

        // Normalize platform and architecture names
        const normalizedPlatform = platform.toLowerCase()
        const normalizedArch = arch.toLowerCase()

        switch (normalizedPlatform) {
            case 'darwin':
            case 'macos':
                patterns.push(
                    /\.dmg$/i,
                    /\.pkg$/i,
                    /mac/i,
                    /darwin/i,
                    /osx/i
                )
                if (normalizedArch === 'arm64') {
                    patterns.push(/arm64/i, /aarch64/i, /apple.*silicon/i)
                } else if (normalizedArch === 'x64') {
                    patterns.push(/x64/i, /x86_64/i, /intel/i)
                }
                break

            case 'win32':
            case 'windows':
                patterns.push(
                    /\.exe$/i,
                    /\.msi$/i,
                    /\.zip$/i,
                    /win/i,
                    /windows/i
                )
                if (normalizedArch === 'x64') {
                    patterns.push(/x64/i, /x86_64/i, /win64/i)
                } else if (normalizedArch === 'x86') {
                    patterns.push(/x86/i, /win32/i, /ia32/i)
                }
                break

            case 'linux':
                patterns.push(
                    /\.tar\.gz$/i,
                    /\.tar\.xz$/i,
                    /\.deb$/i,
                    /\.rpm$/i,
                    /\.appimage$/i,
                    /linux/i
                )
                if (normalizedArch === 'x64') {
                    patterns.push(/x64/i, /x86_64/i, /amd64/i)
                } else if (normalizedArch === 'arm64') {
                    patterns.push(/arm64/i, /aarch64/i)
                } else if (normalizedArch === 'arm') {
                    patterns.push(/arm/i, /armv7/i)
                }
                break
        }

        return patterns
    }

    /**
     * Select the preferred asset from matching platform assets
     */
    private selectPreferredAsset(assets: GitHubAsset[], platform: string): GitHubAsset {
        if (assets.length === 1) {
            return assets[0]
        }

        const normalizedPlatform = platform.toLowerCase()

        // Define preference order by file extension for each platform
        const preferenceOrder: { [key: string]: string[] } = {
            'darwin': ['.dmg', '.pkg', '.tar.gz'],
            'macos': ['.dmg', '.pkg', '.tar.gz'],
            'win32': ['.exe', '.msi', '.zip'],
            'windows': ['.exe', '.msi', '.zip'],
            'linux': ['.appimage', '.deb', '.rpm', '.tar.gz', '.tar.xz']
        }

        const preferences = preferenceOrder[normalizedPlatform] || []

        // Find the first asset that matches the preference order
        for (const extension of preferences) {
            const preferredAsset = assets.find(asset =>
                asset.name.toLowerCase().endsWith(extension.toLowerCase())
            )
            if (preferredAsset) {
                return preferredAsset
            }
        }

        // If no preferred extension found, return the first asset
        return assets[0]
    }

    /**
     * Detect the current platform
     */
    private detectPlatform(): string {
        if (typeof process !== 'undefined' && process.platform) {
            return process.platform
        }

        // Fallback for browser environments
        if (typeof navigator !== 'undefined') {
            const userAgent = navigator.userAgent.toLowerCase()
            if (userAgent.includes('mac')) return 'darwin'
            if (userAgent.includes('win')) return 'win32'
            if (userAgent.includes('linux')) return 'linux'
        }

        return 'linux' // Default fallback
    }

    /**
     * Detect the current architecture
     */
    private detectArchitecture(): string {
        if (typeof process !== 'undefined' && process.arch) {
            return process.arch
        }

        // Fallback for browser environments
        return 'x64' // Default fallback
    }

    /**
     * Get the network resilience instance for status monitoring
     */
    getNetworkResilience(): NetworkResilience {
        return this.networkResilience
    }

    /**
     * Get current rate limit status
     */
    getRateLimitStatus(): { isRateLimited: boolean; rateLimitInfo: any } {
        const rateLimitInfo = this.networkResilience.getRateLimitInfo()
        const isRateLimited = rateLimitInfo !== null && rateLimitInfo.remaining <= 0

        return {
            isRateLimited,
            rateLimitInfo
        }
    }

    /**
     * Log debug information
     */
    private log(message: string): void {
        // In production, this could be replaced with a proper logging system
        console.debug(`[GitHubClient] ${message}`)
    }
}