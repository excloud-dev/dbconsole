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
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
    Settings,
    Shield,
    Clock,
    Download,
    AlertTriangle,
    Info,
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
}

export function UpdateSettingsDialog({
    isOpen,
    onClose,
    settings,
    onSaveSettings,
    githubToken,
    onSaveGitHubToken,
    isLoading = false
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
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Update Settings
                    </DialogTitle>
                    <DialogDescription>
                        Configure how DBConsole checks for and installs updates
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* GitHub Authentication */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Key className="h-4 w-4" />
                            <h3 className="text-sm font-medium">GitHub Authentication</h3>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="github-token">Personal Access Token</Label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="github-token"
                                        type={showToken ? 'text' : 'password'}
                                        value={localToken}
                                        onChange={(e) => setLocalToken(e.target.value)}
                                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                                        className="pr-10"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-0 top-0 h-full px-3"
                                        onClick={() => setShowToken(!showToken)}
                                    >
                                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Required for accessing private repositories. Token should have &apos;repo&apos; permissions.
                            </p>
                        </div>
                    </div>

                    <Separator />

                    {/* Update Checking */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            <h3 className="text-sm font-medium">Update Checking</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Automatic Update Checks</Label>
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
                                    <Label htmlFor="check-interval">Check Interval</Label>
                                    <Select
                                        value={localSettings.checkInterval.toString()}
                                        onValueChange={(value) => updateSetting('checkInterval', parseInt(value))}
                                    >
                                        <SelectTrigger>
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
                                <Label htmlFor="update-channel">Update Channel</Label>
                                <Select
                                    value={localSettings.updateChannel}
                                    onValueChange={(value: UpdateSettings['updateChannel']) =>
                                        updateSetting('updateChannel', value)
                                    }
                                >
                                    <SelectTrigger>
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
                                        <Label htmlFor="custom-pattern">Tag Pattern</Label>
                                        <Input
                                            id="custom-pattern"
                                            value={localSettings.customTagPattern || ''}
                                            onChange={(e) => updateSetting('customTagPattern', e.target.value)}
                                            placeholder="v*-beta"
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
                        <div className="flex items-center gap-2">
                            <Download className="h-4 w-4" />
                            <h3 className="text-sm font-medium">Installation</h3>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Automatic Installation</Label>
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
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Maintenance Window</Label>
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
                                        <Label htmlFor="start-time">Start Time</Label>
                                        <Input
                                            id="start-time"
                                            type="time"
                                            value={localSettings.maintenanceWindow.startTime}
                                            onChange={(e) => updateMaintenanceWindow({ startTime: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="end-time">End Time</Label>
                                        <Input
                                            id="end-time"
                                            type="time"
                                            value={localSettings.maintenanceWindow.endTime}
                                            onChange={(e) => updateMaintenanceWindow({ endTime: e.target.value })}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Warning for auto-install */}
                    {localSettings.autoInstall && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                            <div className="text-sm">
                                <p className="font-medium text-amber-800">Automatic Installation Enabled</p>
                                <p className="text-amber-700">
                                    Updates will be installed automatically and may restart the application without warning.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges || isLoading}>
                        {isLoading ? 'Saving...' : 'Save Settings'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}