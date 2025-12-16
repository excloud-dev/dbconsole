/**
 * React hook for checking web app updates and managing update notifications
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface UpdateInfo {
    available: boolean
    latestVersion?: string
    releaseNotes?: string
    publishedAt?: string
    downloadUrl?: string
    error?: string
    message?: string
}

export interface AppInfo {
    version: string
    buildSha?: string
    buildTime?: string
    platform: string
    updateInfo?: UpdateInfo
}

export interface UseUpdateCheckerOptions {
    checkInterval?: number // in milliseconds, default 30 minutes
    autoCheck?: boolean // default true
}

export interface UseUpdateCheckerReturn {
    appInfo: AppInfo | null
    updateInfo: UpdateInfo | null
    isChecking: boolean
    error: string | null
    checkForUpdates: () => Promise<void>
    dismissUpdate: () => void
    hasNewUpdate: boolean
}

export function useUpdateChecker(options: UseUpdateCheckerOptions = {}): UseUpdateCheckerReturn {
    const { checkInterval = 30 * 60 * 1000, autoCheck = true } = options

    const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
    const [isChecking, setIsChecking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

    // Important: don't put isChecking in the checkForUpdates dependency list.
    // If checkForUpdates changes on every toggle, effects that depend on it will re-run and can create
    // an unintended fetch loop.
    const inFlightRef = useRef(false)

    const checkForUpdates = useCallback(async () => {
        if (inFlightRef.current) return

        inFlightRef.current = true
        setIsChecking(true)
        setError(null)

        try {
            const response = await fetch('/api/app-info', { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`Failed to fetch app info: ${response.status} ${response.statusText}`)
            }

            const data: AppInfo = await response.json()
            setAppInfo(data)

            // Log update check result
            if (data.updateInfo?.available) {
                console.log(`Update available: ${data.updateInfo.latestVersion}`)
            } else if (data.updateInfo?.error) {
                console.warn('Update check failed:', data.updateInfo.error)
            } else {
                console.log('No updates available')
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
            setError(errorMessage)
            console.error('Update check failed:', err)
        } finally {
            setIsChecking(false)
            inFlightRef.current = false
        }
    }, [])

    const dismissUpdate = useCallback(() => {
        if (appInfo?.updateInfo?.latestVersion) {
            setDismissedVersion(appInfo.updateInfo.latestVersion)
        }
    }, [appInfo?.updateInfo?.latestVersion])

    // Determine if there's a new update that hasn't been dismissed
    const hasNewUpdate = Boolean(
        appInfo?.updateInfo?.available &&
        appInfo.updateInfo.latestVersion &&
        appInfo.updateInfo.latestVersion !== dismissedVersion
    )

    // Auto-check on mount and at intervals
    useEffect(() => {
        if (!autoCheck) return

        // Initial check
        checkForUpdates()

        // Set up interval for periodic checks
        const intervalId = setInterval(checkForUpdates, checkInterval)

        return () => clearInterval(intervalId)
    }, [autoCheck, checkInterval, checkForUpdates])

    // Check for updates when the page becomes visible again
    useEffect(() => {
        if (!autoCheck) return

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkForUpdates()
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
    }, [autoCheck, checkForUpdates])

    return {
        appInfo,
        updateInfo: appInfo?.updateInfo || null,
        isChecking,
        error,
        checkForUpdates,
        dismissUpdate,
        hasNewUpdate
    }
}