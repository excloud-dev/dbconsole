/**
 * UpdateAgent - Core service for managing update lifecycle
 * Coordinates update checking, downloading, and installation processes
 */

import { EventEmitter } from 'events'
import { join } from 'path'
import { app } from 'electron'
import { UpdateAgent } from './interfaces'
import { UpdateInfo, UpdateRecord, Platform, Architecture } from './types'
import { GitHubClientImpl } from './github-client'
import { ConfigServiceImpl } from './config-service'
import { DownloadManager, DownloadProgress } from './download-manager'
import { FileIntegrityVerifier, VerificationResult } from './file-integrity'
import { VersionUtils } from './version-utils'
import { DesktopInstaller, InstallationResult } from './desktop-installer'
import { NetworkResilience } from './network-resilience'

export interface UpdateAgentOptions {
    owner: string
    repo: string
    platform?: Platform
    arch?: Architecture
    tempDir?: string
    autoCheck?: boolean
    checkInterval?: number // hours
    /**
     * Optional injected config service (useful to share a single instance across controllers)
     */
    configService?: ConfigServiceImpl
}

export interface UpdateState {
    status: 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'error'
    currentVersion: string
    availableUpdate?: UpdateInfo
    progress?: DownloadProgress
    error?: string
    lastCheck?: Date
}

/**
 * Core UpdateAgent implementation
 */
export class UpdateAgentImpl extends EventEmitter implements UpdateAgent {
    private readonly githubClient: GitHubClientImpl
    private readonly configService: ConfigServiceImpl
    private readonly downloadManager: DownloadManager
    private readonly fileVerifier: FileIntegrityVerifier
    private readonly versionUtils: VersionUtils
    private readonly desktopInstaller: DesktopInstaller
    private readonly networkResilience: NetworkResilience

    private readonly options: Required<Omit<UpdateAgentOptions, 'configService'>>
    private state: UpdateState
    private backgroundCheckTimer?: NodeJS.Timeout
    private isInitialized = false
    private downloadManagerEventsBoundTo?: unknown

    constructor(options: UpdateAgentOptions) {
        super()

        // Validate required options
        if (!options.owner?.trim() || !options.repo?.trim()) {
            throw new Error('GitHub owner and repo are required')
        }

        this.options = {
            owner: options.owner,
            repo: options.repo,
            platform: options.platform || this.detectPlatform(),
            arch: options.arch || this.detectArchitecture(),
            tempDir: options.tempDir || join(app.getPath('temp'), 'dbconsole-updates'),
            autoCheck: options.autoCheck ?? false,
            checkInterval: options.checkInterval ?? 24
        }

        // Initialize services
        this.githubClient = new GitHubClientImpl()
        this.configService = options.configService ?? new ConfigServiceImpl()
        this.downloadManager = new DownloadManager({
            tempDir: this.options.tempDir
        })
        this.fileVerifier = new FileIntegrityVerifier()
        this.versionUtils = new VersionUtils()
        this.desktopInstaller = new DesktopInstaller({
            platform: this.options.platform,
            arch: this.options.arch,
            tempDir: this.options.tempDir
        })
        this.networkResilience = new NetworkResilience()

        // Initialize state
        this.state = {
            status: 'idle',
            currentVersion: this.getCurrentVersion()
        }

        // Set up event listeners
        this.setupEventListeners()

        // Safety net: emitting EventEmitter 'error' without listeners throws.
        // Ensure updater errors don't crash the process when callers don't attach a listener.
        this.on('error', (info) => {
            this.log('Unhandled UpdateAgent error event', 'error', info)
        })

        this.log('UpdateAgent initialized')
    }

    /**
     * Initialize the UpdateAgent
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        try {
            this.log('Initializing UpdateAgent...')

            // Initialize configuration service
            await this.configService.initialize()

            // Configure authentication if token is available (but don't assume client supports it)
            await this.configureAuthentication()

            // Start background checking if enabled
            if (this.options.autoCheck) {
                await this.startBackgroundChecker()
            }

            this.isInitialized = true
            this.emit('initialized')
            this.log('UpdateAgent initialization complete')

        } catch (error) {
            const errorMessage = `UpdateAgent initialization failed: ${error}`
            this.handleError('UpdateAgent initialization', error, 'initialization')
            this.setState({ status: 'error', error: errorMessage })
            throw error
        }
    }

    /**
     * Check for available updates
     */
    async checkForUpdates(): Promise<UpdateInfo | null> {
        if (!this.isInitialized) {
            await this.initialize()
        }

        this.log('Checking for updates...')
        this.setState({ status: 'checking', lastCheck: new Date() })

        try {
            // Ensure auth is configured (mocks may throw here for invalid tokens)
            await this.configureAuthentication()

            // Get update settings to determine channel
            const settings = await this.configService.getUpdateSettings()

            // Check if auto-check is allowed by policy
            const autoCheckAllowed = await this.configService.isAutoCheckAllowed()
            if (!autoCheckAllowed) {
                this.log('Automatic update checks are disabled by policy')
                this.setState({ status: 'idle' })
                return null
            }

            // Get releases based on configured channel
            const releases = await this.withNetworkRetry(async () => {
                const byChannel = (this.githubClient as any).getReleasesByChannel
                if (typeof byChannel === 'function') {
                    return await byChannel.call(
                        this.githubClient,
                        this.options.owner,
                        this.options.repo,
                        settings.updateChannel,
                        settings.customTagPattern
                    )
                }

                // Fallback for minimal mocks: use getReleases and filter locally
                const includePrerelease = settings.updateChannel === 'prerelease'
                const releases = await this.githubClient.getReleases(this.options.owner, this.options.repo, {
                    includePrerelease
                } as any)
                if (settings.updateChannel === 'custom' && settings.customTagPattern) {
                    const rx = new RegExp(settings.customTagPattern)
                    return releases.filter(r => rx.test(r.tagName))
                }
                return includePrerelease ? releases : releases.filter(r => !r.prerelease)
            }, 3)

            if (releases.length === 0) {
                this.log('No releases found for the configured channel')
                this.setState({ status: 'idle' })
                return null
            }

            // Find the latest version that's newer than current
            const latestRelease = releases[0] // Releases are sorted by date
            const isNewer = this.versionUtils.isNewerVersion(
                latestRelease.tagName,
                this.state.currentVersion
            )

            if (!isNewer) {
                this.log(`Current version ${this.state.currentVersion} is up to date`)
                this.setState({ status: 'idle' })
                return null
            }

            // Find the best asset for current platform
            const bestAssetFn = (this.githubClient as any).getBestAssetForPlatform
            const asset = typeof bestAssetFn === 'function'
                ? bestAssetFn.call(this.githubClient, latestRelease, this.options.platform, this.options.arch)
                : null

            if (!asset) {
                this.log(`No compatible asset found for ${this.options.platform}-${this.options.arch}`)
                this.setState({ status: 'idle' })
                return null
            }

            // Create UpdateInfo
            const updateInfo: UpdateInfo = {
                version: latestRelease.tagName,
                releaseNotes: latestRelease.body,
                downloadUrl: asset.downloadUrl,
                assetName: asset.name,
                checksum: '', // Will be populated from release notes or manifest
                publishedAt: new Date(latestRelease.publishedAt),
                isPrerelease: latestRelease.prerelease
            }

            // Try to extract checksum from release notes
            updateInfo.checksum = this.extractChecksumFromReleaseNotes(
                latestRelease.body,
                asset.name
            )

            this.log(`Update available: ${updateInfo.version}`)
            this.setState({
                status: 'idle',
                availableUpdate: updateInfo
            })

            this.emit('update-available', updateInfo)
            return updateInfo

        } catch (error) {
            const errorMessage = `Update check failed: ${error}`
            this.handleError('Update check', error, this.classifyError(error))
            this.setState({ status: 'error', error: errorMessage })
            throw error
        }
    }

    /**
     * Download an update
     */
    async downloadUpdate(updateInfo: UpdateInfo): Promise<string> {
        this.log(`Starting download for version ${updateInfo.version}`)
        this.setState({ status: 'downloading' })

        try {
            // Tests sometimes swap the download manager instance via `(agent as any).downloadManager = ...`.
            // Ensure progress listeners stay bound to whichever instance is currently assigned.
            this.bindDownloadManagerEvents()

            // Generate download path
            const fileName = updateInfo.assetName?.trim() || this.extractFileNameFromUrl(updateInfo.downloadUrl)
            const downloadPath = join(this.options.tempDir, fileName)

            // Start download with progress tracking
            const result = await this.downloadManager.downloadFile(
                updateInfo.downloadUrl,
                downloadPath
            )

            this.log(`Download completed: ${result.filePath}`)
            this.setState({ status: 'idle' })
            this.emit('download-complete', result.filePath)

            return result.filePath

        } catch (error) {
            const errorMessage = `Download failed: ${error}`
            this.handleError('Download', error, this.classifyError(error))
            this.setState({ status: 'error', error: errorMessage })
            throw error
        }
    }

    /**
     * Verify downloaded update file
     */
    async verifyUpdate(filePath: string, expectedHash: string): Promise<boolean> {
        this.log(`Verifying update file: ${filePath}`)
        this.setState({ status: 'verifying' })

        try {
            if (!expectedHash) {
                const errorMessage = 'No checksum provided for verification'
                this.log(errorMessage, 'error')
                this.setState({ status: 'error', error: errorMessage })
                this.emit('verification-failed', { valid: false, error: errorMessage } satisfies VerificationResult)
                return false
            }

            const verification = {
                checksumAlgorithm: 'sha256' as const,
                checksum: expectedHash
            }

            const result = await this.fileVerifier.verifyFile(filePath, verification)

            if (!result.valid) {
                const errorMessage = `File verification failed: ${result.error}`
                this.log(errorMessage)
                this.setState({ status: 'error', error: errorMessage })
                this.emit('verification-failed', result)
                return false
            }

            this.log('File verification passed')
            this.setState({ status: 'idle' })
            this.emit('verification-complete', result)
            return true

        } catch (error) {
            const errorMessage = `Verification error: ${error}`
            this.handleError('Verification', error, 'verification')
            this.setState({ status: 'error', error: errorMessage })
            throw error
        }
    }

    /**
     * Install an update (placeholder implementation)
     */
    async installUpdate(filePath: string): Promise<void> {
        this.log(`Installing update from: ${filePath}`)
        this.setState({ status: 'installing' })

        try {
            // Check if auto-install is allowed
            const autoInstallAllowed = await this.configService.isAutoInstallAllowed()
            if (!autoInstallAllowed) {
                throw new Error('Automatic installation is disabled by policy')
            }

            // Check maintenance window
            const inMaintenanceWindow = await this.configService.isInMaintenanceWindow()
            if (!inMaintenanceWindow) {
                throw new Error('Installation not allowed outside maintenance window')
            }

            // Platform-specific installation logic would go here
            // For now, this is a placeholder that simulates installation
            await this.performPlatformSpecificInstallation(filePath)

            this.log('Update installation completed')
            this.setState({ status: 'idle' })
            this.emit('installation-complete')

        } catch (error) {
            const errorMessage = `Installation failed: ${error}`
            this.handleError('Installation', error, this.classifyError(error))
            this.setState({ status: 'error', error: errorMessage })
            throw error
        }
    }

    /**
     * Start background update checking
     */
    async startBackgroundChecker(): Promise<void> {
        if (this.backgroundCheckTimer) {
            return // Already running
        }

        const checkInterval = await this.configService.getEffectiveCheckInterval()
        const intervalMs = checkInterval * 60 * 60 * 1000 // Convert hours to milliseconds

        this.log(`Starting background checker with ${checkInterval}h interval`)

        // Perform initial check after 30 seconds (as per requirements)
        setTimeout(() => {
            this.performBackgroundCheck()
        }, 30000)

        // Set up periodic checks
        this.backgroundCheckTimer = setInterval(() => {
            this.performBackgroundCheck()
        }, intervalMs)

        this.emit('background-checker-started', { intervalHours: checkInterval })
    }

    /**
     * Stop background update checking
     */
    stopBackgroundChecker(): void {
        if (this.backgroundCheckTimer) {
            clearInterval(this.backgroundCheckTimer)
            this.backgroundCheckTimer = undefined
            this.log('Background checker stopped')
            this.emit('background-checker-stopped')
        }
    }

    /**
     * Get current update state
     */
    getState(): UpdateState {
        return { ...this.state }
    }

    /**
     * Get update history
     */
    async getUpdateHistory(): Promise<UpdateRecord[]> {
        // This would typically read from a persistent store
        // For now, return empty array as placeholder
        return []
    }

    /**
     * Private helper methods
     */

    private async performBackgroundCheck(): Promise<void> {
        try {
            this.log('Performing background update check')
            await this.checkForUpdates()
        } catch (error) {
            this.handleError('Background check failed', error, 'background-check')
            // Don't throw - background checks should be silent
        }
    }

    private setupEventListeners(): void {
        this.bindDownloadManagerEvents()
    }

    private readonly onDownloadProgress = (progress: DownloadProgress) => {
        this.setState({ progress })
        this.emit('download-progress', progress)
    }

    private readonly onDownloadCancelled = (info: any) => {
        this.log(`Download cancelled: ${info.url}`)
        this.setState({ status: 'idle', progress: undefined })
        this.emit('download-cancelled', info)
    }

    private bindDownloadManagerEvents(): void {
        const dm: any = (this as any).downloadManager
        if (!dm || typeof dm.on !== 'function') {
            return
        }

        if (this.downloadManagerEventsBoundTo === dm) {
            return
        }

        // Detach from previous manager if possible.
        const prev: any = this.downloadManagerEventsBoundTo
        if (prev && prev !== dm) {
            if (typeof prev.off === 'function') {
                prev.off('progress', this.onDownloadProgress)
                prev.off('cancelled', this.onDownloadCancelled)
            } else if (typeof prev.removeListener === 'function') {
                prev.removeListener('progress', this.onDownloadProgress)
                prev.removeListener('cancelled', this.onDownloadCancelled)
            }
        }

        dm.on('progress', this.onDownloadProgress)
        dm.on('cancelled', this.onDownloadCancelled)
        this.downloadManagerEventsBoundTo = dm
    }

    private setState(updates: Partial<UpdateState>): void {
        this.state = { ...this.state, ...updates }
        this.emit('state-changed', this.state)
    }

    private getCurrentVersion(): string {
        // Get version from package.json or app metadata
        if (typeof app !== 'undefined') {
            return app.getVersion()
        }

        // Fallback for testing environments
        return process.env.npm_package_version || '1.0.0'
    }

    private detectPlatform(): Platform {
        const platform = process.platform
        switch (platform) {
            case 'darwin':
                return 'darwin'
            case 'win32':
                return 'win32'
            case 'linux':
                return 'linux'
            default:
                return 'linux' // Default fallback
        }
    }

    private detectArchitecture(): Architecture {
        const arch = process.arch
        switch (arch) {
            case 'x64':
                return 'x64'
            case 'arm64':
                return 'arm64'
            default:
                return 'x64' // Default fallback
        }
    }

    private extractChecksumFromReleaseNotes(releaseNotes: string, fileName: string): string {
        // Try to extract checksum from release notes
        // Look for patterns like "SHA256: abc123..." or "abc123 filename"
        const lines = releaseNotes.split('\n')

        for (const line of lines) {
            // Pattern 1: "SHA256: hash"
            const sha256Match = line.match(/SHA256:\s*([a-fA-F0-9]{64})/i)
            if (sha256Match) {
                return sha256Match[1].toLowerCase()
            }

            // Pattern 2: "hash filename"
            if (line.includes(fileName)) {
                const hashMatch = line.match(/([a-fA-F0-9]{64})/i)
                if (hashMatch) {
                    return hashMatch[1].toLowerCase()
                }
            }
        }

        return '' // No checksum found
    }

    private async configureAuthentication(): Promise<void> {
        const token = await this.configService.getGitHubToken()
        if (!token) {
            return
        }

        const authenticate = (this.githubClient as any).authenticate
        if (typeof authenticate !== 'function') {
            this.log('GitHub client does not support authenticate(); skipping token configuration', 'warn')
            return
        }

        authenticate.call(this.githubClient, token)
        this.log('GitHub authentication configured')
    }

    private extractFileNameFromUrl(url: string): string {
        try {
            const urlObj = new URL(url)
            const pathname = urlObj.pathname
            return pathname.split('/').pop() || 'update-file'
        } catch {
            return 'update-file'
        }
    }

    private async performPlatformSpecificInstallation(filePath: string): Promise<void> {
        try {
            this.log(`Starting platform-specific installation for ${this.options.platform}`)

            // Extract version from current state
            const targetVersion = this.state.availableUpdate?.version || 'unknown'

            // Set up progress listener
            this.desktopInstaller.on('progress', (progress) => {
                this.emit('installation-progress', progress)
            })

            // Perform the installation
            const result: InstallationResult = await this.desktopInstaller.installUpdate(filePath, targetVersion)

            if (!result.success) {
                throw new Error(result.error || 'Installation failed')
            }

            this.log(`Installation completed successfully: ${result.installedVersion}`)

            // Do not automatically restart here.
            // For DMG/EXE/MSI/AppImage handoff flows, the OS installer is responsible for
            // installing the new version and the user should relaunch afterwards.

        } catch (error) {
            this.log(`Platform-specific installation failed: ${error}`, 'error')
            throw error
        }
    }

    /**
     * Enhanced error handling with structured logging
     */
    private handleError(context: string, error: any, errorType?: string): void {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined

        const logEntry = {
            timestamp: new Date().toISOString(),
            context,
            errorType: errorType || 'unknown',
            message: errorMessage,
            stack: errorStack,
            state: this.state.status,
            currentVersion: this.state.currentVersion
        }

        // Log structured error information
        this.log(`ERROR: ${context} - ${errorMessage}`, 'error', logEntry)

        // Emit error event for external handling
        this.emit('error', {
            context,
            error,
            errorType,
            timestamp: new Date()
        })
    }

    /**
     * Enhanced logging with levels and structured data
     */
    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug', data?: any): void {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            component: 'UpdateAgent',
            message,
            data
        }

        // In production, this would integrate with a proper logging system
        switch (level) {
            case 'error':
                console.error(`[UpdateAgent] ${message}`, data ? JSON.stringify(data, null, 2) : '')
                break
            case 'warn':
                console.warn(`[UpdateAgent] ${message}`, data ? JSON.stringify(data, null, 2) : '')
                break
            case 'info':
                console.info(`[UpdateAgent] ${message}`, data ? JSON.stringify(data, null, 2) : '')
                break
            default:
                console.debug(`[UpdateAgent] ${message}`, data ? JSON.stringify(data, null, 2) : '')
        }

        // Emit log event for external log aggregation
        this.emit('log', logEntry)
    }

    /**
     * Error recovery mechanisms
     */
    private async attemptErrorRecovery(errorType: string, context: string): Promise<boolean> {
        this.log(`Attempting error recovery for ${errorType} in ${context}`, 'info')

        try {
            switch (errorType) {
                case 'authentication':
                    // Try to re-authenticate
                    const token = await this.configService.getGitHubToken()
                    if (token) {
                        this.githubClient.authenticate(token)
                        this.log('Authentication recovery successful', 'info')
                        return true
                    }
                    break

                case 'network':
                    // Check network connectivity and wait before retry
                    await this.delay(5000) // Wait 5 seconds
                    this.log('Network recovery attempted', 'info')
                    return true

                case 'rate-limit':
                    // Get rate limit info and wait appropriately
                    const rateLimitStatus = this.githubClient.getRateLimitStatus()
                    if (rateLimitStatus.rateLimitInfo) {
                        const waitTime = Math.min(rateLimitStatus.rateLimitInfo.retryAfter || 60, 300) * 1000
                        this.log(`Rate limit recovery: waiting ${waitTime}ms`, 'info')
                        await this.delay(waitTime)
                        return true
                    }
                    break

                case 'file-system':
                    // Attempt to clean up and recreate temp directories
                    try {
                        await this.ensureTempDirectory()
                        this.log('File system recovery successful', 'info')
                        return true
                    } catch {
                        // Recovery failed
                    }
                    break

                default:
                    this.log(`No recovery mechanism available for error type: ${errorType}`, 'warn')
            }
        } catch (recoveryError) {
            this.log(`Error recovery failed: ${recoveryError}`, 'error')
        }

        return false
    }

    /**
     * Classify error types for appropriate handling
     */
    private classifyError(error: any): string {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorLower = errorMessage.toLowerCase()

        if (errorLower.includes('authentication') || errorLower.includes('unauthorized') || errorLower.includes('token')) {
            return 'authentication'
        }

        if (errorLower.includes('network') || errorLower.includes('fetch') || errorLower.includes('connection')) {
            return 'network'
        }

        if (errorLower.includes('rate limit') || errorLower.includes('too many requests')) {
            return 'rate-limit'
        }

        if (errorLower.includes('enoent') || errorLower.includes('permission') || errorLower.includes('disk')) {
            return 'file-system'
        }

        if (errorLower.includes('checksum') || errorLower.includes('signature') || errorLower.includes('verification')) {
            return 'verification'
        }

        return 'unknown'
    }

    /**
     * Enhanced error handling wrapper for async operations
     */
    private async withErrorHandling<T>(
        operation: () => Promise<T>,
        context: string,
        allowRetry: boolean = true
    ): Promise<T> {
        try {
            return await operation()
        } catch (error) {
            const errorType = this.classifyError(error)
            this.handleError(context, error, errorType)

            // Attempt recovery if allowed
            if (allowRetry) {
                const recovered = await this.attemptErrorRecovery(errorType, context)
                if (recovered) {
                    try {
                        this.log(`Retrying operation after recovery: ${context}`, 'info')
                        return await operation()
                    } catch (retryError) {
                        this.handleError(`Retry failed for ${context}`, retryError, errorType)
                        throw retryError
                    }
                }
            }

            throw error
        }
    }

    /**
     * Utility methods
     */
    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private async withNetworkRetry<T>(operation: () => Promise<T>, maxAttempts: number): Promise<T> {
        let lastError: unknown

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation()
            } catch (error) {
                lastError = error
                const errorType = this.classifyError(error)
                if (errorType !== 'network' || attempt === maxAttempts) {
                    throw error
                }
                // No delay in tests; keep retries fast and deterministic.
                if (process.env.NODE_ENV !== 'test') {
                    await this.delay(500)
                }
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }

    private async ensureTempDirectory(): Promise<void> {
        try {
            const { mkdir } = await import('fs/promises')
            await mkdir(this.options.tempDir, { recursive: true })
        } catch (error) {
            throw new Error(`Failed to create temp directory: ${error}`)
        }
    }
}