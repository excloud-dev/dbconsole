/**
 * Service Worker registration and management utilities
 * Handles service worker lifecycle and update notifications
 */

export interface ServiceWorkerUpdateInfo {
    available: boolean
    latestVersion?: string
    releaseNotes?: string
    publishedAt?: string
    downloadUrl?: string
    error?: string
    message?: string
}

export interface ServiceWorkerManager {
    register(): Promise<ServiceWorkerRegistration | null>
    unregister(): Promise<boolean>
    checkForUpdates(): Promise<ServiceWorkerUpdateInfo | null>
    skipWaiting(): Promise<void>
    clearCache(): Promise<void>
    onUpdateAvailable(callback: (updateInfo: ServiceWorkerUpdateInfo) => void): () => void
    onUpdateReady(callback: () => void): () => void
}

class ServiceWorkerManagerImpl implements ServiceWorkerManager {
    private registration: ServiceWorkerRegistration | null = null
    private updateCallbacks: Set<(updateInfo: ServiceWorkerUpdateInfo) => void> = new Set()
    private readyCallbacks: Set<() => void> = new Set()

    constructor() {
        this.setupMessageListener()
    }

    /**
     * Register the service worker
     */
    async register(): Promise<ServiceWorkerRegistration | null> {
        if (!('serviceWorker' in navigator)) {
            console.warn('Service Worker not supported')
            return null
        }

        try {
            this.registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            })

            console.log('Service Worker registered:', this.registration.scope)

            // Listen for updates
            this.registration.addEventListener('updatefound', () => {
                const newWorker = this.registration?.installing
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New version is ready
                            this.notifyUpdateReady()
                        }
                    })
                }
            })

            return this.registration
        } catch (error) {
            console.error('Service Worker registration failed:', error)
            return null
        }
    }

    /**
     * Unregister the service worker
     */
    async unregister(): Promise<boolean> {
        if (!this.registration) {
            return false
        }

        try {
            const result = await this.registration.unregister()
            console.log('Service Worker unregistered:', result)
            return result
        } catch (error) {
            console.error('Service Worker unregistration failed:', error)
            return false
        }
    }

    /**
     * Check for updates manually
     */
    async checkForUpdates(): Promise<ServiceWorkerUpdateInfo | null> {
        if (!this.registration) {
            throw new Error('Service Worker not registered')
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel()

            messageChannel.port1.onmessage = (event) => {
                const { type, payload } = event.data

                if (type === 'UPDATE_CHECK_RESULT') {
                    resolve(payload)
                } else if (type === 'UPDATE_CHECK_ERROR') {
                    reject(new Error(payload.error))
                }
            }

            this.sendMessage({
                type: 'CHECK_FOR_UPDATES'
            }, [messageChannel.port2])
        })
    }

    /**
     * Skip waiting and activate new service worker
     */
    async skipWaiting(): Promise<void> {
        if (!this.registration) {
            throw new Error('Service Worker not registered')
        }

        this.sendMessage({
            type: 'SKIP_WAITING'
        })

        // Wait for the new service worker to take control
        return new Promise((resolve) => {
            const handleControllerChange = () => {
                navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
                resolve()
            }

            navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
        })
    }

    /**
     * Clear all caches
     */
    async clearCache(): Promise<void> {
        if (!this.registration) {
            throw new Error('Service Worker not registered')
        }

        return new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel()

            messageChannel.port1.onmessage = (event) => {
                const { type } = event.data

                if (type === 'CACHE_CLEARED') {
                    resolve()
                }
            }

            this.sendMessage({
                type: 'CLEAR_CACHE'
            }, [messageChannel.port2])
        })
    }

    /**
     * Register callback for update available notifications
     */
    onUpdateAvailable(callback: (updateInfo: ServiceWorkerUpdateInfo) => void): () => void {
        this.updateCallbacks.add(callback)

        return () => {
            this.updateCallbacks.delete(callback)
        }
    }

    /**
     * Register callback for update ready notifications
     */
    onUpdateReady(callback: () => void): () => void {
        this.readyCallbacks.add(callback)

        return () => {
            this.readyCallbacks.delete(callback)
        }
    }

    /**
     * Send message to service worker
     */
    private sendMessage(message: any, transfer?: Transferable[]): void {
        const target =
            navigator.serviceWorker.controller ||
            this.registration?.active ||
            this.registration?.waiting ||
            this.registration?.installing

        if (!target) {
            throw new Error('No active service worker available')
        }

        // ServiceWorker.postMessage expects the transfer list as the second argument (not an options object).
        if (transfer) {
            target.postMessage(message, transfer)
        } else {
            target.postMessage(message)
        }
    }

    /**
     * Setup message listener for service worker messages
     */
    private setupMessageListener(): void {
        if (!('serviceWorker' in navigator)) {
            return
        }

        navigator.serviceWorker.addEventListener('message', (event) => {
            const { type, payload } = event.data

            switch (type) {
                case 'UPDATE_AVAILABLE':
                    this.notifyUpdateAvailable(payload)
                    break

                default:
                    console.log('Unknown message from service worker:', type)
            }
        })
    }

    /**
     * Notify all callbacks about available update
     */
    private notifyUpdateAvailable(updateInfo: ServiceWorkerUpdateInfo): void {
        this.updateCallbacks.forEach((callback) => {
            try {
                callback(updateInfo)
            } catch (error) {
                console.error('Error in update callback:', error)
            }
        })
    }

    /**
     * Notify all callbacks that update is ready
     */
    private notifyUpdateReady(): void {
        this.readyCallbacks.forEach((callback) => {
            try {
                callback()
            } catch (error) {
                console.error('Error in ready callback:', error)
            }
        })
    }
}

// Singleton instance
let serviceWorkerManager: ServiceWorkerManager | null = null

/**
 * Get the service worker manager instance
 */
export function getServiceWorkerManager(): ServiceWorkerManager {
    if (!serviceWorkerManager) {
        serviceWorkerManager = new ServiceWorkerManagerImpl()
    }
    return serviceWorkerManager
}

/**
 * Register service worker and return manager instance
 */
export async function registerServiceWorker(): Promise<ServiceWorkerManager> {
    const manager = getServiceWorkerManager()
    await manager.register()
    return manager
}

/**
 * Utility function to check if service workers are supported
 */
export function isServiceWorkerSupported(): boolean {
    return 'serviceWorker' in navigator
}