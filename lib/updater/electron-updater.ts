/**
 * ElectronUpdater - Integrates with Electron's autoUpdater module
 * Extends Electron's built-in updater to work with private repositories
 */

import { EventEmitter } from 'events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo as ElectronUpdateInfo } from 'electron-updater'
import { UpdateControllerImpl, UpdateControllerOptions } from './update-controller'
import { UpdateInfo, UpdateRecord, UpdateSettings } from './types'
import { ConfigServiceImpl } from './config-service'

export interface ElectronUpdaterOptions extends UpdateControllerOptions {
    enableElectronUpdater?: boolean
    quitAndInstall?: boolean
    checkOnStartup?: boolean
}

export interface ElectronUpdateState {
    isElectronUpdaterEnabled: boolean
    isUpdateDownloaded: boolean
    isRestartPending: boolean
    electronUpdaterState: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
    lastElectronError?: string
}

/**
 * Electron-specific updater that integrates with autoUpdater
 */
export class ElectronUpdater extends EventEmitter {
    private readonly updateController: UpdateControllerImpl
    private readonly configService: ConfigServiceImpl
    private readonly options: ElectronUpdaterOptions & {
        enableElectronUpdater: boolean
        quitAndInstall: boolean
        checkOnStartup: boolean
        autoStart: boolean
    }

    private electronState: ElectronUpdateState = {
        isElectronUpdaterEnabled: false,
        isUpdateDownloaded: false,
        isRestartPending: false,
        electronUpdaterState: 'idle'
    }

    private isInitialized = false
    private updateDownloadPath?: string

    constructor(options: ElectronUpdaterOptions) {
        super()

        this.options = {
            ...options,
            enableElectronUpdater: options.enableElectronUpdater ?? true,
            quitAndInstall: options.quitAndInstall ?? true,
            checkOnStartup: options.checkOnStartup ?? true,
            autoStart: options.autoStart ?? true
        }

        this.configService = new ConfigServiceImpl()
        this.updateController = new UpdateControllerImpl({
            ...options,
            // Ensure a single shared ConfigService instance for token/settings/policy.
            configService: this.configService,
            notificationHandler: this.handleUpdateNotification.bind(this),
            progressHandler: this.handleProgressUpdate.bind(this),
            errorHandler: this.handleUpdateError.bind(this)
        })

        this.setupEventListeners()
        this.log('ElectronUpdater initialized')
    }

    /**
     * Initialize the Electron updater
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        try {
            this.log('Initializing ElectronUpdater...')

            // Initialize the update controller
            await this.updateController.initialize()

            // Set up Electron's autoUpdater if enabled
            if (this.options.enableElectronUpdater) {
                await this.setupElectronAutoUpdater()
            }

            // Check for updates on startup if enabled and token is available
            if (this.options.checkOnStartup) {
                // Delay initial check to allow app to fully initialize
                setTimeout(async () => {
                    try {
                        // Only check if GitHub token is configured
                        const token = await this.configService.getGitHubToken()
                        if (token) {
                            await this.checkForUpdates()
                        } else {
                            this.log('Skipping startup update check - no GitHub token configured')
                        }
                    } catch (error) {
                        this.log(`Startup update check failed: ${error}`, 'warn')
                    }
                }, 5000) // 5 second delay
            }

            this.isInitialized = true
            this.emit('initialized')
            this.log('ElectronUpdater initialization complete')

        } catch (error) {
            const errorMessage = `ElectronUpdater initialization failed: ${error}`
            this.handleError('initialization', error)
            throw new Error(errorMessage)
        }
    }

    /**
     * Check for updates using both custom and Electron updater
     */
    async checkForUpdates(): Promise<UpdateInfo | null> {
        if (!this.isInitialized) {
            throw new Error('ElectronUpdater must be initialized before checking for updates')
        }

        try {
            this.log('Checking for updates...')
            this.setElectronState({ electronUpdaterState: 'checking' })

            // Use our custom update controller for private repos
            const updateInfo = await this.updateController.checkNow()

            if (updateInfo) {
                this.setElectronState({ electronUpdaterState: 'available' })
                this.emit('update-available', updateInfo)
                return updateInfo
            } else {
                this.setElectronState({ electronUpdaterState: 'idle' })
                this.emit('update-not-available')
                return null
            }

        } catch (error) {
            this.setElectronState({
                electronUpdaterState: 'error',
                lastElectronError: error instanceof Error ? error.message : String(error)
            })
            this.handleError('check-for-updates', error)
            throw error
        }
    }

    /**
     * Download and install update with Electron integration
     */
    async downloadAndInstall(updateInfo: UpdateInfo): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('ElectronUpdater must be initialized before installing updates')
        }

        try {
            this.log(`Starting download and installation for version ${updateInfo.version}`)
            this.setElectronState({ electronUpdaterState: 'downloading' })

            // Use our custom update controller to download and verify
            await this.updateController.downloadAndInstall(updateInfo)

            // Mark as downloaded and ready for installation
            this.setElectronState({
                electronUpdaterState: 'downloaded',
                isUpdateDownloaded: true
            })

            this.emit('update-downloaded', updateInfo)

            // Auto-install if enabled
            if (this.options.quitAndInstall) {
                await this.quitAndInstall()
            }

        } catch (error) {
            this.setElectronState({
                electronUpdaterState: 'error',
                lastElectronError: error instanceof Error ? error.message : String(error)
            })
            this.handleError('download-and-install', error)
            throw error
        }
    }

    /**
     * Quit application and install update
     */
    async quitAndInstall(): Promise<void> {
        if (!this.electronState.isUpdateDownloaded) {
            throw new Error('No update is ready for installation')
        }

        try {
            this.log('Quitting application and installing update...')
            this.setElectronState({ isRestartPending: true })

            // Emit event to allow cleanup
            this.emit('before-quit-for-update')

            // Give the app a moment to clean up
            setTimeout(() => {
                if (this.options.enableElectronUpdater && autoUpdater.quitAndInstall) {
                    // Use Electron's built-in quit and install if available
                    autoUpdater.quitAndInstall()
                } else {
                    // Fallback: restart the application manually
                    app.relaunch()
                    app.exit(0)
                }
            }, 1000)

        } catch (error) {
            this.setElectronState({ isRestartPending: false })
            this.handleError('quit-and-install', error)
            throw error
        }
    }

    /**
     * Get current state including Electron-specific information
     */
    getState(): ElectronUpdateState & ReturnType<typeof this.updateController.getUpdateState> {
        const controllerState = this.updateController.getUpdateState()
        return {
            ...controllerState,
            ...this.electronState
        }
    }

    /**
     * Get update history
     */
    async getUpdateHistory(): Promise<UpdateRecord[]> {
        return this.updateController.getUpdateHistory()
    }

    /**
     * Read persisted updater settings
     */
    async getUpdateSettings(): Promise<UpdateSettings> {
        return this.configService.getUpdateSettings()
    }

    /**
     * Persist updater settings
     */
    async setUpdateSettings(settings: UpdateSettings): Promise<void> {
        await this.configService.setUpdateSettings(settings)
    }

    /**
     * Read the stored GitHub token (if any)
     */
    async getGitHubToken(): Promise<string | null> {
        return this.configService.getGitHubToken()
    }

    /**
     * Persist the GitHub token (encrypted)
     */
    async setGitHubToken(token: string): Promise<void> {
        await this.configService.setGitHubToken(token)
    }

    /**
     * Start background checking
     */
    startBackgroundChecker(): void {
        this.updateController.startBackgroundChecker()
    }

    /**
     * Stop background checking
     */
    stopBackgroundChecker(): void {
        this.updateController.stopBackgroundChecker()
    }

    /**
     * Check if update is ready for installation
     */
    isUpdateReady(): boolean {
        return this.electronState.isUpdateDownloaded
    }

    /**
     * Check if restart is pending
     */
    isRestartPending(): boolean {
        return this.electronState.isRestartPending
    }

    /**
     * Private helper methods
     */

    private async setupElectronAutoUpdater(): Promise<void> {
        try {
            // Configure Electron's autoUpdater for fallback scenarios
            if (autoUpdater) {
                // Set up basic autoUpdater event listeners
                autoUpdater.on('checking-for-update', () => {
                    this.log('Electron autoUpdater: Checking for update...')
                })

                autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
                    this.log('Electron autoUpdater: Update available', 'info')
                    this.emit('electron-update-available', info)
                })

                autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
                    this.log('Electron autoUpdater: Update not available')
                    this.emit('electron-update-not-available', info)
                })

                autoUpdater.on('error', (err: Error) => {
                    this.log(`Electron autoUpdater error: ${err}`, 'error')
                    this.emit('electron-update-error', err)
                })

                autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
                    this.emit('electron-download-progress', progressObj)
                })

                autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
                    this.log('Electron autoUpdater: Update downloaded', 'info')
                    this.emit('electron-update-downloaded', info)
                })

                this.electronState.isElectronUpdaterEnabled = true
                this.log('Electron autoUpdater configured')
            }

        } catch (error) {
            this.log(`Failed to setup Electron autoUpdater: ${error}`, 'warn')
            this.electronState.isElectronUpdaterEnabled = false
        }
    }

    private setupEventListeners(): void {
        // Listen to update controller events
        this.updateController.on('update-available', (updateInfo: UpdateInfo) => {
            this.emit('update-available', updateInfo)
        })

        this.updateController.on('download-progress', (progress: any) => {
            this.emit('download-progress', progress)
        })

        this.updateController.on('download-complete', (filePath: string) => {
            this.updateDownloadPath = filePath
            this.emit('download-complete', filePath)
        })

        this.updateController.on('installation-complete', (result: any) => {
            this.setElectronState({
                electronUpdaterState: 'downloaded',
                isUpdateDownloaded: true
            })
            this.emit('installation-complete', result)
        })

        this.updateController.on('error', (error: any) => {
            this.setElectronState({
                electronUpdaterState: 'error',
                lastElectronError: error.error || String(error)
            })
            this.emit('error', error)
        })

        this.updateController.on('state-changed', (state: any) => {
            this.emit('state-changed', {
                ...state,
                ...this.electronState
            })
        })

        // Listen to app events
        app.on('before-quit', (event) => {
            if (this.electronState.isRestartPending) {
                // Allow quit for update installation
                return
            }

            // Emit event to allow cleanup
            this.emit('app-before-quit', event)
        })

        app.on('window-all-closed', () => {
            if (this.electronState.isRestartPending) {
                // Don't prevent quit if we're restarting for update
                return
            }

            this.emit('app-window-all-closed')
        })
    }

    private async handleUpdateNotification(updateInfo: UpdateInfo): Promise<boolean> {
        try {
            this.log(`Handling update notification for version ${updateInfo.version}`)

            // Check if auto-install is enabled
            const settings = await this.configService.getUpdateSettings()

            if (settings.autoInstall) {
                this.log('Auto-install enabled, proceeding with download')
                return true
            }

            // Emit notification event for UI to handle
            this.emit('update-notification', {
                type: 'update-available',
                updateInfo,
                timestamp: new Date()
            })

            // Return false to prevent automatic installation
            // UI should call downloadAndInstall() if user approves
            return false

        } catch (error) {
            this.handleError('handle-update-notification', error)
            return false
        }
    }

    private handleProgressUpdate(progress: any): void {
        this.emit('progress-update', progress)
    }

    private handleUpdateError(error: any): void {
        this.setElectronState({
            electronUpdaterState: 'error',
            lastElectronError: error.error || String(error)
        })
        this.emit('update-error', error)
    }

    private setElectronState(updates: Partial<ElectronUpdateState>): void {
        this.electronState = { ...this.electronState, ...updates }
        this.emit('electron-state-changed', this.electronState)
    }

    private handleError(context: string, error: any): void {
        const errorMessage = error instanceof Error ? error.message : String(error)

        const errorInfo = {
            context,
            error: errorMessage,
            timestamp: new Date(),
            electronState: this.electronState
        }

        this.log(`ERROR: ${context} - ${errorMessage}`, 'error')
        this.emit('error', errorInfo)
    }

    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            component: 'ElectronUpdater',
            message
        }

        // In production, this would integrate with a proper logging system
        switch (level) {
            case 'error':
                console.error(`[ElectronUpdater] ${message}`)
                break
            case 'warn':
                console.warn(`[ElectronUpdater] ${message}`)
                break
            case 'info':
                console.info(`[ElectronUpdater] ${message}`)
                break
            default:
                console.debug(`[ElectronUpdater] ${message}`)
        }

        this.emit('log', logEntry)
    }
}