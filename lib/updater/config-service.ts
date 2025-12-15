/**
 * Configuration service for the GitHub Auto-Updater system
 * Handles secure credential storage and update settings management
 */

import { safeStorage } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { ConfigService } from './interfaces'
import { UpdateSettings, TimeWindow } from './types'
import { GitHubTokenManager, TokenValidationResult, TokenRenewalPrompt } from './token-manager'

/**
 * Default update settings
 */
const DEFAULT_SETTINGS: UpdateSettings = {
    autoCheck: false,
    autoInstall: false,
    checkInterval: 24, // 24 hours
    updateChannel: 'latest'
}

/**
 * Policy settings that can override user preferences
 */
interface PolicySettings {
    disableAutoCheck?: boolean
    disableAutoInstall?: boolean
    forceCheckInterval?: number
    allowedChannels?: string[]
    maintenanceWindow?: TimeWindow
    precedence: 'user' | 'enterprise'
}

/**
 * Configuration service implementation with secure storage
 */
export class ConfigServiceImpl implements ConfigService {
    private readonly configDir: string
    private readonly settingsFile: string
    private readonly tokenFile: string
    private readonly policyFile: string
    private cachedSettings: UpdateSettings | null = null
    private cachedPolicy: PolicySettings | null = null
    private readonly tokenManager: GitHubTokenManager

    constructor() {
        // Use Electron's userData directory for configuration storage
        this.configDir = path.join(app.getPath('userData'), 'updater-config')
        this.settingsFile = path.join(this.configDir, 'settings.json')
        this.tokenFile = path.join(this.configDir, 'token.enc')
        this.policyFile = path.join(this.configDir, 'policy.json')
        this.tokenManager = new GitHubTokenManager()
    }

    /**
     * Initialize the configuration service
     */
    async initialize(): Promise<void> {
        await this.ensureConfigDirectory()
        await this.loadPolicy()
    }

    /**
     * Get the stored GitHub token (decrypted)
     */
    async getGitHubToken(): Promise<string | null> {
        try {
            const encryptedData = await fs.readFile(this.tokenFile)
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('Encryption not available on this system')
            }
            const decryptedBuffer = safeStorage.decryptString(encryptedData)
            return decryptedBuffer || null
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null // File doesn't exist
            }
            throw new Error(`Failed to retrieve GitHub token: ${error}`)
        }
    }

    /**
     * Store the GitHub token (encrypted) with comprehensive validation
     */
    async setGitHubToken(token: string): Promise<void> {
        if (!token || typeof token !== 'string') {
            throw new Error('Invalid token: must be a non-empty string')
        }

        // Comprehensive token validation
        const validationResult = this.tokenManager.validateTokenFormat(token)
        if (!validationResult.isValid) {
            const errorMessage = this.tokenManager.getValidationErrorMessage(validationResult)
            throw new Error(`Invalid GitHub token: ${errorMessage}`)
        }

        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Encryption not available on this system')
        }

        try {
            await this.ensureConfigDirectory()
            const encryptedData = safeStorage.encryptString(token)

            // Verify that the token was encrypted properly
            if (!this.tokenManager.verifySecureStorage(encryptedData)) {
                throw new Error('Token encryption verification failed')
            }

            await fs.writeFile(this.tokenFile, encryptedData)
        } catch (error) {
            throw new Error(`Failed to store GitHub token: ${error}`)
        }
    }

    /**
     * Get current update settings (merged with policy)
     */
    async getUpdateSettings(): Promise<UpdateSettings> {
        if (!this.cachedSettings) {
            await this.loadSettings()
        }

        const userSettings = this.cachedSettings || DEFAULT_SETTINGS
        const policy = this.cachedPolicy

        // Apply policy overrides if they exist
        if (policy) {
            return this.applyPolicyToSettings(userSettings, policy)
        }

        return userSettings
    }

    /**
     * Set update settings (user preferences)
     */
    async setUpdateSettings(settings: UpdateSettings): Promise<void> {
        if (!this.isValidUpdateSettings(settings)) {
            throw new Error('Invalid update settings')
        }

        try {
            await this.ensureConfigDirectory()
            await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2))
            this.cachedSettings = settings
        } catch (error) {
            throw new Error(`Failed to save update settings: ${error}`)
        }
    }

    /**
     * Get policy settings (enterprise/administrative)
     */
    async getPolicySettings(): Promise<PolicySettings | null> {
        return this.cachedPolicy
    }

    /**
     * Set policy settings (enterprise/administrative)
     */
    async setPolicySettings(policy: PolicySettings): Promise<void> {
        if (!this.isValidPolicySettings(policy)) {
            throw new Error('Invalid policy settings')
        }

        try {
            await this.ensureConfigDirectory()
            await fs.writeFile(this.policyFile, JSON.stringify(policy, null, 2))
            this.cachedPolicy = policy
        } catch (error) {
            throw new Error(`Failed to save policy settings: ${error}`)
        }
    }

    /**
     * Check if automatic update checks are allowed
     */
    async isAutoCheckAllowed(): Promise<boolean> {
        const policy = this.cachedPolicy

        if (policy?.disableAutoCheck === true) {
            return false
        }

        return true
    }

    /**
     * Check if automatic installation is allowed
     */
    async isAutoInstallAllowed(): Promise<boolean> {
        const policy = this.cachedPolicy

        if (policy?.disableAutoInstall === true) {
            return false
        }

        return true
    }

    /**
     * Get effective check interval (considering policy)
     */
    async getEffectiveCheckInterval(): Promise<number> {
        const settings = await this.getUpdateSettings()
        const policy = this.cachedPolicy

        if (policy?.forceCheckInterval) {
            return policy.forceCheckInterval
        }

        return settings.checkInterval
    }

    /**
     * Check if we're currently in a maintenance window
     */
    async isInMaintenanceWindow(): Promise<boolean> {
        const settings = await this.getUpdateSettings()

        if (!settings.maintenanceWindow) {
            return true // No maintenance window means always allowed
        }

        const now = new Date()
        const currentHour = now.getHours()
        const currentDay = now.getDay()

        const window = settings.maintenanceWindow

        // Check if current day is allowed
        if (!window.days.includes(currentDay)) {
            return false
        }

        // Check if current hour is in the window
        if (window.startHour <= window.endHour) {
            // Same day window (e.g., 9 AM to 5 PM)
            return currentHour >= window.startHour && currentHour < window.endHour
        } else {
            // Overnight window (e.g., 10 PM to 6 AM)
            return currentHour >= window.startHour || currentHour < window.endHour
        }
    }

    /**
     * Check if a specific update channel is allowed by policy
     */
    async isUpdateChannelAllowed(channel: string): Promise<boolean> {
        const policy = this.cachedPolicy

        if (!policy?.allowedChannels) {
            return true // No channel restrictions
        }

        return policy.allowedChannels.includes(channel)
    }

    /**
     * Get the list of allowed update channels
     */
    async getAllowedUpdateChannels(): Promise<string[]> {
        const policy = this.cachedPolicy

        if (!policy?.allowedChannels) {
            return ['latest', 'prerelease', 'custom'] // All channels allowed
        }

        return policy.allowedChannels
    }

    /**
     * Validate the stored GitHub token
     */
    async validateStoredToken(): Promise<TokenValidationResult> {
        try {
            const token = await this.getGitHubToken()
            if (!token) {
                return {
                    isValid: false,
                    tokenType: 'unknown',
                    format: 'invalid-format',
                    expirationStatus: 'unknown',
                    errors: ['No token stored'],
                    warnings: []
                }
            }

            return await this.tokenManager.checkTokenExpiration(token)
        } catch (error) {
            return {
                isValid: false,
                tokenType: 'unknown',
                format: 'invalid-format',
                expirationStatus: 'unknown',
                errors: [`Failed to validate token: ${error}`],
                warnings: []
            }
        }
    }

    /**
     * Check if token renewal is needed
     */
    async checkTokenRenewal(): Promise<TokenRenewalPrompt> {
        const validationResult = await this.validateStoredToken()
        return this.tokenManager.generateRenewalPrompt(validationResult)
    }

    /**
     * Get comprehensive token status
     */
    async getTokenStatus(): Promise<{
        validation: TokenValidationResult
        renewal: TokenRenewalPrompt
        needsAttention: boolean
    }> {
        const validation = await this.validateStoredToken()
        const renewal = this.tokenManager.generateRenewalPrompt(validation)
        const needsAttention = this.tokenManager.needsImmediateAttention(validation)

        return {
            validation,
            renewal,
            needsAttention
        }
    }

    /**
     * Validate token format without network calls
     */
    validateTokenFormat(token: string): TokenValidationResult {
        return this.tokenManager.validateTokenFormat(token)
    }

    /**
     * Get recommended token type for new tokens
     */
    getRecommendedTokenType(): string {
        return this.tokenManager.getRecommendedTokenType()
    }

    /**
     * Check if enterprise policies are active
     */
    async hasEnterprisePolicies(): Promise<boolean> {
        return this.cachedPolicy?.precedence === 'enterprise'
    }

    /**
     * Private helper methods
     */

    private async ensureConfigDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.configDir, { recursive: true })
        } catch (error) {
            throw new Error(`Failed to create config directory: ${error}`)
        }
    }

    private async loadSettings(): Promise<void> {
        try {
            const data = await fs.readFile(this.settingsFile, 'utf-8')
            const settings = JSON.parse(data)

            if (this.isValidUpdateSettings(settings)) {
                this.cachedSettings = settings
            } else {
                this.cachedSettings = DEFAULT_SETTINGS
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.cachedSettings = DEFAULT_SETTINGS
            } else {
                throw new Error(`Failed to load settings: ${error}`)
            }
        }
    }

    private async loadPolicy(): Promise<void> {
        try {
            const data = await fs.readFile(this.policyFile, 'utf-8')
            const policy = JSON.parse(data)
            this.cachedPolicy = policy
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.cachedPolicy = null // No policy file
            } else {
                // Log error but don't fail - policy is optional
                console.warn(`Failed to load policy settings: ${error}`)
                this.cachedPolicy = null
            }
        }
    }

    private applyPolicyToSettings(userSettings: UpdateSettings, policy: PolicySettings): UpdateSettings {
        const result = { ...userSettings }

        // Enterprise policies take precedence
        if (policy.precedence === 'enterprise') {
            if (policy.disableAutoCheck !== undefined) {
                result.autoCheck = !policy.disableAutoCheck
            }
            if (policy.disableAutoInstall !== undefined) {
                result.autoInstall = !policy.disableAutoInstall
            }
            if (policy.forceCheckInterval !== undefined) {
                result.checkInterval = policy.forceCheckInterval
            }
            if (policy.allowedChannels && !policy.allowedChannels.includes(result.updateChannel)) {
                result.updateChannel = policy.allowedChannels[0] as any || 'latest'
            }
            if (policy.maintenanceWindow) {
                result.maintenanceWindow = policy.maintenanceWindow
            }
        }

        return result
    }

    /**
     * @deprecated Use tokenManager.validateTokenFormat instead
     */
    private isValidGitHubToken(token: string): boolean {
        const result = this.tokenManager.validateTokenFormat(token)
        return result.isValid
    }

    private isValidUpdateSettings(settings: any): settings is UpdateSettings {
        if (!settings || typeof settings !== 'object') {
            return false
        }

        const required = ['autoCheck', 'autoInstall', 'checkInterval', 'updateChannel']
        for (const field of required) {
            if (!(field in settings)) {
                return false
            }
        }

        // Validate types
        if (typeof settings.autoCheck !== 'boolean' ||
            typeof settings.autoInstall !== 'boolean' ||
            typeof settings.checkInterval !== 'number' ||
            typeof settings.updateChannel !== 'string') {
            return false
        }

        // Validate values
        if (settings.checkInterval < 1 || settings.checkInterval > 168) { // 1 hour to 1 week
            return false
        }

        const validChannels = ['latest', 'prerelease', 'custom']
        if (!validChannels.includes(settings.updateChannel)) {
            return false
        }

        // Validate maintenance window if present
        if (settings.maintenanceWindow) {
            if (!this.isValidTimeWindow(settings.maintenanceWindow)) {
                return false
            }
        }

        return true
    }

    private isValidTimeWindow(window: any): window is TimeWindow {
        if (!window || typeof window !== 'object') {
            return false
        }

        if (typeof window.startHour !== 'number' ||
            typeof window.endHour !== 'number' ||
            !Array.isArray(window.days)) {
            return false
        }

        if (window.startHour < 0 || window.startHour > 23 ||
            window.endHour < 0 || window.endHour > 23) {
            return false
        }

        if (!window.days.every((day: any) =>
            typeof day === 'number' && day >= 0 && day <= 6)) {
            return false
        }

        return true
    }

    /**
     * Validate policy settings before applying them
     */
    private isValidPolicySettings(policy: any): policy is PolicySettings {
        if (!policy || typeof policy !== 'object') {
            return false
        }

        // Validate precedence
        if (policy.precedence && !['user', 'enterprise'].includes(policy.precedence)) {
            return false
        }

        // Validate boolean fields
        if (policy.disableAutoCheck !== undefined && typeof policy.disableAutoCheck !== 'boolean') {
            return false
        }

        if (policy.disableAutoInstall !== undefined && typeof policy.disableAutoInstall !== 'boolean') {
            return false
        }

        // Validate check interval
        if (policy.forceCheckInterval !== undefined) {
            if (typeof policy.forceCheckInterval !== 'number' ||
                policy.forceCheckInterval < 1 ||
                policy.forceCheckInterval > 168) {
                return false
            }
        }

        // Validate allowed channels
        if (policy.allowedChannels !== undefined) {
            if (!Array.isArray(policy.allowedChannels)) {
                return false
            }
            const validChannels = ['latest', 'prerelease', 'custom']
            if (!policy.allowedChannels.every((channel: any) =>
                typeof channel === 'string' && validChannels.includes(channel))) {
                return false
            }
        }

        // Validate maintenance window
        if (policy.maintenanceWindow !== undefined) {
            if (!this.isValidTimeWindow(policy.maintenanceWindow)) {
                return false
            }
        }

        return true
    }
}