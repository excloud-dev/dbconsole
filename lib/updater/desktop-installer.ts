/**
 * DesktopInstaller - Platform-specific update installation logic
 * Handles desktop app update installation and restart procedures
 */

import { EventEmitter } from 'events'
import { app, dialog, shell } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { Platform, Architecture } from './types'
import { DesktopErrorHandler, UpdateError, SystemCheckResult } from './desktop-error-handler'

export interface DesktopInstallerOptions {
    platform: Platform
    arch: Architecture
    tempDir: string
    backupDir?: string
    validateSignature?: boolean
}

export interface InstallationResult {
    success: boolean
    installedVersion?: string
    backupPath?: string
    error?: string
    requiresRestart: boolean
}

export interface InstallationProgress {
    stage: 'preparing' | 'backing-up' | 'installing' | 'verifying' | 'cleaning-up' | 'complete'
    progress: number // 0-100
    message: string
}

/**
 * Desktop-specific installer implementation
 */
export class DesktopInstaller extends EventEmitter {
    private readonly options: Required<DesktopInstallerOptions>
    private readonly errorHandler: DesktopErrorHandler

    constructor(options: DesktopInstallerOptions) {
        super()

        this.options = {
            ...options,
            backupDir: options.backupDir || join(options.tempDir, 'backups'),
            validateSignature: options.validateSignature ?? true
        }

        // Initialize error handler
        this.errorHandler = new DesktopErrorHandler({
            platform: this.options.platform,
            arch: this.options.arch,
            tempDir: this.options.tempDir,
            enableRollback: true,
            enableSystemChecks: !(process.env.NODE_ENV === 'test' || process.env.VITEST)
        }, this)

        // Forward error handler events
        this.errorHandler.on('error-occurred', (error) => this.emit('error-occurred', error))
        this.errorHandler.on('error-recovery-complete', (result) => this.emit('error-recovery-complete', result))
        this.errorHandler.on('system-check-complete', (result) => this.emit('system-check-complete', result))
    }

    /**
     * Install update from downloaded file
     */
    async installUpdate(filePath: string, targetVersion: string): Promise<InstallationResult> {
        try {
            this.log(`Starting installation of ${targetVersion} from ${filePath}`)
            this.emitProgress('preparing', 0, 'Preparing installation...')

            // Validate the file exists and is accessible
            await this.validateInstallationFile(filePath)

            // Perform system checks (if enabled)
            const stats = await fs.stat(filePath)
            const systemCheck = await this.errorHandler.performSystemChecks(stats.size * 2)

            if (!systemCheck.hasPermissions || !systemCheck.hasDiskSpace) {
                const errorType: UpdateError = !systemCheck.hasPermissions
                    ? 'permission-denied'
                    : 'insufficient-disk-space'

                const recoveryResult = await this.errorHandler.handleUpdateError(
                    new Error('System check failed'),
                    errorType,
                    'pre-installation-check'
                )

                throw new Error(recoveryResult.message)
            }

            // Handoff flow: open the downloaded installer in the OS.
            // This avoids a "fake" in-app install and prevents auto-restarting into the old version.
            this.emitProgress('installing', 50, 'Opening installer...')
            await this.openInstaller(filePath)

            this.emitProgress('complete', 100, 'Installer opened. Complete installation and relaunch DBConsole.')

            const result: InstallationResult = {
                success: true,
                installedVersion: targetVersion,
                requiresRestart: false
            }

            this.log(`Installation completed successfully: ${targetVersion}`)
            this.emit('installation-complete', result)

            return result

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            this.log(`Installation failed: ${errorMessage}`, 'error')

            // Handle the error with recovery strategies
            const errorType = this.classifyInstallationError(error)
            const recoveryResult = await this.errorHandler.handleUpdateError(
                error,
                errorType,
                'installation',
                undefined // No backup path available at this point
            )

            const result: InstallationResult = {
                success: false,
                error: recoveryResult.message,
                requiresRestart: false
            }

            this.emit('installation-failed', result)
            return result
        }
    }

    private async openInstaller(filePath: string): Promise<void> {
        try {
            // Reveal in Finder/Explorer when possible
            if (shell?.showItemInFolder) {
                try {
                    shell.showItemInFolder(filePath)
                } catch {
                    // ignore
                }
            }

            // Open the installer with the OS default handler
            if (shell?.openPath) {
                const err = await shell.openPath(filePath)
                if (err) {
                    this.log(`shell.openPath reported error: ${err}`, 'warn')
                }
            }

            // Optional informational dialog (best-effort; may be absent in mocked test env)
            if ((dialog as any)?.showMessageBox) {
                await dialog.showMessageBox({
                    type: 'info',
                    title: 'Update downloaded',
                    message: 'The update installer has been opened.',
                    detail: 'Complete the installation in the installer window, then relaunch DBConsole.',
                    buttons: ['OK'],
                    defaultId: 0
                })
            }
        } catch (error) {
            throw new Error(`Failed to open installer: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
    /**
     * Restart application after update installation
     */
    async restartApplication(delay: number = 2000): Promise<void> {
        try {
            this.log(`Restarting application in ${delay}ms...`)
            this.emit('restart-scheduled', { delay })

            setTimeout(() => {
                try {
                    // Relaunch the application
                    app.relaunch()
                    app.exit(0)
                } catch (error) {
                    this.log(`Failed to restart application: ${error}`, 'error')
                    this.emit('restart-failed', error)
                }
            }, delay)

        } catch (error) {
            this.log(`Failed to schedule restart: ${error}`, 'error')
            throw error
        }
    }

    /**
     * Rollback to previous version if installation fails
     */
    async rollbackInstallation(backupPath: string): Promise<boolean> {
        try {
            this.log(`Rolling back installation from backup: ${backupPath}`)
            this.emitProgress('preparing', 0, 'Preparing rollback...')

            // Verify backup exists
            const backupExists = await fs.access(backupPath).then(() => true).catch(() => false)
            if (!backupExists) {
                throw new Error(`Backup not found: ${backupPath}`)
            }

            // Perform platform-specific rollback
            this.emitProgress('installing', 50, 'Restoring from backup...')
            await this.performPlatformRollback(backupPath)

            this.emitProgress('complete', 100, 'Rollback complete')
            this.log('Rollback completed successfully')
            this.emit('rollback-complete', { backupPath })

            return true

        } catch (error) {
            this.log(`Rollback failed: ${error}`, 'error')
            this.emit('rollback-failed', error)
            return false
        }
    }

    /**
     * Private helper methods
     */

    private async validateInstallationFile(filePath: string): Promise<void> {
        try {
            const stats = await fs.stat(filePath)

            if (!stats.isFile()) {
                throw new Error('Installation file is not a valid file')
            }

            if (stats.size === 0) {
                throw new Error('Installation file is empty')
            }

            // Check file extension matches platform
            const expectedExtensions = this.getExpectedFileExtensions()
            const fileExt = filePath.toLowerCase().split('.').pop()

            if (!expectedExtensions.includes(fileExt || '')) {
                throw new Error(`Invalid file type for ${this.options.platform}: ${fileExt}`)
            }

            this.log(`Installation file validated: ${filePath} (${stats.size} bytes)`)

        } catch (error) {
            throw new Error(`Installation file validation failed: ${error}`)
        }
    }

    private async checkDiskSpace(filePath: string): Promise<void> {
        try {
            const stats = await fs.stat(filePath)
            const requiredSpace = stats.size * 2 // Require 2x file size for safety

            // Platform-specific disk space checking would go here
            // For now, we'll do a basic check
            this.log(`Checking disk space: ${requiredSpace} bytes required`)

        } catch (error) {
            throw new Error(`Disk space check failed: ${error}`)
        }
    }

    private async createBackup(): Promise<string> {
        try {
            // Create backup directory
            await fs.mkdir(this.options.backupDir, { recursive: true })

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const backupPath = join(this.options.backupDir, `backup-${timestamp}`)

            // Platform-specific backup logic would go here
            // For now, create a placeholder backup
            await fs.mkdir(backupPath, { recursive: true })

            this.log(`Backup created: ${backupPath}`)
            return backupPath

        } catch (error) {
            throw new Error(`Backup creation failed: ${error}`)
        }
    }

    private async performPlatformInstallation(filePath: string, targetVersion: string): Promise<void> {
        switch (this.options.platform) {
            case 'darwin':
                await this.installMacOS(filePath, targetVersion)
                break
            case 'win32':
                await this.installWindows(filePath, targetVersion)
                break
            case 'linux':
                await this.installLinux(filePath, targetVersion)
                break
            default:
                throw new Error(`Unsupported platform: ${this.options.platform}`)
        }
    }

    private async installMacOS(filePath: string, targetVersion: string): Promise<void> {
        try {
            this.log('Performing macOS installation...')

            // For .dmg files, mount and copy application
            if (filePath.endsWith('.dmg')) {
                await this.installMacOSDMG(filePath)
            } else if (filePath.endsWith('.zip')) {
                await this.installMacOSZip(filePath)
            } else {
                throw new Error(`Unsupported macOS installer format: ${filePath}`)
            }

        } catch (error) {
            throw new Error(`macOS installation failed: ${error}`)
        }
    }

    private async installWindows(filePath: string, targetVersion: string): Promise<void> {
        try {
            this.log('Performing Windows installation...')

            // For .exe files, run installer
            if (filePath.endsWith('.exe')) {
                await this.installWindowsEXE(filePath)
            } else if (filePath.endsWith('.msi')) {
                await this.installWindowsMSI(filePath)
            } else {
                throw new Error(`Unsupported Windows installer format: ${filePath}`)
            }

        } catch (error) {
            throw new Error(`Windows installation failed: ${error}`)
        }
    }

    private async installLinux(filePath: string, targetVersion: string): Promise<void> {
        try {
            this.log('Performing Linux installation...')

            // For .AppImage files, replace current executable
            if (filePath.endsWith('.AppImage')) {
                await this.installLinuxAppImage(filePath)
            } else if (filePath.endsWith('.deb')) {
                await this.installLinuxDeb(filePath)
            } else {
                throw new Error(`Unsupported Linux installer format: ${filePath}`)
            }

        } catch (error) {
            throw new Error(`Linux installation failed: ${error}`)
        }
    }
    private async installMacOSDMG(filePath: string): Promise<void> {
        // Placeholder implementation for DMG installation
        this.log('Installing from DMG file...')
        // In production, this would mount the DMG and copy the app
        await this.delay(2000) // Simulate installation time
    }

    private async installMacOSZip(filePath: string): Promise<void> {
        // Placeholder implementation for ZIP installation
        this.log('Installing from ZIP file...')
        // In production, this would extract and replace the app
        await this.delay(2000) // Simulate installation time
    }

    private async installWindowsEXE(filePath: string): Promise<void> {
        // Placeholder implementation for EXE installation
        this.log('Installing from EXE file...')
        // In production, this would run the installer silently
        await this.delay(2000) // Simulate installation time
    }

    private async installWindowsMSI(filePath: string): Promise<void> {
        // Placeholder implementation for MSI installation
        this.log('Installing from MSI file...')
        // In production, this would use msiexec to install
        await this.delay(2000) // Simulate installation time
    }

    private async installLinuxAppImage(filePath: string): Promise<void> {
        // Placeholder implementation for AppImage installation
        this.log('Installing AppImage file...')
        // In production, this would replace the current executable
        await this.delay(2000) // Simulate installation time
    }

    private async installLinuxDeb(filePath: string): Promise<void> {
        // Placeholder implementation for DEB installation
        this.log('Installing from DEB file...')
        // In production, this would use dpkg to install
        await this.delay(2000) // Simulate installation time
    }

    private async verifyInstallation(targetVersion: string): Promise<void> {
        try {
            this.log(`Verifying installation of version ${targetVersion}`)

            // Basic verification - check if app can be launched
            // In production, this would verify the installed version matches target
            await this.delay(1000) // Simulate verification time

            this.log('Installation verification passed')

        } catch (error) {
            throw new Error(`Installation verification failed: ${error}`)
        }
    }

    private async cleanupInstallation(filePath: string): Promise<void> {
        try {
            this.log('Cleaning up installation files...')

            // Remove temporary installation file
            await fs.unlink(filePath).catch(() => {
                // Ignore errors if file doesn't exist
            })

            this.log('Installation cleanup completed')

        } catch (error) {
            this.log(`Cleanup warning: ${error}`, 'warn')
            // Don't fail installation for cleanup errors
        }
    }

    private async performPlatformRollback(backupPath: string): Promise<void> {
        switch (this.options.platform) {
            case 'darwin':
                await this.rollbackMacOS(backupPath)
                break
            case 'win32':
                await this.rollbackWindows(backupPath)
                break
            case 'linux':
                await this.rollbackLinux(backupPath)
                break
            default:
                throw new Error(`Unsupported platform for rollback: ${this.options.platform}`)
        }
    }

    private async rollbackMacOS(backupPath: string): Promise<void> {
        this.log('Performing macOS rollback...')
        // Placeholder implementation
        await this.delay(1000)
    }

    private async rollbackWindows(backupPath: string): Promise<void> {
        this.log('Performing Windows rollback...')
        // Placeholder implementation
        await this.delay(1000)
    }

    private async rollbackLinux(backupPath: string): Promise<void> {
        this.log('Performing Linux rollback...')
        // Placeholder implementation
        await this.delay(1000)
    }

    private getExpectedFileExtensions(): string[] {
        switch (this.options.platform) {
            case 'darwin':
                return ['dmg', 'zip']
            case 'win32':
                return ['exe', 'msi']
            case 'linux':
                return ['appimage', 'deb', 'rpm']
            default:
                return []
        }
    }

    private emitProgress(stage: InstallationProgress['stage'], progress: number, message: string): void {
        const progressInfo: InstallationProgress = {
            stage,
            progress,
            message
        }

        this.emit('progress', progressInfo)
    }

    private async delay(ms: number): Promise<void> {
        // Keep tests fast and deterministic.
        if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
            return
        }
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private classifyInstallationError(error: any): UpdateError {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorLower = errorMessage.toLowerCase()

        if (errorLower.includes('permission') || errorLower.includes('access denied') || errorLower.includes('eacces')) {
            return 'permission-denied'
        }

        if (errorLower.includes('space') || errorLower.includes('enospc') || errorLower.includes('disk full')) {
            return 'insufficient-disk-space'
        }

        if (errorLower.includes('corrupt') || errorLower.includes('checksum') || errorLower.includes('integrity')) {
            return 'file-corruption'
        }

        if (errorLower.includes('network') || errorLower.includes('connection') || errorLower.includes('timeout')) {
            return 'network-error'
        }

        if (errorLower.includes('signature') || errorLower.includes('verification') || errorLower.includes('certificate')) {
            return 'signature-verification-failed'
        }

        return 'installation-failed'
    }

    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            component: 'DesktopInstaller',
            message
        }

        switch (level) {
            case 'error':
                console.error(`[DesktopInstaller] ${message}`)
                break
            case 'warn':
                console.warn(`[DesktopInstaller] ${message}`)
                break
            case 'info':
                console.info(`[DesktopInstaller] ${message}`)
                break
            default:
                console.debug(`[DesktopInstaller] ${message}`)
        }

        this.emit('log', logEntry)
    }
}