/**
 * Semantic version comparison utilities for the GitHub Auto-Updater system
 */

import * as semver from 'semver'

/**
 * Represents a parsed semantic version with additional metadata
 */
export interface ParsedVersion {
    version: string
    major: number
    minor: number
    patch: number
    prerelease: ReadonlyArray<string | number>
    build: ReadonlyArray<string>
    isPrerelease: boolean
    isValid: boolean
}

/**
 * Version comparison result
 */
export type VersionComparison = -1 | 0 | 1

/**
 * Parses a version string into a structured format
 * @param version - The version string to parse (e.g., "1.2.3", "2.0.0-beta.1")
 * @returns ParsedVersion object with structured version information
 */
export function parseVersion(version: string): ParsedVersion {
    const cleanVersion = semver.clean(version)

    if (!cleanVersion || !semver.valid(cleanVersion)) {
        return {
            version,
            major: 0,
            minor: 0,
            patch: 0,
            prerelease: [],
            build: [],
            isPrerelease: false,
            isValid: false
        }
    }

    const parsed = semver.parse(cleanVersion)
    if (!parsed) {
        return {
            version,
            major: 0,
            minor: 0,
            patch: 0,
            prerelease: [],
            build: [],
            isPrerelease: false,
            isValid: false
        }
    }

    return {
        version: cleanVersion,
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch,
        prerelease: parsed.prerelease,
        build: parsed.build,
        isPrerelease: parsed.prerelease.length > 0,
        isValid: true
    }
}

/**
 * Compares two version strings using semantic versioning rules
 * @param version1 - First version to compare
 * @param version2 - Second version to compare
 * @returns -1 if version1 < version2, 0 if equal, 1 if version1 > version2
 */
export function compareVersions(version1: string, version2: string): VersionComparison {
    const result = semver.compare(version1, version2)
    return result as VersionComparison
}

/**
 * Determines if the first version is newer than the second
 * @param version1 - Version to check if newer
 * @param version2 - Version to compare against
 * @returns true if version1 is newer than version2
 */
export function isNewerVersion(version1: string, version2: string): boolean {
    return compareVersions(version1, version2) > 0
}

/**
 * Determines if the first version is older than the second
 * @param version1 - Version to check if older
 * @param version2 - Version to compare against
 * @returns true if version1 is older than version2
 */
export function isOlderVersion(version1: string, version2: string): boolean {
    return compareVersions(version1, version2) < 0
}

/**
 * Determines if two versions are equal
 * @param version1 - First version
 * @param version2 - Second version
 * @returns true if versions are equal
 */
export function areVersionsEqual(version1: string, version2: string): boolean {
    return compareVersions(version1, version2) === 0
}

/**
 * Validates if a version string is a valid semantic version
 * @param version - Version string to validate
 * @returns true if the version is valid
 */
export function isValidVersion(version: string): boolean {
    return semver.valid(version) !== null
}

/**
 * Determines if a version is a prerelease version
 * @param version - Version string to check
 * @returns true if the version is a prerelease
 */
export function isPrerelease(version: string): boolean {
    const parsed = semver.parse(version)
    return parsed ? parsed.prerelease.length > 0 : false
}

/**
 * Gets the highest version from an array of version strings
 * @param versions - Array of version strings
 * @returns The highest version string, or null if no valid versions
 */
export function getHighestVersion(versions: string[]): string | null {
    const validVersions = versions.filter(isValidVersion)
    if (validVersions.length === 0) {
        return null
    }

    // Use semver.sort to get the highest version, including prereleases
    const sorted = semver.sort(validVersions)
    return sorted[sorted.length - 1]
}

/**
 * Filters versions based on prerelease preference
 * @param versions - Array of version strings
 * @param includePrerelease - Whether to include prerelease versions
 * @returns Filtered array of versions
 */
export function filterVersionsByPrerelease(versions: string[], includePrerelease: boolean): string[] {
    return versions.filter(version => {
        if (!isValidVersion(version)) {
            return false
        }

        const isPre = isPrerelease(version)
        return includePrerelease ? true : !isPre
    })
}

/**
 * Checks if a version satisfies a range or pattern
 * @param version - Version to check
 * @param range - Semver range or pattern (e.g., "^1.0.0", ">=2.0.0")
 * @returns true if version satisfies the range
 */
export function satisfiesRange(version: string, range: string): boolean {
    return semver.satisfies(version, range)
}

/**
 * Increments a version by the specified release type
 * @param version - Current version
 * @param releaseType - Type of release (major, minor, patch, prerelease)
 * @param prereleaseId - Identifier for prerelease (e.g., "alpha", "beta")
 * @returns New incremented version string
 */
export function incrementVersion(
    version: string,
    releaseType: 'major' | 'minor' | 'patch' | 'prerelease',
    prereleaseId?: string
): string | null {
    try {
        if (prereleaseId) {
            return semver.inc(version, releaseType, prereleaseId) || null
        }
        return semver.inc(version, releaseType) || null
    } catch {
        return null
    }
}

/**
 * Version utilities class for object-oriented usage
 */
export class VersionUtils {
    /**
     * Parse a version string into structured format
     */
    parseVersion(version: string): ParsedVersion {
        return parseVersion(version)
    }

    /**
     * Compare two version strings
     */
    compareVersions(version1: string, version2: string): VersionComparison {
        return compareVersions(version1, version2)
    }

    /**
     * Check if first version is newer than second
     */
    isNewerVersion(version1: string, version2: string): boolean {
        return isNewerVersion(version1, version2)
    }

    /**
     * Check if first version is older than second
     */
    isOlderVersion(version1: string, version2: string): boolean {
        return isOlderVersion(version1, version2)
    }

    /**
     * Check if two versions are equal
     */
    areVersionsEqual(version1: string, version2: string): boolean {
        return areVersionsEqual(version1, version2)
    }

    /**
     * Validate if version string is valid semantic version
     */
    isValidVersion(version: string): boolean {
        return isValidVersion(version)
    }

    /**
     * Check if version is a prerelease
     */
    isPrerelease(version: string): boolean {
        return isPrerelease(version)
    }

    /**
     * Get highest version from array
     */
    getHighestVersion(versions: string[]): string | null {
        return getHighestVersion(versions)
    }

    /**
     * Filter versions by prerelease preference
     */
    filterVersionsByPrerelease(versions: string[], includePrerelease: boolean): string[] {
        return filterVersionsByPrerelease(versions, includePrerelease)
    }

    /**
     * Check if version satisfies range
     */
    satisfiesRange(version: string, range: string): boolean {
        return satisfiesRange(version, range)
    }

    /**
     * Increment version by release type
     */
    incrementVersion(
        version: string,
        releaseType: 'major' | 'minor' | 'patch' | 'prerelease',
        prereleaseId?: string
    ): string | null {
        return incrementVersion(version, releaseType, prereleaseId)
    }
}