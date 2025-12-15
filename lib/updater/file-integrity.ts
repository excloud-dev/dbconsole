/**
 * File Integrity Verification System
 * Handles checksum verification and digital signature validation for downloaded files
 */

import { createHash, createVerify } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { SecurityVerification } from './types'

/**
 * Security failure types for comprehensive error handling
 */
export enum SecurityFailureType {
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
    SIGNATURE_INVALID = 'SIGNATURE_INVALID',
    SIGNATURE_MISSING = 'SIGNATURE_MISSING',
    ALGORITHM_UNSUPPORTED = 'ALGORITHM_UNSUPPORTED',
    VERIFICATION_ERROR = 'VERIFICATION_ERROR',
    RETRY_EXHAUSTED = 'RETRY_EXHAUSTED'
}

/**
 * Security failure details for alerting and logging
 */
export interface SecurityFailure {
    type: SecurityFailureType
    message: string
    filePath: string
    expectedChecksum?: string
    actualChecksum?: string
    signature?: string
    algorithm?: string
    timestamp: Date
    retryAttempt?: number
    maxRetries?: number
}

export interface VerificationResult {
    valid: boolean
    checksumMatch?: boolean
    signatureValid?: boolean
    error?: string
    securityFailures?: SecurityFailure[]
    verificationTime?: number
}

export interface VerificationOptions {
    maxRetries?: number
    retryDelay?: number
    enableLogging?: boolean
    alertOnFailure?: boolean
    strictMode?: boolean
}

export class FileIntegrityVerifier {
    private readonly defaultOptions: Required<VerificationOptions>
    private readonly securityFailures: SecurityFailure[] = []
    private readonly alertCallbacks: ((failure: SecurityFailure) => void)[] = []

    constructor(options: VerificationOptions = {}) {
        this.defaultOptions = {
            maxRetries: 2,
            retryDelay: 1000, // 1 second
            enableLogging: true,
            alertOnFailure: true,
            strictMode: false,
            ...options
        }
    }

    /**
     * Register a callback for security failure alerts
     */
    onSecurityFailure(callback: (failure: SecurityFailure) => void): void {
        this.alertCallbacks.push(callback)
    }

    /**
     * Get all recorded security failures
     */
    getSecurityFailures(): SecurityFailure[] {
        return [...this.securityFailures]
    }

    /**
     * Clear recorded security failures
     */
    clearSecurityFailures(): void {
        this.securityFailures.length = 0
    }

    /**
     * Verify file integrity using checksum and optional digital signature
     */
    async verifyFile(
        filePath: string,
        verification: SecurityVerification,
        options: VerificationOptions = {}
    ): Promise<VerificationResult> {
        const startTime = Date.now()
        const mergedOptions = { ...this.defaultOptions, ...options }
        const securityFailures: SecurityFailure[] = []

        // Check if file exists
        if (!existsSync(filePath)) {
            const failure = this.createSecurityFailure(
                SecurityFailureType.FILE_NOT_FOUND,
                `File not found: ${filePath}`,
                filePath
            )
            securityFailures.push(failure)
            this.recordAndAlertFailure(failure, mergedOptions)

            return {
                valid: false,
                error: failure.message,
                securityFailures,
                verificationTime: Date.now() - startTime
            }
        }

        this.log(`Starting comprehensive security verification for: ${filePath}`, mergedOptions)

        // Verify checksum with retry logic
        const checksumResult = await this.verifyChecksumWithRetry(
            filePath,
            verification,
            mergedOptions.maxRetries,
            mergedOptions.retryDelay,
            mergedOptions
        )

        if (checksumResult.securityFailures) {
            securityFailures.push(...checksumResult.securityFailures)
        }

        if (!checksumResult.valid && mergedOptions.strictMode) {
            // In strict mode, fail immediately on checksum failure
            return {
                valid: false,
                checksumMatch: checksumResult.checksumMatch,
                error: checksumResult.error,
                securityFailures,
                verificationTime: Date.now() - startTime
            }
        }

        // Verify digital signature if signature algorithm is specified
        let signatureResult: VerificationResult = { valid: true }
        if (verification.signatureAlgorithm) {
            // If signature algorithm is specified, we must verify the signature
            if (verification.signature !== undefined && verification.publicKey !== undefined) {
                signatureResult = await this.verifyDigitalSignature(
                    filePath,
                    verification,
                    mergedOptions
                )

                if (signatureResult.securityFailures) {
                    securityFailures.push(...signatureResult.securityFailures)
                }
            } else {
                // Missing signature or public key when algorithm is specified
                const failure = this.createSecurityFailure(
                    SecurityFailureType.SIGNATURE_MISSING,
                    'Digital signature required but not provided',
                    filePath,
                    undefined,
                    undefined,
                    verification.signature,
                    verification.signatureAlgorithm
                )
                securityFailures.push(failure)
                this.recordAndAlertFailure(failure, mergedOptions)
                signatureResult = { valid: false, signatureValid: false }
            }
        }

        // Combine results
        const result: VerificationResult = {
            valid: checksumResult.valid && signatureResult.valid,
            checksumMatch: checksumResult.checksumMatch,
            signatureValid: signatureResult.signatureValid,
            securityFailures,
            verificationTime: Date.now() - startTime
        }

        if (!result.valid) {
            result.error = checksumResult.error || signatureResult.error
        }

        this.log(`Comprehensive verification completed. Valid: ${result.valid}, Time: ${result.verificationTime}ms`, mergedOptions)
        return result
    }

    /**
     * Verify file checksum with retry logic
     */
    private async verifyChecksumWithRetry(
        filePath: string,
        verification: SecurityVerification,
        maxRetries: number,
        retryDelay: number,
        options: Required<VerificationOptions>
    ): Promise<VerificationResult> {
        let lastError: string | undefined
        const securityFailures: SecurityFailure[] = []

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                const result = await this.verifyChecksum(filePath, verification, options)

                if (result.valid) {
                    if (attempt > 1) {
                        this.log(`Checksum verification succeeded on attempt ${attempt}`, options)
                    }
                    return result
                }

                lastError = result.error

                // Record failure for this attempt
                const failure = this.createSecurityFailure(
                    SecurityFailureType.CHECKSUM_MISMATCH,
                    result.error || 'Checksum verification failed',
                    filePath,
                    verification.checksum,
                    undefined, // Will be filled by verifyChecksum
                    undefined,
                    verification.checksumAlgorithm,
                    attempt,
                    maxRetries + 1
                )
                securityFailures.push(failure)

                if (attempt <= maxRetries) {
                    this.log(`Checksum verification failed (attempt ${attempt}/${maxRetries + 1}): ${result.error}`, options)
                    this.log(`Retrying in ${retryDelay}ms...`, options)
                    await this.delay(retryDelay)
                } else {
                    // Final failure - alert
                    const finalFailure = this.createSecurityFailure(
                        SecurityFailureType.RETRY_EXHAUSTED,
                        `Checksum verification failed after ${maxRetries + 1} attempts`,
                        filePath,
                        verification.checksum,
                        undefined,
                        undefined,
                        verification.checksumAlgorithm,
                        attempt,
                        maxRetries + 1
                    )
                    securityFailures.push(finalFailure)
                    this.recordAndAlertFailure(finalFailure, options)
                }

            } catch (error) {
                lastError = `Checksum verification error: ${error}`

                const failure = this.createSecurityFailure(
                    SecurityFailureType.VERIFICATION_ERROR,
                    lastError,
                    filePath,
                    verification.checksum,
                    undefined,
                    undefined,
                    verification.checksumAlgorithm,
                    attempt,
                    maxRetries + 1
                )
                securityFailures.push(failure)

                if (attempt <= maxRetries) {
                    this.log(`Checksum verification error (attempt ${attempt}/${maxRetries + 1}): ${error}`, options)
                    this.log(`Retrying in ${retryDelay}ms...`, options)
                    await this.delay(retryDelay)
                } else {
                    this.recordAndAlertFailure(failure, options)
                }
            }
        }

        return {
            valid: false,
            checksumMatch: false,
            error: lastError || 'Checksum verification failed after all retries',
            securityFailures
        }
    }

    /**
     * Verify file checksum against expected hash
     */
    async verifyChecksum(
        filePath: string,
        verification: SecurityVerification,
        options: Required<VerificationOptions>
    ): Promise<VerificationResult> {
        try {
            const algorithm = this.normalizeHashAlgorithm(verification.checksumAlgorithm)
            const expectedChecksum = verification.checksum.toLowerCase()

            this.log(`Calculating ${algorithm} checksum for: ${filePath}`, options)

            const actualChecksum = await this.calculateFileChecksum(filePath, algorithm)
            const checksumMatch = actualChecksum === expectedChecksum

            if (!checksumMatch) {
                const error = `Checksum mismatch. Expected: ${expectedChecksum}, Actual: ${actualChecksum}`
                this.log(error, options)

                const failure = this.createSecurityFailure(
                    SecurityFailureType.CHECKSUM_MISMATCH,
                    error,
                    filePath,
                    expectedChecksum,
                    actualChecksum,
                    undefined,
                    algorithm
                )

                return {
                    valid: false,
                    checksumMatch: false,
                    error,
                    securityFailures: [failure]
                }
            }

            this.log(`Checksum verification passed: ${actualChecksum}`, options)
            return {
                valid: true,
                checksumMatch: true
            }

        } catch (error) {
            const errorMessage = `Checksum calculation failed: ${error}`
            this.log(errorMessage, options)

            const failure = this.createSecurityFailure(
                SecurityFailureType.VERIFICATION_ERROR,
                errorMessage,
                filePath,
                verification.checksum,
                undefined,
                undefined,
                verification.checksumAlgorithm
            )

            return {
                valid: false,
                checksumMatch: false,
                error: errorMessage,
                securityFailures: [failure]
            }
        }
    }

    /**
     * Calculate file checksum using specified algorithm
     */
    async calculateFileChecksum(filePath: string, algorithm: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = createHash(algorithm)
            const stream = createReadStream(filePath)

            stream.on('data', (data) => {
                hash.update(data)
            })

            stream.on('end', () => {
                resolve(hash.digest('hex'))
            })

            stream.on('error', (error) => {
                reject(error)
            })
        })
    }

    /**
     * Verify digital signature with comprehensive error handling
     */
    async verifyDigitalSignature(
        filePath: string,
        verification: SecurityVerification,
        options: Required<VerificationOptions>
    ): Promise<VerificationResult> {
        const securityFailures: SecurityFailure[] = []

        try {
            if (!verification.signature || !verification.signatureAlgorithm || !verification.publicKey) {
                const failure = this.createSecurityFailure(
                    SecurityFailureType.SIGNATURE_MISSING,
                    'Missing signature, algorithm, or public key',
                    filePath,
                    undefined,
                    undefined,
                    verification.signature,
                    verification.signatureAlgorithm
                )
                securityFailures.push(failure)
                this.recordAndAlertFailure(failure, options)

                return {
                    valid: false,
                    signatureValid: false,
                    error: failure.message,
                    securityFailures
                }
            }

            this.log(`Verifying digital signature using ${verification.signatureAlgorithm}`, options)

            // Use proper cryptographic verification
            const isValidSignature = await this.validateDigitalSignature(
                filePath,
                verification.signature,
                verification.signatureAlgorithm,
                verification.publicKey
            )

            if (!isValidSignature) {
                const failure = this.createSecurityFailure(
                    SecurityFailureType.SIGNATURE_INVALID,
                    'Digital signature validation failed',
                    filePath,
                    undefined,
                    undefined,
                    verification.signature,
                    verification.signatureAlgorithm
                )
                securityFailures.push(failure)
                this.recordAndAlertFailure(failure, options)

                return {
                    valid: false,
                    signatureValid: false,
                    error: failure.message,
                    securityFailures
                }
            }

            this.log('Digital signature verification passed', options)
            return {
                valid: true,
                signatureValid: true
            }

        } catch (error) {
            const errorMessage = `Digital signature verification error: ${error}`
            this.log(errorMessage, options)

            const failure = this.createSecurityFailure(
                SecurityFailureType.VERIFICATION_ERROR,
                errorMessage,
                filePath,
                undefined,
                undefined,
                verification.signature,
                verification.signatureAlgorithm
            )
            securityFailures.push(failure)
            this.recordAndAlertFailure(failure, options)

            return {
                valid: false,
                signatureValid: false,
                error: errorMessage,
                securityFailures
            }
        }
    }

    /**
     * Validate digital signature using Node.js crypto module
     */
    private async validateDigitalSignature(
        filePath: string,
        signature: string,
        algorithm: string,
        publicKey: string
    ): Promise<boolean> {
        try {
            // Read file content
            const fileContent = await readFile(filePath)

            // Validate inputs
            if (!signature || !publicKey || !algorithm) {
                return false
            }

            // Normalize algorithm name
            const normalizedAlgorithm = this.normalizeSignatureAlgorithm(algorithm)

            // Create verifier
            const verifier = createVerify(normalizedAlgorithm)
            verifier.update(fileContent)

            // Convert signature from hex to buffer if needed
            const signatureBuffer = Buffer.isBuffer(signature)
                ? signature
                : Buffer.from(signature, 'hex')

            // Verify signature
            const isValid = verifier.verify(publicKey, signatureBuffer)

            return isValid

        } catch (error) {
            this.log(`Digital signature validation error: ${error}`, { enableLogging: true } as Required<VerificationOptions>)
            return false
        }
    }

    /**
     * Normalize signature algorithm name for Node.js crypto
     */
    private normalizeSignatureAlgorithm(algorithm: string): string {
        const normalized = algorithm.toLowerCase().replace(/[^a-z0-9]/g, '')

        switch (normalized) {
            case 'rsa':
            case 'rsasha256':
                return 'RSA-SHA256'
            case 'rsasha512':
                return 'RSA-SHA512'
            case 'ecdsa':
            case 'ecdsasha256':
                return 'sha256'
            case 'ecdsasha512':
                return 'sha512'
            case 'ed25519':
                return 'ed25519'
            default:
                throw new Error(`Unsupported signature algorithm: ${algorithm}`)
        }
    }

    /**
     * Normalize hash algorithm name
     */
    private normalizeHashAlgorithm(algorithm: string): string {
        const normalized = algorithm.toLowerCase().replace(/[^a-z0-9]/g, '')

        switch (normalized) {
            case 'sha256':
            case 'sha2256':
                return 'sha256'
            case 'sha512':
            case 'sha2512':
                return 'sha512'
            case 'sha1':
                return 'sha1'
            case 'md5':
                return 'md5'
            default:
                throw new Error(`Unsupported hash algorithm: ${algorithm}`)
        }
    }

    /**
     * Utility function to create a delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Create a security failure record
     */
    private createSecurityFailure(
        type: SecurityFailureType,
        message: string,
        filePath: string,
        expectedChecksum?: string,
        actualChecksum?: string,
        signature?: string,
        algorithm?: string,
        retryAttempt?: number,
        maxRetries?: number
    ): SecurityFailure {
        return {
            type,
            message,
            filePath,
            expectedChecksum,
            actualChecksum,
            signature,
            algorithm,
            timestamp: new Date(),
            retryAttempt,
            maxRetries
        }
    }

    /**
     * Record and alert on security failure
     */
    private recordAndAlertFailure(failure: SecurityFailure, options: Required<VerificationOptions>): void {
        // Record the failure
        this.securityFailures.push(failure)

        // Log the failure
        if (options.enableLogging) {
            this.log(`SECURITY FAILURE [${failure.type}]: ${failure.message}`, options)
            if (failure.expectedChecksum && failure.actualChecksum) {
                this.log(`Expected: ${failure.expectedChecksum}, Actual: ${failure.actualChecksum}`, options)
            }
        }

        // Alert callbacks if enabled
        if (options.alertOnFailure) {
            this.alertCallbacks.forEach(callback => {
                try {
                    callback(failure)
                } catch (error) {
                    this.log(`Alert callback error: ${error}`, options)
                }
            })
        }
    }

    /**
     * Log debug information
     */
    private log(message: string, options?: Required<VerificationOptions>): void {
        if (!options || options.enableLogging) {
            console.debug(`[FileIntegrityVerifier] ${message}`)
        }
    }
}

/**
 * Utility function to generate a file checksum
 */
export async function generateFileChecksum(
    filePath: string,
    algorithm: 'sha256' | 'sha512' | 'sha1' | 'md5' = 'sha256'
): Promise<string> {
    const verifier = new FileIntegrityVerifier()
    return verifier.calculateFileChecksum(filePath, algorithm)
}

/**
 * Utility function to verify a file's integrity
 */
export async function verifyFileIntegrity(
    filePath: string,
    expectedChecksum: string,
    algorithm: 'sha256' | 'sha512' = 'sha256',
    signature?: string,
    publicKey?: string
): Promise<VerificationResult> {
    const verifier = new FileIntegrityVerifier()

    const verification: SecurityVerification = {
        checksumAlgorithm: algorithm,
        checksum: expectedChecksum,
        signatureAlgorithm: signature && publicKey ? 'rsa' : undefined,
        signature,
        publicKey
    }

    return verifier.verifyFile(filePath, verification)
}