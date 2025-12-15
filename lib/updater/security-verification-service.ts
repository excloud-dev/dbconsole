/**
 * Comprehensive Security Verification Service
 * Provides high-level security verification with alerting and logging
 */

import { FileIntegrityVerifier, SecurityFailure, SecurityFailureType, VerificationResult } from './file-integrity'
import { SecurityVerification } from './types'

export interface SecurityAlert {
    id: string
    timestamp: Date
    severity: 'low' | 'medium' | 'high' | 'critical'
    title: string
    message: string
    filePath: string
    failureType: SecurityFailureType
    actionRequired: boolean
    metadata?: Record<string, any>
}

export interface SecurityVerificationServiceOptions {
    enableRealTimeAlerts?: boolean
    enableSecurityLogging?: boolean
    strictMode?: boolean
    maxRetries?: number
    alertThreshold?: number
}

/**
 * Security verification service with comprehensive error handling and alerting
 */
export class SecurityVerificationService {
    private readonly verifier: FileIntegrityVerifier
    private readonly options: Required<SecurityVerificationServiceOptions>
    private readonly alerts: SecurityAlert[] = []
    private readonly alertCallbacks: ((alert: SecurityAlert) => void)[] = []
    private alertCounter = 0

    constructor(options: SecurityVerificationServiceOptions = {}) {
        this.options = {
            enableRealTimeAlerts: true,
            enableSecurityLogging: true,
            strictMode: false,
            maxRetries: 2,
            alertThreshold: 3,
            ...options
        }

        this.verifier = new FileIntegrityVerifier({
            maxRetries: this.options.maxRetries,
            enableLogging: this.options.enableSecurityLogging,
            alertOnFailure: this.options.enableRealTimeAlerts,
            strictMode: this.options.strictMode
        })

        // Register for security failure notifications
        this.verifier.onSecurityFailure(this.handleSecurityFailure.bind(this))
    }

    /**
     * Register callback for security alerts
     */
    onSecurityAlert(callback: (alert: SecurityAlert) => void): void {
        this.alertCallbacks.push(callback)
    }

    /**
     * Perform comprehensive security verification of a file
     */
    async verifyFileSecurity(
        filePath: string,
        verification: SecurityVerification
    ): Promise<VerificationResult> {
        this.log(`Starting comprehensive security verification for: ${filePath}`)

        try {
            const result = await this.verifier.verifyFile(filePath, verification, {
                enableLogging: this.options.enableSecurityLogging,
                alertOnFailure: this.options.enableRealTimeAlerts,
                strictMode: this.options.strictMode,
                maxRetries: this.options.maxRetries
            })

            // Generate summary alert if verification failed
            if (!result.valid) {
                await this.generateVerificationFailureAlert(filePath, result)
            }

            this.log(`Security verification completed. Valid: ${result.valid}, Time: ${result.verificationTime}ms`)
            return result

        } catch (error) {
            const errorMessage = `Security verification error: ${error}`
            this.log(errorMessage)

            // Generate critical alert for unexpected errors
            await this.generateCriticalAlert(
                'Security Verification Error',
                errorMessage,
                filePath,
                SecurityFailureType.VERIFICATION_ERROR
            )

            return {
                valid: false,
                error: errorMessage,
                verificationTime: 0
            }
        }
    }

    /**
     * Verify multiple files with batch processing
     */
    async verifyMultipleFiles(
        files: Array<{ path: string; verification: SecurityVerification }>
    ): Promise<Array<{ path: string; result: VerificationResult }>> {
        this.log(`Starting batch security verification for ${files.length} files`)

        const results: Array<{ path: string; result: VerificationResult }> = []

        for (const file of files) {
            try {
                const result = await this.verifyFileSecurity(file.path, file.verification)
                results.push({ path: file.path, result })
            } catch (error) {
                this.log(`Batch verification error for ${file.path}: ${error}`)
                results.push({
                    path: file.path,
                    result: {
                        valid: false,
                        error: `Batch verification error: ${error}`,
                        verificationTime: 0
                    }
                })
            }
        }

        // Generate batch summary alert if needed
        const failedFiles = results.filter(r => !r.result.valid)
        if (failedFiles.length > 0) {
            await this.generateBatchFailureAlert(failedFiles)
        }

        this.log(`Batch security verification completed. ${results.length - failedFiles.length}/${results.length} files passed`)
        return results
    }

    /**
     * Get all security alerts
     */
    getSecurityAlerts(): SecurityAlert[] {
        return [...this.alerts]
    }

    /**
     * Get alerts by severity
     */
    getAlertsBySeverity(severity: SecurityAlert['severity']): SecurityAlert[] {
        return this.alerts.filter(alert => alert.severity === severity)
    }

    /**
     * Clear all alerts
     */
    clearAlerts(): void {
        this.alerts.length = 0
    }

    /**
     * Get security verification statistics
     */
    getSecurityStats(): {
        totalAlerts: number
        alertsBySeverity: Record<string, number>
        recentFailures: SecurityFailure[]
        alertThresholdReached: boolean
    } {
        const alertsBySeverity = this.alerts.reduce((acc, alert) => {
            acc[alert.severity] = (acc[alert.severity] || 0) + 1
            return acc
        }, {} as Record<string, number>)

        return {
            totalAlerts: this.alerts.length,
            alertsBySeverity,
            recentFailures: this.verifier.getSecurityFailures(),
            alertThresholdReached: this.alerts.length >= this.options.alertThreshold
        }
    }

    /**
     * Handle security failure from verifier
     */
    private async handleSecurityFailure(failure: SecurityFailure): Promise<void> {
        const severity = this.determineSeverity(failure)
        const alert = this.createSecurityAlert(failure, severity)

        this.alerts.push(alert)

        // Notify callbacks
        if (this.options.enableRealTimeAlerts) {
            this.alertCallbacks.forEach(callback => {
                try {
                    callback(alert)
                } catch (error) {
                    this.log(`Alert callback error: ${error}`)
                }
            })
        }

        // Check if we've reached the alert threshold
        if (this.alerts.length >= this.options.alertThreshold) {
            await this.generateThresholdAlert()
        }
    }

    /**
     * Determine alert severity based on failure type
     */
    private determineSeverity(failure: SecurityFailure): SecurityAlert['severity'] {
        switch (failure.type) {
            case SecurityFailureType.SIGNATURE_INVALID:
            case SecurityFailureType.SIGNATURE_MISSING:
                return 'critical'
            case SecurityFailureType.CHECKSUM_MISMATCH:
                return 'high'
            case SecurityFailureType.RETRY_EXHAUSTED:
                return 'medium'
            case SecurityFailureType.FILE_NOT_FOUND:
            case SecurityFailureType.VERIFICATION_ERROR:
                return 'medium'
            case SecurityFailureType.ALGORITHM_UNSUPPORTED:
                return 'low'
            default:
                return 'medium'
        }
    }

    /**
     * Create security alert from failure
     */
    private createSecurityAlert(failure: SecurityFailure, severity: SecurityAlert['severity']): SecurityAlert {
        return {
            id: `alert-${++this.alertCounter}-${Date.now()}`,
            timestamp: failure.timestamp,
            severity,
            title: this.getAlertTitle(failure.type),
            message: failure.message,
            filePath: failure.filePath,
            failureType: failure.type,
            actionRequired: severity === 'critical' || severity === 'high',
            metadata: {
                expectedChecksum: failure.expectedChecksum,
                actualChecksum: failure.actualChecksum,
                signature: failure.signature,
                algorithm: failure.algorithm,
                retryAttempt: failure.retryAttempt,
                maxRetries: failure.maxRetries
            }
        }
    }

    /**
     * Get alert title based on failure type
     */
    private getAlertTitle(type: SecurityFailureType): string {
        switch (type) {
            case SecurityFailureType.FILE_NOT_FOUND:
                return 'File Not Found'
            case SecurityFailureType.CHECKSUM_MISMATCH:
                return 'File Integrity Compromised'
            case SecurityFailureType.SIGNATURE_INVALID:
                return 'Invalid Digital Signature'
            case SecurityFailureType.SIGNATURE_MISSING:
                return 'Missing Digital Signature'
            case SecurityFailureType.ALGORITHM_UNSUPPORTED:
                return 'Unsupported Security Algorithm'
            case SecurityFailureType.VERIFICATION_ERROR:
                return 'Security Verification Error'
            case SecurityFailureType.RETRY_EXHAUSTED:
                return 'Security Verification Failed'
            default:
                return 'Security Issue Detected'
        }
    }

    /**
     * Generate verification failure alert
     */
    private async generateVerificationFailureAlert(filePath: string, result: VerificationResult): Promise<void> {
        const alert: SecurityAlert = {
            id: `verification-failure-${++this.alertCounter}-${Date.now()}`,
            timestamp: new Date(),
            severity: 'high',
            title: 'File Security Verification Failed',
            message: `Security verification failed for ${filePath}: ${result.error}`,
            filePath,
            failureType: SecurityFailureType.VERIFICATION_ERROR,
            actionRequired: true,
            metadata: {
                checksumMatch: result.checksumMatch,
                signatureValid: result.signatureValid,
                verificationTime: result.verificationTime,
                failureCount: result.securityFailures?.length || 0
            }
        }

        this.alerts.push(alert)
        this.notifyAlert(alert)
    }

    /**
     * Generate critical alert
     */
    private async generateCriticalAlert(
        title: string,
        message: string,
        filePath: string,
        failureType: SecurityFailureType
    ): Promise<void> {
        const alert: SecurityAlert = {
            id: `critical-${++this.alertCounter}-${Date.now()}`,
            timestamp: new Date(),
            severity: 'critical',
            title,
            message,
            filePath,
            failureType,
            actionRequired: true
        }

        this.alerts.push(alert)
        this.notifyAlert(alert)
    }

    /**
     * Generate batch failure alert
     */
    private async generateBatchFailureAlert(
        failedFiles: Array<{ path: string; result: VerificationResult }>
    ): Promise<void> {
        const alert: SecurityAlert = {
            id: `batch-failure-${++this.alertCounter}-${Date.now()}`,
            timestamp: new Date(),
            severity: 'high',
            title: 'Batch Security Verification Failed',
            message: `${failedFiles.length} files failed security verification`,
            filePath: 'batch-operation',
            failureType: SecurityFailureType.VERIFICATION_ERROR,
            actionRequired: true,
            metadata: {
                failedFiles: failedFiles.map(f => ({
                    path: f.path,
                    error: f.result.error
                }))
            }
        }

        this.alerts.push(alert)
        this.notifyAlert(alert)
    }

    /**
     * Generate threshold alert
     */
    private async generateThresholdAlert(): Promise<void> {
        const alert: SecurityAlert = {
            id: `threshold-${++this.alertCounter}-${Date.now()}`,
            timestamp: new Date(),
            severity: 'critical',
            title: 'Security Alert Threshold Reached',
            message: `Security alert threshold of ${this.options.alertThreshold} has been reached. Immediate attention required.`,
            filePath: 'system',
            failureType: SecurityFailureType.VERIFICATION_ERROR,
            actionRequired: true,
            metadata: {
                alertCount: this.alerts.length,
                threshold: this.options.alertThreshold
            }
        }

        this.alerts.push(alert)
        this.notifyAlert(alert)
    }

    /**
     * Notify alert to callbacks
     */
    private notifyAlert(alert: SecurityAlert): void {
        if (this.options.enableRealTimeAlerts) {
            this.alertCallbacks.forEach(callback => {
                try {
                    callback(alert)
                } catch (error) {
                    this.log(`Alert callback error: ${error}`)
                }
            })
        }
    }

    /**
     * Log debug information
     */
    private log(message: string): void {
        if (this.options.enableSecurityLogging) {
            console.debug(`[SecurityVerificationService] ${message}`)
        }
    }
}

/**
 * Create a default security verification service instance
 */
export function createSecurityVerificationService(
    options?: SecurityVerificationServiceOptions
): SecurityVerificationService {
    return new SecurityVerificationService(options)
}

/**
 * Utility function for quick file security verification
 */
export async function verifyFileSecurity(
    filePath: string,
    verification: SecurityVerification,
    options?: SecurityVerificationServiceOptions
): Promise<VerificationResult> {
    const service = createSecurityVerificationService(options)
    return service.verifyFileSecurity(filePath, verification)
}