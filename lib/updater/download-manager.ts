/**
 * Download Manager with progress tracking and resumable downloads
 * Handles file downloads with progress events, resumption, and cancellation
 */

import { createWriteStream, createReadStream, existsSync, statSync, unlinkSync } from 'fs'
import { mkdir, access, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { EventEmitter } from 'events'
import { NetworkResilience } from './network-resilience'

export interface DownloadProgress {
    bytesDownloaded: number
    totalBytes: number
    percentage: number
    speed: number // bytes per second
    estimatedTimeRemaining: number // seconds
    startTime: Date
    elapsedTime: number // seconds
}

export interface DownloadOptions {
    resumable?: boolean
    timeout?: number
    maxRetries?: number
    chunkSize?: number
    tempDir?: string
    /**
     * Optional request headers (e.g. Authorization for private GitHub assets).
     * These will be merged with any internal headers (like Range).
     */
    headers?: Record<string, string>
}

export interface DownloadResult {
    filePath: string
    totalBytes: number
    downloadTime: number
    averageSpeed: number
    resumed: boolean
}

export class DownloadManager extends EventEmitter {
    private readonly networkResilience: NetworkResilience
    private readonly defaultOptions: Required<DownloadOptions>
    private activeDownloads = new Map<string, AbortController>()

    constructor(options: Partial<DownloadOptions> = {}) {
        super()
        this.networkResilience = new NetworkResilience()
        this.defaultOptions = {
            resumable: true,
            timeout: 300000, // 5 minutes
            maxRetries: 3,
            chunkSize: 1024 * 1024, // 1MB chunks
            tempDir: process.env.TMPDIR || process.env.TEMP || '/tmp',
            ...options,
            // Ensure headers is never undefined even after spreading.
            headers: options.headers ?? {}
        }
    }

    /**
     * Download a file with progress tracking and resumption support
     */
    async downloadFile(
        url: string,
        destinationPath: string,
        options: DownloadOptions = {}
    ): Promise<DownloadResult> {
        const mergedOptions = { ...this.defaultOptions, ...options }
        const downloadId = this.generateDownloadId(url, destinationPath)

        this.log(`Starting download: ${url} -> ${destinationPath}`)

        // Ensure destination directory exists
        await this.ensureDirectoryExists(dirname(destinationPath))

        // Check for existing partial download
        const { existingBytes, canResume } = await this.checkExistingFile(
            destinationPath,
            mergedOptions.resumable
        )

        const startTime = new Date()
        let bytesDownloaded = existingBytes
        let totalBytes = 0
        let lastProgressTime = Date.now()
        let lastBytesDownloaded = bytesDownloaded
        let didRestartFromScratch = false

        try {
            // Create abort controller for cancellation
            const abortController = new AbortController()
            this.activeDownloads.set(downloadId, abortController)

            const result = await this.networkResilience.withRetry(async () => {
                // Re-check existing bytes inside retries so we can recover from bad partials.
                let currentExistingBytes = 0
                try {
                    currentExistingBytes = existsSync(destinationPath) ? statSync(destinationPath).size : 0
                } catch {
                    currentExistingBytes = 0
                }

                const headers: Record<string, string> = { ...(mergedOptions.headers || {}) }

                // Add range header for resumable downloads
                if (canResume && currentExistingBytes > 0 && !didRestartFromScratch) {
                    headers['Range'] = `bytes=${currentExistingBytes}-`
                    this.log(`Resuming download from byte ${currentExistingBytes}`)
                }

                let response = await fetch(url, {
                    headers,
                    signal: abortController.signal
                })

                // If we attempted a range request and the server says it's not satisfiable (416),
                // the local partial file is inconsistent with the remote. Remove it and restart once.
                if (response.status === 416 && (headers['Range'] || headers['range']) && !didRestartFromScratch) {
                    this.log('Received 416 Range Not Satisfiable; restarting download from scratch')
                    try {
                        if (existsSync(destinationPath)) {
                            unlinkSync(destinationPath)
                        }
                    } catch {
                        // ignore
                    }
                    didRestartFromScratch = true
                    bytesDownloaded = 0

                    const retryHeaders: Record<string, string> = { ...(mergedOptions.headers || {}) }
                    response = await fetch(url, {
                        headers: retryHeaders,
                        signal: abortController.signal
                    })
                }

                if (!response.ok) {
                    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
                }

                // Get total file size
                const contentLength = response.headers.get('content-length')
                const contentRange = response.headers.get('content-range')

                if (contentRange) {
                    // Parse range response: "bytes 200-1023/1024"
                    const match = contentRange.match(/bytes \d+-\d+\/(\d+)/)
                    totalBytes = match ? parseInt(match[1]) : 0
                } else if (contentLength) {
                    totalBytes = parseInt(contentLength) + existingBytes
                } else {
                    this.log('Warning: Unable to determine total file size')
                    totalBytes = 0
                }

                // Check if server supports resumable downloads
                const acceptsRanges = response.headers.get('accept-ranges') === 'bytes'
                if (currentExistingBytes > 0 && !acceptsRanges && response.status !== 206) {
                    this.log('Server does not support range requests, starting fresh download')
                    bytesDownloaded = 0
                    // Remove existing file and start over
                    if (existsSync(destinationPath)) {
                        unlinkSync(destinationPath)
                    }
                }

                if (!response.body) {
                    throw new Error('No response body received')
                }

                // Create write stream (append mode for resumable downloads)
                const writeStream = createWriteStream(destinationPath, {
                    flags: currentExistingBytes > 0 && !didRestartFromScratch ? 'a' : 'w'
                })

                // Set up progress tracking
                const reader = response.body.getReader()
                const progressInterval = setInterval(() => {
                    this.emitProgress(
                        bytesDownloaded,
                        totalBytes,
                        startTime,
                        lastProgressTime,
                        lastBytesDownloaded
                    )
                    lastProgressTime = Date.now()
                    lastBytesDownloaded = bytesDownloaded
                }, 1000) // Update progress every second

                try {
                    // Read and write chunks
                    while (true) {
                        const { done, value } = await reader.read()

                        if (done) break

                        if (abortController.signal.aborted) {
                            throw new Error('Download cancelled')
                        }

                        // Write chunk to file
                        await new Promise<void>((resolve, reject) => {
                            writeStream.write(value, (error?: Error | null) => {
                                if (error) reject(error)
                                else resolve()
                            })
                        })

                        bytesDownloaded += value.length

                        // Emit progress for large chunks
                        if (value.length >= mergedOptions.chunkSize) {
                            this.emitProgress(
                                bytesDownloaded,
                                totalBytes,
                                startTime,
                                lastProgressTime,
                                lastBytesDownloaded
                            )
                        }
                    }

                    // Close write stream (end callback has no error arg; use events)
                    await new Promise<void>((resolve, reject) => {
                        writeStream.once('finish', resolve)
                        writeStream.once('error', reject)
                        writeStream.end()
                    })

                    clearInterval(progressInterval)

                    // Final progress update
                    this.emitProgress(
                        bytesDownloaded,
                        totalBytes,
                        startTime,
                        Date.now(),
                        lastBytesDownloaded
                    )

                    const endTime = new Date()
                    const downloadTime = (endTime.getTime() - startTime.getTime()) / 1000
                    const averageSpeed = bytesDownloaded / downloadTime

                    this.log(`Download completed: ${bytesDownloaded} bytes in ${downloadTime.toFixed(2)}s`)

                    return {
                        filePath: destinationPath,
                        totalBytes: bytesDownloaded,
                        downloadTime,
                        averageSpeed,
                        resumed: existingBytes > 0
                    }

                } finally {
                    clearInterval(progressInterval)
                    writeStream.destroy()
                }

            }, { maxRetries: mergedOptions.maxRetries })

            return result

        } finally {
            this.activeDownloads.delete(downloadId)
        }
    }

    /**
     * Cancel an active download
     */
    cancelDownload(url: string, destinationPath: string): boolean {
        const downloadId = this.generateDownloadId(url, destinationPath)
        const controller = this.activeDownloads.get(downloadId)

        if (controller) {
            controller.abort()
            this.activeDownloads.delete(downloadId)
            this.log(`Download cancelled: ${downloadId}`)
            this.emit('cancelled', { url, destinationPath })
            return true
        }

        return false
    }

    /**
     * Cancel all active downloads
     */
    cancelAllDownloads(): void {
        const activeCount = this.activeDownloads.size

        for (const [downloadId, controller] of this.activeDownloads) {
            controller.abort()
            this.log(`Download cancelled: ${downloadId}`)
        }

        this.activeDownloads.clear()
        this.log(`Cancelled ${activeCount} active downloads`)
        this.emit('allCancelled', { count: activeCount })
    }

    /**
     * Get list of active downloads
     */
    getActiveDownloads(): string[] {
        return Array.from(this.activeDownloads.keys())
    }

    /**
     * Check if a download is currently active
     */
    isDownloadActive(url: string, destinationPath: string): boolean {
        const downloadId = this.generateDownloadId(url, destinationPath)
        return this.activeDownloads.has(downloadId)
    }

    /**
     * Clean up partial downloads (remove incomplete files)
     */
    async cleanupPartialDownload(filePath: string): Promise<void> {
        try {
            if (existsSync(filePath)) {
                unlinkSync(filePath)
                this.log(`Cleaned up partial download: ${filePath}`)
            }
        } catch (error) {
            this.log(`Error cleaning up partial download: ${error}`)
        }
    }

    /**
     * Check for existing file and determine if resumption is possible
     */
    private async checkExistingFile(
        filePath: string,
        resumable: boolean
    ): Promise<{ existingBytes: number; canResume: boolean }> {
        if (!resumable || !existsSync(filePath)) {
            return { existingBytes: 0, canResume: false }
        }

        try {
            const stats = statSync(filePath)
            const existingBytes = stats.size

            if (existingBytes > 0) {
                this.log(`Found existing file with ${existingBytes} bytes`)
                return { existingBytes, canResume: true }
            }
        } catch (error) {
            this.log(`Error checking existing file: ${error}`)
        }

        return { existingBytes: 0, canResume: false }
    }

    /**
     * Ensure directory exists for the destination path
     */
    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await access(dirPath)
        } catch {
            await mkdir(dirPath, { recursive: true })
            this.log(`Created directory: ${dirPath}`)
        }
    }

    /**
     * Generate a unique download ID
     */
    private generateDownloadId(url: string, destinationPath: string): string {
        return `${url}:${destinationPath}`
    }

    /**
     * Emit progress event with calculated metrics
     */
    private emitProgress(
        bytesDownloaded: number,
        totalBytes: number,
        startTime: Date,
        lastProgressTime: number,
        lastBytesDownloaded: number
    ): void {
        const now = Date.now()
        const elapsedTime = (now - startTime.getTime()) / 1000
        const timeSinceLastUpdate = (now - lastProgressTime) / 1000
        const bytesSinceLastUpdate = bytesDownloaded - lastBytesDownloaded

        // Calculate current speed (bytes per second)
        const speed = timeSinceLastUpdate > 0 ? bytesSinceLastUpdate / timeSinceLastUpdate : 0

        // Calculate percentage
        const percentage = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0

        // Estimate time remaining
        const remainingBytes = totalBytes - bytesDownloaded
        const estimatedTimeRemaining = speed > 0 ? remainingBytes / speed : 0

        const progress: DownloadProgress = {
            bytesDownloaded,
            totalBytes,
            percentage: Math.min(percentage, 100),
            speed,
            estimatedTimeRemaining,
            startTime,
            elapsedTime
        }

        this.emit('progress', progress)
    }

    /**
     * Log debug information
     */
    private log(message: string): void {
        console.debug(`[DownloadManager] ${message}`)
    }
}

/**
 * Utility function to format bytes for display
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Utility function to format time duration
 */
export function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = Math.round(seconds % 60)
        return `${minutes}m ${remainingSeconds}s`
    } else {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        return `${hours}h ${minutes}m`
    }
}