/**
 * GitHub Auto-Updater System
 * 
 * This module provides automatic update capabilities for DBConsole,
 * supporting both Electron desktop and Next.js web applications.
 */

// Export all types and interfaces
export * from './types'
export * from './interfaces'

// Export implementations
export { GitHubClientImpl } from './github-client'
export { ConfigServiceImpl } from './config-service'
export { UpdateControllerImpl } from './update-controller'
export { UpdateAgentImpl } from './update-agent'
export { ElectronUpdater } from './electron-updater'
export { DesktopInstaller } from './desktop-installer'
export { DesktopErrorHandler } from './desktop-error-handler'

// Export version utilities
export * from './version-utils'

// Export update detection utilities
export * from './update-detector'

// Re-export commonly used types for convenience
export type {
    UpdateInfo,
    UpdateSettings,
    UpdateRecord,
    GitHubRelease,
    GitHubAsset,
    UpdateManifest,
    SecurityVerification
} from './types'

export type {
    UpdateAgent,
    GitHubClient,
    UpdateController,
    ConfigService
} from './interfaces'