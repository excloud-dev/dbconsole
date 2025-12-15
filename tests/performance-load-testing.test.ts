/**
 * Performance and Load Testing for GitHub Auto-Updater
 * Tests update system under various network conditions and load scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock Electron module first
vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => {
            switch (name) {
                case 'temp':
                    return tmpdir()
                case 'userData':
                    return join(tmpdir(), 'test-user-data')
                default:
                    return tmpdir()
            }
        },
        getVersion: () => '1.0.0',
        relaunch: () => undefined,
        exit: () => undefined
    },
    shell: {
        showItemInFolder: () => undefined,
        openPath: async () => ''
    },
    dialog: {}
}))

import { UpdateAgentImpl } from '../lib/updater/update-agent'
import { UpdateControllerImpl } from '../lib/updater/update-controller'
import { GitHubClientImpl } from '../lib/updater/github-client'
import { NetworkResilience } from '../lib/updater/network-resilience'

const RUN_PERF_TESTS = process.env.RUN_PERF_TESTS === '1' || process.env.RUN_PERF_TESTS === 'true'
const describePerf = RUN_PERF_TESTS ? describe : describe.skip

// Performance test configurations
const performanceScenarios = {
    smallFile: {
        size: 1000000, // 1MB
        expectedDownloadTime: 2000, // 2 seconds max
        chunks: 10
    },
    mediumFile: {
        size: 50000000, // 50MB
        expectedDownloadTime: 30000, // 30 seconds max
        chunks: 100
    },
    largeFile: {
        size: 200000000, // 200MB
        expectedDownloadTime: 120000, // 2 minutes max
        chunks: 400
    }
}

// Network condition simulations
const networkConditions = {
    fast: {
        latency: 10, // 10ms
        bandwidth: 10000000, // 10MB/s
        packetLoss: 0
    },
    normal: {
        latency: 50, // 50ms
        bandwidth: 5000000, // 5MB/s
        packetLoss: 0.01 // 1% packet loss
    },
    slow: {
        latency: 200, // 200ms
        bandwidth: 1000000, // 1MB/s
        packetLoss: 0.05 // 5% packet loss
    },
    mobile: {
        latency: 300, // 300ms
        bandwidth: 500000, // 500KB/s
        packetLoss: 0.1 // 10% packet loss
    }
}

// Performance monitoring utilities
class PerformanceMonitor {
    private metrics: Map<string, any[]> = new Map()
    private startTimes: Map<string, number> = new Map()

    startTimer(operation: string): void {
        this.startTimes.set(operation, performance.now())
    }

    endTimer(operation: string): number {
        const startTime = this.startTimes.get(operation)
        if (!startTime) {
            throw new Error(`Timer not started for operation: ${operation}`)
        }

        const duration = performance.now() - startTime
        this.addMetric(operation, { duration, timestamp: Date.now() })
        this.startTimes.delete(operation)
        return duration
    }

    addMetric(category: string, data: any): void {
        if (!this.metrics.has(category)) {
            this.metrics.set(category, [])
        }
        this.metrics.get(category)!.push(data)
    }

    getMetrics(category: string): any[] {
        return this.metrics.get(category) || []
    }

    getAverageMetric(category: string, field: string): number {
        const metrics = this.getMetrics(category)
        if (metrics.length === 0) return 0

        const sum = metrics.reduce((acc, metric) => acc + (metric[field] || 0), 0)
        return sum / metrics.length
    }

    getMemoryUsage(): NodeJS.MemoryUsage {
        return process.memoryUsage()
    }

    reset(): void {
        this.metrics.clear()
        this.startTimes.clear()
    }
}

// Mock GitHub client with performance simulation
class PerformanceGitHubMock extends EventEmitter {
    private networkCondition = networkConditions.normal
    private performanceMonitor: PerformanceMonitor

    constructor(performanceMonitor: PerformanceMonitor) {
        super()
        this.performanceMonitor = performanceMonitor
    }

    setNetworkCondition(condition: keyof typeof networkConditions): void {
        this.networkCondition = networkConditions[condition]
    }

    async getLatestRelease(owner: string, repo: string): Promise<any> {
        this.performanceMonitor.startTimer('api-request')

        // Simulate network latency
        await this.simulateNetworkDelay()

        const duration = this.performanceMonitor.endTimer('api-request')

        return {
            id: 1,
            tagName: 'v2.0.0',
            name: 'Test Release',
            body: 'Test release notes',
            assets: [
                {
                    id: 1,
                    name: 'test-app-darwin-x64.dmg',
                    size: performanceScenarios.mediumFile.size,
                    downloadUrl: 'https://api.github.com/test/asset/1',
                    contentType: 'application/octet-stream'
                }
            ],
            prerelease: false,
            publishedAt: new Date().toISOString()
        }
    }

    async getReleases(owner: string, repo: string): Promise<any[]> {
        const release = await this.getLatestRelease(owner, repo)
        return [release]
    }

    async getReleasesByChannel(owner: string, repo: string, channel: string): Promise<any[]> {
        return this.getReleases(owner, repo)
    }

    getBestAssetForPlatform(release: any): any {
        return release.assets[0]
    }

    async downloadAsset(assetUrl: string): Promise<ReadableStream> {
        this.performanceMonitor.startTimer('download-stream-creation')

        const fileSize = this.getFileSizeFromUrl(assetUrl)
        const chunkSize = Math.floor(fileSize / performanceScenarios.mediumFile.chunks)

        await this.simulateNetworkDelay()

        this.performanceMonitor.endTimer('download-stream-creation')

        return new ReadableStream({
            start: (controller) => {
                let bytesStreamed = 0
                let chunkCount = 0

                const streamChunk = async () => {
                    if (bytesStreamed >= fileSize) {
                        controller.close()
                        return
                    }

                    // Simulate packet loss
                    if (Math.random() < this.networkCondition.packetLoss) {
                        // Retry after delay
                        setTimeout(streamChunk, this.networkCondition.latency)
                        return
                    }

                    const currentChunkSize = Math.min(chunkSize, fileSize - bytesStreamed)
                    const chunk = new Uint8Array(currentChunkSize)

                    // Simulate bandwidth limitation
                    const chunkDelay = (currentChunkSize / this.networkCondition.bandwidth) * 1000

                    setTimeout(() => {
                        controller.enqueue(chunk)
                        bytesStreamed += currentChunkSize
                        chunkCount++

                        // Track streaming performance
                        this.performanceMonitor.addMetric('streaming', {
                            chunkNumber: chunkCount,
                            chunkSize: currentChunkSize,
                            totalStreamed: bytesStreamed,
                            timestamp: Date.now()
                        })

                        streamChunk()
                    }, Math.max(1, chunkDelay))
                }

                streamChunk()
            }
        })
    }

    private async simulateNetworkDelay(): Promise<void> {
        const delay = this.networkCondition.latency + (Math.random() * this.networkCondition.latency * 0.5)
        await new Promise(resolve => setTimeout(resolve, delay))
    }

    private getFileSizeFromUrl(url: string): number {
        if (url.includes('small')) return performanceScenarios.smallFile.size
        if (url.includes('large')) return performanceScenarios.largeFile.size
        return performanceScenarios.mediumFile.size
    }

    getRateLimitStatus() {
        return { isRateLimited: false, rateLimitInfo: null }
    }
}

// Performance-aware download manager mock
class PerformanceDownloadMock extends EventEmitter {
    private performanceMonitor: PerformanceMonitor
    private networkCondition = networkConditions.normal

    constructor(performanceMonitor: PerformanceMonitor) {
        super()
        this.performanceMonitor = performanceMonitor
    }

    setNetworkCondition(condition: keyof typeof networkConditions): void {
        this.networkCondition = networkConditions[condition]
    }

    async downloadFile(url: string, filePath: string): Promise<{ filePath: string; size: number }> {
        this.performanceMonitor.startTimer('download-total')

        const fileSize = this.getFileSizeFromUrl(url)
        const expectedBandwidth = this.networkCondition.bandwidth
        const chunkSize = Math.min(fileSize / 100, 1000000) // 100 chunks or 1MB max

        let bytesDownloaded = 0
        let lastProgressTime = Date.now()
        const progressInterval = 100 // Report progress every 100ms

        return new Promise((resolve, reject) => {
            const memoryBefore = this.performanceMonitor.getMemoryUsage()

            const downloadInterval = setInterval(() => {
                const now = Date.now()
                const timeDelta = now - lastProgressTime

                if (timeDelta >= progressInterval) {
                    const bytesToDownload = Math.min(
                        chunkSize,
                        (expectedBandwidth * timeDelta) / 1000,
                        fileSize - bytesDownloaded
                    )

                    bytesDownloaded += bytesToDownload
                    const percentage = (bytesDownloaded / fileSize) * 100

                    // Calculate current speed
                    const currentSpeed = bytesToDownload / (timeDelta / 1000)

                    // Track memory usage during download
                    const currentMemory = this.performanceMonitor.getMemoryUsage()
                    this.performanceMonitor.addMetric('memory-usage', {
                        heapUsed: currentMemory.heapUsed,
                        heapTotal: currentMemory.heapTotal,
                        external: currentMemory.external,
                        percentage,
                        timestamp: now
                    })

                    // Emit progress with performance data
                    this.emit('progress', {
                        url,
                        filePath,
                        bytesDownloaded,
                        totalBytes: fileSize,
                        percentage,
                        speed: currentSpeed,
                        estimatedTimeRemaining: (fileSize - bytesDownloaded) / currentSpeed,
                        memoryUsage: currentMemory.heapUsed
                    })

                    lastProgressTime = now
                }

                if (bytesDownloaded >= fileSize) {
                    clearInterval(downloadInterval)

                    const totalDuration = this.performanceMonitor.endTimer('download-total')
                    const memoryAfter = this.performanceMonitor.getMemoryUsage()

                    // Record final performance metrics
                    this.performanceMonitor.addMetric('download-complete', {
                        fileSize,
                        duration: totalDuration,
                        averageSpeed: fileSize / (totalDuration / 1000),
                        memoryDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
                        peakMemory: Math.max(memoryBefore.heapUsed, memoryAfter.heapUsed)
                    })

                    resolve({ filePath, size: fileSize })
                }
            }, 10) // Check every 10ms for smooth progress
        })
    }

    private getFileSizeFromUrl(url: string): number {
        if (url.includes('small')) return performanceScenarios.smallFile.size
        if (url.includes('large')) return performanceScenarios.largeFile.size
        return performanceScenarios.mediumFile.size
    }
}

// Concurrent operation manager for load testing
class ConcurrentOperationManager {
    private operations: Promise<any>[] = []
    private results: any[] = []
    private errors: any[] = []

    async runConcurrent<T>(
        operationFactory: () => Promise<T>,
        concurrency: number,
        totalOperations: number
    ): Promise<{ results: T[]; errors: any[]; duration: number }> {
        const startTime = performance.now()

        for (let i = 0; i < totalOperations; i++) {
            if (this.operations.length >= concurrency) {
                // Wait for one operation to complete before starting another
                await Promise.race(this.operations)
                this.operations = this.operations.filter(op => !this.isPromiseSettled(op))
            }

            const operation = operationFactory()
                .then(result => {
                    this.results.push(result)
                    return result
                })
                .catch(error => {
                    this.errors.push(error)
                    throw error
                })

            this.operations.push(operation)
        }

        // Wait for all remaining operations to complete
        await Promise.allSettled(this.operations)

        const duration = performance.now() - startTime

        return {
            results: [...this.results],
            errors: [...this.errors],
            duration
        }
    }

    private isPromiseSettled(promise: Promise<any>): boolean {
        // This is a simplified check - in practice, you'd track promise states
        return false
    }

    reset(): void {
        this.operations = []
        this.results = []
        this.errors = []
    }
}

describePerf('Performance and Load Testing', () => {
    let performanceMonitor: PerformanceMonitor
    let mockGitHub: PerformanceGitHubMock
    let mockDownload: PerformanceDownloadMock
    let concurrentManager: ConcurrentOperationManager

    beforeEach(() => {
        performanceMonitor = new PerformanceMonitor()
        mockGitHub = new PerformanceGitHubMock(performanceMonitor)
        mockDownload = new PerformanceDownloadMock(performanceMonitor)
        concurrentManager = new ConcurrentOperationManager()
    })

    afterEach(() => {
        performanceMonitor.reset()
        concurrentManager.reset()
        vi.restoreAllMocks()
    })

    describe('Network Condition Performance Tests', () => {
        it('should perform efficiently under fast network conditions', async () => {
            // **Feature: github-auto-updater, Performance Test 1: Fast network performance**

            mockGitHub.setNetworkCondition('fast')
            mockDownload.setNetworkCondition('fast')

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            // Test API request performance
            performanceMonitor.startTimer('full-check-cycle')

            await updateAgent.initialize()
            const updateInfo = await updateAgent.checkForUpdates()

            const checkDuration = performanceMonitor.endTimer('full-check-cycle')

            // Under fast network, check should complete quickly
            expect(checkDuration).toBeLessThan(1000) // Less than 1 second
            expect(updateInfo).toBeDefined()

            // Test download performance
            if (updateInfo) {
                performanceMonitor.startTimer('fast-download')
                const filePath = await updateAgent.downloadUpdate(updateInfo)
                const downloadDuration = performanceMonitor.endTimer('fast-download')

                expect(filePath).toBeDefined()
                expect(downloadDuration).toBeLessThan(performanceScenarios.mediumFile.expectedDownloadTime / 2)
            }

            // Verify API request metrics
            const apiMetrics = performanceMonitor.getMetrics('api-request')
            expect(apiMetrics.length).toBeGreaterThan(0)
            expect(performanceMonitor.getAverageMetric('api-request', 'duration')).toBeLessThan(100)
        })

        it('should handle slow network conditions gracefully', async () => {
            // **Feature: github-auto-updater, Performance Test 2: Slow network resilience**

            mockGitHub.setNetworkCondition('slow')
            mockDownload.setNetworkCondition('slow')

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            performanceMonitor.startTimer('slow-network-check')

            await updateAgent.initialize()
            const updateInfo = await updateAgent.checkForUpdates()

            const checkDuration = performanceMonitor.endTimer('slow-network-check')

            // Should still complete but take longer
            expect(checkDuration).toBeGreaterThan(200) // At least 200ms due to latency
            expect(checkDuration).toBeLessThan(5000) // But not more than 5 seconds
            expect(updateInfo).toBeDefined()

            // Test download under slow conditions
            if (updateInfo) {
                const progressEvents: any[] = []

                mockDownload.on('progress', (progress) => {
                    progressEvents.push({
                        percentage: progress.percentage,
                        speed: progress.speed,
                        memoryUsage: progress.memoryUsage,
                        timestamp: Date.now()
                    })
                })

                performanceMonitor.startTimer('slow-download')
                const filePath = await updateAgent.downloadUpdate(updateInfo)
                const downloadDuration = performanceMonitor.endTimer('slow-download')

                expect(filePath).toBeDefined()
                expect(progressEvents.length).toBeGreaterThan(10) // Should have many progress updates

                // Verify speed is consistently low but not zero
                const speeds = progressEvents.map(e => e.speed).filter(s => s > 0)
                const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length
                expect(avgSpeed).toBeLessThan(networkConditions.slow.bandwidth * 1.5) // Within expected range
                expect(avgSpeed).toBeGreaterThan(0)
            }
        })

        it('should adapt to mobile network conditions', async () => {
            // **Feature: github-auto-updater, Performance Test 3: Mobile network adaptation**

            mockGitHub.setNetworkCondition('mobile')
            mockDownload.setNetworkCondition('mobile')

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            const memoryBefore = performanceMonitor.getMemoryUsage()

            await updateAgent.initialize()
            const updateInfo = await updateAgent.checkForUpdates()

            if (updateInfo) {
                const filePath = await updateAgent.downloadUpdate(updateInfo)
                expect(filePath).toBeDefined()

                // Verify memory usage remains reasonable under mobile conditions
                const memoryMetrics = performanceMonitor.getMetrics('memory-usage')
                expect(memoryMetrics.length).toBeGreaterThan(0)

                const peakMemory = Math.max(...memoryMetrics.map(m => m.heapUsed))
                const memoryIncrease = peakMemory - memoryBefore.heapUsed

                // Memory increase should be reasonable (less than 100MB for 50MB file)
                expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024)
            }
        })
    })

    describe('File Size Performance Tests', () => {
        it('should handle small files efficiently', async () => {
            // **Feature: github-auto-updater, Performance Test 4: Small file efficiency**

            // Mock small file scenario
            const originalGetFileSizeFromUrl = (mockDownload as any).getFileSizeFromUrl
                ; (mockDownload as any).getFileSizeFromUrl = () => performanceScenarios.smallFile.size

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            await updateAgent.initialize()
            const updateInfo = await updateAgent.checkForUpdates()

            if (updateInfo) {
                performanceMonitor.startTimer('small-file-download')
                const filePath = await updateAgent.downloadUpdate(updateInfo)
                const duration = performanceMonitor.endTimer('small-file-download')

                expect(filePath).toBeDefined()
                expect(duration).toBeLessThan(performanceScenarios.smallFile.expectedDownloadTime)

                // Small files should have minimal memory overhead
                const downloadMetrics = performanceMonitor.getMetrics('download-complete')
                expect(downloadMetrics.length).toBe(1)
                expect(downloadMetrics[0].memoryDelta).toBeLessThan(10 * 1024 * 1024) // Less than 10MB overhead
            }

            // Restore original method
            ; (mockDownload as any).getFileSizeFromUrl = originalGetFileSizeFromUrl
        })

        it('should handle large files without memory issues', async () => {
            // **Feature: github-auto-updater, Performance Test 5: Large file memory management**

            // Mock large file scenario
            const originalGetFileSizeFromUrl = (mockDownload as any).getFileSizeFromUrl
                ; (mockDownload as any).getFileSizeFromUrl = () => performanceScenarios.largeFile.size

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            await updateAgent.initialize()
            const updateInfo = await updateAgent.checkForUpdates()

            if (updateInfo) {
                const memoryBefore = performanceMonitor.getMemoryUsage()

                performanceMonitor.startTimer('large-file-download')
                const filePath = await updateAgent.downloadUpdate(updateInfo)
                const duration = performanceMonitor.endTimer('large-file-download')

                expect(filePath).toBeDefined()
                expect(duration).toBeLessThan(performanceScenarios.largeFile.expectedDownloadTime)

                // Verify memory usage didn't grow excessively
                const memoryMetrics = performanceMonitor.getMetrics('memory-usage')
                const peakMemory = Math.max(...memoryMetrics.map(m => m.heapUsed))
                const memoryIncrease = peakMemory - memoryBefore.heapUsed

                // Memory increase should be proportional to file size but not excessive
                // For a 200MB file, we shouldn't use more than 50MB additional memory
                expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024)

                // Verify streaming was used (many small chunks)
                const streamingMetrics = performanceMonitor.getMetrics('streaming')
                expect(streamingMetrics.length).toBeGreaterThan(100) // Should have many chunks
            }

            // Restore original method
            ; (mockDownload as any).getFileSizeFromUrl = originalGetFileSizeFromUrl
        })
    })

    describe('Concurrent Operations Load Tests', () => {
        it('should handle multiple concurrent update checks', async () => {
            // **Feature: github-auto-updater, Performance Test 6: Concurrent update checks**

            const concurrency = 5
            const totalOperations = 20

            const operationFactory = async () => {
                const updateAgent = new UpdateAgentImpl({
                    owner: 'test',
                    repo: 'dbconsole'
                })

                    ; (updateAgent as any).githubClient = mockGitHub
                    ; (updateAgent as any).downloadManager = mockDownload

                await updateAgent.initialize()
                return updateAgent.checkForUpdates()
            }

            const result = await concurrentManager.runConcurrent(
                operationFactory,
                concurrency,
                totalOperations
            )

            // All operations should succeed
            expect(result.results.length).toBe(totalOperations)
            expect(result.errors.length).toBe(0)

            // Should complete in reasonable time despite concurrency
            expect(result.duration).toBeLessThan(30000) // 30 seconds max

            // Verify all results are valid
            result.results.forEach(updateInfo => {
                expect(updateInfo).toBeDefined()
                if (updateInfo) {
                    expect(updateInfo.version).toBeDefined()
                    expect(updateInfo.downloadUrl).toBeDefined()
                }
            })
        })

        it('should handle concurrent downloads efficiently', async () => {
            // **Feature: github-auto-updater, Performance Test 7: Concurrent downloads**

            const concurrency = 3
            const totalDownloads = 9

            // Pre-create update info for downloads
            const mockUpdateInfo = {
                version: 'v2.0.0',
                releaseNotes: 'Test release',
                downloadUrl: 'https://api.github.com/test/asset/1',
                checksum: 'abc123',
                publishedAt: new Date(),
                isPrerelease: false
            }

            const operationFactory = async () => {
                const updateAgent = new UpdateAgentImpl({
                    owner: 'test',
                    repo: 'dbconsole'
                })

                    ; (updateAgent as any).githubClient = mockGitHub
                    ; (updateAgent as any).downloadManager = mockDownload

                await updateAgent.initialize()
                return updateAgent.downloadUpdate(mockUpdateInfo)
            }

            const memoryBefore = performanceMonitor.getMemoryUsage()

            const result = await concurrentManager.runConcurrent(
                operationFactory,
                concurrency,
                totalDownloads
            )

            const memoryAfter = performanceMonitor.getMemoryUsage()

            // Most downloads should succeed (some may fail due to simulated network issues)
            expect(result.results.length).toBeGreaterThan(totalDownloads * 0.7) // At least 70% success

            // Memory usage should remain reasonable even with concurrent downloads
            const memoryIncrease = memoryAfter.heapUsed - memoryBefore.heapUsed
            expect(memoryIncrease).toBeLessThan(200 * 1024 * 1024) // Less than 200MB increase

            // Verify download performance metrics
            const downloadMetrics = performanceMonitor.getMetrics('download-complete')
            expect(downloadMetrics.length).toBeGreaterThan(0)

            const avgDuration = performanceMonitor.getAverageMetric('download-complete', 'duration')
            expect(avgDuration).toBeLessThan(60000) // Average less than 1 minute per download
        })

        it('should maintain performance under sustained load', async () => {
            // **Feature: github-auto-updater, Performance Test 8: Sustained load performance**

            const testDuration = 10000 // 10 seconds
            const operationInterval = 500 // New operation every 500ms
            const maxConcurrency = 10

            const operations: Promise<any>[] = []
            const results: any[] = []
            const startTime = Date.now()

            const createOperation = async () => {
                const updateAgent = new UpdateAgentImpl({
                    owner: 'test',
                    repo: 'dbconsole'
                })

                    ; (updateAgent as any).githubClient = mockGitHub
                    ; (updateAgent as any).downloadManager = mockDownload

                await updateAgent.initialize()
                return updateAgent.checkForUpdates()
            }

            // Start sustained load test
            const loadTestInterval = setInterval(async () => {
                if (Date.now() - startTime >= testDuration) {
                    clearInterval(loadTestInterval)
                    return
                }

                // Limit concurrency
                if (operations.length >= maxConcurrency) {
                    return
                }

                const operation = createOperation()
                    .then(result => {
                        results.push({ success: true, result, timestamp: Date.now() })
                        return result
                    })
                    .catch(error => {
                        results.push({ success: false, error, timestamp: Date.now() })
                        return null
                    })

                operations.push(operation)
            }, operationInterval)

            // Wait for test duration plus some buffer for operations to complete
            await new Promise(resolve => setTimeout(resolve, testDuration + 5000))

            // Wait for all operations to complete
            await Promise.allSettled(operations)

            // Analyze results
            const successfulOperations = results.filter(r => r.success)
            const failedOperations = results.filter(r => !r.success)

            // Should maintain reasonable success rate under load
            const successRate = successfulOperations.length / results.length
            expect(successRate).toBeGreaterThan(0.8) // At least 80% success rate

            // Should handle a reasonable number of operations
            expect(results.length).toBeGreaterThan(10) // At least 10 operations in 10 seconds

            // Performance should not degrade significantly over time
            const firstHalf = results.slice(0, Math.floor(results.length / 2))
            const secondHalf = results.slice(Math.floor(results.length / 2))

            const firstHalfSuccessRate = firstHalf.filter(r => r.success).length / firstHalf.length
            const secondHalfSuccessRate = secondHalf.filter(r => r.success).length / secondHalf.length

            // Success rate shouldn't degrade by more than 20%
            expect(secondHalfSuccessRate).toBeGreaterThan(firstHalfSuccessRate * 0.8)
        })
    })

    describe('Memory Usage and Resource Management', () => {
        it('should maintain stable memory usage during extended operations', async () => {
            // **Feature: github-auto-updater, Performance Test 9: Memory stability**

            const iterations = 50
            const memoryReadings: number[] = []

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            await updateAgent.initialize()

            // Perform many update checks to test for memory leaks
            for (let i = 0; i < iterations; i++) {
                await updateAgent.checkForUpdates()

                // Force garbage collection if available
                if (global.gc) {
                    global.gc()
                }

                const memoryUsage = process.memoryUsage()
                memoryReadings.push(memoryUsage.heapUsed)

                // Small delay between operations
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            // Analyze memory trend
            const firstQuarter = memoryReadings.slice(0, Math.floor(iterations / 4))
            const lastQuarter = memoryReadings.slice(-Math.floor(iterations / 4))

            const avgFirst = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length
            const avgLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length

            // Memory usage shouldn't grow significantly (less than 50% increase)
            const memoryGrowth = (avgLast - avgFirst) / avgFirst
            expect(memoryGrowth).toBeLessThan(0.5)

            // Peak memory shouldn't be excessive
            const peakMemory = Math.max(...memoryReadings)
            expect(peakMemory).toBeLessThan(500 * 1024 * 1024) // Less than 500MB peak
        })

        it('should clean up resources properly after operations', async () => {
            // **Feature: github-auto-updater, Performance Test 10: Resource cleanup**

            const updateAgent = new UpdateAgentImpl({
                owner: 'test',
                repo: 'dbconsole'
            })

                ; (updateAgent as any).githubClient = mockGitHub
                ; (updateAgent as any).downloadManager = mockDownload

            const memoryBefore = process.memoryUsage()

            await updateAgent.initialize()

            // Perform update operations
            const updateInfo = await updateAgent.checkForUpdates()
            if (updateInfo) {
                await updateAgent.downloadUpdate(updateInfo)
            }

            // Stop background processes
            updateAgent.stopBackgroundChecker()

            // Force cleanup
            if (global.gc) {
                global.gc()
            }

            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000))

            const memoryAfter = process.memoryUsage()

            // Memory should return close to baseline after cleanup
            const memoryIncrease = memoryAfter.heapUsed - memoryBefore.heapUsed
            expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024) // Less than 50MB permanent increase
        })
    })
})