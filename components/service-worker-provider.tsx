/**
 * Service Worker Provider Component
 * Handles service worker registration and provides context for the app
 */

'use client'

import { useEffect } from 'react'
import { registerServiceWorker, isServiceWorkerSupported } from '../lib/service-worker'

export interface ServiceWorkerProviderProps {
    children?: React.ReactNode
}

export function ServiceWorkerProvider({ children }: ServiceWorkerProviderProps) {
    useEffect(() => {
        // Only register service worker in production and if supported
        if (process.env.NODE_ENV === 'production' && isServiceWorkerSupported()) {
            registerServiceWorker()
                .then(() => {
                    console.log('Service worker registered successfully')
                })
                .catch((error) => {
                    console.error('Service worker registration failed:', error)
                })
        }
    }, [])

    return <>{children}</>
}