/**
 * Tests for Network Resilience functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { NetworkResilience, RetryOptions } from '../lib/updater/network-resilience'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('NetworkResilience', () => {
    let networkResilience: NetworkResilience

    beforeEach(() => {
        // Set test environment
        ;(process.env as any).NODE_ENV = 'test'
        networkResilience = new NetworkResilience()
        mockFetch.mockClear()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe('Retry Logic', () => {
        /**
         * **Feature: github-auto-updater, Property 14: Exponential backoff retry behavior**
         * **Validates: Requirements 4.1**
         */
        it('should implement exponential backoff retry behavior correctly', async () => {
            // Test specific cases to verify the property
            const testCases = [
                {
                    retryOptions: { maxRetries: 2, baseDelay: 100, backoffFactor: 2, jitter: false },
                    failuresBeforeSuccess: 2,
                    expectedDelays: [100, 200]
                },
                {
                    retryOptions: { maxRetries: 3, baseDelay: 50, backoffFactor: 1.5, jitter: false },
                    failuresBeforeSuccess: 2,
                    expectedDelays: [50, 75]
                }
            ]

            for (const testCase of testCases) {
                let attemptCount = 0
                const delays: number[] = []

                // Temporarily disable test environment to enable delay tracking
                const originalNodeEnv = process.env.NODE_ENV
                delete (process.env as any).NODE_ENV

                // Mock fetch for connectivity checks
                const mockFetch = vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200
                })
                const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(mockFetch)

                // Mock setTimeout to capture delays, but filter out connectivity check timeouts (5000ms)
                const mockSetTimeout = vi.fn().mockImplementation((callback: any, delay: number) => {
                    if (delay !== 5000) { // Filter out connectivity check timeouts
                        delays.push(delay)
                    }
                    // Execute immediately for testing
                    callback()
                    return 1 as any
                })

                const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(mockSetTimeout)

                // Create operation that fails a specific number of times then succeeds
                const operation = vi.fn().mockImplementation(async () => {
                    attemptCount++
                    if (attemptCount <= testCase.failuresBeforeSuccess) {
                        throw new Error(`Network error attempt ${attemptCount}`)
                    }
                    return `Success after ${attemptCount} attempts`
                })

                const result = await networkResilience.withRetry(operation, testCase.retryOptions)

                // Verify the operation eventually succeeded
                expect(result).toBe(`Success after ${attemptCount} attempts`)
                expect(attemptCount).toBe(testCase.failuresBeforeSuccess + 1)

                // Verify exponential backoff behavior
                expect(delays).toEqual(testCase.expectedDelays)

                setTimeoutSpy.mockRestore()
                fetchSpy.mockRestore()
                // Restore NODE_ENV
                if (originalNodeEnv) {
                    ;(process.env as any).NODE_ENV = originalNodeEnv
                }

                // Reset for next test case
                attemptCount = 0
            }
        })

        it('should respect maximum retry limit', async () => {
            const operation = vi.fn().mockRejectedValue(new Error('Always fails'))
            const maxRetries = 2

            // Mock setTimeout to execute immediately
            const mockSetTimeout = vi.fn().mockImplementation((callback: any) => {
                callback()
                return 1 as any
            })
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(mockSetTimeout)

            await expect(
                networkResilience.withRetry(operation, { maxRetries })
            ).rejects.toThrow('Operation failed after 3 attempts')

            expect(operation).toHaveBeenCalledTimes(maxRetries + 1) // Initial attempt + retries

            setTimeoutSpy.mockRestore()
        })

        it('should not retry on immediate success', async () => {
            const operation = vi.fn().mockResolvedValue('Success')

            const result = await networkResilience.withRetry(operation, { maxRetries: 3 })

            expect(result).toBe('Success')
            expect(operation).toHaveBeenCalledTimes(1)
        })

        it('should handle zero retries configuration', async () => {
            const operation = vi.fn().mockRejectedValue(new Error('Fails'))

            await expect(
                networkResilience.withRetry(operation, { maxRetries: 0 })
            ).rejects.toThrow('Operation failed after 1 attempts')

            expect(operation).toHaveBeenCalledTimes(1)
        })
    })

    describe('Network Connectivity', () => {
        it('should detect network connectivity', async () => {
            // Mock successful connectivity check
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200
            })

            const isOnline = await networkResilience.checkConnectivity()
            expect(isOnline).toBe(true)

            const status = networkResilience.getNetworkStatus()
            expect(status.isOnline).toBe(true)
            expect(status.consecutiveFailures).toBe(0)
        })

        it('should detect network failures', async () => {
            // Mock network failure
            mockFetch.mockRejectedValueOnce(new Error('Network error'))

            const isOnline = await networkResilience.checkConnectivity()
            expect(isOnline).toBe(false)

            const status = networkResilience.getNetworkStatus()
            expect(status.isOnline).toBe(false)
            expect(status.consecutiveFailures).toBe(1)
        })

        it('should treat 401 as online (GitHub is reachable)', async () => {
            // Mock 401 response (unauthorized but reachable)
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401
            })

            const isOnline = await networkResilience.checkConnectivity()
            expect(isOnline).toBe(true)
        })
    })

    describe('Rate Limiting', () => {
        it('should detect rate limit errors', async () => {
            const rateLimitError = new Error('Rate limit exceeded')
                ; (rateLimitError as any).rateLimitInfo = {
                    remaining: 0,
                    resetTime: new Date(Date.now() + 60000),
                    retryAfter: 60
                }

            // Test that the error is correctly identified as a rate limit error
            const isRateLimitError = (networkResilience as any).isRateLimitError(rateLimitError)
            expect(isRateLimitError).toBe(true)

            // Mock setTimeout to execute immediately
            const mockSetTimeout = vi.fn().mockImplementation((callback: any) => {
                callback()
                return 1 as any
            })
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(mockSetTimeout)

            const operation = vi.fn()
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce('Success')

            const result = await networkResilience.withRetry(operation, { maxRetries: 2 })
            expect(result).toBe('Success')

            // Verify that the operation was called twice (once failed, once succeeded)
            expect(operation).toHaveBeenCalledTimes(2)

            setTimeoutSpy.mockRestore()
        })

        it('should respect rate limit delays', async () => {
            const rateLimitError = new Error('Rate limit exceeded')
                ; (rateLimitError as any).rateLimitInfo = {
                    remaining: 0,
                    resetTime: new Date(Date.now() + 60000),
                    retryAfter: 30
                }

            // Test the rate limit delay calculation directly
            const rateLimitInfo = {
                limit: 5000,
                remaining: 0,
                resetTime: new Date(Date.now() + 60000),
                retryAfter: 30
            }

                // Set rate limit info directly
                ; (networkResilience as any).rateLimitInfo = rateLimitInfo

            // Test that rate limit delay is calculated correctly
            const isRateLimited = (networkResilience as any).isRateLimited()
            expect(isRateLimited).toBe(true)

            const rateLimitDelay = (networkResilience as any).getRateLimitDelay()
            expect(rateLimitDelay).toBe(30000) // 30 seconds in milliseconds
        })

        /**
         * **Feature: github-auto-updater, Property 15: Rate limit compliance**
         * **Validates: Requirements 4.2**
         */
        it('should comply with rate limit constraints across all scenarios', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate rate limit scenarios
                    fc.record({
                        remaining: fc.integer({ min: 0, max: 10 }),
                        resetTimeMinutes: fc.integer({ min: 1, max: 60 }),
                        retryAfterSeconds: fc.option(fc.integer({ min: 1, max: 300 }), { nil: undefined })
                    }),
                    async (rateLimitScenario) => {
                        const resetTime = new Date(Date.now() + rateLimitScenario.resetTimeMinutes * 60 * 1000)

                        // Set up rate limit info
                        const rateLimitInfo = {
                            limit: 5000,
                            remaining: rateLimitScenario.remaining,
                            resetTime,
                            retryAfter: rateLimitScenario.retryAfterSeconds
                        }

                            // Set rate limit info directly
                            ; (networkResilience as any).rateLimitInfo = rateLimitInfo

                        // Test rate limit detection
                        const isRateLimited = (networkResilience as any).isRateLimited()

                        // Property: Should be rate limited if and only if remaining is 0 and reset time is in the future
                        const shouldBeRateLimited = rateLimitScenario.remaining <= 0 && resetTime > new Date()
                        expect(isRateLimited).toBe(shouldBeRateLimited)

                        // Property: If rate limited, delay should be positive
                        if (isRateLimited) {
                            const delay = (networkResilience as any).getRateLimitDelay()
                            expect(delay).toBeGreaterThan(0)

                            // Property: If retryAfter is specified, it should be used
                            if (rateLimitScenario.retryAfterSeconds) {
                                expect(delay).toBe(rateLimitScenario.retryAfterSeconds * 1000)
                            } else {
                                // Property: Otherwise, delay should be time until reset
                                const expectedDelay = Math.max(0, resetTime.getTime() - Date.now())
                                expect(delay).toBeCloseTo(expectedDelay, -2) // Within 100ms tolerance
                            }
                        }

                        // Property: Rate limit status should be consistent
                        const status = networkResilience.getRateLimitStatus()
                        expect(status.isRateLimited).toBe(isRateLimited)
                        expect(status.rateLimitInfo?.remaining).toBe(rateLimitScenario.remaining)

                        if (isRateLimited) {
                            expect(status.recommendedDelay).toBeGreaterThan(0)
                            expect(status.timeUntilReset).toBeGreaterThanOrEqual(0)
                        }
                    }
                ),
                { numRuns: 20 }
            )
        })

        /**
         * **Feature: github-auto-updater, Property 18: Offline detection and handling**
         * **Validates: Requirements 4.5**
         */
        it('should handle offline scenarios correctly across all conditions', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate offline scenarios
                    fc.record({
                        consecutiveFailures: fc.integer({ min: 0, max: 15 }),
                        timeSinceLastCheck: fc.integer({ min: 0, max: 48 * 60 * 60 * 1000 }), // Up to 48 hours
                        isCurrentlyOnline: fc.boolean()
                    }),
                    async (offlineScenario) => {
                        // Set up network status
                        const lastChecked = new Date(Date.now() - offlineScenario.timeSinceLastCheck)
                            ; (networkResilience as any).networkStatus = {
                                isOnline: offlineScenario.isCurrentlyOnline,
                                lastChecked,
                                consecutiveFailures: offlineScenario.consecutiveFailures
                            }

                            // Test adaptive interval calculation
                            ; (networkResilience as any).updateAdaptiveInterval()
                        const adaptiveInterval = networkResilience.getAdaptiveInterval()

                        // Property: Adaptive interval should increase with more failures
                        if (offlineScenario.consecutiveFailures === 0) {
                            // Base interval is 24 hours, but may be reduced for extended offline periods
                            const baseInterval = 24 * 60 * 60 * 1000
                            const oneDay = 24 * 60 * 60 * 1000
                            if (!offlineScenario.isCurrentlyOnline && offlineScenario.timeSinceLastCheck > oneDay) {
                                expect(adaptiveInterval).toBe(6 * 60 * 60 * 1000) // 6 hours for extended offline
                            } else {
                                expect(adaptiveInterval).toBe(baseInterval) // 24 hours
                            }
                        } else if (offlineScenario.consecutiveFailures >= 10) {
                            // With 10+ failures, normally 7 days, but offline reduction may apply
                            const oneDay = 24 * 60 * 60 * 1000
                            if (!offlineScenario.isCurrentlyOnline && offlineScenario.timeSinceLastCheck > oneDay) {
                                expect(adaptiveInterval).toBe(6 * 60 * 60 * 1000) // 6 hours for extended offline
                            } else {
                                expect(adaptiveInterval).toBe(7 * 24 * 60 * 60 * 1000) // 7 days max
                            }
                        } else {
                            // With failures, interval increases, but may be reduced for extended offline periods
                            const oneDay = 24 * 60 * 60 * 1000
                            if (!offlineScenario.isCurrentlyOnline && offlineScenario.timeSinceLastCheck > oneDay) {
                                expect(adaptiveInterval).toBe(6 * 60 * 60 * 1000) // 6 hours for extended offline
                            } else {
                                expect(adaptiveInterval).toBeGreaterThan(24 * 60 * 60 * 1000) // More than 24 hours
                            }
                        }

                        // Test recommended check interval
                        const recommendedInterval = networkResilience.getRecommendedCheckInterval()

                        // Property: When offline, recommended interval should be capped at 30 minutes
                        if (!offlineScenario.isCurrentlyOnline) {
                            expect(recommendedInterval).toBeLessThanOrEqual(30 * 60 * 1000)
                        }

                        // Property: Recommended interval should never be negative
                        expect(recommendedInterval).toBeGreaterThan(0)

                        // Property: Network status should be consistent
                        const networkStatus = networkResilience.getNetworkStatus()
                        expect(networkStatus.isOnline).toBe(offlineScenario.isCurrentlyOnline)
                        expect(networkStatus.consecutiveFailures).toBe(offlineScenario.consecutiveFailures)

                        // Property: Extended offline period should reduce interval
                        const oneDay = 24 * 60 * 60 * 1000
                        if (!offlineScenario.isCurrentlyOnline && offlineScenario.timeSinceLastCheck > oneDay) {
                            expect(adaptiveInterval).toBeLessThanOrEqual(6 * 60 * 60 * 1000) // Max 6 hours
                        }
                    }
                ),
                { numRuns: 25 }
            )
        })
    })

    describe('Adaptive Intervals', () => {
        it('should increase check interval after failures', () => {
            const initialInterval = networkResilience.getAdaptiveInterval()
            expect(initialInterval).toBe(24 * 60 * 60 * 1000) // 24 hours

                // Simulate failures by directly modifying the network status
                ; (networkResilience as any).networkStatus.consecutiveFailures = 3

                // This would normally be called internally, but we'll call it directly for testing
                ; (networkResilience as any).updateAdaptiveInterval()

            const newInterval = networkResilience.getAdaptiveInterval()
            expect(newInterval).toBeGreaterThan(initialInterval)
        })

        it('should reset interval on success', () => {
            // Set some failures first
            ; (networkResilience as any).networkStatus.consecutiveFailures = 5
                ; (networkResilience as any).updateAdaptiveInterval()

            const increasedInterval = networkResilience.getAdaptiveInterval()
            expect(increasedInterval).toBeGreaterThan(24 * 60 * 60 * 1000)

                // Reset failures
                ; (networkResilience as any).networkStatus.consecutiveFailures = 0
                ; (networkResilience as any).updateAdaptiveInterval()

            const resetInterval = networkResilience.getAdaptiveInterval()
            expect(resetInterval).toBe(24 * 60 * 60 * 1000) // Back to 24 hours
        })
    })

    describe('Error Classification', () => {
        it('should identify network errors correctly', () => {
            const networkErrors = [
                new Error('Network error occurred'),
                new Error('fetch failed'),
                new Error('Connection refused'),
                new Error('Request timeout'),
                new Error('DNS resolution failed'),
                new Error('Host unreachable'),
                new Error('System is offline'),
                new Error('No internet connection')
            ]

            for (const error of networkErrors) {
                const isNetworkError = (networkResilience as any).isNetworkError(error)
                expect(isNetworkError).toBe(true)
            }
        })

        it('should identify rate limit errors correctly', () => {
            const rateLimitErrors = [
                { message: 'API rate limit exceeded', status: 403 },
                { message: 'Rate limit hit', statusCode: 403 },
                new Error('GitHub rate limit reached')
            ]

            for (const error of rateLimitErrors) {
                const isRateLimitError = (networkResilience as any).isRateLimitError(error)
                expect(isRateLimitError).toBe(true)
            }
        })

        it('should not misclassify other errors', () => {
            const otherErrors = [
                new Error('Invalid token'),
                new Error('Repository not found'),
                { message: 'Bad request', status: 400 },
                new Error('Internal server error')
            ]

            for (const error of otherErrors) {
                const isNetworkError = (networkResilience as any).isNetworkError(error)
                const isRateLimitError = (networkResilience as any).isRateLimitError(error)

                expect(isNetworkError).toBe(false)
                expect(isRateLimitError).toBe(false)
            }
        })
    })

    describe('Status Management', () => {
        it('should reset network status correctly', () => {
            // Set some failure state
            ; (networkResilience as any).networkStatus.consecutiveFailures = 5
                ; (networkResilience as any).networkStatus.isOnline = false
                ; (networkResilience as any).rateLimitInfo = { remaining: 0, resetTime: new Date() }

            networkResilience.resetNetworkStatus()

            const status = networkResilience.getNetworkStatus()
            expect(status.consecutiveFailures).toBe(0)
            expect(status.isOnline).toBe(true)
            expect(networkResilience.getRateLimitInfo()).toBeNull()
            expect(networkResilience.getAdaptiveInterval()).toBe(24 * 60 * 60 * 1000)
        })
    })
})