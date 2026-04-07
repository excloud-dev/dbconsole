"use client"

import { useState, useEffect, useCallback } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
    Info,
    ExternalLink,
    Copy,
    Check
} from 'lucide-react'

export interface AboutDialogProps {
    isOpen: boolean
    onClose: () => void
}

interface AppInfo {
    version: string
    buildSha?: string
    buildTime?: string
    platform?: string
    arch?: string
    runtime?: {
        electron?: string
        node?: string
        chrome?: string
    }
}

export function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!isOpen || typeof window === 'undefined' || !window.dbconsole?.isDesktop) {
            return
        }

        const loadAppInfo = async () => {
            try {
                const info = await window.dbconsole!.api.app.info()
                setAppInfo(info)
            } catch (error) {
                console.error('Failed to load app info:', error)
            }
        }

        loadAppInfo()
    }, [isOpen])

    const copyVersionInfo = async () => {
        if (!appInfo) return

        const versionText = [
            `DBConsole ${appInfo.version}`,
            appInfo.buildSha ? `Build: ${appInfo.buildSha}` : '',
            appInfo.buildTime ? `Built: ${new Date(appInfo.buildTime).toLocaleString()}` : '',
            `Platform: ${appInfo.platform ?? 'unknown'} ${appInfo.arch ?? ''}`.trim(),
            appInfo.runtime?.electron ? `Electron: ${appInfo.runtime.electron}` : '',
            appInfo.runtime?.node ? `Node: ${appInfo.runtime.node}` : '',
            appInfo.runtime?.chrome ? `Chrome: ${appInfo.runtime.chrome}` : ''
        ].filter(Boolean).join('\n')

        try {
            await navigator.clipboard.writeText(versionText)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (error) {
            console.error('Failed to copy version info:', error)
        }
    }

    const openRepository = () => {
        if (typeof window !== 'undefined') {
            window.open('https://github.com/excloud-in/dbconsole', '_blank')
        }
    }

    const openIssues = () => {
        if (typeof window !== 'undefined') {
            window.open('https://github.com/excloud-in/dbconsole/issues', '_blank')
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Info className="h-5 w-5" />
                        About DBConsole
                    </DialogTitle>
                    <DialogDescription>
                        A lightweight read-only database console with a modern UI
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* App Version */}
                    <div className="text-center space-y-2">
                        <div className="text-2xl font-semibold">
                            DBConsole
                        </div>
                        {appInfo && (
                            <div className="space-y-1">
                                <Badge variant="secondary" className="text-sm">
                                    Version {appInfo.version}
                                </Badge>
                                {appInfo.buildSha && (
                                    <div className="text-xs text-muted-foreground">
                                        Build {appInfo.buildSha}
                                    </div>
                                )}
                                {appInfo.buildTime && (
                                    <div className="text-xs text-muted-foreground">
                                        Built {new Date(appInfo.buildTime).toLocaleDateString()}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* System Information */}
                    {appInfo && (
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium">System Information</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <span className="text-muted-foreground">Platform:</span>
                                    <div>{appInfo.platform} {appInfo.arch}</div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Electron:</span>
                                    <div>{appInfo.runtime?.electron ?? '—'}</div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Node.js:</span>
                                    <div>{appInfo.runtime?.node ?? '—'}</div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Chrome:</span>
                                    <div>{appInfo.runtime?.chrome ?? '—'}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    <Separator />

                    {/* Links */}
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">Links</h4>
                        <div className="flex flex-col gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="justify-start h-8"
                                onClick={openRepository}
                            >
                                <ExternalLink className="h-3 w-3 mr-2" />
                                View on GitHub
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="justify-start h-8"
                                onClick={openIssues}
                            >
                                <ExternalLink className="h-3 w-3 mr-2" />
                                Report Issues
                            </Button>
                        </div>
                    </div>

                    <Separator />

                    {/* Actions */}
                    <div className="flex justify-between">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={copyVersionInfo}
                            disabled={!appInfo}
                        >
                            {copied ? (
                                <>
                                    <Check className="h-3 w-3 mr-2" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="h-3 w-3 mr-2" />
                                    Copy Info
                                </>
                            )}
                        </Button>
                        <Button onClick={onClose}>
                            Close
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}