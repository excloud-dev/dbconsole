/**
 * Update availability detection service for the GitHub Auto-Updater system
 */

import {
    UpdateInfo,
    UpdateSettings,
    GitHubRelease,
    UpdateChannel,
    Platform,
    Architecture
} from './types'
import {
    compareVersions,
    isNewerVersion,
    isPrerelease,
    filterVersionsByPrerelease,
    getHighestVersion,
    satisfiesRange,
    isValidVersion
} from './version-utils'

/**
 * Result of update availability check
 */
export interface UpdateAvailabilityResult {
    hasUpdate: boolean
    updateInfo?: UpdateInfo
    currentVersion: string
    latestVersion?: string
    channel: UpdateChannel
    isForced: boolean
}

/**
 * Configuration for update detection
 */
export interface UpdateDetectionConfig {
    currentVersion: string
    owner: string
    repo: string
    platform: Platform
    architecture: Architecture
    settings: UpdateSettings
}

/**
 * Service for detecting update availability based on GitHub releases
 */
export class UpdateDetector {
    /**
     * Determines if an update is available based on releases and settings
     * @param releases - Array of GitHub releases
     * @param config - Update detection configuration
     * @returns Update availability result
     */
    public detectUpdateAvailability(
        releases: GitHubRelease[],
        config: UpdateDetectionConfig
    ): UpdateAvailabilityResult {
        const { currentVersion, settings } = config

        // Filter releases based on update channel
        const filteredReleases = this.filterReleasesByChannel(releases, settings.updateChannel, settings.customTagPattern)

        if (filteredReleases.length === 0) {
            return {
                hasUpdate: false,
                currentVersion,
                channel: settings.updateChannel,
                isForced: false
            }
        }

        // Get the latest available version
        const latestRelease = this.getLatestRelease(filteredReleases)
        if (!latestRelease) {
            return {
                hasUpdate: false,
                currentVersion,
                channel: settings.updateChannel,
                isForced: false
            }
        }

        const latestVersion = this.normalizeVersionTag(latestRelease.tagName)

        // Check if update is available
        const hasUpdate = this.isUpdateAvailable(currentVersion, latestVersion)

        if (!hasUpdate) {
            return {
                hasUpdate: false,
                currentVersion,
                latestVersion,
                channel: settings.updateChannel,
                isForced: false
            }
        }

        // Check if update is forced
        const isForced = this.isForceUpdate(latestRelease, currentVersion)

        // Find appropriate asset for current platform
        const asset = this.findPlatformAsset(latestRelease, config.platform, config.architecture)

        if (!asset) {
            return {
                hasUpdate: false,
                currentVersion,
                latestVersion,
                channel: settings.updateChannel,
                isForced
            }
        }

        // Create update info
        const updateInfo: UpdateInfo = {
            version: latestVersion,
            releaseNotes: latestRelease.body || '',
            downloadUrl: asset.downloadUrl,
            checksum: '', // Will be populated by download manager
            signature: undefined,
            publishedAt: new Date(latestRelease.publishedAt),
            isPrerelease: latestRelease.prerelease
        }

        return {
            hasUpdate: true,
            updateInfo,
            currentVersion,
            latestVersion,
            channel: settings.updateChannel,
            isForced
        }
    }

    /**
     * Filters releases based on the specified update channel
     * @param releases - Array of GitHub releases
     * @param channel - Update channel to filter by
     * @param customPattern - Custom tag pattern for 'custom' channel
     * @returns Filtered releases
     */
    private filterReleasesByChannel(
        releases: GitHubRelease[],
        channel: UpdateChannel,
        customPattern?: string
    ): GitHubRelease[] {
        switch (channel) {
            case 'latest':
                // Only stable releases (non-prerelease)
                return releases.filter(release => !release.prerelease)

            case 'prerelease':
                // Include all releases (stable and prerelease)
                return releases

            case 'custom':
                // Filter by custom tag pattern if provided
                if (!customPattern) {
                    return releases
                }

                try {
                    const regex = new RegExp(customPattern)
                    return releases.filter(release => regex.test(release.tagName))
                } catch {
                    // Invalid regex, return all releases
                    return releases
                }

            default:
                return releases
        }
    }

    /**
     * Gets the latest release from filtered releases
     * @param releases - Filtered releases
     * @returns Latest release or null
     */
    private getLatestRelease(releases: GitHubRelease[]): GitHubRelease | null {
        if (releases.length === 0) {
            return null
        }

        // Extract version tags and find the highest version
        const versionMap = new Map<string, GitHubRelease>()
        const versions: string[] = []

        for (const release of releases) {
            const normalizedVersion = this.normalizeVersionTag(release.tagName)
            if (isValidVersion(normalizedVersion)) {
                versionMap.set(normalizedVersion, release)
                versions.push(normalizedVersion)
            }
        }

        const highestVersion = getHighestVersion(versions)
        if (!highestVersion) {
            // Fallback to first release if no valid versions found
            return releases[0]
        }

        return versionMap.get(highestVersion) || releases[0]
    }

    /**
     * Normalizes a version tag by removing common prefixes
     * @param tag - Version tag from GitHub release
     * @returns Normalized version string
     */
    private normalizeVersionTag(tag: string): string {
        // Remove common prefixes like 'v', 'version-', 'release-'
        return tag.replace(/^(v|version-|release-)/i, '')
    }

    /**
     * Determines if an update is available
     * @param currentVersion - Current application version
     * @param latestVersion - Latest available version
     * @returns true if update is available
     */
    private isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
        if (!isValidVersion(currentVersion) || !isValidVersion(latestVersion)) {
            return false
        }

        return isNewerVersion(latestVersion, currentVersion)
    }

    /**
     * Determines if an update is forced based on release metadata
     * @param release - GitHub release
     * @param currentVersion - Current application version
     * @returns true if update is forced
     */
    private isForceUpdate(release: GitHubRelease, currentVersion: string): boolean {
        // Check release body for force update indicators
        const body = release.body?.toLowerCase() || ''
        const forceKeywords = ['force update', 'forced update', 'critical update', 'security update']

        const hasForceKeyword = forceKeywords.some(keyword => body.includes(keyword))

        // Check if release name indicates force update
        const name = release.name?.toLowerCase() || ''
        const hasForceInName = forceKeywords.some(keyword => name.includes(keyword))

        // Check for breaking changes that might require forced update
        const hasBreakingChange = body.includes('breaking change') || body.includes('breaking:')

        // Check version difference - major version changes might be forced
        const currentMajor = this.getMajorVersion(currentVersion)
        const releaseMajor = this.getMajorVersion(this.normalizeVersionTag(release.tagName))
        const isMajorVersionJump = currentMajor !== null && releaseMajor !== null && releaseMajor > currentMajor

        return hasForceKeyword || hasForceInName || hasBreakingChange || isMajorVersionJump
    }

    /**
     * Extracts major version number from version string
     * @param version - Version string
     * @returns Major version number or null if invalid
     */
    private getMajorVersion(version: string): number | null {
        if (!isValidVersion(version)) {
            return null
        }

        const parts = version.split('.')
        const major = parseInt(parts[0], 10)
        return isNaN(major) ? null : major
    }

    /**
     * Finds the appropriate asset for the current platform and architecture
     * @param release - GitHub release
     * @param platform - Target platform
     * @param architecture - Target architecture
     * @returns Matching asset or null
     */
    private findPlatformAsset(
        release: GitHubRelease,
        platform: Platform,
        architecture: Architecture
    ): { downloadUrl: string; name: string; size: number } | null {
        const assets = release.assets

        // Platform-specific file patterns
        const platformPatterns = {
            darwin: ['.dmg', '.pkg', 'mac', 'darwin'],
            win32: ['.exe', '.msi', 'win', 'windows'],
            linux: ['.deb', '.rpm', '.tar.gz', '.AppImage', 'linux']
        }

        // Architecture patterns
        const archPatterns = {
            x64: ['x64', 'amd64', 'x86_64'],
            arm64: ['arm64', 'aarch64']
        }

        const platformKeywords = platformPatterns[platform] || []
        const archKeywords = archPatterns[architecture] || []

        // Find assets that match platform and architecture
        const matchingAssets = assets.filter(asset => {
            const name = asset.name.toLowerCase()

            const matchesPlatform = platformKeywords.some(keyword =>
                name.includes(keyword.toLowerCase())
            )

            const matchesArch = archKeywords.some(keyword =>
                name.includes(keyword.toLowerCase())
            )

            // For some platforms, architecture might be implicit
            if (matchesPlatform && archKeywords.length > 0) {
                return matchesArch
            }

            return matchesPlatform
        })

        if (matchingAssets.length === 0) {
            return null
        }

        // Prefer the first matching asset
        const asset = matchingAssets[0]

        return {
            downloadUrl: asset.downloadUrl,
            name: asset.name,
            size: asset.size
        }
    }

    /**
     * Checks if a version satisfies minimum version requirements
     * @param version - Version to check
     * @param minimumVersion - Minimum required version
     * @returns true if version meets minimum requirements
     */
    public satisfiesMinimumVersion(version: string, minimumVersion: string): boolean {
        if (!isValidVersion(version) || !isValidVersion(minimumVersion)) {
            return false
        }

        return compareVersions(version, minimumVersion) >= 0
    }

    /**
     * Determines update priority based on version difference and release metadata
     * @param currentVersion - Current version
     * @param updateVersion - Update version
     * @param release - GitHub release
     * @returns Priority level (1-5, where 5 is highest priority)
     */
    public getUpdatePriority(
        currentVersion: string,
        updateVersion: string,
        release: GitHubRelease
    ): number {
        if (!isValidVersion(currentVersion) || !isValidVersion(updateVersion)) {
            return 1
        }

        let priority = 1

        // Check version difference magnitude
        const currentMajor = this.getMajorVersion(currentVersion)
        const updateMajor = this.getMajorVersion(updateVersion)

        if (currentMajor !== null && updateMajor !== null) {
            if (updateMajor > currentMajor) {
                priority = Math.max(priority, 4) // Major version update
            }
        }

        // Check for security or critical updates
        const body = release.body?.toLowerCase() || ''
        const name = release.name?.toLowerCase() || ''

        if (body.includes('security') || name.includes('security')) {
            priority = 5 // Highest priority for security updates
        } else if (body.includes('critical') || name.includes('critical')) {
            priority = Math.max(priority, 4)
        } else if (body.includes('bug fix') || body.includes('bugfix')) {
            priority = Math.max(priority, 3)
        }

        // Force updates get highest priority
        if (this.isForceUpdate(release, currentVersion)) {
            priority = 5
        }

        return priority
    }
}