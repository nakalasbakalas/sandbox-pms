import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { 
  ArrowsClockwise,
  CheckCircle,
  Warning,
  XCircle,
  Lightning,
  Clock,
  ChartBar,
  Activity
} from '@phosphor-icons/react'
import { useInventorySync } from '@/hooks/use-inventory-sync'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface InventorySyncPanelProps {
  connectedChannels: Array<{
    id: string
    name: string
    connected: boolean
    enabled: boolean
  }>
}

export function InventorySyncPanel({ connectedChannels }: InventorySyncPanelProps) {
  const {
    syncEvents,
    syncLogs,
    autoSyncEnabled,
    setAutoSyncEnabled,
    getPendingEventCount,
    getChannelSyncHealth,
    manualSyncAllChannels,
    channelStates,
    setChannelStates
  } = useInventorySync()

  const [syncing, setSyncing] = useState(false)
  const pendingCount = getPendingEventCount()
  const channelHealth = getChannelSyncHealth()
  const recentEvents = syncEvents.slice(0, 10)
  const recentLogs = syncLogs.slice(0, 15)

  useEffect(() => {
    const activeChannels = connectedChannels.filter(ch => ch.connected && ch.enabled)
    
    setChannelStates(current => {
      const existingIds = new Set(current.map(ch => ch.channelId))
      const newChannels = activeChannels
        .filter(ch => !existingIds.has(ch.id))
        .map(ch => ({
          channelId: ch.id,
          lastSyncTimestamp: new Date().toISOString(),
          pendingEvents: 0,
          syncEnabled: true
        }))

      const updatedChannels = current
        .filter(ch => activeChannels.some(ac => ac.id === ch.channelId))
        .map(ch => {
          const channel = activeChannels.find(ac => ac.id === ch.channelId)
          return channel ? { ...ch, syncEnabled: channel.enabled } : ch
        })

      return [...updatedChannels, ...newChannels]
    })
  }, [connectedChannels, setChannelStates])

  const handleManualSync = async () => {
    setSyncing(true)
    try {
      await manualSyncAllChannels('deluxe', 90)
      await manualSyncAllChannels('superior', 90)
      await manualSyncAllChannels('suite', 90)
    } finally {
      setSyncing(false)
    }
  }

  const getEventIcon = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'FAILED':
        return <XCircle className="w-4 h-4 text-red-600" />
      case 'IN_PROGRESS':
        return <Clock className="w-4 h-4 text-blue-600 animate-pulse" />
      case 'PENDING':
        return <Clock className="w-4 h-4 text-orange-600" />
      default:
        return <Activity className="w-4 h-4 text-gray-400" />
    }
  }

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'HEALTHY':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'DEGRADED':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'ERROR':
        return 'text-red-600 bg-red-50 border-red-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getEventTypeLabel = (eventType: string) => {
    return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
  }

  return (
    <div className="grid grid-cols-3 gap-6 h-full">
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Real-Time Sync Status</CardTitle>
                <CardDescription>Automatic inventory synchronization across all channels</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={autoSyncEnabled}
                    onCheckedChange={(checked) => {
                      setAutoSyncEnabled(checked)
                      toast.success(checked ? 'Auto-sync enabled' : 'Auto-sync disabled')
                    }}
                  />
                  <span className="text-sm font-medium">Auto-Sync</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualSync}
                  disabled={syncing || connectedChannels.filter(ch => ch.connected).length === 0}
                >
                  <ArrowsClockwise className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
                  Sync Now
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">Active Channels</span>
                </div>
                <p className="text-2xl font-bold text-blue-900">
                  {connectedChannels.filter(ch => ch.connected && ch.enabled).length}
                </p>
              </div>

              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                  <span className="text-sm font-medium text-orange-900">Pending Events</span>
                </div>
                <p className="text-2xl font-bold text-orange-900">{pendingCount}</p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Lightning className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-green-900">Sync Mode</span>
                </div>
                <p className="text-xl font-bold text-green-900">
                  {autoSyncEnabled ? 'Real-Time' : 'Manual'}
                </p>
              </div>
            </div>

            <Separator className="my-4" />

            <div>
              <h3 className="text-sm font-semibold mb-3">Channel Health</h3>
              <div className="space-y-2">
                {channelHealth.map((health) => {
                  const channel = connectedChannels.find(ch => ch.id === health.channelId)
                  if (!channel) return null

                  return (
                    <div key={health.channelId} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-2 h-2 rounded-full", 
                          health.health === 'HEALTHY' ? 'bg-green-600' :
                          health.health === 'DEGRADED' ? 'bg-orange-600' : 'bg-red-600'
                        )} />
                        <div>
                          <p className="font-medium text-sm">{channel.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Last sync: {health.lastSync ? formatDistanceToNow(new Date(health.lastSync), { addSuffix: true }) : 'Never'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Success Rate</p>
                          <p className="text-sm font-bold">{health.successRate.toFixed(1)}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Avg Time</p>
                          <p className="text-sm font-bold">{(health.avgDuration / 1000).toFixed(1)}s</p>
                        </div>
                        <Badge variant="outline" className={cn("text-xs", getHealthColor(health.health))}>
                          {health.health}
                        </Badge>
                      </div>
                    </div>
                  )
                })}

                {channelHealth.length === 0 && (
                  <div className="text-center py-8">
                    <ChartBar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No active channels connected</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-lg">Recent Sync Operations</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {recentLogs.length === 0 ? (
                  <div className="text-center py-12">
                    <ArrowsClockwise className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No sync operations yet</p>
                  </div>
                ) : (
                  recentLogs.map(log => {
                    const channel = connectedChannels.find(ch => ch.id === log.channelId)
                    return (
                      <div key={log.id} className="p-3 bg-muted rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {log.status === 'SUCCESS' ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : log.status === 'PARTIAL' ? (
                              <Warning className="w-4 h-4 text-orange-600" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600" />
                            )}
                            <span className="font-medium text-sm">{channel?.name || log.channelId}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground">
                              {log.operation.replace(/_/g, ' ')}
                            </span>
                            <span className="text-muted-foreground">
                              {log.dateRange.start} → {log.dateRange.end}
                            </span>
                            <span className="font-medium">
                              {log.recordsUpdated} records
                            </span>
                          </div>
                          <span className="text-muted-foreground">
                            {(log.duration / 1000).toFixed(2)}s
                          </span>
                        </div>
                        {log.errors && log.errors.length > 0 && (
                          <div className="mt-2 text-xs text-red-600">
                            {log.errors.join(', ')}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">Live Event Stream</CardTitle>
            <CardDescription>Real-time inventory changes</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-2">
                {recentEvents.length === 0 ? (
                  <div className="text-center py-12">
                    <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No recent events</p>
                  </div>
                ) : (
                  recentEvents.map(event => (
                    <div key={event.id} className="p-3 bg-muted rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getEventIcon(event.syncStatus)}
                          <span className="font-medium text-sm">
                            {getEventTypeLabel(event.eventType)}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {event.syncStatus}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Room Type: {event.roomTypeId}</p>
                        <p>Delta: {event.delta > 0 ? '+' : ''}{event.delta} units</p>
                        <p>Dates: {event.affectedDates.length} affected</p>
                        {event.syncedToChannels.length > 0 && (
                          <p className="text-green-600 font-medium">
                            Synced to {event.syncedToChannels.length} channel(s)
                          </p>
                        )}
                        {event.errors && Object.keys(event.errors).length > 0 && (
                          <p className="text-red-600 font-medium">
                            {Object.keys(event.errors).length} error(s)
                          </p>
                        )}
                        <p>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
