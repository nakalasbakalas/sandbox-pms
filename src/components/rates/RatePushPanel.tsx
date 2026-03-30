import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { 
  ArrowUp, 
  CheckCircle, 
  XCircle, 
  Warning,
  Lightning,
  Gear,
  Play,
  ArrowClockwise
} from '@phosphor-icons/react'
import { useRatePush } from '@/hooks/use-rate-push'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useKV } from '@github/spark/hooks'
import { ManualRatePushDialog } from './ManualRatePushDialog'

interface Channel {
  id: string
  name: string
  enabled: boolean
  connected: boolean
}

interface RoomType {
  id: string
  name: string
}

export function RatePushPanel() {
  const {
    pushLogs,
    settings,
    updateSettings,
    getSuccessRate,
    getRecentPushes
  } = useRatePush()

  const [channels] = useKV<Channel[]>('channels', [])
  const [roomTypes] = useKV<RoomType[]>('room-types-config', [])
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showManualPushDialog, setShowManualPushDialog] = useState(false)
  const [pushWindow, setPushWindow] = useState(settings.pushWindow.toString())

  const recentPushes = getRecentPushes(10)
  const successRate = getSuccessRate()
  const connectedChannels = channels.filter(c => c.connected && c.enabled)

  const handleSaveSettings = () => {
    const window = parseInt(pushWindow)
    if (!isNaN(window) && window > 0) {
      updateSettings({ pushWindow: window })
    }
    setShowSettingsDialog(false)
  }

  const getStatusColor = (status: 'SUCCESS' | 'PARTIAL' | 'FAILED') => {
    switch (status) {
      case 'SUCCESS': return 'text-green-600 bg-green-50 border-green-200'
      case 'PARTIAL': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'FAILED': return 'text-red-600 bg-red-50 border-red-200'
    }
  }

  const getStatusIcon = (status: 'SUCCESS' | 'PARTIAL' | 'FAILED') => {
    switch (status) {
      case 'SUCCESS': return <CheckCircle className="w-4 h-4" />
      case 'PARTIAL': return <Warning className="w-4 h-4" />
      case 'FAILED': return <XCircle className="w-4 h-4" />
    }
  }

  const getTriggerLabel = (trigger: string) => {
    switch (trigger) {
      case 'MANUAL': return 'Manual'
      case 'AUTO_BASE_RATE': return 'Base Rate Change'
      case 'AUTO_RULE': return 'Rule Change'
      case 'AUTO_OVERRIDE': return 'Override Change'
      default: return trigger
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Auto Push</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {settings.autoEnabled ? 'ON' : 'OFF'}
              </span>
              <div className={cn(
                "p-2 rounded-lg",
                settings.autoEnabled ? "bg-green-100" : "bg-gray-100"
              )}>
                <Lightning className={cn(
                  "w-5 h-5",
                  settings.autoEnabled ? "text-green-600" : "text-gray-400"
                )} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">{successRate}%</span>
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <Progress value={successRate} className="h-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pushes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{pushLogs.length}</span>
              <ArrowUp className="w-5 h-5 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{connectedChannels.length}</span>
              <div className="flex -space-x-1">
                {connectedChannels.slice(0, 3).map((channel, i) => (
                  <div
                    key={channel.id}
                    className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold border-2 border-background"
                  >
                    {channel.name.charAt(0)}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Push Activity</CardTitle>
                <CardDescription>Latest rate pushes to OTA channels</CardDescription>
              </div>
              <Button onClick={() => setShowManualPushDialog(true)}>
                <ArrowUp className="w-4 h-4 mr-2" />
                Manual Push
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {recentPushes.length === 0 ? (
                <div className="text-center py-12">
                  <ArrowUp className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No rate pushes yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Changes to rates will automatically push to connected channels
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentPushes.map(log => {
                    const roomType = roomTypes.find(rt => rt.id === log.roomTypeId)
                    return (
                      <Card key={log.id} className="p-4">
                        <div className="flex items-start gap-4">
                          <div className={cn(
                            "p-2 rounded-lg flex-shrink-0",
                            getStatusColor(log.status)
                          )}>
                            {getStatusIcon(log.status)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <h4 className="font-semibold text-sm mb-1">
                                  {roomType?.name || log.roomTypeId}
                                </h4>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{format(new Date(log.timestamp), 'MMM d, HH:mm')}</span>
                                  <span>•</span>
                                  <Badge variant="outline" className="text-xs">
                                    {getTriggerLabel(log.triggeredBy)}
                                  </Badge>
                                </div>
                              </div>
                              <Badge variant="outline" className={getStatusColor(log.status)}>
                                {log.status}
                              </Badge>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="text-sm">
                                <span className="text-muted-foreground">Rate: </span>
                                <span className="font-semibold">฿{log.rate.toLocaleString()}</span>
                              </div>
                              
                              {log.successfulChannels.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {log.successfulChannels.map(channelId => {
                                    const channel = channels.find(c => c.id === channelId)
                                    return (
                                      <Badge key={channelId} variant="secondary" className="text-xs">
                                        <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                                        {channel?.name || channelId}
                                      </Badge>
                                    )
                                  })}
                                </div>
                              )}

                              {log.failedChannels.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {log.failedChannels.map(channelId => {
                                    const channel = channels.find(c => c.id === channelId)
                                    return (
                                      <Badge key={channelId} variant="secondary" className="text-xs">
                                        <XCircle className="w-3 h-3 mr-1 text-red-600" />
                                        {channel?.name || channelId}
                                      </Badge>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Settings</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowSettingsDialog(true)}>
                <Gear className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto Push</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically push rate changes
                  </p>
                </div>
                <Switch
                  checked={settings.autoEnabled}
                  onCheckedChange={(checked) => updateSettings({ autoEnabled: checked })}
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Push Triggers</Label>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal text-sm">Base Rate</Label>
                    <p className="text-xs text-muted-foreground">
                      When base rate changes
                    </p>
                  </div>
                  <Switch
                    checked={settings.pushOnBaseRateChange}
                    onCheckedChange={(checked) => updateSettings({ pushOnBaseRateChange: checked })}
                    disabled={!settings.autoEnabled}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal text-sm">Rate Rules</Label>
                    <p className="text-xs text-muted-foreground">
                      When rules are modified
                    </p>
                  </div>
                  <Switch
                    checked={settings.pushOnRuleChange}
                    onCheckedChange={(checked) => updateSettings({ pushOnRuleChange: checked })}
                    disabled={!settings.autoEnabled}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal text-sm">Overrides</Label>
                    <p className="text-xs text-muted-foreground">
                      When overrides are set
                    </p>
                  </div>
                  <Switch
                    checked={settings.pushOnOverrideChange}
                    onCheckedChange={(checked) => updateSettings({ pushOnOverrideChange: checked })}
                    disabled={!settings.autoEnabled}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Push Window</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={settings.pushWindow}
                    onChange={(e) => updateSettings({ pushWindow: parseInt(e.target.value) || 90 })}
                    className="flex-1"
                    disabled={!settings.autoEnabled}
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  How far ahead to push rates
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Channel Status</Label>
              <ScrollArea className="h-[200px]">
                {connectedChannels.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No channels connected</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {connectedChannels.map(channel => (
                      <div key={channel.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                            {channel.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{channel.name}</span>
                        </div>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rate Push Settings</DialogTitle>
            <DialogDescription>
              Configure automatic rate push behavior
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Push Window (days)</Label>
              <Input
                type="number"
                value={pushWindow}
                onChange={(e) => setPushWindow(e.target.value)}
                placeholder="90"
              />
              <p className="text-xs text-muted-foreground">
                Number of days ahead to push rate changes
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManualRatePushDialog 
        open={showManualPushDialog} 
        onOpenChange={setShowManualPushDialog} 
      />
    </div>
  )
}
