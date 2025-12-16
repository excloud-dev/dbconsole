"use client"

import { useState, useEffect, useMemo } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Download, AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react'

export interface UpdateInfo {
    version: string
    releaseNotes: string
    downloadUrl: string
    checksum: string
    signature?: string
    publishedAt: Date | string | number
    isPrerelease: boolean
}

export interface UpdateNotificationProps {
    isOpen: boolean
    onClose: () => void
    updateInfo: UpdateInfo | null
    onInstallUpdate: (updateInfo: UpdateInfo) => void
    onSkipUpdate: () => void
    isDownloading?: boolean
    downloadProgress?: number
    isInstalling?: boolean
    installationProgress?: number
    error?: string
}

export function UpdateNotificationDialog({
    isOpen,
    onClose,
    updateInfo,
    onInstallUpdate,
    onSkipUpdate,
    isDownloading = false,
    downloadProgress = 0,
    isInstalling = false,
    installationProgress = 0,
    error
}: UpdateNotificationProps) {
    const [showReleaseNotes, setShowReleaseNotes] = useState(false)
    const [currentVersion, setCurrentVersion] = useState<string | null>(null)
    const [showErrorDetails, setShowErrorDetails] = useState(false)

    const isInProgress = isDownloading || isInstalling
    const currentProgress = isDownloading ? downloadProgress : installationProgress
    const progressLabel = isDownloading ? 'Downloading...' : isInstalling ? 'Installing...' : ''

    // Security note: render release notes as plain text.
    // GitHub release bodies are user-controlled content and must not be injected as HTML.

    const publishedAtDate: Date | null = useMemo(() => {
        const v = (updateInfo as any)?.publishedAt
        if (!v) return null
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v
        const d = new Date(v)
        return isNaN(d.getTime()) ? null : d
    }, [updateInfo])

    useEffect(() => {
        let cancelled = false

        async function loadVersion() {
            try {
                if (typeof window === 'undefined') return
                const dbconsole = (window as any).dbconsole
                if (!dbconsole?.isDesktop || !dbconsole?.api?.app?.info) {
                    setCurrentVersion(null)
                    return
                }
                const info = await dbconsole.api.app.info()
                if (!cancelled) {
                    setCurrentVersion(typeof info?.version === 'string' ? info.version : null)
                }
            } catch {
                if (!cancelled) setCurrentVersion(null)
            }
        }

        if (isOpen) {
            void loadVersion()
        }

        return () => {
            cancelled = true
        }
    }, [isOpen])

    const errorText = typeof error === 'string' ? error : ''
    const errorIsLong = errorText.length > 220
    const errorPreview = errorIsLong ? `${errorText.slice(0, 220)}…` : errorText

    // IMPORTANT: keep hooks order stable. Only return null *after* hooks are declared.
    if (!updateInfo) return null

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            {/* No hard min-width on tiny windows; keep it responsive but prevent overly narrow dialogs on sm+ */}
            <DialogContent
                className="w-[min(95vw,48rem)] sm:min-w-[32rem] max-w-none max-h-[85vh] flex flex-col overflow-hidden"
                onOpenAutoFocus={(e) => {
                    // Prevent Radix from focusing the first focusable element (which was "Show Details").
                    e.preventDefault()
                }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        Update Available
                        {updateInfo.isPrerelease && (
                            <Badge variant="secondary" className="ml-2">
                                Pre-release
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        Version {updateInfo.version} is now available
                        {publishedAtDate && (
                            <span className="text-muted-foreground ml-2">
                                • Released {publishedAtDate.toLocaleDateString()}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-4">
                        {error && (
                            <div className="space-y-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                                <div className="flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm text-destructive break-words">
                                            {showErrorDetails ? errorText : errorPreview}
                                        </div>
                                    </div>
                                </div>
                                {errorIsLong && (
                                    <div className="flex justify-end">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowErrorDetails(!showErrorDetails)}
                                            className="h-7 px-2 text-destructive"
                                        >
                                            {showErrorDetails ? 'Hide' : 'Show'} error details
                                        </Button>
                                    </div>
                                )}
                                {showErrorDetails && errorIsLong && (
                                    <ScrollArea
                                        className="max-h-40 w-full rounded-md border border-destructive/20 bg-background/60 p-2"
                                        showHorizontalScrollbar
                                    >
                                        <pre className="text-xs whitespace-pre-wrap break-words font-mono text-destructive">
                                            {errorText}
                                        </pre>
                                    </ScrollArea>
                                )}
                            </div>
                        )}

                        {isInProgress && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span className="text-sm font-medium">{progressLabel}</span>
                                    <span className="text-sm text-muted-foreground">
                                        {Math.round(currentProgress)}%
                                    </span>
                                </div>
                                <Progress value={currentProgress} className="w-full" />
                            </div>
                        )}

                        {updateInfo.releaseNotes && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium">Release Notes</h4>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowReleaseNotes(!showReleaseNotes)}
                                    >
                                        {showReleaseNotes ? 'Hide' : 'Show'} Details
                                    </Button>
                                </div>

                                {showReleaseNotes && (
                                    <>
                                        <Separator />
                                        {/* Keep this compact; enable horizontal scroll for long checksums/filenames. */}
                                        <ScrollArea className="h-[28vh] w-full rounded-md border p-3" showHorizontalScrollbar>
                                            {/* Prefer wrapping for readability; horizontal scrollbar still exists for edge-cases. */}
                                            <pre className="text-sm whitespace-pre-wrap break-words font-sans">
                                                {updateInfo.releaseNotes}
                                            </pre>
                                        </ScrollArea>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="font-medium">Current Version:</span>
                                <div className="text-muted-foreground">
                                    {typeof window !== 'undefined' && (window as any).dbconsole?.isDesktop
                                        ? (currentVersion ?? 'Unknown')
                                        : 'Web Version'}
                                </div>
                            </div>
                            <div>
                                <span className="font-medium">New Version:</span>
                                <div className="text-muted-foreground">{updateInfo.version}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="shrink-0 flex-col sm:flex-row gap-2">
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                            variant="outline"
                            onClick={onSkipUpdate}
                            disabled={isInProgress}
                            className="flex-1 sm:flex-none"
                        >
                            <Clock className="h-4 w-4 mr-2" />
                            Later
                        </Button>
                        <Button
                            onClick={() => onInstallUpdate(updateInfo)}
                            disabled={isInProgress}
                            className="flex-1 sm:flex-none"
                        >
                            {isInProgress ? (
                                <>
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                    {progressLabel}
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    Install Update
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}