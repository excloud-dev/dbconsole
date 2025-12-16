"use client"

import { useState, useEffect, useCallback } from 'react'
import { AboutDialog } from './about-dialog'
import { UpdateSettingsDialog, UpdateSettings } from './update-settings-dialog'
import { UpdateNotificationDialog, UpdateInfo } from './update-notification-dialog'
import { UpdateProgressDialog, ProgressInfo } from './update-progress-dialog'
import { useToast } from '@/hooks/use-toast'

export function MenuHandler() {
    const { toast } = useToast()
    const [showAboutDialog, setShowAboutDialog] = useState(false)
    const [showUpdateSettingsDialog, setShowUpdateSettingsDialog] = useState(false)
    const [showUpdateNotificationDialog, setShowUpdateNotificationDialog] = useState(false)
    const [showUpdateProgressDialog, setShowUpdateProgressDialog] = useState(false)

    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
    const [progressInfo, setProgressInfo] = useState<ProgressInfo>({
        stage: 'preparing',
        progress: 0,
        message: 'Preparing...'
    })
    const [updateSettings, setUpdateSettings] = useState<UpdateSettings>({
        autoCheck: false,
        autoInstall: false,
        checkInterval: 24,
        updateChannel: 'latest'
    })
    const [githubToken, setGithubToken] = useState<string>('')
    const [isTokenConfigured, setIsTokenConfigured] = useState(false)
    const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
    const [updateError, setUpdateError] = useState<string | null>(null)

    const checkIfTokenExists = useCallback(async (): Promise<boolean> => {
        try {
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                const result = await (window as any).dbconsole.api.updater.token.exists()
                return result.exists
            }
            return false
        } catch (error) {
            return false
        }
    }, [])

    const refreshTokenStatus = useCallback(async () => {
        try {
            const exists = await checkIfTokenExists()
            setIsTokenConfigured(exists)
        } catch (error) {
            console.error('Failed to refresh token status:', error)
            setIsTokenConfigured(false)
        }
    }, [checkIfTokenExists])

    const handleCheckForUpdates = useCallback(async () => {
        if (isCheckingForUpdates) return

        setIsCheckingForUpdates(true)
        setUpdateError(null)

        try {
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                // First check if we have a GitHub token configured
                const settings = await (window as any).dbconsole.api.updater.settings.get()

                // For manual checks, if no token is configured, show settings dialog
                const hasToken = await checkIfTokenExists()
                if (!hasToken) {
                    setShowUpdateSettingsDialog(true)
                    toast({
                        title: "GitHub Token Required",
                        description: "Please configure your GitHub Personal Access Token to check for updates from private repositories."
                    })
                    return
                }

                const result = await (window as any).dbconsole.api.updater.check()

                if (result) {
                    // Update available
                    setUpdateInfo(result)
                    setShowUpdateNotificationDialog(true)
                    toast({
                        title: "Update Available",
                        description: `Version ${result.version} is now available.`
                    })
                } else {
                    // No update available
                    toast({
                        title: "No Updates Available",
                        description: "You're running the latest version of DBConsole."
                    })
                }
            }
        } catch (error: any) {
            console.error('Update check failed:', error)
            setUpdateError(error.message || 'Update check failed')
            toast({
                variant: "destructive",
                title: "Update Check Failed",
                description: error.message || 'Failed to check for updates.'
            })
        } finally {
            setIsCheckingForUpdates(false)
        }
    }, [isCheckingForUpdates, toast, checkIfTokenExists])

    useEffect(() => {
        if (showUpdateSettingsDialog) {
            refreshTokenStatus()
        }
    }, [showUpdateSettingsDialog, refreshTokenStatus])

    const loadUpdateSettings = useCallback(async () => {
        try {
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                const settings = await (window as any).dbconsole.api.updater.settings.get()
                setUpdateSettings(settings)
            }
        } catch (error) {
            console.error('Failed to load update settings:', error)
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined' || !(window as any).dbconsole?.isDesktop) {
            return
        }

        const dbconsole = (window as any).dbconsole

        // Load initial settings
        loadUpdateSettings()

        // Set up menu event listeners
        const unsubscribeAbout = dbconsole.events.onMenuAbout(() => {
            setShowAboutDialog(true)
        })

        const unsubscribeCheckUpdates = dbconsole.events.onMenuCheckUpdates(() => {
            try {
                handleCheckForUpdates()
            } catch (error) {
                console.error('Error in menu check updates handler:', error)
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to handle update check menu action."
                })
            }
        })

        const unsubscribeUpdateSettings = dbconsole.events.onMenuUpdateSettings(() => {
            refreshTokenStatus()
            setShowUpdateSettingsDialog(true)
        })

        return () => {
            unsubscribeAbout()
            unsubscribeCheckUpdates()
            unsubscribeUpdateSettings()
        }
    }, [handleCheckForUpdates, toast, loadUpdateSettings, refreshTokenStatus])

    const handleInstallUpdate = async (updateInfo: UpdateInfo) => {
        try {
            setShowUpdateNotificationDialog(false)
            setShowUpdateProgressDialog(true)
            setProgressInfo({
                stage: 'preparing',
                progress: 0,
                message: 'Preparing to download update...'
            })

            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                await (window as any).dbconsole.api.updater.install(updateInfo)
            }

            setProgressInfo({
                stage: 'complete',
                progress: 100,
                message: 'Installer opened. Complete installation and relaunch DBConsole.'
            })

            toast({
                title: 'Update ready',
                description: 'The installer has been opened. Finish installing, then relaunch DBConsole.'
            })
        } catch (error: any) {
            console.error('Update installation failed:', error)
            setUpdateError(error.message || 'Installation failed')

            setProgressInfo({
                stage: 'error',
                progress: 0,
                message: 'Update failed'
            })

            toast({
                variant: "destructive",
                title: "Installation Failed",
                description: error.message || 'Failed to install update.'
            })
        }
    }

    const handleSkipUpdate = () => {
        setShowUpdateNotificationDialog(false)
        setUpdateInfo(null)
    }

    const handleSaveSettings = async (newSettings: UpdateSettings) => {
        try {
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                await (window as any).dbconsole.api.updater.settings.set(newSettings)
                setUpdateSettings(newSettings)
                toast({
                    title: "Settings Saved",
                    description: "Update settings have been saved successfully."
                })
            }
        } catch (error: any) {
            console.error('Failed to save settings:', error)
            toast({
                variant: "destructive",
                title: "Failed to Save Settings",
                description: error.message || 'Could not save update settings.'
            })
        }
    }

    const handleSaveGitHubToken = async (token: string) => {
        try {
            // First validate the token by testing it
            toast({
                title: "Validating Token",
                description: "Testing GitHub token..."
            })

            const isValid = await validateGitHubToken(token)
            if (!isValid) {
                toast({
                    variant: "destructive",
                    title: "Invalid Token",
                    description: "The GitHub token is invalid or doesn't have the required permissions."
                })
                return
            }

            // Token is valid, save it
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                await (window as any).dbconsole.api.updater.token.set(token)
                setGithubToken(token)
                setIsTokenConfigured(true)
                toast({
                    title: "Token Saved",
                    description: "GitHub token has been validated and saved securely."
                })
            }
        } catch (error: any) {
            console.error('Failed to save GitHub token:', error)
            toast({
                variant: "destructive",
                title: "Failed to Save Token",
                description: error.message || 'Could not save GitHub token.'
            })
        }
    }

    const validateGitHubToken = async (token: string): Promise<boolean> => {
        try {
            if (typeof window !== 'undefined' && (window as any).dbconsole?.api?.updater) {
                const result = await (window as any).dbconsole.api.updater.token.validate(token)

                if (!result.valid) {
                    toast({
                        variant: "destructive",
                        title: "Invalid Token",
                        description: result.error || "The GitHub token is invalid."
                    })
                    return false
                }

                return true
            }
            return false
        } catch (error: any) {
            console.error('Token validation failed:', error)
            toast({
                variant: "destructive",
                title: "Validation Failed",
                description: error.message || "Could not validate GitHub token."
            })
            return false
        }
    }

    // Don't render anything in web environment
    if (typeof window === 'undefined' || !(window as any).dbconsole?.isDesktop) {
        return null
    }

    return (
        <>
            <AboutDialog
                isOpen={showAboutDialog}
                onClose={() => setShowAboutDialog(false)}
            />

            <UpdateSettingsDialog
                isOpen={showUpdateSettingsDialog}
                onClose={() => setShowUpdateSettingsDialog(false)}
                settings={updateSettings}
                onSaveSettings={handleSaveSettings}
                githubToken={githubToken}
                onSaveGitHubToken={handleSaveGitHubToken}
                isLoading={isCheckingForUpdates}
                tokenConfigured={isTokenConfigured}
            />

            <UpdateNotificationDialog
                isOpen={showUpdateNotificationDialog}
                onClose={() => setShowUpdateNotificationDialog(false)}
                updateInfo={updateInfo}
                onInstallUpdate={handleInstallUpdate}
                onSkipUpdate={handleSkipUpdate}
                isDownloading={false}
                isInstalling={false}
                error={updateError || undefined}
            />

            <UpdateProgressDialog
                isOpen={showUpdateProgressDialog}
                onClose={() => setShowUpdateProgressDialog(false)}
                progressInfo={progressInfo}
                updateVersion={updateInfo?.version}
                error={updateError || undefined}
            />
        </>
    )
}