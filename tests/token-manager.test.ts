/**
 * Property-based tests for GitHub token validation and management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'

import { GitHubTokenManager, TokenValidationResult } from '../lib/updater/token-manager'

// Custom arbitraries for generating test data
const validClassicTokenArbitrary = fc.array(
    fc.oneof(
        fc.integer({ min: 48, max: 57 }), // 0-9
        fc.integer({ min: 65, max: 90 }), // A-Z
        fc.integer({ min: 97, max: 122 }) // a-z
    ),
    { minLength: 36, maxLength: 36 }
).map(codes => 'ghp_' + String.fromCharCode(...codes))

const validFineGrainedTokenArbitrary = fc.array(
    fc.oneof(
        fc.integer({ min: 48, max: 57 }), // 0-9
        fc.integer({ min: 65, max: 90 }), // A-Z
        fc.integer({ min: 97, max: 122 }), // a-z
        fc.constant(95) // underscore
    ),
    { minLength: 82, maxLength: 82 }
).map(codes => 'github_pat_' + String.fromCharCode(...codes))

const invalidTokenPrefixArbitrary = fc.oneof(
    fc.constant('gho_'), // OAuth app token
    fc.constant('ghs_'), // GitHub App installation token
    fc.constant('ghu_'), // User-to-server token
    fc.constant('invalid_'),
    fc.constant(''),
    fc.constant('token_'),
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.startsWith('ghp_') && !s.startsWith('github_pat_'))
)

const invalidTokenBodyArbitrary = fc.oneof(
    fc.string({ minLength: 0, maxLength: 35 }), // Too short for classic
    fc.string({ minLength: 37, maxLength: 100 }).filter(s => s.length !== 36 && s.length !== 82), // Wrong length
    fc.string({ minLength: 36, maxLength: 36 }).filter(s => /[^A-Za-z0-9]/.test(s)), // Invalid characters for classic
    fc.string({ minLength: 82, maxLength: 82 }).filter(s => /[^A-Za-z0-9_]/.test(s)) // Invalid characters for fine-grained
)

const malformedTokenArbitrary = fc.oneof(
    // Wrong prefix with valid body
    fc.tuple(invalidTokenPrefixArbitrary, fc.string({ minLength: 36, maxLength: 36 }))
        .map(([prefix, body]) => prefix + body),

    // Valid prefix with invalid body
    fc.tuple(fc.oneof(fc.constant('ghp_'), fc.constant('github_pat_')), invalidTokenBodyArbitrary)
        .map(([prefix, body]) => prefix + body),

    // Completely invalid
    fc.string({ minLength: 1, maxLength: 200 }).filter(s =>
        !s.startsWith('ghp_') && !s.startsWith('github_pat_')
    ),

    // Empty or whitespace
    fc.oneof(
        fc.constant(''),
        fc.constant('   '),
        fc.constant('\t\n'),
        fc.string({ minLength: 1, maxLength: 10 }).map(s => ' '.repeat(s.length))
    )
)

describe('Token Manager - Property Tests', () => {
    let tokenManager: GitHubTokenManager

    beforeEach(() => {
        tokenManager = new GitHubTokenManager()
    })

    describe('Property 6: Token format validation', () => {
        /**
         * **Feature: github-auto-updater, Property 6: Token format validation**
         * **Validates: Requirements 2.1**
         * 
         * For any Personal Access Token input, the system should validate the token format and accept only properly formatted GitHub tokens
         */
        it('should accept all valid classic GitHub tokens', async () => {
            await fc.assert(
                fc.property(
                    validClassicTokenArbitrary,
                    (token) => {
                        const result = tokenManager.validateTokenFormat(token)

                        // Property: All valid classic tokens should be accepted
                        expect(result.isValid).toBe(true)
                        expect(result.tokenType).toBe('classic')
                        expect(result.format).toBe('valid')
                        expect(result.errors).toHaveLength(0)

                        // Should have warning about classic tokens
                        expect(result.warnings.length).toBeGreaterThan(0)
                        expect(result.warnings.some(w => w.includes('Classic tokens'))).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should accept all valid fine-grained GitHub tokens', async () => {
            await fc.assert(
                fc.property(
                    validFineGrainedTokenArbitrary,
                    (token) => {
                        const result = tokenManager.validateTokenFormat(token)

                        // Property: All valid fine-grained tokens should be accepted
                        expect(result.isValid).toBe(true)
                        expect(result.tokenType).toBe('fine-grained')
                        expect(result.format).toBe('valid')
                        expect(result.errors).toHaveLength(0)

                        // Should not have warnings for fine-grained tokens
                        expect(result.warnings.length).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should reject all malformed tokens', async () => {
            await fc.assert(
                fc.property(
                    malformedTokenArbitrary,
                    (token) => {
                        const result = tokenManager.validateTokenFormat(token)

                        // Property: All malformed tokens should be rejected
                        expect(result.isValid).toBe(false)
                        expect(result.tokenType).toBe('unknown')
                        expect(result.format).not.toBe('valid')
                        expect(result.errors.length).toBeGreaterThan(0)

                        // Should have a meaningful error message
                        const errorMessage = tokenManager.getValidationErrorMessage(result)
                        expect(errorMessage).toBeDefined()
                        expect(typeof errorMessage).toBe('string')
                        expect(errorMessage.length).toBeGreaterThan(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should handle edge cases consistently', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.constant(123),
                        fc.constant({}),
                        fc.constant([]),
                        fc.constant(true)
                    ),
                    (invalidInput) => {
                        // Property: Invalid input types should be handled gracefully
                        const result = tokenManager.validateTokenFormat(invalidInput as any)

                        expect(result.isValid).toBe(false)
                        expect(result.errors.length).toBeGreaterThan(0)
                        expect(result.errors[0]).toContain('must be a non-empty string')
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('should provide consistent validation results for the same token', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(validClassicTokenArbitrary, validFineGrainedTokenArbitrary, malformedTokenArbitrary),
                    (token) => {
                        // Property: Multiple validations of the same token should yield identical results
                        const result1 = tokenManager.validateTokenFormat(token)
                        const result2 = tokenManager.validateTokenFormat(token)

                        expect(result1.isValid).toBe(result2.isValid)
                        expect(result1.tokenType).toBe(result2.tokenType)
                        expect(result1.format).toBe(result2.format)
                        expect(result1.errors).toEqual(result2.errors)
                        expect(result1.warnings).toEqual(result2.warnings)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should correctly identify token types', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        validClassicTokenArbitrary.map(token => ({ token, expectedType: 'classic' as const })),
                        validFineGrainedTokenArbitrary.map(token => ({ token, expectedType: 'fine-grained' as const }))
                    ),
                    ({ token, expectedType }) => {
                        const result = tokenManager.validateTokenFormat(token)

                        // Property: Token type should be correctly identified for valid tokens
                        expect(result.isValid).toBe(true)
                        expect(result.tokenType).toBe(expectedType)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should handle whitespace correctly', async () => {
            await fc.assert(
                fc.property(
                    validClassicTokenArbitrary,
                    fc.string({ minLength: 0, maxLength: 5 }).filter(s => /^\s*$/.test(s)), // whitespace
                    fc.string({ minLength: 0, maxLength: 5 }).filter(s => /^\s*$/.test(s)), // whitespace
                    (token, prefixWhitespace, suffixWhitespace) => {
                        const tokenWithWhitespace = prefixWhitespace + token + suffixWhitespace
                        const result = tokenManager.validateTokenFormat(tokenWithWhitespace)

                        // Property: Whitespace should be trimmed and token should still be valid
                        if (prefixWhitespace.length > 0 || suffixWhitespace.length > 0) {
                            // Token should still be valid after trimming
                            expect(result.isValid).toBe(true)
                            expect(result.tokenType).toBe('classic')
                        } else {
                            // No whitespace, should be valid
                            expect(result.isValid).toBe(true)
                        }
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('should provide appropriate error categories', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string({ minLength: 1, maxLength: 19 }), // Too short
                        fc.string({ minLength: 201, maxLength: 300 }), // Too long
                        fc.constant('ghp_' + 'x'.repeat(35)), // Wrong length for classic
                        fc.constant('github_pat_' + 'x'.repeat(81)), // Wrong length for fine-grained
                        fc.constant('invalid_prefix_' + 'x'.repeat(36)), // Wrong prefix
                        fc.constant('ghp_' + 'x'.repeat(35) + '!'), // Invalid characters
                    ),
                    (invalidToken) => {
                        const result = tokenManager.validateTokenFormat(invalidToken)

                        // Property: Invalid tokens should have appropriate error categorization
                        expect(result.isValid).toBe(false)
                        expect(result.format).toMatch(/^invalid-(format|length|prefix)$/)

                        // Should have specific error messages based on the problem
                        const errorMessage = result.errors[0].toLowerCase()
                        if (invalidToken.length < 20) {
                            expect(errorMessage).toContain('too short')
                        } else if (invalidToken.length > 200) {
                            expect(errorMessage).toContain('too long')
                        } else if (invalidToken.startsWith('ghp_') || invalidToken.startsWith('github_pat_')) {
                            expect(errorMessage).toMatch(/(characters|length)/i)
                        } else {
                            expect(errorMessage).toMatch(/(format|prefix)/i)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Token renewal prompt generation', () => {
        it('should generate appropriate renewal prompts for invalid tokens', async () => {
            await fc.assert(
                fc.property(
                    malformedTokenArbitrary,
                    (invalidToken) => {
                        const validationResult = tokenManager.validateTokenFormat(invalidToken)
                        const renewalPrompt = tokenManager.generateRenewalPrompt(validationResult)

                        // Property: Invalid tokens should always generate renewal prompts
                        expect(renewalPrompt.shouldPrompt).toBe(true)
                        expect(renewalPrompt.urgency).toBe('critical')
                        expect(renewalPrompt.reason).toBe('invalid')
                        expect(renewalPrompt.message).toBeDefined()
                        expect(renewalPrompt.suggestedActions.length).toBeGreaterThan(0)

                        // Should contain helpful guidance
                        expect(renewalPrompt.suggestedActions.some(action =>
                            action.toLowerCase().includes('github')
                        )).toBe(true)
                    }
                ),
                { numRuns: 50 }
            )
        })

        it('should not prompt for valid tokens without issues', async () => {
            await fc.assert(
                fc.property(
                    validFineGrainedTokenArbitrary,
                    (validToken) => {
                        const validationResult = tokenManager.validateTokenFormat(validToken)
                        // Simulate valid token with no expiration issues
                        validationResult.expirationStatus = 'valid'
                        validationResult.scopes = ['repo', 'read:org'] // Required scopes

                        const renewalPrompt = tokenManager.generateRenewalPrompt(validationResult)

                        // Property: Valid tokens with proper scopes should not generate prompts
                        expect(renewalPrompt.shouldPrompt).toBe(false)
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('Secure storage verification', () => {
        it('should reject plaintext tokens as insecure', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(validClassicTokenArbitrary, validFineGrainedTokenArbitrary),
                    (token) => {
                        const plaintextBuffer = Buffer.from(token, 'utf8')

                        // Property: Plaintext tokens should be detected as insecure
                        const isSecure = tokenManager.verifySecureStorage(plaintextBuffer)
                        expect(isSecure).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should accept properly encrypted data', async () => {
            await fc.assert(
                fc.property(
                    fc.uint8Array({ minLength: 32, maxLength: 256 }).filter(arr => {
                        // Filter out arrays that look like plaintext GitHub tokens
                        const str = Buffer.from(arr).toString('utf8')
                        return !str.startsWith('ghp_') && !str.startsWith('github_pat_')
                    }),
                    (encryptedData) => {
                        const encryptedBuffer = Buffer.from(encryptedData)

                        // Property: Non-plaintext data of sufficient length should be considered secure
                        const isSecure = tokenManager.verifySecureStorage(encryptedBuffer)
                        expect(isSecure).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should reject invalid input types', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string(),
                        fc.integer(),
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.constant({}),
                        fc.constant([])
                    ),
                    (invalidInput) => {
                        // Property: Non-Buffer inputs should be rejected
                        const isSecure = tokenManager.verifySecureStorage(invalidInput as any)
                        expect(isSecure).toBe(false)
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('Token manager utility methods', () => {
        it('should provide consistent error messages', async () => {
            await fc.assert(
                fc.property(
                    malformedTokenArbitrary,
                    (invalidToken) => {
                        const validationResult = tokenManager.validateTokenFormat(invalidToken)
                        const errorMessage = tokenManager.getValidationErrorMessage(validationResult)

                        // Property: Error messages should be consistent and informative
                        expect(typeof errorMessage).toBe('string')
                        expect(errorMessage.length).toBeGreaterThan(0)
                        expect(errorMessage).not.toBe('Token validation failed') // Should be more specific

                        // Should match the first error in the validation result
                        if (validationResult.errors.length > 0) {
                            expect(errorMessage).toBe(validationResult.errors[0])
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('should correctly identify tokens needing immediate attention', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        validClassicTokenArbitrary.map(token => ({ token, shouldNeedAttention: false })),
                        malformedTokenArbitrary.map(token => ({ token, shouldNeedAttention: true }))
                    ),
                    ({ token, shouldNeedAttention }) => {
                        const validationResult = tokenManager.validateTokenFormat(token)
                        const needsAttention = tokenManager.needsImmediateAttention(validationResult)

                        // Property: Attention needs should match token validity
                        expect(needsAttention).toBe(shouldNeedAttention)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})