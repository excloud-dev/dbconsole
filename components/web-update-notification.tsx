/**
 * Web-specific update notification component
 * Displays update notifications for the Next.js web application
 */

'use client'

import { useState } from 'react'
import { X, Download, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { useUpdateChecker } from '../hooks/use-update-checker'
import { useServiceWorkerUpdates } from '../hooks/use-service-worker-updates'

export interface WebUpdateNotificationProps {
    className?: string
    position?: 'top' | 'bottom'
    autoCheck?: boolean
    checkInterval?: number
}

export function WebUpdateNotification({
    className = '',
    position = 'top',
    autoCheck = true,
    checkInterval = 30 * 60 * 1000 // 30 minutes
}: WebUpdateNotificationProps) {
    const [showReleaseNotes, setShowReleaseNotes] = useState(false)
    const {
        appInfo,
        updateInfo,
        isChecking,
        error,
        checkForUpdates,
        dismissUpdate,
        hasNewUpdate
    } = useUpdateChecker({ autoCheck, checkInterval })

    // Service worker integration for seamless updates
    const {
        isSupported: isSwSupported,
        isRegistered: isSwRegistered,
        updateInfo: swUpdateInfo,
        isUpdateReady: isSwUpdateReady,
        applyUpdate: applySwUpdate,
        clearCache
    } = useServiceWorkerUpdates({
        autoRegister: true,
        onUpdateAvailable: (info) => {
            console.log('Service worker detected update:', info)
        },
        onUpdateReady: () => {
            console.log('Service worker update ready')
        }
    })

    // Don't render if no update is available or update was dismissed
    if (!hasNewUpdate && !error) {
        return null
    }

    const handleRefresh = async () => {
        if (isSwSupported && isSwRegistered && (isSwUpdateReady || swUpdateInfo?.available)) {
            // Use service worker for seamless update
            try {
                await clearCache()
                await applySwUpdate()
            } catch (error) {
                console.error('Service worker update failed, falling back to reload:', error)
                window.location.reload()
            }
        } else {
            // Fallback to regular page reload
            window.location.reload()
        }
    }

    const handleDownload = () => {
        if (updateInfo?.downloadUrl) {
            window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer')
        }
    }

    const positionClasses = position === 'top'
        ? 'top-4 animate-in slide-in-from-top-2'
        : 'bottom-4 animate-in slide-in-from-bottom-2'

    return (
        <div className={`fixed left-4 right-4 z-50 ${positionClasses} ${className}`}>
            <Card className="mx-auto max-w-md shadow-lg border-2">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            <CardTitle className="text-lg">
                                {error ? 'Update Check Failed' : 'Update Available'}
                            </CardTitle>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={dismissUpdate}
                            className="h-6 w-6 p-0"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    {!error && updateInfo && (
                        <CardDescription className="flex items-center gap-2">
                            Version {updateInfo.latestVersion} is now available
                            <Badge variant="secondary" className="text-xs">
                                Current: {appInfo?.version}
                            </Badge>
                        </CardDescription>
                    )}

                    {error && (
                        <CardDescription className="text-red-600 dark:text-red-400">
                            {error}
                        </CardDescription>
                    )}
                </CardHeader>

                <CardContent className="pt-0">
                    {!error && updateInfo && (
                        <>
                            <div className="flex gap-2 mb-3">
                                <Button
                                    onClick={handleRefresh}
                                    size="sm"
                                    className="flex-1"
                                    disabled={isChecking}
                                >
                                    <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
                                    Refresh Page
                                </Button>

                                {updateInfo.downloadUrl && (
                                    <Button
                                        onClick={handleDownload}
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                    >
                                        <ExternalLink className="h-4 w-4 mr-2" />
                                        Download
                                    </Button>
                                )}
                            </div>

                            {updateInfo.releaseNotes && (
                                <Collapsible open={showReleaseNotes} onOpenChange={setShowReleaseNotes}>
                                    <CollapsibleTrigger asChild>
                                        <Button variant="ghost" size="sm" className="w-full justify-start p-0 h-auto">
                                            <span className="text-sm text-muted-foreground hover:text-foreground">
                                                {showReleaseNotes ? 'Hide' : 'Show'} release notes
                                            </span>
                                        </Button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2">
                                        <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-32 overflow-y-auto">
                                            <pre className="whitespace-pre-wrap font-sans">
                                                {updateInfo.releaseNotes}
                                            </pre>
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            )}

                            {updateInfo.publishedAt && (
                                <p className="text-xs text-muted-foreground mt-2">
                                    Released: {new Date(updateInfo.publishedAt).toLocaleDateString()}
                                </p>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="flex gap-2">
                            <Button
                                onClick={checkForUpdates}
                                size="sm"
                                variant="outline"
                                disabled={isChecking}
                                className="flex-1"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
                                Retry
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

/**
 * Simplified update banner for minimal UI impact
 */
export function WebUpdateBanner({
    className = '',
    autoCheck = true,
    checkInterval = 30 * 60 * 1000
}: Omit<WebUpdateNotificationProps, 'position'>) {
    const {
        updateInfo,
        isChecking,
        dismissUpdate,
        hasNewUpdate
    } = useUpdateChecker({ autoCheck, checkInterval })

    // Service worker integration for seamless updates
    const {
        isSupported: isSwSupported,
        isRegistered: isSwRegistered,
        updateInfo: swUpdateInfo,
        isUpdateReady: isSwUpdateReady,
        applyUpdate: applySwUpdate,
        clearCache
    } = useServiceWorkerUpdates({ autoRegister: true })

    if (!hasNewUpdate) {
        return null
    }

    const handleRefresh = async () => {
        if (isSwSupported && isSwRegistered && (isSwUpdateReady || swUpdateInfo?.available)) {
            // Use service worker for seamless update
            try {
                await clearCache()
                await applySwUpdate()
            } catch (error) {
                console.error('Service worker update failed, falling back to reload:', error)
                window.location.reload()
            }
        } else {
            // Fallback to regular page reload
            window.location.reload()
        }
    }

    return (
        <div className={`bg-blue-600 dark:bg-blue-800 text-white px-4 py-2 ${className}`}>
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div className="flex items-center gap-3">
                    <RefreshCw className="h-4 w-4" />
                    <span className="text-sm font-medium">
                        New version {updateInfo?.latestVersion} available
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        onClick={handleRefresh}
                        size="sm"
                        variant="secondary"
                        disabled={isChecking}
                        className="h-7 text-xs"
                    >
                        <RefreshCw className={`h-3 w-3 mr-1 ${isChecking ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>

                    <Button
                        onClick={dismissUpdate}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-white hover:bg-white/20"
                    >
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            </div>
        </div>
    )
}