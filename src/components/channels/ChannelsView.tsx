import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { 
  ArrowsClockwise, 
  Plus,
  CheckCircle,
  Warning,
  XCircle,
  Lightning,
  ChartBar,
  Link,
  LinkBreak,
  ArrowClockwise,
  Calendar,
  CurrencyCircleDollar,
  Bed,
  Users,
  TrendUp,
  Eye,
  ArrowUp
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { InventorySyncPanel } from './InventorySyncPanel'
import { InventoryCalendar, InventoryOverview } from './InventoryCalendar'
import { RateParityPanel } from './RateParityPanel'
import { RatePushPanel } from '../rates/RatePushPanel'

interface Channel {
  id: string
  name: string
  provider: 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB'
  enabled: boolean
  connected: boolean
  lastSync?: string
  status: 'ACTIVE' | 'ERROR' | 'WARNING' | 'DISCONNECTED'
  credentials?: {
    apiKey?: string
    propertyId?: string
    hotelId?: string
  }
  stats?: {
    totalBookings: number
    monthlyRevenue: number
    occupancyRate: number
  }
}

interface ChannelReservation {
  id: string
  channelId: string
  channelRef: string
  guestName: string
  checkIn: string
  checkOut: string
  roomType: string
  nights: number
  totalAmount: number
  status: 'PENDING' | 'CONFIRMED' | 'SYNCED'
  syncedAt?: string
}

interface SyncLog {
  id: string
  channelId: string
  timestamp: string
  type: 'INVENTORY' | 'RATES' | 'RESERVATIONS' | 'RESTRICTIONS' | 'RATE_PUSH'
  status: 'SUCCESS' | 'ERROR' | 'WARNING'
  message: string
  details?: string
}

export function ChannelsView() {
  const [channels, setChannels] = useKV<Channel[]>('channels', [
    {
      id: 'booking',
      name: 'Booking.com',
      provider: 'BOOKING_COM',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'agoda',
      name: 'Agoda',
      provider: 'AGODA',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'expedia',
      name: 'Expedia',
      provider: 'EXPEDIA',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'airbnb',
      name: 'Airbnb',
      provider: 'AIRBNB',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    }
  ])
  const [reservations, setReservations] = useKV<ChannelReservation[]>('channel-reservations', [])
  const [syncLogs, setSyncLogs] = useKV<SyncLog[]>('channel-sync-logs', [])
  const [roomTypes] = useKV<Array<{ id: string; name: string; baseRate: number }>>('room-types-config', [])

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [showReservationDialog, setShowReservationDialog] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [apiKey, setApiKey] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [hotelId, setHotelId] = useState('')

  const connectedChannels = channels.filter(c => c.connected)
  const pendingReservations = reservations.filter(r => r.status === 'PENDING')

  const handleConnectChannel = () => {
    if (!selectedChannel || !apiKey || !propertyId) {
      toast.error('Please fill in all required fields')
      return
    }

    setChannels(current => 
      current.map(c => 
        c.id === selectedChannel.id 
          ? {
              ...c,
              connected: false,
              enabled: false,
              status: 'WARNING',
              lastSync: undefined,
              credentials: { apiKey, propertyId, hotelId: hotelId || undefined }
            }
          : c
      )
    )

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      channelId: selectedChannel.id,
      timestamp: new Date().toISOString(),
      type: 'INVENTORY',
      status: 'WARNING',
      message: `Saved ${selectedChannel.name} credentials`,
      details: 'No live channel connector is configured, so synchronization was not enabled.'
    }
    setSyncLogs(current => [log, ...current])

    setApiKey('')
    setPropertyId('')
    setHotelId('')
    setShowConnectDialog(false)
    toast.info(`${selectedChannel.name} credentials saved`, {
      description: 'A live channel connector is required before sync can be enabled.',
    })
  }

  const handleDisconnect = (channelId: string) => {
    const channel = channels.find(c => c.id === channelId)
    if (!channel) return

    setChannels(current => 
      current.map(c => 
        c.id === channelId 
          ? {
              ...c,
              connected: false,
              enabled: false,
              status: 'DISCONNECTED',
              credentials: undefined
            }
          : c
      )
    )

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      channelId,
      timestamp: new Date().toISOString(),
      type: 'INVENTORY',
      status: 'WARNING',
      message: `Disconnected from ${channel.name}`
    }
    setSyncLogs(current => [log, ...current])

    toast.success(`Disconnected from ${channel.name}`)
  }

  const handleSync = async (channelId: string) => {
    const channel = channels.find(c => c.id === channelId)
    if (!channel) return

    setSyncing(true)
    
    await new Promise(resolve => setTimeout(resolve, 2000))

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      channelId,
      timestamp: new Date().toISOString(),
      type: 'RESERVATIONS',
      status: 'WARNING',
      message: `Manual sync checked ${channel.name}`,
      details: 'No live channel connector is configured, so no reservations were imported.'
    }
    setSyncLogs(current => [log, ...current])

    setChannels(current => 
      current.map(c => 
        c.id === channelId 
          ? { ...c, lastSync: new Date().toISOString() }
          : c
      )
    )

    setSyncing(false)
    toast.info(`Checked ${channel.name}`, {
      description: 'No live channel connector is configured.'
    })
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    
    for (const channel of connectedChannels) {
      await handleSync(channel.id)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    setSyncing(false)
  }

  const handleImportReservation = (reservation: ChannelReservation) => {
    setReservations(current => 
      current.map(r => 
        r.id === reservation.id 
          ? { ...r, status: 'SYNCED', syncedAt: new Date().toISOString() }
          : r
      )
    )

    const channel = channels.find(c => c.id === reservation.channelId)
    toast.success(`Imported reservation from ${channel?.name}`)
  }

  const toggleChannel = (channelId: string) => {
    setChannels(current => 
      current.map(c => 
        c.id === channelId && c.connected
          ? { ...c, enabled: !c.enabled, status: !c.enabled ? 'ACTIVE' : 'WARNING' }
          : c
      )
    )
  }

  const getStatusColor = (status: Channel['status']) => {
    switch (status) {
      case 'ACTIVE': return 'text-green-600'
      case 'ERROR': return 'text-red-600'
      case 'WARNING': return 'text-orange-600'
      case 'DISCONNECTED': return 'text-gray-400'
    }
  }

  const getStatusIcon = (status: Channel['status']) => {
    switch (status) {
      case 'ACTIVE': return <CheckCircle className="w-4 h-4" />
      case 'ERROR': return <XCircle className="w-4 h-4" />
      case 'WARNING': return <Warning className="w-4 h-4" />
      case 'DISCONNECTED': return <LinkBreak className="w-4 h-4" />
    }
  }

  const getProviderLogo = (provider: Channel['provider']) => {
    const colors: Record<Channel['provider'], string> = {
      BOOKING_COM: 'bg-blue-500',
      AGODA: 'bg-red-500',
      EXPEDIA: 'bg-yellow-500',
      AIRBNB: 'bg-pink-500'
    }
    return colors[provider]
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ArrowsClockwise className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Channel Manager</h1>
              <p className="text-sm text-muted-foreground">OTA integrations and inventory sync</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={handleSyncAll}
              disabled={syncing || connectedChannels.length === 0}
            >
              <ArrowClockwise className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
              Sync All Channels
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="channels" className="h-full flex flex-col">
          <TabsList>
            <TabsTrigger value="channels">
              Channels ({connectedChannels.length}/{channels.length})
            </TabsTrigger>
            <TabsTrigger value="rate-push">
              <ArrowUp className="w-4 h-4 mr-2" />
              Rate Push
            </TabsTrigger>
            <TabsTrigger value="rate-parity">
              <CurrencyCircleDollar className="w-4 h-4 mr-2" />
              Rate Parity
            </TabsTrigger>
            <TabsTrigger value="inventory-sync">
              <Lightning className="w-4 h-4 mr-2" />
              Real-Time Sync
            </TabsTrigger>
            <TabsTrigger value="inventory">
              <Bed className="w-4 h-4 mr-2" />
              Inventory
            </TabsTrigger>
            <TabsTrigger value="reservations">
              Pending Reservations ({pendingReservations.length})
            </TabsTrigger>
            <TabsTrigger value="logs">
              Sync Logs ({syncLogs.length})
            </TabsTrigger>
            <TabsTrigger value="performance">
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="channels" className="flex-1 mt-6">
            <div className="grid grid-cols-2 gap-6 h-full">
              {channels.map(channel => (
                <Card key={channel.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center", getProviderLogo(channel.provider))}>
                          <span className="text-white font-bold text-lg">{channel.name.charAt(0)}</span>
                        </div>
                        <div>
                          <CardTitle>{channel.name}</CardTitle>
                          <div className={cn("flex items-center gap-1 mt-1", getStatusColor(channel.status))}>
                            {getStatusIcon(channel.status)}
                            <span className="text-sm font-medium capitalize">
                              {channel.status.toLowerCase().replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={channel.enabled}
                        onCheckedChange={() => toggleChannel(channel.id)}
                        disabled={!channel.connected}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {channel.connected ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Bookings</p>
                            <p className="text-xl font-bold">{channel.stats?.totalBookings || 0}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Revenue</p>
                            <p className="text-xl font-bold">฿{(channel.stats?.monthlyRevenue || 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Occupancy</p>
                            <p className="text-xl font-bold">{channel.stats?.occupancyRate || 0}%</p>
                          </div>
                        </div>

                        <Separator />

                        <div>
                          <p className="text-sm text-muted-foreground mb-2">
                            Last sync: {channel.lastSync ? format(new Date(channel.lastSync), 'MMM d, HH:mm') : 'Never'}
                          </p>
                          <div className="flex gap-2">
                            <Button 
                              className="flex-1" 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleSync(channel.id)}
                              disabled={syncing || !channel.enabled}
                            >
                              <ArrowClockwise className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
                              Sync Now
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleDisconnect(channel.id)}
                            >
                              <LinkBreak className="w-4 h-4 mr-2" />
                              Disconnect
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <LinkBreak className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">
                          Connect {channel.name} to sync inventory and reservations
                        </p>
                        <Button onClick={() => {
                          setSelectedChannel(channel)
                          setShowConnectDialog(true)
                        }}>
                          <Link className="w-4 h-4 mr-2" />
                          Connect Channel
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="rate-push" className="flex-1 mt-6">
            <RatePushPanel />
          </TabsContent>

          <TabsContent value="rate-parity" className="flex-1 mt-6">
            <RateParityPanel connectedChannels={channels} />
          </TabsContent>

          <TabsContent value="inventory-sync" className="flex-1 mt-6">
            <InventorySyncPanel connectedChannels={channels} />
          </TabsContent>

          <TabsContent value="inventory" className="flex-1 mt-6">
            <div className="space-y-6">
              <InventoryOverview />
              {roomTypes.length === 0 ? (
                <Card className="p-12 text-center">
                  <Bed className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Room Types Configured</h3>
                  <p className="text-sm text-muted-foreground">
                    Complete property setup before publishing inventory to channels.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  {roomTypes.map((roomType) => (
                    <InventoryCalendar key={roomType.id} roomTypeId={roomType.id} roomTypeName={roomType.name} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="reservations" className="flex-1 mt-6">
            <ScrollArea className="h-[calc(100vh-250px)]">
              <div className="grid grid-cols-2 gap-4">
                {pendingReservations.length === 0 ? (
                  <Card className="col-span-2 p-12 text-center">
                    <CheckCircle className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">All Caught Up</h3>
                    <p className="text-sm text-muted-foreground">
                      No pending reservations to import
                    </p>
                  </Card>
                ) : (
                  pendingReservations.map(reservation => {
                    const channel = channels.find(c => c.id === reservation.channelId)
                    return (
                      <Card key={reservation.id}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <CardTitle className="text-lg">{reservation.guestName}</CardTitle>
                              <div className="flex items-center gap-2 mt-1">
                                <div className={cn("w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold", getProviderLogo(channel?.provider || 'BOOKING_COM'))}>
                                  {channel?.name.charAt(0)}
                                </div>
                                <span className="text-sm text-muted-foreground">{reservation.channelRef}</span>
                              </div>
                            </div>
                            <Badge>Pending</Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground mb-1">Check-in</p>
                                <p className="font-medium">{format(new Date(reservation.checkIn), 'MMM d, yyyy')}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">Check-out</p>
                                <p className="font-medium">{format(new Date(reservation.checkOut), 'MMM d, yyyy')}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground mb-1">Room Type</p>
                                <p className="font-medium">{reservation.roomType}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">Nights</p>
                                <p className="font-medium">{reservation.nights}</p>
                              </div>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Total Amount</span>
                              <span className="text-xl font-bold">฿{reservation.totalAmount.toLocaleString()}</span>
                            </div>
                            <Button 
                              className="w-full" 
                              onClick={() => handleImportReservation(reservation)}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Import to PMS
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="logs" className="flex-1 mt-6">
            <ScrollArea className="h-[calc(100vh-250px)]">
              <div className="space-y-2">
                {syncLogs.length === 0 ? (
                  <Card className="p-12 text-center">
                    <ArrowsClockwise className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">No sync activity yet</p>
                  </Card>
                ) : (
                  syncLogs.map(log => {
                    const channel = channels.find(c => c.id === log.channelId)
                    return (
                      <Card key={log.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={cn(
                                log.status === 'SUCCESS' && "bg-green-50 text-green-700 border-green-200",
                                log.status === 'ERROR' && "bg-red-50 text-red-700 border-red-200",
                                log.status === 'WARNING' && "bg-orange-50 text-orange-700 border-orange-200"
                              )}>
                                {log.type}
                              </Badge>
                              <span className="text-sm font-medium">{channel?.name}</span>
                            </div>
                            <p className="text-sm mb-1">{log.message}</p>
                            {log.details && (
                              <p className="text-xs text-muted-foreground">{log.details}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                            </p>
                          </div>
                        </div>
                      </Card>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="performance" className="flex-1 mt-6">
            <div className="grid grid-cols-2 gap-6">
              {channels.filter(c => c.connected).map(channel => (
                <Card key={channel.id}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", getProviderLogo(channel.provider))}>
                        <span className="text-white font-bold">{channel.name.charAt(0)}</span>
                      </div>
                      <CardTitle>{channel.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <Users className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-2xl font-bold">{channel.stats?.totalBookings || 0}</p>
                        <p className="text-xs text-muted-foreground">Bookings</p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <CurrencyCircleDollar className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-2xl font-bold">฿{((channel.stats?.monthlyRevenue || 0) / 1000).toFixed(0)}k</p>
                        <p className="text-xs text-muted-foreground">Revenue</p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <TrendUp className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-2xl font-bold">{channel.stats?.occupancyRate || 0}%</p>
                        <p className="text-xs text-muted-foreground">Occupancy</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Average Daily Rate</span>
                        <span className="text-sm font-bold">No data</span>
                      </div>
                      <Progress value={0} className="h-2" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Conversion Rate</span>
                        <span className="text-sm font-bold">No data</span>
                      </div>
                      <Progress value={0} className="h-2" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Guest Satisfaction</span>
                        <span className="text-sm font-bold">No data</span>
                      </div>
                      <Progress value={0} className="h-2" />
                    </div>
                  </CardContent>
                </Card>
              ))}

              {connectedChannels.length === 0 && (
                <Card className="col-span-2 p-12 text-center">
                  <ChartBar className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Data Available</h3>
                  <p className="text-sm text-muted-foreground">
                    Connect channels to view performance metrics
                  </p>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {selectedChannel?.name}</DialogTitle>
            <DialogDescription>
              Save your {selectedChannel?.name} credentials. A live connector must be added before synchronization is enabled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="Enter API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Property ID</Label>
              <Input
                placeholder="Enter property ID"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Hotel ID (Optional)</Label>
              <Input
                placeholder="Enter hotel ID if required"
                value={hotelId}
                onChange={(e) => setHotelId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConnectDialog(false)}>Cancel</Button>
            <Button onClick={handleConnectChannel}>Save Credentials</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
