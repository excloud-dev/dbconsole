/**
 * Property-based tests for file integrity verification system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'

import {
    FileIntegrityVerifier,
    SecurityFailureType,
    generateFileChecksum
} from '../lib/updater/file-integrity'
import { SecurityVerification } from '../lib/updater/types'

// Test directory for temporary files
const TEST_DIR = path.join(__dirname, 'temp-integrity-tests')

// Custom arbitraries for generating test data
const fileContentArbitrary = fc.uint8Array({ minLength: 1, maxLength: 1024 })

const checksumAlgorithmArbitrary = fc.oneof(
    fc.constant('sha256'),
    fc.constant('sha512'),
    fc.constant('sha1')
)

const signatureAlgorithmArbitrary = fc.oneof(
    fc.constant('rsa'),
    fc.constant('ecdsa'),
    fc.constant('ed25519')
)

const invalidSignatureArbitrary = fc.oneof(
    fc.constant(''), // Empty signature
    fc.string({ minLength: 1, maxLength: 32 }), // Too short
    fc.string({ minLength: 1, maxLength: 64 }).filter(s => !/^[0-9a-fA-F]+$/.test(s)), // Invalid hex
    fc.constant('invalid-signature-format')
)

const publicKeyArbitrary = fc.oneof(
    // Valid-looking RSA public key format
    fc.constant(`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdef
-----END PUBLIC KEY-----`),
    // Invalid public key
    fc.constant('invalid-public-key'),
    fc.constant(''), // Empty key
    fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 128 })
        .map(arr => arr.map(n => n.toString(16)).join('')) // Hex format key
)

describe('File Integrity Verification - Property Tests', () => {
    let verifier: FileIntegrityVerifier

    beforeEach(async () => {
        verifier = new FileIntegrityVerifier()

        // Create test directory
        if (!existsSync(TEST_DIR)) {
            await mkdir(TEST_DIR, { recursive: true })
        }
    })

    afterEach(async () => {
        // Clean up test files
        try {
            const { readdir } = await import('fs/promises')
            const files = await readdir(TEST_DIR)
            await Promise.all(files.map(file => unlink(path.join(TEST_DIR, file))))
        } catch (error) {
            // Ignore cleanup errors
        }
    })

    describe('Property 25: Signature failure rejection', () => {
        /**
         * **Feature: github-auto-updater, Property 25: Signature failure rejection**
         * **Validates: Requirements 6.3**
         * 
         * For any file with invalid or missing required signatures, the system should reject the update and alert the user
         */
        it('should reject files with invalid signatures', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fileContentArbitrary,
                    checksumAlgorithmArbitrary,
                    signatureAlgorithmArbitrary,
                    invalidSignatureArbitrary,
                    publicKeyArbitrary,
                    async (fileContent, checksumAlgorithm, signatureAlgorithm, invalidSignature, publicKey) => {
                        // Create a temporary file
                        const fileName = `test-file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`
                        const filePath = path.join(TEST_DIR, fileName)

                        await writeFile(filePath, Buffer.from(fileContent))

                        try {
                            // Calculate correct checksum
                            const correctChecksum = await generateFileChecksum(filePath, checksumAlgorithm as any)

                            // Create security verification with invalid signature
                            const verification: SecurityVerification = {
                                checksumAlgorithm: checksumAlgorithm as any,
                                checksum: correctChecksum,
                                signatureAlgorithm: signatureAlgorithm as any,
                                signature: invalidSignature,
                                publicKey: publicKey
                            }

                            // Verify file - should fail due to invalid signature
                            const result = await verifier.verifyFile(filePath, verification)

                            // Property: Invalid signatures should always be rejected
                            expect(result.valid).toBe(false)

                            // Should have signature-related failure
                            if (result.securityFailures) {
                                const hasSignatureFailure = result.securityFailures.some(failure =>
                                    failure.type === SecurityFailureType.SIGNATURE_INVALID ||
                                    failure.type === SecurityFailureType.SIGNATURE_MISSING ||
                                    failure.type === SecurityFailureType.VERIFICATION_ERROR
                                )
                                expect(hasSignatureFailure).toBe(true)
                            }

                            // Should indicate signature validation failed
                            expect(result.signatureValid).toBe(false)

                            // Should have an error message
                            expect(result.error).toBeDefined()
                            expect(typeof result.error).toBe('string')
                            expect(result.error!.length).toBeGreaterThan(0)

                        } finally {
                            // Clean up
                            try {
                                await unlink(filePath)
                            } catch (error) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should reject files when signature is required but missing', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fileContentArbitrary,
                    checksumAlgorithmArbitrary,
                    signatureAlgorithmArbitrary,
                    async (fileContent, checksumAlgorithm, signatureAlgorithm) => {
                        // Create a temporary file
                        const fileName = `test-file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`
                        const filePath = path.join(TEST_DIR, fileName)

                        await writeFile(filePath, Buffer.from(fileContent))

                        try {
                            // Calculate correct checksum
                            const correctChecksum = await generateFileChecksum(filePath, checksumAlgorithm as any)

                            // Create security verification with signature algorithm but no signature
                            const verification: SecurityVerification = {
                                checksumAlgorithm: checksumAlgorithm as any,
                                checksum: correctChecksum,
                                signatureAlgorithm: signatureAlgorithm as any,
                                // signature and publicKey intentionally omitted
                            }

                            // Verify file in strict mode - should fail due to missing signature
                            const result = await verifier.verifyFile(filePath, verification, { strictMode: true })

                            // Property: Missing required signatures should be rejected
                            expect(result.valid).toBe(false)

                            // Should have signature missing failure
                            if (result.securityFailures) {
                                const hasSignatureMissingFailure = result.securityFailures.some(failure =>
                                    failure.type === SecurityFailureType.SIGNATURE_MISSING
                                )
                                expect(hasSignatureMissingFailure).toBe(true)
                            }

                            // Should indicate signature validation failed
                            expect(result.signatureValid).toBe(false)

                        } finally {
                            // Clean up
                            try {
                                await unlink(filePath)
                            } catch (error) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should generate appropriate security alerts for signature failures', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fileContentArbitrary,
                    checksumAlgorithmArbitrary,
                    signatureAlgorithmArbitrary,
                    invalidSignatureArbitrary,
                    async (fileContent, checksumAlgorithm, signatureAlgorithm, invalidSignature) => {
                        // Create a temporary file
                        const fileName = `test-file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`
                        const filePath = path.join(TEST_DIR, fileName)

                        await writeFile(filePath, Buffer.from(fileContent))

                        try {
                            // Calculate correct checksum
                            const correctChecksum = await generateFileChecksum(filePath, checksumAlgorithm as any)

                            // Set up alert tracking
                            const alerts: any[] = []
                            const testVerifier = new FileIntegrityVerifier({ alertOnFailure: true })
                            testVerifier.onSecurityFailure((failure) => {
                                alerts.push(failure)
                            })

                            // Create security verification with invalid signature
                            const verification: SecurityVerification = {
                                checksumAlgorithm: checksumAlgorithm as any,
                                checksum: correctChecksum,
                                signatureAlgorithm: signatureAlgorithm as any,
                                signature: invalidSignature,
                                publicKey: 'test-public-key'
                            }

                            // Verify file - should fail and generate alerts
                            const result = await testVerifier.verifyFile(filePath, verification)

                            // Property: Signature failures should generate security alerts
                            expect(result.valid).toBe(false)
                            expect(alerts.length).toBeGreaterThan(0)

                            // Should have signature-related alert
                            const hasSignatureAlert = alerts.some(alert =>
                                alert.type === SecurityFailureType.SIGNATURE_INVALID ||
                                alert.type === SecurityFailureType.SIGNATURE_MISSING ||
                                alert.type === SecurityFailureType.VERIFICATION_ERROR
                            )
                            expect(hasSignatureAlert).toBe(true)

                            // Alert should contain relevant information
                            const signatureAlert = alerts.find(alert =>
                                alert.type === SecurityFailureType.SIGNATURE_INVALID ||
                                alert.type === SecurityFailureType.SIGNATURE_MISSING ||
                                alert.type === SecurityFailureType.VERIFICATION_ERROR
                            )

                            if (signatureAlert) {
                                expect(signatureAlert.filePath).toBe(filePath)
                                expect(signatureAlert.message).toBeDefined()
                                expect(signatureAlert.timestamp).toBeInstanceOf(Date)
                            }

                        } finally {
                            // Clean up
                            try {
                                await unlink(filePath)
                            } catch (error) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                ),
                { numRuns: 50 } // Fewer runs for alert testing
            )
        })
    })

    describe('Additional signature verification properties', () => {
        it('should handle malformed signature algorithms gracefully', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fileContentArbitrary,
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s =>
                        !['rsa', 'ecdsa', 'ed25519'].includes(s.toLowerCase())
                    ),
                    async (fileContent, malformedAlgorithm) => {
                        // Create a temporary file
                        const fileName = `test-file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`
                        const filePath = path.join(TEST_DIR, fileName)

                        await writeFile(filePath, Buffer.from(fileContent))

                        try {
                            const correctChecksum = await generateFileChecksum(filePath, 'sha256')

                            const verification: SecurityVerification = {
                                checksumAlgorithm: 'sha256',
                                checksum: correctChecksum,
                                signatureAlgorithm: malformedAlgorithm as any,
                                signature: 'test-signature',
                                publicKey: 'test-key'
                            }

                            // Should handle malformed algorithm gracefully
                            const result = await verifier.verifyFile(filePath, verification)

                            // Property: Malformed algorithms should be rejected gracefully
                            expect(result.valid).toBe(false)
                            expect(result.error).toBeDefined()

                        } finally {
                            try {
                                await unlink(filePath)
                            } catch (error) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                ),
                { numRuns: 50 }
            )
        })
    })
})