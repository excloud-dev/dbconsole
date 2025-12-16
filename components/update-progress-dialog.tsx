"use client"

import { useState, useEffect, useRef, useMemo } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import {
    Download,
    Settings,
    CheckCircle,
    AlertCircle,
    RefreshCw,
    Clock,
    HardDrive
} from 'lucide-react'

export interface ProgressInfo {
    stage: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'complete' | 'error'
    progress: number // 0-100
    message: string
    bytesDownloaded?: number
    totalBytes?: number
    downloadSpeed?: number // bytes per second
    estimatedTimeRemaining?: number // seconds
}

export interface UpdateProgressProps {
    isOpen: boolean
    onClose: () => void
    progressInfo: ProgressInfo
    updateVersion?: string
    onCancel?: () => void
    canCancel?: boolean
    onRetry?: () => void
    error?: string
}

export function UpdateProgressDialog({
    isOpen,
    onClose,
    progressInfo,
    updateVersion,
    onCancel,
    canCancel = false,
    onRetry,
    error
}: UpdateProgressProps) {
    // Reset elapsed time when stage changes or dialog opens/closes
    const shouldResetTimer = useMemo(() => {
        return !isOpen || progressInfo.stage === 'complete' || progressInfo.stage === 'error'
    }, [isOpen, progressInfo.stage])

    const [elapsedTime, setElapsedTime] = useState(0)

    // Timer effect for counting elapsed time
    useEffect(() => {
        if (shouldResetTimer) {
            return
        }

        // Start fresh timer
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setElapsedTime(0)

        const interval = setInterval(() => {
            setElapsedTime(prev => prev + 1)
        }, 1000)

        return () => clearInterval(interval)
    }, [shouldResetTimer, progressInfo.stage])

    const getStageIcon = () => {
        switch (progressInfo.stage) {
            case 'preparing':
                return <Settings className="h-5 w-5 animate-pulse" />
            case 'downloading':
                return <Download className="h-5 w-5" />
            case 'verifying':
                return <RefreshCw className="h-5 w-5 animate-spin" />
            case 'installing':
                return <HardDrive className="h-5 w-5 animate-pulse" />
            case 'complete':
                return <CheckCircle className="h-5 w-5 text-green-500" />
            case 'error':
                return <AlertCircle className="h-5 w-5 text-destructive" />
            default:
                return <RefreshCw className="h-5 w-5" />
        }
    }

    const getStageTitle = () => {
        switch (progressInfo.stage) {
            case 'preparing':
                return 'Preparing Update'
            case 'downloading':
                return 'Downloading Update'
            case 'verifying':
                return 'Verifying Download'
            case 'installing':
                return 'Installing Update'
            case 'complete':
                return 'Update Complete'
            case 'error':
                return 'Update Failed'
            default:
                return 'Updating'
        }
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const formatTime = (seconds: number) => {
        // Truncate seconds to keep the UI calm/less noisy.
        if (seconds < 60) return '<1m'
        const minutes = Math.floor(seconds / 60)
        return `${minutes}m`
    }

    const formatSpeed = (bytesPerSecond: number) => {
        return `${formatBytes(bytesPerSecond)}/s`
    }

    const isComplete = progressInfo.stage === 'complete'
    const hasError = progressInfo.stage === 'error' || !!error
    const isInProgress = !isComplete && !hasError

    return (
        <Dialog open={isOpen} onOpenChange={isComplete ? onClose : undefined}>
            <DialogContent className="max-w-md" showCloseButton={!isInProgress}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {getStageIcon()}
                        {getStageTitle()}
                    </DialogTitle>
                    {updateVersion && (
                        <DialogDescription>
                            Version {updateVersion}
                        </DialogDescription>
                    )}
                </DialogHeader>

                <div className="space-y-4">
                    {hasError && (
                        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-sm text-destructive">
                                {error || 'An error occurred during the update process'}
                            </span>
                        </div>
                    )}

                    {!hasError && (
                        <>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-medium">{progressInfo.message}</span>
                                    <span className="text-sm text-muted-foreground">
                                        {Math.round(progressInfo.progress)}%
                                    </span>
                                </div>
                                <Progress
                                    value={progressInfo.progress}
                                    className="w-full"
                                />
                            </div>

                            {progressInfo.stage === 'downloading' && (
                                <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                                    {progressInfo.bytesDownloaded && progressInfo.totalBytes && (
                                        <div>
                                            <span className="font-medium">Downloaded:</span>
                                            <div>
                                                {formatBytes(progressInfo.bytesDownloaded)} / {formatBytes(progressInfo.totalBytes)}
                                            </div>
                                        </div>
                                    )}

                                    {progressInfo.downloadSpeed && (
                                        <div>
                                            <span className="font-medium">Speed:</span>
                                            <div>{formatSpeed(progressInfo.downloadSpeed)}</div>
                                        </div>
                                    )}

                                    <div>
                                        <span className="font-medium">Elapsed:</span>
                                        <div>{formatTime(elapsedTime)}</div>
                                    </div>

                                    {progressInfo.estimatedTimeRemaining && (
                                        <div>
                                            <span className="font-medium">Remaining:</span>
                                            <div>{formatTime(progressInfo.estimatedTimeRemaining)}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {isInProgress && elapsedTime > 0 && progressInfo.stage !== 'downloading' && (
                                <div className="text-xs text-muted-foreground">
                                    <span className="font-medium">Elapsed time:</span> {formatTime(elapsedTime)}
                                </div>
                            )}
                        </>
                    )}

                    {isComplete && (
                        <div className="text-center space-y-2">
                            <div className="text-sm text-muted-foreground">
                                {progressInfo.message || 'Update step completed.'}
                            </div>
                        </div>
                    )}
                </div>

                {(hasError || isComplete || canCancel) && (
                    <div className="flex gap-2 justify-end">
                        {hasError && onRetry && (
                            <Button onClick={onRetry} size="sm">
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Retry
                            </Button>
                        )}

                        {canCancel && isInProgress && onCancel && (
                            <Button variant="outline" onClick={onCancel} size="sm">
                                Cancel
                            </Button>
                        )}

                        {(hasError || isComplete) && (
                            <Button onClick={onClose} size="sm">
                                {hasError ? 'Close' : 'OK'}
                            </Button>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}