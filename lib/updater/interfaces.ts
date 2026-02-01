/**
 * Core interfaces for the GitHub Auto-Updater system components
 */

import {
    UpdateInfo,
    UpdateRecord,
    UpdateSettings,
    GitHubRelease,
    GitHubAsset,
    ReleaseOptions,
    SecurityVerification
} from './types'

import { DownloadProgress, DownloadOptions, DownloadResult } from './download-manager'
import { VerificationResult, VerificationOptions } from './file-integrity'

/**
 * Core service responsible for communicating with GitHub API and managing update lifecycle
 */
export interface UpdateAgent {
    checkForUpdates(): Promise<UpdateInfo | null>
    downloadUpdate(updateInfo: UpdateInfo): Promise<string>
    verifyUpdate(filePath: string, expectedHash: string): Promise<boolean>
    installUpdate(filePath: string): Promise<void>
}

/**
 * Handles authentication and API communication with private repositories
 */
export interface GitHubClient {
    authenticate(token: string): void
    getLatestRelease(owner: string, repo: string): Promise<GitHubRelease>
    getReleases(owner: string, repo: string, options?: ReleaseOptions): Promise<GitHubRelease[]>
    downloadAsset(assetUrl: string): Promise<ReadableStream>
}

/**
 * Orchestrates the update process and manages user interactions
 */
export interface UpdateController {
    initialize(): Promise<void>
    startBackgroundChecker(): void
    stopBackgroundChecker(): void
    checkNow(): Promise<UpdateInfo | null>
    downloadAndInstall(updateInfo: UpdateInfo): Promise<void>
    getUpdateHistory(): Promise<UpdateRecord[]>
    getReleaseNotes(version: string): Promise<string>
    getFormattedReleaseInfo(version: string): Promise<{
        version: string
        releaseNotes: string
        publishedAt?: Date | null
        isPrerelease?: boolean
        downloadUrl?: string
    }>
    displayReleaseNotes(version: string, format?: 'markdown' | 'plain' | 'html'): Promise<string>
}

/**
 * Manages updater settings and secure credential storage
 */
export interface ConfigService {
    getGitHubToken(): Promise<string | null>
    setGitHubToken(token: string): Promise<void>
    getUpdateSettings(): Promise<UpdateSettings>
    setUpdateSettings(settings: UpdateSettings): Promise<void>
}

/**
 * Handles file downloads with progress tracking and resumption support
 */
export interface DownloadManager {
    downloadFile(url: string, destinationPath: string, options?: DownloadOptions): Promise<DownloadResult>
    cancelDownload(url: string, destinationPath: string): boolean
    cancelAllDownloads(): void
    getActiveDownloads(): string[]
    isDownloadActive(url: string, destinationPath: string): boolean
    cleanupPartialDownload(filePath: string): Promise<void>

    // Event emitter methods
    on(event: 'progress', listener: (progress: DownloadProgress) => void): this
    on(event: 'cancelled', listener: (info: { url: string; destinationPath: string }) => void): this
    on(event: 'allCancelled', listener: (info: { count: number }) => void): this
    emit(event: string, ...args: any[]): boolean
}

/**
 * Handles file integrity verification including checksums and digital signatures
 */
export interface FileIntegrityVerifier {
    verifyFile(filePath: string, verification: SecurityVerification, options?: VerificationOptions): Promise<VerificationResult>
    verifyChecksum(filePath: string, verification: SecurityVerification): Promise<VerificationResult>
    calculateFileChecksum(filePath: string, algorithm: string): Promise<string>
}
