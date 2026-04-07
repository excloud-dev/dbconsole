"use client"

import { useState, useEffect, useCallback } from 'react'
import { UpdateNotificationDialog, UpdateInfo } from './update-notification-dialog'
import { UpdateProgressDialog, ProgressInfo } from './update-progress-dialog'
import { UpdateSettingsDialog, UpdateSettings } from './update-settings-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Download,
    Settings,
    CheckCircle,
    AlertCircle,
    Clock,
    RefreshCw,
    ChevronDown
} from 'lucide-react'

export interface UpdateManagerProps {
    className?: string
}

interface UpdateState {
    currentVersion: string
    availableUpdate?: UpdateInfo
    isCheckingForUpdates: boolean
    isUpdateAvailable: boolean
    isDownloading: boolean
    isInstalling: boolean
    lastCheckTime?: Date
    error?: string
}

export function UpdateManager({ className }: UpdateManagerProps) {
    const [updateState, setUpdateState] = useState<UpdateState>({
        currentVersion: '0.0.0',
        isCheckingForUpdates: false,
        isUpdateAvailable: false,
        isDownloading: false,
        isInstalling: false
    })

    const [showNotificationDialog, setShowNotificationDialog] = useState(false)
    const [showProgressDialog, setShowProgressDialog] = useState(false)
    const [showSettingsDialog, setShowSettingsDialog] = useState(false)

    const [progressInfo, setProgressInfo] = useState<ProgressInfo>({
        stage: 'preparing',
        progress: 0,
        message: 'Preparing...'
    })

    const [settings, setSettings] = useState<UpdateSettings>({
        autoCheck: true,
        autoInstall: false,
        checkInterval: 24,
        updateChannel: 'latest'
    })

    const [githubToken, setGithubToken] = useState<string>('')

    // Initialize and set up event listeners
    useEffect(() => {
        if (typeof window === 'undefined' || !window.dbconsole?.isDesktop) {
            return // Not in Electron environment
        }

        const dbconsoleAPI = window.dbconsole

        // Load initial data
        loadCurrentVersion()
        loadSettings()
        loadGitHubToken()

        // Set up event listeners for update events
        const handleUpdateAvailable = (updateInfo: UpdateInfo) => {
            setUpdateState(prev => ({
                ...prev,
                availableUpdate: updateInfo,
                isUpdateAvailable: true,
                isCheckingForUpdates: false
            }))

            // Show notification if not auto-installing
            if (!settings.autoInstall) {
                setShowNotificationDialog(true)
            }
        }

        const handleUpdateProgress = (progress: any) => {
            setProgressInfo({
                stage: 'downloading',
                progress: progress.percent || 0,
                message: `Downloading... ${Math.round(progress.percent || 0)}%`,
                bytesDownloaded: progress.transferred,
                totalBytes: progress.total,
                downloadSpeed: progress.bytesPerSecond
            })

            setUpdateState(prev => ({ ...prev, isDownloading: true }))
            setShowProgressDialog(true)
        }

        const handleInstallationProgress = (progress: any) => {
            setProgressInfo({
                stage: progress.stage || 'installing',
                progress: progress.progress || 0,
                message: progress.message || 'Installing...'
            })

            setUpdateState(prev => ({
                ...prev,
                isDownloading: false,
                isInstalling: true
            }))
            setShowProgressDialog(true)
        }

        const handleUpdateComplete = () => {
            setProgressInfo({
                stage: 'complete',
                progress: 100,
                message: 'Update completed successfully!'
            })

            setUpdateState(prev => ({
                ...prev,
                isDownloading: false,
                isInstalling: false,
                isUpdateAvailable: false,
                availableUpdate: undefined
            }))
        }

        const handleUpdateError = (error: any) => {
            setUpdateState(prev => ({
                ...prev,
                isCheckingForUpdates: false,
                isDownloading: false,
                isInstalling: false,
                error: error.error || error.message || 'Update failed'
            }))

            setProgressInfo({
                stage: 'error',
                progress: 0,
                message: 'Update failed'
            })
        }

        // Register event listeners (these would be actual Electron IPC events)
        // For now, we'll simulate with custom events
        window.addEventListener('update-available', handleUpdateAvailable as any)
        window.addEventListener('update-progress', handleUpdateProgress as any)
        window.addEventListener('installation-progress', handleInstallationProgress as any)
        window.addEventListener('update-complete', handleUpdateComplete as any)
        window.addEventListener('update-error', handleUpdateError as any)

        return () => {
            window.removeEventListener('update-available', handleUpdateAvailable as any)
            window.removeEventListener('update-progress', handleUpdateProgress as any)
            window.removeEventListener('installation-progress', handleInstallationProgress as any)
            window.removeEventListener('update-complete', handleUpdateComplete as any)
            window.removeEventListener('update-error', handleUpdateError as any)
        }
    }, [settings.autoInstall])

    const loadCurrentVersion = async () => {
        try {
            if (typeof window !== 'undefined' && window.dbconsole?.isDesktop) {
                // In Electron, get version from IPC
                const appInfo = await window.dbconsole.api.app.info()
                setUpdateState(prev => ({ ...prev, currentVersion: appInfo.version }))
            }
        } catch (error) {
            console.error('Failed to load current version:', error)
        }
    }

    const loadSettings = async () => {
        try {
            // Load settings from storage or IPC
            // For now, use defaults
            setSettings({
                autoCheck: true,
                autoInstall: false,
                checkInterval: 24,
                updateChannel: 'latest'
            })
        } catch (error) {
            console.error('Failed to load settings:', error)
        }
    }

    const loadGitHubToken = async () => {
        try {
            // Load GitHub token from secure storage
            // For now, leave empty
            setGithubToken('')
        } catch (error) {
            console.error('Failed to load GitHub token:', error)
        }
    }

    const checkForUpdates = useCallback(async () => {
        if (updateState.isCheckingForUpdates) return

        try {
            setUpdateState(prev => ({
                ...prev,
                isCheckingForUpdates: true,
                error: undefined
            }))

            // Simulate update check
            setTimeout(() => {
                setUpdateState(prev => ({
                    ...prev,
                    isCheckingForUpdates: false,
                    lastCheckTime: new Date()
                }))
            }, 2000)

        } catch (error) {
            setUpdateState(prev => ({
                ...prev,
                isCheckingForUpdates: false,
                error: error instanceof Error ? error.message : 'Update check failed'
            }))
        }
    }, [updateState.isCheckingForUpdates])

    const installUpdate = useCallback(async (updateInfo: UpdateInfo) => {
        try {
            setShowNotificationDialog(false)
            setShowProgressDialog(true)

            // Start the installation process
            // This would call the Electron updater
            console.log('Installing update:', updateInfo.version)

        } catch (error) {
            setUpdateState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Installation failed'
            }))
        }
    }, [])

    const skipUpdate = useCallback(() => {
        setShowNotificationDialog(false)
        setUpdateState(prev => ({
            ...prev,
            isUpdateAvailable: false,
            availableUpdate: undefined
        }))
    }, [])

    const saveSettings = useCallback(async (newSettings: UpdateSettings) => {
        try {
            setSettings(newSettings)
            // Save to storage or IPC
            console.log('Saving settings:', newSettings)
        } catch (error) {
            console.error('Failed to save settings:', error)
        }
    }, [])

    const saveGitHubToken = useCallback(async (token: string) => {
        try {
            setGithubToken(token)
            // Save to secure storage
            console.log('Saving GitHub token')
        } catch (error) {
            console.error('Failed to save GitHub token:', error)
        }
    }, [])

    const getStatusIcon = () => {
        if (updateState.isCheckingForUpdates) {
            return <RefreshCw className="h-4 w-4 animate-spin" />
        }
        if (updateState.error) {
            return <AlertCircle className="h-4 w-4 text-destructive" />
        }
        if (updateState.isUpdateAvailable) {
            return <Download className="h-4 w-4 text-blue-500 dark:text-blue-400" />
        }
        return <CheckCircle className="h-4 w-4 text-green-500 dark:text-green-400" />
    }

    const getStatusText = () => {
        if (updateState.isCheckingForUpdates) {
            return 'Checking...'
        }
        if (updateState.error) {
            return 'Error'
        }
        if (updateState.isUpdateAvailable) {
            return 'Update Available'
        }
        return 'Up to date'
    }

    // Don't render in web environment
    if (typeof window === 'undefined' || !window.dbconsole?.isDesktop) {
        return null
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={className}>
                        {getStatusIcon()}
                        <span className="ml-2">{getStatusText()}</span>
                        {updateState.isUpdateAvailable && (
                            <Badge variant="secondary" className="ml-2">
                                {updateState.availableUpdate?.version}
                            </Badge>
                        )}
                        <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5 text-sm font-medium">
                        Version {updateState.currentVersion}
                    </div>

                    {updateState.lastCheckTime && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                            Last checked: {updateState.lastCheckTime.toLocaleTimeString()}
                        </div>
                    )}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem onClick={checkForUpdates} disabled={updateState.isCheckingForUpdates}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Check for Updates
                    </DropdownMenuItem>

                    {updateState.isUpdateAvailable && (
                        <DropdownMenuItem onClick={() => setShowNotificationDialog(true)}>
                            <Download className="h-4 w-4 mr-2" />
                            Install Update
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem onClick={() => setShowSettingsDialog(true)}>
                        <Settings className="h-4 w-4 mr-2" />
                        Update Settings
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <UpdateNotificationDialog
                isOpen={showNotificationDialog}
                onClose={() => setShowNotificationDialog(false)}
                updateInfo={updateState.availableUpdate || null}
                onInstallUpdate={installUpdate}
                onSkipUpdate={skipUpdate}
                isDownloading={updateState.isDownloading}
                isInstalling={updateState.isInstalling}
                error={updateState.error}
            />

            <UpdateProgressDialog
                isOpen={showProgressDialog}
                onClose={() => setShowProgressDialog(false)}
                progressInfo={progressInfo}
                updateVersion={updateState.availableUpdate?.version}
                error={updateState.error}
            />

            <UpdateSettingsDialog
                isOpen={showSettingsDialog}
                onClose={() => setShowSettingsDialog(false)}
                settings={settings}
                onSaveSettings={saveSettings}
                githubToken={githubToken}
                onSaveGitHubToken={saveGitHubToken}
            />
        </>
    )
}