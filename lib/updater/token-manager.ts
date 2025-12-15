/**
 * GitHub Token Management System
 * Handles token validation, expiration detection, and renewal prompts
 */

export interface TokenValidationResult {
    isValid: boolean
    tokenType: 'classic' | 'fine-grained' | 'unknown'
    format: 'valid' | 'invalid-format' | 'invalid-length' | 'invalid-prefix'
    expirationStatus: 'valid' | 'expired' | 'expiring-soon' | 'unknown'
    expirationDate?: Date
    scopes?: string[]
    errors: string[]
    warnings: string[]
}

export interface TokenRenewalPrompt {
    shouldPrompt: boolean
    reason: 'expired' | 'expiring-soon' | 'invalid' | 'insufficient-scopes'
    message: string
    urgency: 'low' | 'medium' | 'high' | 'critical'
    suggestedActions: string[]
}

export interface GitHubTokenInfo {
    id: number
    url: string
    scopes: string[]
    token: string
    token_last_eight: string
    hashed_token: string
    app: {
        name: string
        url: string
        client_id: string
    }
    note?: string
    note_url?: string
    updated_at: string
    created_at: string
    fingerprint?: string
    expires_at?: string
}

/**
 * Comprehensive GitHub token management system
 */
export class GitHubTokenManager {
    private readonly requiredScopes = ['repo', 'read:org']
    private readonly expirationWarningDays = 7

    /**
     * Validate GitHub token format and structure
     */
    validateTokenFormat(token: string): TokenValidationResult {
        const result: TokenValidationResult = {
            isValid: false,
            tokenType: 'unknown',
            format: 'invalid-format',
            expirationStatus: 'unknown',
            errors: [],
            warnings: []
        }

        if (!token || typeof token !== 'string') {
            result.errors.push('Token must be a non-empty string')
            return result
        }

        // Trim whitespace
        token = token.trim()

        if (token.length === 0) {
            result.errors.push('Token cannot be empty')
            return result
        }

        // Check for classic personal access token (ghp_)
        const classicPattern = /^ghp_[A-Za-z0-9]{36}$/
        if (classicPattern.test(token)) {
            result.tokenType = 'classic'
            result.format = 'valid'
            result.isValid = true
            result.warnings.push('Classic tokens have limited functionality compared to fine-grained tokens')
            return result
        }

        // Check for fine-grained personal access token (github_pat_)
        const fineGrainedPattern = /^github_pat_[A-Za-z0-9_]{82}$/
        if (fineGrainedPattern.test(token)) {
            result.tokenType = 'fine-grained'
            result.format = 'valid'
            result.isValid = true
            return result
        }

        // Check for OAuth app token (gho_)
        const oauthPattern = /^gho_[A-Za-z0-9]{36}$/
        if (oauthPattern.test(token)) {
            result.errors.push('OAuth app tokens are not supported for private repository access')
            result.format = 'invalid-format'
            return result
        }

        // Check for GitHub App installation token (ghs_)
        const appPattern = /^ghs_[A-Za-z0-9]{36}$/
        if (appPattern.test(token)) {
            result.errors.push('GitHub App installation tokens are not supported')
            result.format = 'invalid-format'
            return result
        }

        // Check for user-to-server token (ghu_)
        const userToServerPattern = /^ghu_[A-Za-z0-9]{36}$/
        if (userToServerPattern.test(token)) {
            result.errors.push('User-to-server tokens are not supported')
            result.format = 'invalid-format'
            return result
        }

        // Check if it starts with a GitHub token prefix but has wrong length
        if (token.startsWith('ghp_')) {
            if (token.length !== 40) {
                result.errors.push(`Classic token should be 40 characters long, got ${token.length}`)
                result.format = 'invalid-length'
            } else {
                result.errors.push('Classic token contains invalid characters')
                result.format = 'invalid-format'
            }
            return result
        }

        if (token.startsWith('github_pat_')) {
            if (token.length !== 93) {
                result.errors.push(`Fine-grained token should be 93 characters long, got ${token.length}`)
                result.format = 'invalid-length'
            } else {
                result.errors.push('Fine-grained token contains invalid characters')
                result.format = 'invalid-format'
            }
            return result
        }

        // Generic validation for unknown format
        if (token.length < 20) {
            result.errors.push('Token is too short to be a valid GitHub token')
            result.format = 'invalid-length'
        } else if (token.length > 200) {
            result.errors.push('Token is too long to be a valid GitHub token')
            result.format = 'invalid-length'
        } else {
            result.errors.push('Token does not match any known GitHub token format')
            result.format = 'invalid-prefix'
        }

        return result
    }

    /**
     * Check token expiration status by calling GitHub API
     */
    async checkTokenExpiration(token: string): Promise<TokenValidationResult> {
        const formatResult = this.validateTokenFormat(token)

        if (!formatResult.isValid) {
            return formatResult
        }

        try {
            // For classic tokens, check via user endpoint
            if (formatResult.tokenType === 'classic') {
                return await this.checkClassicTokenExpiration(token, formatResult)
            }

            // For fine-grained tokens, check via apps endpoint
            if (formatResult.tokenType === 'fine-grained') {
                return await this.checkFineGrainedTokenExpiration(token, formatResult)
            }

            return formatResult
        } catch (error) {
            formatResult.errors.push(`Failed to check token expiration: ${error}`)
            formatResult.expirationStatus = 'unknown'
            return formatResult
        }
    }

    /**
     * Check classic token expiration
     */
    private async checkClassicTokenExpiration(
        token: string,
        result: TokenValidationResult
    ): Promise<TokenValidationResult> {
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'DBConsole-Updater/1.0.0'
                }
            })

            if (response.status === 401) {
                result.isValid = false
                result.expirationStatus = 'expired'
                result.errors.push('Token is invalid or expired')
                return result
            }

            if (!response.ok) {
                result.warnings.push(`Unable to verify token expiration: ${response.status} ${response.statusText}`)
                result.expirationStatus = 'unknown'
                return result
            }

            // Check token scopes from response headers
            const scopes = response.headers.get('x-oauth-scopes')
            if (scopes) {
                result.scopes = scopes.split(',').map(s => s.trim()).filter(s => s.length > 0)

                // Check if token has required scopes
                const hasRequiredScopes = this.requiredScopes.every(scope =>
                    result.scopes!.includes(scope)
                )

                if (!hasRequiredScopes) {
                    result.warnings.push(`Token may not have sufficient scopes. Required: ${this.requiredScopes.join(', ')}. Current: ${result.scopes.join(', ')}`)
                }
            }

            // Classic tokens don't have expiration dates in the API response
            result.expirationStatus = 'valid'
            result.warnings.push('Classic tokens do not have expiration dates - consider using fine-grained tokens')

            return result
        } catch (error) {
            result.errors.push(`Network error checking token: ${error}`)
            result.expirationStatus = 'unknown'
            return result
        }
    }

    /**
     * Check fine-grained token expiration
     */
    private async checkFineGrainedTokenExpiration(
        token: string,
        result: TokenValidationResult
    ): Promise<TokenValidationResult> {
        try {
            // Fine-grained tokens use different API endpoints
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'DBConsole-Updater/1.0.0'
                }
            })

            if (response.status === 401) {
                result.isValid = false
                result.expirationStatus = 'expired'
                result.errors.push('Token is invalid or expired')
                return result
            }

            if (!response.ok) {
                result.warnings.push(`Unable to verify token expiration: ${response.status} ${response.statusText}`)
                result.expirationStatus = 'unknown'
                return result
            }

            // Fine-grained tokens have expiration information
            // Note: The actual expiration date is not directly available via API
            // but we can infer from the token structure or error responses
            result.expirationStatus = 'valid'

            return result
        } catch (error) {
            result.errors.push(`Network error checking token: ${error}`)
            result.expirationStatus = 'unknown'
            return result
        }
    }

    /**
     * Generate token renewal prompt based on validation result
     */
    generateRenewalPrompt(validationResult: TokenValidationResult): TokenRenewalPrompt {
        const prompt: TokenRenewalPrompt = {
            shouldPrompt: false,
            reason: 'invalid',
            message: '',
            urgency: 'low',
            suggestedActions: []
        }

        if (!validationResult.isValid) {
            prompt.shouldPrompt = true
            prompt.urgency = 'critical'

            if (validationResult.format !== 'valid') {
                prompt.reason = 'invalid'
                prompt.message = 'The GitHub token format is invalid and needs to be replaced.'
                prompt.suggestedActions = [
                    'Go to GitHub Settings > Developer settings > Personal access tokens',
                    'Generate a new personal access token',
                    'Ensure the token has "repo" and "read:org" scopes',
                    'Copy the new token and update your configuration'
                ]
            } else if (validationResult.expirationStatus === 'expired') {
                prompt.reason = 'expired'
                prompt.message = 'The GitHub token has expired and needs to be renewed.'
                prompt.suggestedActions = [
                    'Go to GitHub Settings > Developer settings > Personal access tokens',
                    'Find your existing token and regenerate it',
                    'Or create a new token with the same scopes',
                    'Update your configuration with the new token'
                ]
            }

            return prompt
        }

        if (validationResult.expirationStatus === 'expiring-soon') {
            prompt.shouldPrompt = true
            prompt.reason = 'expiring-soon'
            prompt.urgency = 'medium'
            prompt.message = `The GitHub token will expire soon${validationResult.expirationDate ? ` on ${validationResult.expirationDate.toLocaleDateString()}` : ''}.`
            prompt.suggestedActions = [
                'Renew your GitHub token before it expires',
                'Go to GitHub Settings > Developer settings > Personal access tokens',
                'Regenerate or create a new token',
                'Update your configuration with the new token'
            ]
            return prompt
        }

        // Check for insufficient scopes
        if (validationResult.scopes) {
            const hasRequiredScopes = this.requiredScopes.every(scope =>
                validationResult.scopes!.includes(scope)
            )

            if (!hasRequiredScopes) {
                prompt.shouldPrompt = true
                prompt.reason = 'insufficient-scopes'
                prompt.urgency = 'high'
                prompt.message = 'The GitHub token does not have sufficient permissions for private repository access.'
                prompt.suggestedActions = [
                    'Go to GitHub Settings > Developer settings > Personal access tokens',
                    'Edit your existing token or create a new one',
                    `Ensure the token has these scopes: ${this.requiredScopes.join(', ')}`,
                    'Update your configuration with the updated token'
                ]
                return prompt
            }
        }

        // Check for classic token warning
        if (validationResult.tokenType === 'classic') {
            prompt.shouldPrompt = true
            prompt.reason = 'invalid'
            prompt.urgency = 'low'
            prompt.message = 'Consider upgrading to a fine-grained personal access token for better security and functionality.'
            prompt.suggestedActions = [
                'Go to GitHub Settings > Developer settings > Personal access tokens',
                'Create a new fine-grained personal access token',
                'Configure repository access and permissions',
                'Replace your classic token with the new fine-grained token'
            ]
        }

        return prompt
    }

    /**
     * Validate token and generate renewal prompt in one call
     */
    async validateAndPrompt(token: string): Promise<{
        validation: TokenValidationResult
        renewal: TokenRenewalPrompt
    }> {
        const validation = await this.checkTokenExpiration(token)
        const renewal = this.generateRenewalPrompt(validation)

        return { validation, renewal }
    }

    /**
     * Get user-friendly error message for token validation
     */
    getValidationErrorMessage(validationResult: TokenValidationResult): string {
        if (validationResult.isValid) {
            return 'Token is valid'
        }

        if (validationResult.errors.length > 0) {
            return validationResult.errors[0]
        }

        return 'Token validation failed'
    }

    /**
     * Check if token needs immediate attention
     */
    needsImmediateAttention(validationResult: TokenValidationResult): boolean {
        return !validationResult.isValid ||
            validationResult.expirationStatus === 'expired' ||
            validationResult.expirationStatus === 'expiring-soon'
    }

    /**
     * Get recommended token type for new tokens
     */
    getRecommendedTokenType(): 'fine-grained' {
        return 'fine-grained'
    }

    /**
     * Generate secure token storage verification
     */
    verifySecureStorage(encryptedToken: Buffer): boolean {
        try {
            // Basic verification that the token is encrypted
            if (!Buffer.isBuffer(encryptedToken)) {
                return false
            }

            // Check that it's not plaintext (basic heuristic)
            const tokenString = encryptedToken.toString('utf8')

            // If it looks like a GitHub token pattern, it's not encrypted
            if (/^(gh[pous]_|github_pat_)/.test(tokenString)) {
                return false
            }

            // If it's too short to be encrypted, it's probably not encrypted
            if (encryptedToken.length < 32) {
                return false
            }

            return true
        } catch (error) {
            return false
        }
    }
}

/**
 * Default token manager instance
 */
export const tokenManager = new GitHubTokenManager()

/**
 * Utility function for quick token validation
 */
export async function validateGitHubToken(token: string): Promise<TokenValidationResult> {
    return tokenManager.checkTokenExpiration(token)
}

/**
 * Utility function for token format validation only
 */
export function validateTokenFormat(token: string): TokenValidationResult {
    return tokenManager.validateTokenFormat(token)
}