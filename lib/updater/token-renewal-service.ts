/**
 * Token Renewal Service
 * Handles token expiration detection and user prompts for renewal
 */

import { GitHubTokenManager, TokenValidationResult, TokenRenewalPrompt } from './token-manager'
import { ConfigServiceImpl } from './config-service'

export interface TokenRenewalNotification {
    id: string
    timestamp: Date
    type: 'warning' | 'error' | 'info'
    title: string
    message: string
    actions: TokenRenewalAction[]
    dismissible: boolean
    persistent: boolean
}

export interface TokenRenewalAction {
    id: string
    label: string
    type: 'primary' | 'secondary' | 'danger'
    url?: string
    callback?: () => void | Promise<void>
}

export interface TokenRenewalServiceOptions {
    checkInterval: number // minutes
    enableAutoCheck: boolean
    enableNotifications: boolean
}

/**
 * Service for managing token renewal notifications and prompts
 */
export class TokenRenewalService {
    private readonly tokenManager: GitHubTokenManager
    private readonly configService: ConfigServiceImpl
    private readonly options: TokenRenewalServiceOptions
    private checkTimer: NodeJS.Timeout | null = null
    private lastCheckTime: Date | null = null
    private notificationCallbacks: ((notification: TokenRenewalNotification) => void)[] = []
    private notificationCounter = 0

    constructor(
        configService: ConfigServiceImpl,
        options: Partial<TokenRenewalServiceOptions> = {}
    ) {
        this.configService = configService
        this.tokenManager = new GitHubTokenManager()
        this.options = {
            checkInterval: 60, // 1 hour
            enableAutoCheck: true,
            enableNotifications: true,
            ...options
        }
    }

    /**
     * Start automatic token checking
     */
    start(): void {
        if (!this.options.enableAutoCheck) {
            return
        }

        this.stop() // Stop any existing timer

        // Perform initial check
        this.performTokenCheck()

        // Set up periodic checking
        this.checkTimer = setInterval(() => {
            this.performTokenCheck()
        }, this.options.checkInterval * 60 * 1000)
    }

    /**
     * Stop automatic token checking
     */
    stop(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer)
            this.checkTimer = null
        }
    }

    /**
     * Register callback for token renewal notifications
     */
    onNotification(callback: (notification: TokenRenewalNotification) => void): void {
        this.notificationCallbacks.push(callback)
    }

    /**
     * Perform manual token check
     */
    async checkTokenNow(): Promise<{
        validation: TokenValidationResult
        renewal: TokenRenewalPrompt
        notification?: TokenRenewalNotification
    }> {
        const tokenStatus = await this.configService.getTokenStatus()

        let notification: TokenRenewalNotification | undefined
        if (tokenStatus.renewal.shouldPrompt && this.options.enableNotifications) {
            notification = this.createRenewalNotification(tokenStatus.renewal)
            this.notifyCallbacks(notification)
        }

        this.lastCheckTime = new Date()

        return {
            validation: tokenStatus.validation,
            renewal: tokenStatus.renewal,
            notification
        }
    }

    /**
     * Get last check time
     */
    getLastCheckTime(): Date | null {
        return this.lastCheckTime
    }

    /**
     * Check if service is running
     */
    isRunning(): boolean {
        return this.checkTimer !== null
    }

    /**
     * Private method to perform token check
     */
    private async performTokenCheck(): Promise<void> {
        try {
            await this.checkTokenNow()
        } catch (error) {
            console.error('Token renewal check failed:', error)

            if (this.options.enableNotifications) {
                const errorNotification = this.createErrorNotification(
                    'Token Check Failed',
                    `Failed to check token status: ${error}`
                )
                this.notifyCallbacks(errorNotification)
            }
        }
    }

    /**
     * Create renewal notification from prompt
     */
    private createRenewalNotification(prompt: TokenRenewalPrompt): TokenRenewalNotification {
        const notificationId = `token-renewal-${++this.notificationCounter}-${Date.now()}`

        const notification: TokenRenewalNotification = {
            id: notificationId,
            timestamp: new Date(),
            type: this.getNotificationType(prompt.urgency),
            title: this.getNotificationTitle(prompt.reason),
            message: prompt.message,
            actions: this.createRenewalActions(prompt),
            dismissible: prompt.urgency !== 'critical',
            persistent: prompt.urgency === 'critical' || prompt.urgency === 'high'
        }

        return notification
    }

    /**
     * Create error notification
     */
    private createErrorNotification(title: string, message: string): TokenRenewalNotification {
        return {
            id: `token-error-${++this.notificationCounter}-${Date.now()}`,
            timestamp: new Date(),
            type: 'error',
            title,
            message,
            actions: [
                {
                    id: 'retry',
                    label: 'Retry',
                    type: 'primary',
                    callback: async () => {
                        await this.checkTokenNow()
                    }
                },
                {
                    id: 'dismiss',
                    label: 'Dismiss',
                    type: 'secondary'
                }
            ],
            dismissible: true,
            persistent: false
        }
    }

    /**
     * Get notification type from urgency
     */
    private getNotificationType(urgency: TokenRenewalPrompt['urgency']): TokenRenewalNotification['type'] {
        switch (urgency) {
            case 'critical':
            case 'high':
                return 'error'
            case 'medium':
                return 'warning'
            case 'low':
            default:
                return 'info'
        }
    }

    /**
     * Get notification title from reason
     */
    private getNotificationTitle(reason: TokenRenewalPrompt['reason']): string {
        switch (reason) {
            case 'expired':
                return 'GitHub Token Expired'
            case 'expiring-soon':
                return 'GitHub Token Expiring Soon'
            case 'invalid':
                return 'GitHub Token Invalid'
            case 'insufficient-scopes':
                return 'GitHub Token Insufficient Permissions'
            default:
                return 'GitHub Token Issue'
        }
    }

    /**
     * Create renewal actions from prompt
     */
    private createRenewalActions(prompt: TokenRenewalPrompt): TokenRenewalAction[] {
        const actions: TokenRenewalAction[] = []

        // Primary action - open GitHub settings
        actions.push({
            id: 'open-github-settings',
            label: 'Open GitHub Settings',
            type: 'primary',
            url: 'https://github.com/settings/tokens',
            callback: () => {
                // Open external URL
                if (typeof window !== 'undefined' && window.open) {
                    window.open('https://github.com/settings/tokens', '_blank')
                }
            }
        })

        // Secondary action - show help
        actions.push({
            id: 'show-help',
            label: 'Show Help',
            type: 'secondary',
            callback: () => {
                this.showTokenHelp(prompt)
            }
        })

        // Dismiss action (if dismissible)
        if (prompt.urgency !== 'critical') {
            actions.push({
                id: 'dismiss',
                label: 'Dismiss',
                type: 'secondary'
            })
        }

        return actions
    }

    /**
     * Show token help information
     */
    private showTokenHelp(prompt: TokenRenewalPrompt): void {
        const helpNotification: TokenRenewalNotification = {
            id: `token-help-${++this.notificationCounter}-${Date.now()}`,
            timestamp: new Date(),
            type: 'info',
            title: 'GitHub Token Help',
            message: `Steps to resolve:\n${prompt.suggestedActions.map((action, i) => `${i + 1}. ${action}`).join('\n')}`,
            actions: [
                {
                    id: 'close-help',
                    label: 'Close',
                    type: 'secondary'
                }
            ],
            dismissible: true,
            persistent: false
        }

        this.notifyCallbacks(helpNotification)
    }

    /**
     * Notify all registered callbacks
     */
    private notifyCallbacks(notification: TokenRenewalNotification): void {
        this.notificationCallbacks.forEach(callback => {
            try {
                callback(notification)
            } catch (error) {
                console.error('Token renewal notification callback error:', error)
            }
        })
    }

    /**
     * Get service status
     */
    getStatus(): {
        isRunning: boolean
        lastCheckTime: Date | null
        checkInterval: number
        enableAutoCheck: boolean
        enableNotifications: boolean
    } {
        return {
            isRunning: this.isRunning(),
            lastCheckTime: this.getLastCheckTime(),
            checkInterval: this.options.checkInterval,
            enableAutoCheck: this.options.enableAutoCheck,
            enableNotifications: this.options.enableNotifications
        }
    }

    /**
     * Update service options
     */
    updateOptions(newOptions: Partial<TokenRenewalServiceOptions>): void {
        Object.assign(this.options, newOptions)

        // Restart if auto-check settings changed
        if (this.isRunning()) {
            this.start()
        }
    }
}

/**
 * Create a token renewal service instance
 */
export function createTokenRenewalService(
    configService: ConfigServiceImpl,
    options?: Partial<TokenRenewalServiceOptions>
): TokenRenewalService {
    return new TokenRenewalService(configService, options)
}