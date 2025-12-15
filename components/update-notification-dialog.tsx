"use client"

import { useState, useEffect } from 'react'
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
    publishedAt: Date
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

    if (!updateInfo) return null

    const isInProgress = isDownloading || isInstalling
    const currentProgress = isDownloading ? downloadProgress : installationProgress
    const progressLabel = isDownloading ? 'Downloading...' : isInstalling ? 'Installing...' : ''

    // Security note: render release notes as plain text.
    // GitHub release bodies are user-controlled content and must not be injected as HTML.

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[80vh]">
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
                        {updateInfo.publishedAt && (
                            <span className="text-muted-foreground ml-2">
                                • Released {updateInfo.publishedAt.toLocaleDateString()}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-sm text-destructive">{error}</span>
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
                                    <ScrollArea className="h-48 w-full rounded-md border p-3">
                                        <pre className="text-sm whitespace-pre-wrap font-sans">
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
                                {typeof window !== 'undefined' && (window as any).electronAPI
                                    ? 'Loading...'
                                    : 'Web Version'
                                }
                            </div>
                        </div>
                        <div>
                            <span className="font-medium">New Version:</span>
                            <div className="text-muted-foreground">{updateInfo.version}</div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
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