/**
 * UpdateController - Orchestrates the update process and manages user interactions
 * Provides high-level update management with user notification and history tracking
 */

import { EventEmitter } from 'events'
import { UpdateController } from './interfaces'
import { UpdateInfo, UpdateRecord, UpdateSettings } from './types'
import { UpdateAgentImpl, UpdateAgentOptions, UpdateState } from './update-agent'
import { ConfigServiceImpl } from './config-service'

export interface UpdateControllerOptions {
    owner: string
    repo: string
    autoStart?: boolean
    /**
     * Optional injected config service (useful to share a single instance across controllers/agents)
     */
    configService?: ConfigServiceImpl
    notificationHandler?: (updateInfo: UpdateInfo) => Promise<boolean>
    progressHandler?: (progress: any) => void
    errorHandler?: (error: any) => void
}

export interface UpdateNotification {
    type: 'update-available' | 'download-progress' | 'installation-complete' | 'error'
    data: any
    timestamp: Date
}

/**
 * Core UpdateController implementation
 */
export class UpdateControllerImpl extends EventEmitter implements UpdateController {
    private readonly updateAgent: UpdateAgentImpl
    private readonly configService: ConfigServiceImpl
    private readonly options: Required<Omit<UpdateControllerOptions, 'notificationHandler' | 'progressHandler' | 'errorHandler' | 'configService'>>

    private updateHistory: UpdateRecord[] = []
    private readonly releaseNotesCache = new Map<string, string>()
    private isInitialized = false
    private currentUpdateInfo?: UpdateInfo
    private isUpdateInProgress = false

    // Optional handlers
    private notificationHandler?: (updateInfo: UpdateInfo) => Promise<boolean>
    private progressHandler?: (progress: any) => void
    private errorHandler?: (error: any) => void

    constructor(options: UpdateControllerOptions) {
        super()

        // Validate required options
        if (!options.owner?.trim() || !options.repo?.trim()) {
            throw new Error('GitHub owner and repo are required')
        }

        this.options = {
            owner: options.owner,
            repo: options.repo,
            autoStart: options.autoStart ?? true
        }

        // Store optional handlers
        this.notificationHandler = options.notificationHandler
        this.progressHandler = options.progressHandler
        this.errorHandler = options.errorHandler

        // Initialize services
        this.configService = options.configService ?? new ConfigServiceImpl()

        const agentOptions: UpdateAgentOptions = {
            owner: this.options.owner,
            repo: this.options.repo,
            configService: this.configService
        }
        this.updateAgent = new UpdateAgentImpl(agentOptions)

        // Set up event listeners
        this.setupEventListeners()

        // Safety net: emitting EventEmitter 'error' without listeners throws.
        this.on('error', (info) => {
            try {
                this.log(`Unhandled UpdateController error event: ${JSON.stringify(info)}`, 'error')
            } catch {
                this.log('Unhandled UpdateController error event (unserializable payload)', 'error')
            }
        })

        this.log('UpdateController initialized')
    }

    /**
     * Initialize the UpdateController
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        try {
            this.log('Initializing UpdateController...')

            // Initialize configuration service (policy/settings)
            await this.configService.initialize()

            // Initialize the update agent
            await this.updateAgent.initialize()

            // Load update history
            await this.loadUpdateHistory()

            // Start background checker if auto-start is enabled
            if (this.options.autoStart) {
                this.startBackgroundChecker()
            }

            this.isInitialized = true
            this.emit('initialized')
            this.log('UpdateController initialization complete')

        } catch (error) {
            const errorMessage = `UpdateController initialization failed: ${error}`
            this.handleError('initialization', error)
            throw new Error(errorMessage)
        }
    }

    /**
     * Start background update checking
     */
    startBackgroundChecker(): void {
        if (!this.isInitialized) {
            this.log('Background checker start requested but controller not initialized yet - will start after initialization')
            return
        }

        try {
            this.updateAgent.startBackgroundChecker()
            this.log('Background checker started')
            this.emit('background-checker-started')
        } catch (error) {
            this.handleError('start-background-checker', error)
            throw error
        }
    }

    /**
     * Stop background update checking
     */
    stopBackgroundChecker(): void {
        try {
            this.updateAgent.stopBackgroundChecker()
            this.log('Background checker stopped')
            this.emit('background-checker-stopped')
        } catch (error) {
            this.handleError('stop-background-checker', error)
            throw error
        }
    }

    /**
     * Manually check for updates now
     */
    async checkNow(): Promise<UpdateInfo | null> {
        if (!this.isInitialized) {
            throw new Error('UpdateController must be initialized before checking for updates')
        }

        try {
            this.log('Manual update check initiated')
            this.emit('check-started')

            const updateInfo = await this.updateAgent.checkForUpdates()

            if (updateInfo) {
                this.currentUpdateInfo = updateInfo
                this.releaseNotesCache.set(updateInfo.version, updateInfo.releaseNotes)
                this.log(`Update available: ${updateInfo.version}`)

                // Notify user about available update
                await this.notifyUser(updateInfo)

                this.emit('update-available', updateInfo)
                return updateInfo
            } else {
                this.log('No updates available')
                this.emit('no-updates-available')
                return null
            }

        } catch (error) {
            this.handleError('manual-check', error)
            throw error
        }
    }

    /**
     * Download and install an update
     */
    async downloadAndInstall(updateInfo: UpdateInfo): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('UpdateController must be initialized before installing updates')
        }

        if (this.isUpdateInProgress) {
            throw new Error('Another update is already in progress')
        }

        this.isUpdateInProgress = true
        const startTime = new Date()

        // Cache release notes so callers can retrieve them after install.
        this.releaseNotesCache.set(updateInfo.version, updateInfo.releaseNotes)

        try {
            this.log(`Starting download and installation for version ${updateInfo.version}`)
            this.emit('installation-started', updateInfo)

            // Enforce policy/maintenance window before doing any work.
            const autoInstallAllowed = await this.configService.isAutoInstallAllowed()
            if (!autoInstallAllowed) {
                throw new Error('Automatic installation is disabled by policy')
            }

            const inMaintenanceWindow = await this.configService.isInMaintenanceWindow()
            if (!inMaintenanceWindow) {
                throw new Error('Installation not allowed outside maintenance window')
            }

            // Download the update
            this.log('Downloading update...')
            const filePath = await this.updateAgent.downloadUpdate(updateInfo)

            // Verify the downloaded file
            this.log('Verifying download...')
            const isValid = await this.updateAgent.verifyUpdate(filePath, updateInfo.checksum)

            if (!isValid) {
                throw new Error('Update verification failed')
            }

            // Install the update
            this.log('Installing update...')
            await this.updateAgent.installUpdate(filePath)

            // Record successful update
            const updateRecord: UpdateRecord = {
                version: updateInfo.version,
                installedAt: new Date(),
                success: true
            }

            await this.addUpdateRecord(updateRecord)

            this.log(`Update ${updateInfo.version} installed successfully`)
            this.emit('installation-complete', {
                updateInfo,
                record: updateRecord,
                duration: Date.now() - startTime.getTime()
            })

            // Notify user of completion
            await this.notifyInstallationComplete(updateInfo)

        } catch (error) {
            // Record failed update
            const updateRecord: UpdateRecord = {
                version: updateInfo.version,
                installedAt: new Date(),
                success: false,
                errorMessage: error instanceof Error ? error.message : String(error)
            }

            await this.addUpdateRecord(updateRecord)

            this.handleError('installation', error)
            this.emit('installation-failed', {
                updateInfo,
                error,
                record: updateRecord
            })

            throw error
        } finally {
            this.isUpdateInProgress = false
            this.currentUpdateInfo = undefined
        }
    }

    /**
     * Get update history
     */
    async getUpdateHistory(): Promise<UpdateRecord[]> {
        return [...this.updateHistory] // Return a copy to prevent external modification
    }

    /**
     * Get current update state
     */
    getUpdateState(): UpdateState & { isUpdateInProgress: boolean; currentUpdateInfo?: UpdateInfo } {
        const agentState = this.updateAgent.getState()
        return {
            ...agentState,
            isUpdateInProgress: this.isUpdateInProgress,
            currentUpdateInfo: this.currentUpdateInfo
        }
    }

    /**
     * Get release notes for a specific version
     */
    async getReleaseNotes(version: string): Promise<string> {
        try {
            // If we have current update info for this version, return it
            if (this.currentUpdateInfo && this.currentUpdateInfo.version === version) {
                return this.formatReleaseNotes(this.currentUpdateInfo.releaseNotes, version)
            }

            // Fall back to cached notes from prior checks/installs
            const cached = this.releaseNotesCache.get(version)
            if (cached) {
                return this.formatReleaseNotes(cached, version)
            }

            // For other versions, we don't have a way to fetch them currently
            // In a real implementation, this would use the GitHub client directly
            return this.formatReleaseNotes(`Release notes for version ${version} are not available.`, version)

        } catch (error) {
            this.handleError('get-release-notes', error)
            return this.formatReleaseNotes(`Failed to fetch release notes for version ${version}: ${error}`, version)
        }
    }

    /**
     * Format release notes for display
     */
    private formatReleaseNotes(rawNotes: string, version: string): string {
        if (!rawNotes || rawNotes.trim() === '') {
            return `# Release Notes - ${version}\n\nNo release notes provided for this version.`
        }

        // Clean up and format the release notes
        let formatted = rawNotes.trim()

        // Ensure the version is always visible somewhere in the output.
        // Keep the original notes content intact so callers can still search within it.
        const versionHeader = `# Release Notes - ${version}`
        const hasVersion = formatted.includes(version)

        // Add header if not present (or if the notes don't mention the version at all)
        if (!formatted.startsWith('#')) {
            formatted = `${versionHeader}\n\n${formatted}`
        } else if (!hasVersion) {
            formatted = `${versionHeader}\n\n${formatted}`
        }

        // Ensure proper markdown formatting
        formatted = formatted
            .replace(/\r\n/g, '\n') // Normalize line endings
            .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
            .trim()

        return formatted
    }

    /**
     * Get formatted release information including metadata
     */
    async getFormattedReleaseInfo(version: string): Promise<{
        version: string
        releaseNotes: string
        publishedAt?: Date
        isPrerelease?: boolean
        downloadUrl?: string
    }> {
        try {
            const releaseNotes = await this.getReleaseNotes(version)

            // Get additional metadata if available
            let publishedAt: Date | undefined
            let isPrerelease: boolean | undefined
            let downloadUrl: string | undefined

            if (this.currentUpdateInfo && this.currentUpdateInfo.version === version) {
                publishedAt = this.currentUpdateInfo.publishedAt
                isPrerelease = this.currentUpdateInfo.isPrerelease
                downloadUrl = this.currentUpdateInfo.downloadUrl
            }

            return {
                version,
                releaseNotes,
                publishedAt,
                isPrerelease,
                downloadUrl
            }
        } catch (error) {
            this.handleError('get-formatted-release-info', error)
            throw error
        }
    }

    /**
     * Check if an update is currently in progress
     */
    isInstallationInProgress(): boolean {
        return this.isUpdateInProgress
    }

    /**
     * Display release notes in a formatted way
     */
    async displayReleaseNotes(version: string, format: 'markdown' | 'plain' | 'html' = 'markdown'): Promise<string> {
        try {
            const releaseInfo = await this.getFormattedReleaseInfo(version)

            switch (format) {
                case 'plain':
                    return this.formatReleaseNotesAsPlainText(releaseInfo)
                case 'html':
                    return this.formatReleaseNotesAsHtml(releaseInfo)
                case 'markdown':
                default:
                    return releaseInfo.releaseNotes
            }
        } catch (error) {
            this.handleError('display-release-notes', error)
            throw error
        }
    }

    /**
     * Format release notes as plain text
     */
    private formatReleaseNotesAsPlainText(releaseInfo: any): string {
        let plainText = releaseInfo.releaseNotes
            .replace(/^#+\s*/gm, '') // Remove markdown headers
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold formatting
            .replace(/\*(.*?)\*/g, '$1') // Remove italic formatting
            .replace(/`(.*?)`/g, '$1') // Remove code formatting
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
            .trim()

        if (releaseInfo.publishedAt) {
            plainText = `Release ${releaseInfo.version} - ${releaseInfo.publishedAt.toLocaleDateString()}\n\n${plainText}`
        }

        return plainText
    }

    /**
     * Format release notes as HTML
     */
    private formatReleaseNotesAsHtml(releaseInfo: any): string {
        let html = releaseInfo.releaseNotes
            .replace(/^# (.*$)/gm, '<h1>$1</h1>') // H1 headers
            .replace(/^## (.*$)/gm, '<h2>$1</h2>') // H2 headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>') // H3 headers
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
            .replace(/`(.*?)`/g, '<code>$1</code>') // Code
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>') // Links
            .replace(/^[-*+]\s+(.*)$/gm, '<li>$1</li>') // List items
            .replace(/\n\n/g, '</p><p>') // Paragraphs
            .replace(/^(?!<[h|l|p])/gm, '<p>') // Wrap remaining lines in paragraphs
            .replace(/<\/p><p><li>/g, '</p><ul><li>') // Start lists
            .replace(/<\/li><p>/g, '</li></ul><p>') // End lists

        // Wrap in container
        html = `<div class="release-notes">
            <div class="release-header">
                <h1>Release ${releaseInfo.version}</h1>
                ${releaseInfo.publishedAt ? `<p class="release-date">Published: ${releaseInfo.publishedAt.toLocaleDateString()}</p>` : ''}
                ${releaseInfo.isPrerelease ? '<span class="prerelease-badge">Pre-release</span>' : ''}
            </div>
            <div class="release-content">
                ${html}
            </div>
        </div>`

        return html
    }

    /**
     * Private helper methods
     */

    private setupEventListeners(): void {
        // Listen to update agent events
        this.updateAgent.on('update-available', (updateInfo: UpdateInfo) => {
            this.currentUpdateInfo = updateInfo
            this.handleUpdateAvailable(updateInfo)
        })

        this.updateAgent.on('download-progress', (progress: any) => {
            this.handleDownloadProgress(progress)
        })

        this.updateAgent.on('download-complete', (filePath: string) => {
            this.log(`Download completed: ${filePath}`)
            this.emit('download-complete', filePath)
        })

        this.updateAgent.on('verification-complete', (result: any) => {
            this.log('File verification completed')
            this.emit('verification-complete', result)
        })

        this.updateAgent.on('installation-complete', () => {
            this.log('Installation completed by agent')
        })

        this.updateAgent.on('error', (error: any) => {
            this.handleError('agent-error', error.error || error)
        })

        this.updateAgent.on('state-changed', (state: UpdateState) => {
            this.emit('state-changed', {
                ...state,
                isUpdateInProgress: this.isUpdateInProgress,
                currentUpdateInfo: this.currentUpdateInfo
            })
        })
    }

    private async handleUpdateAvailable(updateInfo: UpdateInfo): Promise<void> {
        try {
            this.log(`Handling update available: ${updateInfo.version}`)

            // Check if auto-install is enabled
            const settings = await this.configService.getUpdateSettings()

            if (settings.autoInstall) {
                this.log('Auto-install enabled, starting download and installation')
                await this.downloadAndInstall(updateInfo)
            } else {
                this.log('Auto-install disabled, notifying user')
                await this.notifyUser(updateInfo)
            }
        } catch (error) {
            this.handleError('handle-update-available', error)
        }
    }

    private handleDownloadProgress(progress: any): void {
        if (this.progressHandler) {
            this.progressHandler(progress)
        }

        this.emit('download-progress', progress)
    }

    private async notifyUser(updateInfo: UpdateInfo): Promise<void> {
        try {
            const notification: UpdateNotification = {
                type: 'update-available',
                data: updateInfo,
                timestamp: new Date()
            }

            this.emit('notification', notification)

            // Call custom notification handler if provided
            if (this.notificationHandler) {
                const shouldInstall = await this.notificationHandler(updateInfo)
                if (shouldInstall) {
                    await this.downloadAndInstall(updateInfo)
                }
            }
        } catch (error) {
            this.handleError('notify-user', error)
        }
    }

    private async notifyInstallationComplete(updateInfo: UpdateInfo): Promise<void> {
        try {
            // Get formatted release information
            const releaseInfo = await this.getFormattedReleaseInfo(updateInfo.version)

            // Create detailed notification
            const notification: UpdateNotification = {
                type: 'installation-complete',
                data: {
                    version: updateInfo.version,
                    releaseNotes: releaseInfo.releaseNotes,
                    publishedAt: releaseInfo.publishedAt,
                    isPrerelease: releaseInfo.isPrerelease,
                    formattedMessage: this.createCompletionMessage(updateInfo, releaseInfo),
                    keyChanges: this.extractKeyChanges(releaseInfo.releaseNotes)
                },
                timestamp: new Date()
            }

            this.emit('notification', notification)
            this.log(`Installation complete notification sent for version ${updateInfo.version}`)
        } catch (error) {
            this.handleError('notify-installation-complete', error)
        }
    }

    /**
     * Create a formatted completion message
     */
    private createCompletionMessage(updateInfo: UpdateInfo, releaseInfo: any): string {
        const versionType = updateInfo.isPrerelease ? 'Pre-release' : 'Release'
        const publishedDate = releaseInfo.publishedAt
            ? releaseInfo.publishedAt.toLocaleDateString()
            : 'Unknown date'

        return `🎉 Update Complete!\n\n` +
            `${versionType} ${updateInfo.version} has been successfully installed.\n` +
            `Published: ${publishedDate}\n\n` +
            `Your application has been updated with the latest features and improvements.`
    }

    /**
     * Extract key changes from release notes
     */
    private extractKeyChanges(releaseNotes: string): string[] {
        if (!releaseNotes) return []

        const keyChanges: string[] = []
        const lines = releaseNotes.split('\n')

        for (const line of lines) {
            const trimmed = line.trim()

            // Look for bullet points, numbered lists, or lines starting with keywords
            if (trimmed.match(/^[-*+]\s+/) || // Bullet points
                trimmed.match(/^\d+\.\s+/) || // Numbered lists
                trimmed.match(/^(Added|Fixed|Changed|Improved|Updated|New|Enhanced):/i)) { // Keywords

                // Clean up the line and add to key changes
                const cleaned = trimmed
                    .replace(/^[-*+]\s+/, '') // Remove bullet
                    .replace(/^\d+\.\s+/, '') // Remove number
                    .trim()

                if (cleaned.length > 0 && keyChanges.length < 5) { // Limit to 5 key changes
                    keyChanges.push(cleaned)
                }
            }
        }

        return keyChanges
    }

    private async loadUpdateHistory(): Promise<void> {
        try {
            // In a real implementation, this would load from persistent storage
            // For now, initialize with empty history
            this.updateHistory = []
            this.log('Update history loaded')
        } catch (error) {
            this.log(`Failed to load update history: ${error}`)
            this.updateHistory = []
        }
    }

    private async addUpdateRecord(record: UpdateRecord): Promise<void> {
        try {
            this.updateHistory.unshift(record) // Add to beginning for chronological order

            // Keep only the last 50 records to prevent unbounded growth
            if (this.updateHistory.length > 50) {
                this.updateHistory = this.updateHistory.slice(0, 50)
            }

            // In a real implementation, this would persist to storage
            this.log(`Update record added: ${record.version} (${record.success ? 'success' : 'failed'})`)

            this.emit('history-updated', this.updateHistory)
        } catch (error) {
            this.log(`Failed to add update record: ${error}`)
        }
    }

    private handleError(context: string, error: any): void {
        const errorMessage = error instanceof Error ? error.message : String(error)

        const errorInfo = {
            context,
            error: errorMessage,
            timestamp: new Date(),
            state: this.getUpdateState()
        }

        this.log(`ERROR: ${context} - ${errorMessage}`, 'error')

        // Call custom error handler if provided
        if (this.errorHandler) {
            this.errorHandler(errorInfo)
        }

        // Emit error notification
        const notification: UpdateNotification = {
            type: 'error',
            data: errorInfo,
            timestamp: new Date()
        }

        this.emit('notification', notification)
        this.emit('error', errorInfo)
    }

    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            component: 'UpdateController',
            message
        }

        // In production, this would integrate with a proper logging system
        switch (level) {
            case 'error':
                console.error(`[UpdateController] ${message}`)
                break
            case 'warn':
                console.warn(`[UpdateController] ${message}`)
                break
            case 'info':
                console.info(`[UpdateController] ${message}`)
                break
            default:
                console.debug(`[UpdateController] ${message}`)
        }

        this.emit('log', logEntry)
    }
}