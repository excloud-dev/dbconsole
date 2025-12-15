/**
 * DesktopErrorHandler - Platform-specific error handling for update operations
 * Handles installation failures, rollback mechanisms, and system checks
 */

import { EventEmitter } from 'events'
import { app, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { Platform, Architecture } from './types'
import { DesktopInstaller } from './desktop-installer'

export interface ErrorHandlerOptions {
    platform: Platform
    arch: Architecture
    tempDir: string
    enableRollback?: boolean
    enableSystemChecks?: boolean
}

export interface SystemCheckResult {
    hasPermissions: boolean
    hasDiskSpace: boolean
    diskSpaceAvailable: number // bytes
    diskSpaceRequired: number // bytes
    permissionErrors: string[]
    recommendations: string[]
}

export interface ErrorRecoveryResult {
    success: boolean
    action: 'retry' | 'rollback' | 'abort'
    message: string
    backupPath?: string
}

export type UpdateError =
    | 'permission-denied'
    | 'insufficient-disk-space'
    | 'file-corruption'
    | 'network-error'
    | 'signature-verification-failed'
    | 'installation-failed'
    | 'rollback-failed'
    | 'unknown-error'

/**
 * Desktop-specific error handler implementation
 */
export class DesktopErrorHandler extends EventEmitter {
    private readonly options: Required<ErrorHandlerOptions>
    private readonly installer: DesktopInstaller

    constructor(options: ErrorHandlerOptions, installer: DesktopInstaller) {
        super()

        this.options = {
            ...options,
            enableRollback: options.enableRollback ?? true,
            enableSystemChecks: options.enableSystemChecks ?? true
        }

        this.installer = installer
    }

    /**
     * Perform system checks before update installation
     */
    async performSystemChecks(requiredSpaceBytes: number): Promise<SystemCheckResult> {
        try {
            this.log('Performing system checks...')

            // Allow callers (and tests) to skip system checks.
            if (!this.options.enableSystemChecks) {
                const bypassResult: SystemCheckResult = {
                    hasPermissions: true,
                    hasDiskSpace: true,
                    diskSpaceAvailable: Number.MAX_SAFE_INTEGER,
                    diskSpaceRequired: requiredSpaceBytes,
                    permissionErrors: [],
                    recommendations: []
                }

                this.log('System checks bypassed (enableSystemChecks=false)')
                this.emit('system-check-complete', bypassResult)
                return bypassResult
            }

            const result: SystemCheckResult = {
                hasPermissions: false,
                hasDiskSpace: false,
                diskSpaceAvailable: 0,
                diskSpaceRequired: requiredSpaceBytes,
                permissionErrors: [],
                recommendations: []
            }

            // Check permissions
            const permissionCheck = await this.checkPermissions()
            result.hasPermissions = permissionCheck.hasPermissions
            result.permissionErrors = permissionCheck.errors

            // Check disk space
            const diskSpaceCheck = await this.checkDiskSpace(requiredSpaceBytes)
            result.hasDiskSpace = diskSpaceCheck.hasSpace
            result.diskSpaceAvailable = diskSpaceCheck.availableBytes

            // Generate recommendations
            result.recommendations = this.generateRecommendations(result)

            this.log(`System checks completed: permissions=${result.hasPermissions}, diskSpace=${result.hasDiskSpace}`)
            this.emit('system-check-complete', result)

            return result

        } catch (error) {
            this.log(`System checks failed: ${error}`, 'error')
            throw new Error(`System checks failed: ${error}`)
        }
    }

    /**
     * Handle update errors with appropriate recovery strategies
     */
    async handleUpdateError(
        error: any,
        errorType: UpdateError,
        context: string,
        backupPath?: string
    ): Promise<ErrorRecoveryResult> {
        try {
            this.log(`Handling update error: ${errorType} in ${context}`)

            const errorMessage = error instanceof Error ? error.message : String(error)

            // Emit error event for logging
            this.emit('error-occurred', {
                type: errorType,
                context,
                message: errorMessage,
                timestamp: new Date()
            })

            // Determine recovery strategy based on error type
            const recoveryResult = await this.determineRecoveryStrategy(
                errorType,
                errorMessage,
                context,
                backupPath
            )

            // Execute recovery action
            const finalResult = await this.executeRecoveryAction(recoveryResult, backupPath)

            this.log(`Error recovery completed: ${finalResult.action} - ${finalResult.success}`)
            this.emit('error-recovery-complete', finalResult)

            return finalResult

        } catch (recoveryError) {
            this.log(`Error recovery failed: ${recoveryError}`, 'error')

            const failedResult: ErrorRecoveryResult = {
                success: false,
                action: 'abort',
                message: `Recovery failed: ${recoveryError}`
            }

            this.emit('error-recovery-failed', failedResult)
            return failedResult
        }
    }

    /**
     * Show user-friendly error dialog
     */
    async showErrorDialog(
        title: string,
        message: string,
        errorType: UpdateError,
        recoveryOptions?: string[]
    ): Promise<string | null> {
        try {
            const buttons = recoveryOptions || ['OK']
            const defaultButton = 0

            const result = await dialog.showMessageBox({
                type: 'error',
                title,
                message,
                detail: this.getErrorDetails(errorType),
                buttons,
                defaultId: defaultButton,
                cancelId: buttons.length - 1
            })

            const selectedOption = buttons[result.response]
            this.log(`User selected error dialog option: ${selectedOption}`)

            return selectedOption

        } catch (error) {
            this.log(`Failed to show error dialog: ${error}`, 'error')
            return null
        }
    }

    /**
     * Attempt automatic error recovery
     */
    async attemptAutoRecovery(
        errorType: UpdateError,
        context: string,
        maxRetries: number = 3
    ): Promise<boolean> {
        try {
            this.log(`Attempting auto-recovery for ${errorType} (max ${maxRetries} retries)`)

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                this.log(`Auto-recovery attempt ${attempt}/${maxRetries}`)

                const success = await this.executeAutoRecoveryStep(errorType, context, attempt)

                if (success) {
                    this.log(`Auto-recovery successful on attempt ${attempt}`)
                    this.emit('auto-recovery-success', { errorType, attempt })
                    return true
                }

                // Wait before next attempt (exponential backoff)
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
                    this.log(`Waiting ${delay}ms before next attempt`)
                    await this.delay(delay)
                }
            }

            this.log(`Auto-recovery failed after ${maxRetries} attempts`)
            this.emit('auto-recovery-failed', { errorType, attempts: maxRetries })
            return false

        } catch (error) {
            this.log(`Auto-recovery error: ${error}`, 'error')
            return false
        }
    }

    /**
     * Private helper methods
     */

    private async checkPermissions(): Promise<{ hasPermissions: boolean; errors: string[] }> {
        const errors: string[] = []
        let hasPermissions = true

        try {
            // Check write permissions to temp directory
            try {
                const testTempFile = join(this.options.tempDir, '.permission-test')
                await fs.mkdir(this.options.tempDir, { recursive: true })
                await fs.writeFile(testTempFile, 'test')
                await fs.unlink(testTempFile)
            } catch (error) {
                hasPermissions = false
                errors.push(`No write permission to temp directory: ${this.options.tempDir}`)
            }

            // Platform-specific permission checks
            const platformErrors = await this.checkPlatformPermissions()
            errors.push(...platformErrors)

            // For handoff installers (DMG/MSI/etc.), lack of write permission to the
            // application directory is not required. Treat most platform checks as
            // advisory rather than fatal (except where explicitly critical).
            if (this.options.platform === 'linux' && platformErrors.length > 0) {
                hasPermissions = false
            }

        } catch (error) {
            hasPermissions = false
            errors.push(`Permission check failed: ${error}`)
        }

        return { hasPermissions, errors }
    }

    private async checkPlatformPermissions(): Promise<string[]> {
        const errors: string[] = []

        switch (this.options.platform) {
            case 'darwin':
                // macOS-specific permission checks
                try {
                    // Check if app is in Applications folder (recommended for updates)
                    const appPath = app.getAppPath()
                    if (!appPath.includes('/Applications/')) {
                        errors.push('Application should be installed in /Applications folder for proper updates')
                    }
                } catch (error) {
                    errors.push(`macOS permission check failed: ${error}`)
                }
                break

            case 'win32':
                // Windows-specific permission checks
                try {
                    // Check if running as administrator (may be required for some installations)
                    // This is a simplified check - in production, use proper Windows APIs
                } catch (error) {
                    errors.push(`Windows permission check failed: ${error}`)
                }
                break

            case 'linux':
                // Linux-specific permission checks
                try {
                    // Check executable permissions
                    const appPath = process.execPath
                    await fs.access(appPath, fs.constants.X_OK)
                } catch (error) {
                    errors.push(`Linux permission check failed: ${error}`)
                }
                break
        }

        return errors
    }
    private async checkDiskSpace(requiredBytes: number): Promise<{ hasSpace: boolean; availableBytes: number }> {
        try {
            await fs.mkdir(this.options.tempDir, { recursive: true })

            // Prefer fs.statfs when available (accurate on most POSIX platforms).
            const statfsFn = (fs as any).statfs as undefined | ((path: string) => Promise<any>)
            if (typeof statfsFn === 'function') {
                const stat = await statfsFn(this.options.tempDir)
                const availableBytes = Number(stat.bavail) * Number(stat.bsize)
                const hasSpace = availableBytes >= requiredBytes * 1.5 // Require 1.5x space for safety
                return { hasSpace, availableBytes }
            }

            // If disk space can't be determined on this platform/runtime, don't block
            // installation (the download already succeeded).
            return {
                hasSpace: true,
                availableBytes: Number.MAX_SAFE_INTEGER
            }

        } catch (error) {
            // Best-effort: if disk checks fail, do not block the install handoff.
            this.log(`Disk space check failed (non-blocking): ${error}`, 'warn')
            return {
                hasSpace: true,
                availableBytes: Number.MAX_SAFE_INTEGER
            }
        }
    }

    private generateRecommendations(checkResult: SystemCheckResult): string[] {
        const recommendations: string[] = []

        if (!checkResult.hasPermissions) {
            recommendations.push('Run the application as administrator or ensure proper file permissions')

            if (this.options.platform === 'darwin') {
                recommendations.push('Move the application to the /Applications folder')
            }
        }

        if (!checkResult.hasDiskSpace) {
            const requiredMB = Math.ceil(checkResult.diskSpaceRequired / (1024 * 1024))
            const availableMB = Math.ceil(checkResult.diskSpaceAvailable / (1024 * 1024))

            recommendations.push(`Free up disk space: ${requiredMB}MB required, ${availableMB}MB available`)
            recommendations.push('Clear temporary files and empty trash')
        }

        if (checkResult.permissionErrors.length > 0) {
            recommendations.push('Check file and folder permissions')
            recommendations.push('Ensure antivirus software is not blocking the application')
        }

        return recommendations
    }

    private async determineRecoveryStrategy(
        errorType: UpdateError,
        errorMessage: string,
        context: string,
        backupPath?: string
    ): Promise<ErrorRecoveryResult> {

        switch (errorType) {
            case 'permission-denied':
                return {
                    success: false,
                    action: 'abort',
                    message: 'Permission denied. Please run as administrator or check file permissions.'
                }

            case 'insufficient-disk-space':
                return {
                    success: false,
                    action: 'abort',
                    message: 'Insufficient disk space. Please free up space and try again.'
                }

            case 'file-corruption':
                return {
                    success: false,
                    action: 'retry',
                    message: 'File corruption detected. Will retry download.'
                }

            case 'network-error':
                return {
                    success: false,
                    action: 'retry',
                    message: 'Network error occurred. Will retry in a moment.'
                }

            case 'signature-verification-failed':
                return {
                    success: false,
                    action: 'abort',
                    message: 'Security verification failed. Update may be compromised.'
                }

            case 'installation-failed':
                if (backupPath && this.options.enableRollback) {
                    return {
                        success: false,
                        action: 'rollback',
                        message: 'Installation failed. Will attempt to restore previous version.',
                        backupPath
                    }
                } else {
                    return {
                        success: false,
                        action: 'abort',
                        message: 'Installation failed and no backup available.'
                    }
                }

            case 'rollback-failed':
                return {
                    success: false,
                    action: 'abort',
                    message: 'Rollback failed. Manual intervention may be required.'
                }

            default:
                return {
                    success: false,
                    action: 'abort',
                    message: `Unknown error: ${errorMessage}`
                }
        }
    }

    private async executeRecoveryAction(
        recoveryResult: ErrorRecoveryResult,
        backupPath?: string
    ): Promise<ErrorRecoveryResult> {

        switch (recoveryResult.action) {
            case 'retry':
                // For retry actions, just return the result - the caller will handle retry
                return recoveryResult

            case 'rollback':
                if (backupPath && this.options.enableRollback) {
                    try {
                        this.log(`Attempting rollback from: ${backupPath}`)
                        const rollbackSuccess = await this.installer.rollbackInstallation(backupPath)

                        return {
                            success: rollbackSuccess,
                            action: 'rollback',
                            message: rollbackSuccess
                                ? 'Successfully restored previous version'
                                : 'Rollback failed',
                            backupPath
                        }
                    } catch (error) {
                        return {
                            success: false,
                            action: 'rollback',
                            message: `Rollback failed: ${error}`,
                            backupPath
                        }
                    }
                } else {
                    return {
                        success: false,
                        action: 'abort',
                        message: 'Rollback not available'
                    }
                }

            case 'abort':
            default:
                return recoveryResult
        }
    }

    private async executeAutoRecoveryStep(
        errorType: UpdateError,
        context: string,
        attempt: number
    ): Promise<boolean> {

        try {
            switch (errorType) {
                case 'network-error':
                    // For network errors, just wait and return true to retry
                    this.log(`Network error recovery attempt ${attempt}`)
                    return true

                case 'file-corruption':
                    // For file corruption, clean up and return true to retry download
                    this.log(`File corruption recovery attempt ${attempt}`)
                    await this.cleanupCorruptedFiles()
                    return true

                case 'permission-denied':
                    // Try to fix permissions
                    this.log(`Permission recovery attempt ${attempt}`)
                    return await this.attemptPermissionFix()

                default:
                    // No auto-recovery available for other error types
                    return false
            }

        } catch (error) {
            this.log(`Auto-recovery step failed: ${error}`, 'error')
            return false
        }
    }

    private async cleanupCorruptedFiles(): Promise<void> {
        try {
            // Clean up temporary files that might be corrupted
            const tempFiles = await fs.readdir(this.options.tempDir)

            for (const file of tempFiles) {
                if (file.startsWith('dbconsole-update-')) {
                    const filePath = join(this.options.tempDir, file)
                    await fs.unlink(filePath).catch(() => {
                        // Ignore errors - file might not exist
                    })
                }
            }

            this.log('Corrupted files cleaned up')

        } catch (error) {
            this.log(`Failed to cleanup corrupted files: ${error}`, 'warn')
        }
    }

    private async attemptPermissionFix(): Promise<boolean> {
        try {
            // Attempt to create necessary directories with proper permissions
            await fs.mkdir(this.options.tempDir, { recursive: true, mode: 0o755 })

            // Test write access
            const testFile = join(this.options.tempDir, '.permission-test')
            await fs.writeFile(testFile, 'test')
            await fs.unlink(testFile)

            this.log('Permission fix successful')
            return true

        } catch (error) {
            this.log(`Permission fix failed: ${error}`, 'warn')
            return false
        }
    }

    private getErrorDetails(errorType: UpdateError): string {
        switch (errorType) {
            case 'permission-denied':
                return 'The application does not have sufficient permissions to install updates. ' +
                    'Try running as administrator or check file permissions.'

            case 'insufficient-disk-space':
                return 'There is not enough free disk space to install the update. ' +
                    'Please free up some space and try again.'

            case 'file-corruption':
                return 'The downloaded update file appears to be corrupted. ' +
                    'The download will be retried automatically.'

            case 'network-error':
                return 'A network error occurred while downloading the update. ' +
                    'Please check your internet connection and try again.'

            case 'signature-verification-failed':
                return 'The update file failed security verification. ' +
                    'This may indicate a compromised or invalid update file.'

            case 'installation-failed':
                return 'The update installation process failed. ' +
                    'The application will attempt to restore the previous version.'

            case 'rollback-failed':
                return 'Failed to restore the previous version after a failed update. ' +
                    'You may need to reinstall the application manually.'

            default:
                return 'An unexpected error occurred during the update process.'
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            level,
            component: 'DesktopErrorHandler',
            message
        }

        switch (level) {
            case 'error':
                console.error(`[DesktopErrorHandler] ${message}`)
                break
            case 'warn':
                console.warn(`[DesktopErrorHandler] ${message}`)
                break
            case 'info':
                console.info(`[DesktopErrorHandler] ${message}`)
                break
            default:
                console.debug(`[DesktopErrorHandler] ${message}`)
        }

        this.emit('log', logEntry)
    }
}