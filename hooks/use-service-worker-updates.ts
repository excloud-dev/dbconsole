/**
 * React hook for service worker-based update management
 * Provides seamless update experience with cache invalidation
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getServiceWorkerManager, isServiceWorkerSupported, type ServiceWorkerUpdateInfo } from '../lib/service-worker'

export interface UseServiceWorkerUpdatesOptions {
    autoRegister?: boolean
    onUpdateAvailable?: (updateInfo: ServiceWorkerUpdateInfo) => void
    onUpdateReady?: () => void
}

export interface UseServiceWorkerUpdatesReturn {
    isSupported: boolean
    isRegistered: boolean
    updateInfo: ServiceWorkerUpdateInfo | null
    isUpdateReady: boolean
    isChecking: boolean
    error: string | null
    register: () => Promise<void>
    checkForUpdates: () => Promise<void>
    applyUpdate: () => Promise<void>
    clearCache: () => Promise<void>
}

export function useServiceWorkerUpdates(options: UseServiceWorkerUpdatesOptions = {}): UseServiceWorkerUpdatesReturn {
    const { autoRegister = true, onUpdateAvailable, onUpdateReady } = options

    const [isRegistered, setIsRegistered] = useState(false)
    const [updateInfo, setUpdateInfo] = useState<ServiceWorkerUpdateInfo | null>(null)
    const [isUpdateReady, setIsUpdateReady] = useState(false)
    const [isChecking, setIsChecking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isSupported = isServiceWorkerSupported()

    const unsubscribeUpdateRef = useRef<null | (() => void)>(null)
    const unsubscribeReadyRef = useRef<null | (() => void)>(null)

    const register = useCallback(async () => {
        if (!isSupported) {
            setError('Service Worker not supported')
            return
        }

        try {
            setError(null)
            const manager = getServiceWorkerManager()
            const registration = await manager.register()

            if (registration) {
                setIsRegistered(true)

                // Prevent duplicate subscriptions if register is called more than once.
                unsubscribeUpdateRef.current?.()
                unsubscribeReadyRef.current?.()

                // Set up event listeners
                unsubscribeUpdateRef.current = manager.onUpdateAvailable((info) => {
                    setUpdateInfo(info)
                    onUpdateAvailable?.(info)
                })

                unsubscribeReadyRef.current = manager.onUpdateReady(() => {
                    setIsUpdateReady(true)
                    onUpdateReady?.()
                })
            } else {
                setError('Failed to register service worker')
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
            setError(errorMessage)
            console.error('Service worker registration failed:', err)
        }
    }, [isSupported, onUpdateAvailable, onUpdateReady])

    const checkForUpdates = useCallback(async () => {
        if (!isRegistered) {
            setError('Service worker not registered')
            return
        }

        setIsChecking(true)
        setError(null)

        try {
            const manager = getServiceWorkerManager()
            const info = await manager.checkForUpdates()
            setUpdateInfo(info)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates'
            setError(errorMessage)
            console.error('Update check failed:', err)
        } finally {
            setIsChecking(false)
        }
    }, [isRegistered])

    const applyUpdate = useCallback(async () => {
        if (!isRegistered) {
            setError('Service worker not registered')
            return
        }

        try {
            setError(null)
            const manager = getServiceWorkerManager()

            // Skip waiting to activate new service worker
            await manager.skipWaiting()

            // Reload the page to use the new version
            window.location.reload()
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to apply update'
            setError(errorMessage)
            console.error('Update application failed:', err)
        }
    }, [isRegistered])

    const clearCache = useCallback(async () => {
        if (!isRegistered) {
            setError('Service worker not registered')
            return
        }

        try {
            setError(null)
            const manager = getServiceWorkerManager()
            await manager.clearCache()
            console.log('Cache cleared successfully')
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to clear cache'
            setError(errorMessage)
            console.error('Cache clearing failed:', err)
        }
    }, [isRegistered])

    // Auto-register on mount if enabled (production only).
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') {
            return
        }

        if (autoRegister && isSupported && !isRegistered) {
            register()
        }
    }, [autoRegister, isSupported, isRegistered, register])

    // Cleanup SW manager subscriptions on unmount.
    useEffect(() => {
        return () => {
            unsubscribeUpdateRef.current?.()
            unsubscribeUpdateRef.current = null
            unsubscribeReadyRef.current?.()
            unsubscribeReadyRef.current = null
        }
    }, [])

    return {
        isSupported,
        isRegistered,
        updateInfo,
        isUpdateReady,
        isChecking,
        error,
        register,
        checkForUpdates,
        applyUpdate,
        clearCache
    }
}