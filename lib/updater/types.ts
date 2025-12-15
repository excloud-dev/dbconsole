/**
 * Core types and interfaces for the GitHub Auto-Updater system
 */

export interface UpdateInfo {
    version: string
    releaseNotes: string
    downloadUrl: string
    /**
     * Optional GitHub asset filename (recommended). When present, the updater
     * will download to this filename so installers keep the correct extension.
     */
    assetName?: string
    checksum: string
    signature?: string
    publishedAt: Date
    isPrerelease: boolean
}

export interface UpdateRecord {
    version: string
    installedAt: Date
    success: boolean
    errorMessage?: string
}

export interface TimeWindow {
    startHour: number // 0-23
    endHour: number   // 0-23
    days: number[]    // 0-6 (Sunday-Saturday)
}

export interface UpdateSettings {
    autoCheck: boolean
    autoInstall: boolean
    checkInterval: number // hours
    updateChannel: 'latest' | 'prerelease' | 'custom'
    customTagPattern?: string
    maintenanceWindow?: TimeWindow
}

export interface GitHubAsset {
    id: number
    name: string
    size: number
    downloadUrl: string
    contentType: string
}

export interface GitHubRelease {
    id: number
    tagName: string
    name: string
    body: string
    assets: GitHubAsset[]
    prerelease: boolean
    publishedAt: string
}

export interface ReleaseOptions {
    includePrerelease?: boolean
    perPage?: number
    page?: number
}

export interface UpdateManifest {
    version: string
    platform: 'darwin' | 'win32' | 'linux'
    arch: 'x64' | 'arm64'
    files: {
        [platform: string]: {
            url: string
            size: number
            checksum: string
            signature?: string
        }
    }
    releaseNotes: string
    minimumVersion?: string
    forceUpdate: boolean
}

export interface SecurityVerification {
    checksumAlgorithm: 'sha256' | 'sha512'
    checksum: string
    signatureAlgorithm?: 'rsa' | 'ecdsa'
    signature?: string
    publicKey?: string
}

export type UpdateChannel = 'latest' | 'prerelease' | 'custom'
export type Platform = 'darwin' | 'win32' | 'linux'
export type Architecture = 'x64' | 'arm64'