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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
    Settings,
    Shield,
    Clock,
    Download,
    AlertTriangle,
    Key,
    Eye,
    EyeOff
} from 'lucide-react'

export interface UpdateSettings {
    autoCheck: boolean
    autoInstall: boolean
    checkInterval: number // hours
    updateChannel: 'latest' | 'prerelease' | 'custom'
    customTagPattern?: string
    maintenanceWindow?: {
        enabled: boolean
        startTime: string // HH:MM format
        endTime: string // HH:MM format
        timezone: string
    }
}

export interface UpdateSettingsProps {
    isOpen: boolean
    onClose: () => void
    settings: UpdateSettings
    onSaveSettings: (settings: UpdateSettings) => void
    githubToken?: string
    onSaveGitHubToken: (token: string) => void
    isLoading?: boolean
    tokenConfigured?: boolean
}

export function UpdateSettingsDialog({
    isOpen,
    onClose,
    settings,
    onSaveSettings,
    githubToken,
    onSaveGitHubToken,
    isLoading = false,
    tokenConfigured = false
}: UpdateSettingsProps) {
    const [localSettings, setLocalSettings] = useState<UpdateSettings>(settings)
    const [localToken, setLocalToken] = useState(githubToken || '')
    const [showToken, setShowToken] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)

    useEffect(() => {
        setLocalSettings(settings)
    }, [settings])

    useEffect(() => {
        setLocalToken(githubToken || '')
    }, [githubToken])

    useEffect(() => {
        const settingsChanged = JSON.stringify(localSettings) !== JSON.stringify(settings)
        const tokenChanged = localToken !== (githubToken || '')
        setHasChanges(settingsChanged || tokenChanged)
    }, [localSettings, settings, localToken, githubToken])

    const handleSave = () => {
        onSaveSettings(localSettings)
        if (localToken !== githubToken) {
            onSaveGitHubToken(localToken)
        }
        onClose()
    }

    const handleCancel = () => {
        setLocalSettings(settings)
        setLocalToken(githubToken || '')
        onClose()
    }

    const updateSetting = <K extends keyof UpdateSettings>(
        key: K,
        value: UpdateSettings[K]
    ) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }))
    }

    const updateMaintenanceWindow = (updates: Partial<NonNullable<UpdateSettings['maintenanceWindow']>>) => {
        setLocalSettings(prev => ({
            ...prev,
            maintenanceWindow: {
                ...prev.maintenanceWindow,
                enabled: prev.maintenanceWindow?.enabled || false,
                startTime: prev.maintenanceWindow?.startTime || '02:00',
                endTime: prev.maintenanceWindow?.endTime || '04:00',
                timezone: prev.maintenanceWindow?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                ...updates
            }
        }))
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="!max-w-2xl !w-[720px] max-h-[85vh] overflow-hidden p-0">
                <div className="flex flex-col h-full">
                <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
                    <DialogTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5 text-muted-foreground" />
                        Update Settings
                    </DialogTitle>
                    <DialogDescription>
                        Configure how DBConsole checks for and installs updates
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                    {/* GitHub Authentication */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            <Key className="h-3.5 w-3.5" />
                            <span>GitHub Authentication</span>
                            {tokenConfigured && (
                                <Badge variant="secondary" className="text-xs uppercase tracking-wide">
                                    Token Configured
                                </Badge>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="github-token" className="text-xs font-medium text-muted-foreground">
                                Personal Access Token
                            </Label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="github-token"
                                        type={showToken ? 'text' : 'password'}
                                        value={localToken}
                                        onChange={(e) => setLocalToken(e.target.value)}
                                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                                        className="h-8 pr-9"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 px-0 text-muted-foreground hover:text-foreground"
                                        onClick={() => setShowToken(!showToken)}
                                    >
                                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                                <p className="text-xs text-muted-foreground">
                                    Required for accessing private repositories. Token should have &apos;repo&apos; permissions.
                                </p>
                                {tokenConfigured && (
                                    <div className="flex items-start gap-3 p-3 rounded-md border border-success/30 bg-success/10 text-foreground text-sm">
                                        <Shield className="h-4 w-4 shrink-0 text-success" />
                                        <div>
                                            <p className="font-medium leading-tight">Token already configured</p>
                                            <p className="text-xs text-success leading-tight">
                                                DBConsole is already using a saved GitHub token. Leave this field empty to keep it,
                                                or enter a new token to replace the stored credentials if needed.
                                            </p>
                                        </div>
                                    </div>
                                )}
                        </div>
                    </div>

                    <Separator />

                    {/* Update Checking */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            <Clock className="h-3.5 w-3.5" />
                            <span>Update Checking</span>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2">
                                <div className="space-y-0.5">
                                    <Label className="text-xs font-medium text-muted-foreground">Automatic Update Checks</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Automatically check for new versions in the background
                                    </p>
                                </div>
                                <Switch
                                    checked={localSettings.autoCheck}
                                    onCheckedChange={(checked) => updateSetting('autoCheck', checked)}
                                />
                            </div>

                            {localSettings.autoCheck && (
                                <div className="space-y-2">
                                    <Label htmlFor="check-interval" className="text-xs font-medium text-muted-foreground">
                                        Check Interval
                                    </Label>
                                    <Select
                                        value={localSettings.checkInterval.toString()}
                                        onValueChange={(value) => updateSetting('checkInterval', parseInt(value))}
                                    >
                                        <SelectTrigger className="h-8 border-border bg-background">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1">Every hour</SelectItem>
                                            <SelectItem value="6">Every 6 hours</SelectItem>
                                            <SelectItem value="12">Every 12 hours</SelectItem>
                                            <SelectItem value="24">Daily</SelectItem>
                                            <SelectItem value="168">Weekly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="update-channel" className="text-xs font-medium text-muted-foreground">
                                    Update Channel
                                </Label>
                                <Select
                                    value={localSettings.updateChannel}
                                    onValueChange={(value: UpdateSettings['updateChannel']) =>
                                        updateSetting('updateChannel', value)
                                    }
                                >
                                    <SelectTrigger className="h-8 border-border bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="latest">
                                            <div className="flex items-center gap-2">
                                                <span>Latest Release</span>
                                                <Badge variant="secondary" className="text-xs">Stable</Badge>
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="prerelease">
                                            <div className="flex items-center gap-2">
                                                <span>Pre-release</span>
                                                <Badge variant="outline" className="text-xs">Beta</Badge>
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="custom">
                                            <div className="flex items-center gap-2">
                                                <span>Custom Pattern</span>
                                                <Badge variant="outline" className="text-xs">Advanced</Badge>
                                            </div>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {localSettings.updateChannel === 'custom' && (
                                    <div className="space-y-2">
                                        <Label htmlFor="custom-pattern" className="text-xs font-medium text-muted-foreground">
                                            Tag Pattern
                                        </Label>
                                        <Input
                                            id="custom-pattern"
                                            value={localSettings.customTagPattern || ''}
                                            onChange={(e) => updateSetting('customTagPattern', e.target.value)}
                                            placeholder="v*-beta"
                                            className="h-8"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Use wildcards (*) to match tag patterns. Example: v*-beta, release-*
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Installation Settings */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            <Download className="h-3.5 w-3.5" />
                            <span>Installation</span>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2">
                            <div className="space-y-0.5">
                                <Label className="text-xs font-medium text-muted-foreground">Automatic Installation</Label>
                                <p className="text-xs text-muted-foreground">
                                    Install updates automatically without user confirmation
                                </p>
                            </div>
                            <Switch
                                checked={localSettings.autoInstall}
                                onCheckedChange={(checked) => updateSetting('autoInstall', checked)}
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2">
                                <div className="space-y-0.5">
                                    <Label className="text-xs font-medium text-muted-foreground">Maintenance Window</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Only install updates during specified hours
                                    </p>
                                </div>
                                <Switch
                                    checked={localSettings.maintenanceWindow?.enabled || false}
                                    onCheckedChange={(checked) => updateMaintenanceWindow({ enabled: checked })}
                                />
                            </div>

                            {localSettings.maintenanceWindow?.enabled && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="start-time" className="text-xs font-medium text-muted-foreground">
                                            Start Time
                                        </Label>
                                        <Input
                                            id="start-time"
                                            type="time"
                                            value={localSettings.maintenanceWindow.startTime}
                                            onChange={(e) => updateMaintenanceWindow({ startTime: e.target.value })}
                                            className="h-8"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="end-time" className="text-xs font-medium text-muted-foreground">
                                            End Time
                                        </Label>
                                        <Input
                                            id="end-time"
                                            type="time"
                                            value={localSettings.maintenanceWindow.endTime}
                                            onChange={(e) => updateMaintenanceWindow({ endTime: e.target.value })}
                                            className="h-8"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Warning for auto-install */}
                    {localSettings.autoInstall && (
                        <div className="flex items-start gap-2 p-3 rounded-md border border-warning/30 bg-warning/10">
                            <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                            <div className="text-sm">
                                <p className="font-medium text-warning">Automatic Installation Enabled</p>
                                <p className="text-warning">
                                    Updates will be installed automatically and may restart the application without warning.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="px-6 py-3 border-t border-border">
                    <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges || isLoading}>
                        {isLoading ? 'Saving...' : 'Save Settings'}
                    </Button>
                </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
