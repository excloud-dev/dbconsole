/**
 * Property-based tests for version comparison utilities
 * **Feature: github-auto-updater, Property 4: Version comparison accuracy**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    compareVersions,
    isNewerVersion,
    isOlderVersion,
    areVersionsEqual,
    parseVersion,
    isValidVersion,
    isPrerelease,
    getHighestVersion,
    filterVersionsByPrerelease,
    satisfiesRange,
    incrementVersion
} from '../lib/updater/version-utils'

// Custom arbitraries for generating semantic versions
const validVersionArbitrary = fc.tuple(
    fc.integer({ min: 0, max: 999 }), // major
    fc.integer({ min: 0, max: 999 }), // minor  
    fc.integer({ min: 0, max: 999 })  // patch
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const prereleaseVersionArbitrary = fc.tuple(
    fc.integer({ min: 0, max: 999 }), // major
    fc.integer({ min: 0, max: 999 }), // minor
    fc.integer({ min: 0, max: 999 }), // patch
    fc.oneof(
        fc.constant('alpha'),
        fc.constant('beta'),
        fc.constant('rc')
    ),
    fc.integer({ min: 1, max: 99 })
).map(([major, minor, patch, preId, preNum]) => `${major}.${minor}.${patch}-${preId}.${preNum}`)

const anyValidVersionArbitrary = fc.oneof(
    validVersionArbitrary,
    prereleaseVersionArbitrary
)

describe('Version Comparison Properties', () => {
    it('Property 4: Version comparison accuracy - comparison should be transitive', () => {
        /**
         * **Validates: Requirements 1.4**
         * For any three versions A, B, C: if A > B and B > C, then A > C
         */
        fc.assert(
            fc.property(
                anyValidVersionArbitrary,
                anyValidVersionArbitrary,
                anyValidVersionArbitrary,
                (versionA, versionB, versionC) => {
                    const compAB = compareVersions(versionA, versionB)
                    const compBC = compareVersions(versionB, versionC)
                    const compAC = compareVersions(versionA, versionC)

                    // If A > B and B > C, then A > C (transitivity)
                    if (compAB > 0 && compBC > 0) {
                        return compAC > 0
                    }

                    // If A < B and B < C, then A < C
                    if (compAB < 0 && compBC < 0) {
                        return compAC < 0
                    }

                    // If A = B and B = C, then A = C
                    if (compAB === 0 && compBC === 0) {
                        return compAC === 0
                    }

                    // For other cases, we don't enforce specific behavior
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - comparison should be antisymmetric', () => {
        /**
         * **Validates: Requirements 1.4**
         * For any two versions A and B: if compare(A, B) = x, then compare(B, A) = -x
         */
        fc.assert(
            fc.property(
                anyValidVersionArbitrary,
                anyValidVersionArbitrary,
                (versionA, versionB) => {
                    const compAB = compareVersions(versionA, versionB)
                    const compBA = compareVersions(versionB, versionA)

                    return compAB === -compBA
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - reflexivity property', () => {
        /**
         * **Validates: Requirements 1.4**
         * For any version A: compare(A, A) should equal 0
         */
        fc.assert(
            fc.property(
                anyValidVersionArbitrary,
                (version) => {
                    return compareVersions(version, version) === 0
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - helper function consistency', () => {
        /**
         * **Validates: Requirements 1.4**
         * Helper functions should be consistent with compareVersions
         */
        fc.assert(
            fc.property(
                anyValidVersionArbitrary,
                anyValidVersionArbitrary,
                (versionA, versionB) => {
                    const comparison = compareVersions(versionA, versionB)

                    const isNewer = isNewerVersion(versionA, versionB)
                    const isOlder = isOlderVersion(versionA, versionB)
                    const areEqual = areVersionsEqual(versionA, versionB)

                    // Exactly one of these should be true
                    const trueCount = [isNewer, isOlder, areEqual].filter(Boolean).length

                    // Check consistency with comparison result
                    const newerConsistent = isNewer === (comparison > 0)
                    const olderConsistent = isOlder === (comparison < 0)
                    const equalConsistent = areEqual === (comparison === 0)

                    return trueCount === 1 && newerConsistent && olderConsistent && equalConsistent
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - prerelease versions are older than release versions', () => {
        /**
         * **Validates: Requirements 1.4**
         * For any version X, X-prerelease should be older than X
         */
        fc.assert(
            fc.property(
                validVersionArbitrary,
                fc.oneof(
                    fc.constant('alpha'),
                    fc.constant('beta'),
                    fc.constant('rc')
                ),
                fc.integer({ min: 1, max: 99 }),
                (baseVersion, preId, preNum) => {
                    const prereleaseVersion = `${baseVersion}-${preId}.${preNum}`

                    // Prerelease should be older than the base version
                    return isOlderVersion(prereleaseVersion, baseVersion)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - version parsing consistency', () => {
        /**
         * **Validates: Requirements 1.4**
         * Parsed version information should be consistent with comparison results
         */
        fc.assert(
            fc.property(
                anyValidVersionArbitrary,
                anyValidVersionArbitrary,
                (versionA, versionB) => {
                    const parsedA = parseVersion(versionA)
                    const parsedB = parseVersion(versionB)

                    // Both should be valid
                    if (!parsedA.isValid || !parsedB.isValid) {
                        return false
                    }

                    const comparison = compareVersions(versionA, versionB)

                    // If major versions differ, comparison should follow major version order
                    if (parsedA.major !== parsedB.major) {
                        const majorComparison = parsedA.major - parsedB.major
                        return Math.sign(comparison) === Math.sign(majorComparison)
                    }

                    // If minor versions differ (and major is same), comparison should follow minor version order
                    if (parsedA.minor !== parsedB.minor) {
                        const minorComparison = parsedA.minor - parsedB.minor
                        return Math.sign(comparison) === Math.sign(minorComparison)
                    }

                    // If patch versions differ (and major/minor same), comparison should follow patch version order
                    if (parsedA.patch !== parsedB.patch) {
                        const patchComparison = parsedA.patch - parsedB.patch
                        return Math.sign(comparison) === Math.sign(patchComparison)
                    }

                    // If all version numbers are same, prerelease handling should be consistent
                    return true
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - highest version selection', () => {
        /**
         * **Validates: Requirements 1.4**
         * getHighestVersion should return a version that is >= all input versions
         */
        fc.assert(
            fc.property(
                fc.array(anyValidVersionArbitrary, { minLength: 1, maxLength: 10 }),
                (versions) => {
                    const highest = getHighestVersion(versions)

                    if (highest === null) {
                        return false // Should not happen with valid versions
                    }

                    // Highest version should be >= all input versions
                    return versions.every(version =>
                        compareVersions(highest, version) >= 0
                    )
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property 4: Version comparison accuracy - prerelease filtering consistency', () => {
        /**
         * **Validates: Requirements 1.4**
         * Filtering by prerelease should correctly include/exclude prerelease versions
         */
        fc.assert(
            fc.property(
                fc.array(anyValidVersionArbitrary, { minLength: 1, maxLength: 10 }),
                fc.boolean(),
                (versions, includePrerelease) => {
                    const filtered = filterVersionsByPrerelease(versions, includePrerelease)

                    return filtered.every(version => {
                        const isPre = isPrerelease(version)
                        return includePrerelease ? true : !isPre
                    })
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('Version Utility Unit Tests', () => {
    it('should correctly identify valid versions', () => {
        expect(isValidVersion('1.0.0')).toBe(true)
        expect(isValidVersion('1.0.0-alpha.1')).toBe(true)
        expect(isValidVersion('invalid')).toBe(false)
        expect(isValidVersion('')).toBe(false)
    })

    it('should correctly identify prerelease versions', () => {
        expect(isPrerelease('1.0.0')).toBe(false)
        expect(isPrerelease('1.0.0-alpha.1')).toBe(true)
        expect(isPrerelease('1.0.0-beta')).toBe(true)
    })

    it('should handle version increment correctly', () => {
        expect(incrementVersion('1.0.0', 'major')).toBe('2.0.0')
        expect(incrementVersion('1.0.0', 'minor')).toBe('1.1.0')
        expect(incrementVersion('1.0.0', 'patch')).toBe('1.0.1')
        expect(incrementVersion('invalid', 'major')).toBe(null)
    })

    it('should handle range satisfaction correctly', () => {
        expect(satisfiesRange('1.5.0', '^1.0.0')).toBe(true)
        expect(satisfiesRange('2.0.0', '^1.0.0')).toBe(false)
        expect(satisfiesRange('1.0.0', '>=1.0.0')).toBe(true)
    })
})