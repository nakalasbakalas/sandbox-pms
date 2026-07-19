import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowsClockwise,
  Bed,
  CheckCircle,
  Copy,
  Link,
  LinkBreak,
  ShieldCheck,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { createPmsIdempotencyKey, pmsApi } from '@/lib/pms-api-client'
import type { SystemCapabilityRegistry } from '@/types/system-capabilities'

type ChannelProvider = 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB'

type ServerIcalChannel = {
  id: string
  provider: ChannelProvider
  name: string
  exportFileName?: string
  exportFeedUrl?: string
  lastPublishedAt?: string
  exportTokenIssuedAt?: string
  exportTokenConfigured?: boolean
  exportTokenGraceUntil?: string
}

type ServerChannel = {
  key: string
  provider: ChannelProvider
  name: string
  persisted: ServerIcalChannel | null
}

type ChannelRoomMapping = {
  id: string
  channelId: string
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId?: string | null
  roomTypeId: string
  roomIds: string[]
  active: boolean
  updatedAt: string
}

type RoomType = {
  id: string
  code?: string
  name: string
}

type Room = {
  id: string
  number: string
  floor?: number
  operationalStatus?: string
  roomTypeId: string
}

type RoomSetup = {
  propertyId: string
  roomTypes: RoomType[]
  rooms: Room[]
}

type ServerChannelsSnapshot = {
  channels: ServerIcalChannel[]
  mappings: ChannelRoomMapping[]
  roomSetup: RoomSetup
  capabilities: SystemCapabilityRegistry
}

type MappingDraft = {
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId: string
  roomTypeId: string
  roomIds: string[]
  active: boolean
  reason: string
}

const EMPTY_MAPPING_DRAFT: MappingDraft = {
  externalRoomTypeId: '',
  externalRoomTypeName: '',
  externalRatePlanId: '',
  roomTypeId: '',
  roomIds: [],
  active: true,
  reason: '',
}

const CHANNEL_CATALOG: Array<Omit<ServerChannel, 'persisted'>> = [
  { key: 'booking', provider: 'BOOKING_COM', name: 'Booking.com' },
  { key: 'agoda', provider: 'AGODA', name: 'Agoda' },
  { key: 'expedia', provider: 'EXPEDIA', name: 'Expedia' },
  { key: 'airbnb', provider: 'AIRBNB', name: 'Airbnb' },
]

function providerPath(provider: ChannelProvider) {
  return provider.toLowerCase().replaceAll('_', '-')
}

function safeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function mappingExternalId(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function ServerChannelsView() {
  const { hasPermission } = useAuth()
  const canManageChannels = hasPermission('manage:channels')
  const [snapshot, setSnapshot] = useState<ServerChannelsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('channels')
  const [selectedProvider, setSelectedProvider] = useState<ChannelProvider>('BOOKING_COM')
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>(EMPTY_MAPPING_DRAFT)
  const [configuringChannel, setConfiguringChannel] = useState<ServerChannel | null>(null)
  const [exportFileName, setExportFileName] = useState('')
  const [configurationReason, setConfigurationReason] = useState('')
  const [configurationIdempotencyKey, setConfigurationIdempotencyKey] = useState('')
  const [issuedFeedUrls, setIssuedFeedUrls] = useState<Partial<Record<ChannelProvider, string>>>({})
  const [saving, setSaving] = useState(false)
  const mutationAttemptKeys = useRef(new Map<string, string>())

  const idempotencyKeyFor = (intent: string) => {
    const existing = mutationAttemptKeys.current.get(intent)
    if (existing) return existing
    const key = createPmsIdempotencyKey('channel-mutation')
    mutationAttemptKeys.current.set(intent, key)
    return key
  }

  const retireIdempotencyKey = (intent: string) => {
    mutationAttemptKeys.current.delete(intent)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [channelsPayload, mappingsPayload, roomSetupPayload, capabilitiesPayload] = await Promise.all([
        pmsApi<{ ok: true; data: ServerIcalChannel[] }>('/api/channels/ical', null),
        pmsApi<{ ok: true; data: ChannelRoomMapping[] }>('/api/channels/mappings', null),
        pmsApi<{ ok: true; data: RoomSetup }>('/api/settings/room-setup', null),
        pmsApi<{ ok: true; data: SystemCapabilityRegistry }>('/api/system/capabilities', null),
      ])
      if (
        !Array.isArray(channelsPayload.data) ||
        !Array.isArray(mappingsPayload.data) ||
        !roomSetupPayload.data ||
        !Array.isArray(roomSetupPayload.data.roomTypes) ||
        !Array.isArray(roomSetupPayload.data.rooms) ||
        !capabilitiesPayload.data?.integrations?.ical ||
        !capabilitiesPayload.data?.integrations?.ota
      ) {
        throw new Error('The server returned an invalid Channels authority snapshot.')
      }
      setSnapshot({
        channels: channelsPayload.data || [],
        mappings: mappingsPayload.data || [],
        roomSetup: roomSetupPayload.data,
        capabilities: capabilitiesPayload.data,
      })
    } catch (error) {
      setSnapshot(null)
      setLoadError(safeError(error, 'Authoritative channel data could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const channels = useMemo<ServerChannel[]>(() => CHANNEL_CATALOG.map((channel) => ({
    ...channel,
    persisted: snapshot?.channels.find((candidate) => candidate.provider === channel.provider) || null,
  })), [snapshot?.channels])

  const selectedChannel = channels.find((channel) => channel.provider === selectedProvider) || channels[0]
  const selectedMappings = selectedChannel?.persisted
    ? snapshot?.mappings.filter((mapping) => mapping.channelId === selectedChannel.persisted?.id) || []
    : []
  const selectedRoomTypeRooms = snapshot?.roomSetup.rooms
    .filter((room) => room.roomTypeId === mappingDraft.roomTypeId)
    .sort((left, right) => left.number.localeCompare(right.number, undefined, { numeric: true })) || []

  const resetMappingDraft = () => {
    setEditingMappingId(null)
    setMappingDraft(EMPTY_MAPPING_DRAFT)
  }

  const openChannelConfiguration = (channel: ServerChannel) => {
    setConfiguringChannel(channel)
    setExportFileName(channel.persisted?.exportFileName || `${channel.key}-sandbox-hotel-blocks.ics`)
    setConfigurationReason('')
    setConfigurationIdempotencyKey(createPmsIdempotencyKey(`ical-${channel.key}`))
  }

  const saveChannelConfiguration = async (rotateToken = false) => {
    if (!configuringChannel) return
    if (!canManageChannels) {
      toast.error('You do not have permission to manage channels.')
      return
    }
    if (configurationReason.trim().length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }
    setSaving(true)
    try {
      const payload = await pmsApi<{ ok: true; data: ServerIcalChannel }>(
        `/api/channels/ical/${providerPath(configuringChannel.provider)}`,
        null,
        {
          method: 'POST',
          headers: { 'x-idempotency-key': configurationIdempotencyKey },
          body: JSON.stringify({
            exportFileName: exportFileName.trim() || undefined,
            rotateToken,
            reason: configurationReason.trim(),
          }),
        },
      )
      if (payload.data.exportFeedUrl) {
        setIssuedFeedUrls((current) => ({ ...current, [configuringChannel.provider]: payload.data.exportFeedUrl }))
      }
      setConfiguringChannel(null)
      toast.success(`${configuringChannel.name} iCal configuration saved to the PMS.`)
      await load()
    } catch (error) {
      toast.error(safeError(error, 'The server did not save this iCal configuration.'))
    } finally {
      setSaving(false)
    }
  }

  const disconnectChannel = async (channel: ServerChannel) => {
    if (!channel.persisted) return
    if (!canManageChannels) {
      toast.error('You do not have permission to manage channels.')
      return
    }
    const reason = window.prompt(`Operational reason required to remove ${channel.name} iCal configuration:`)?.trim() || ''
    if (reason.length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }
    setSaving(true)
    const intent = `disable:${channel.provider}:${reason}`
    try {
      await pmsApi(`/api/channels/ical/${providerPath(channel.provider)}`, null, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKeyFor(intent) },
        body: JSON.stringify({ reason }),
      })
      retireIdempotencyKey(intent)
      setIssuedFeedUrls((current) => {
        const next = { ...current }
        delete next[channel.provider]
        return next
      })
      toast.success(`${channel.name} iCal configuration removed from the PMS.`)
      await load()
    } catch (error) {
      toast.error(safeError(error, 'The server did not remove this iCal configuration.'))
    } finally {
      setSaving(false)
    }
  }

  const saveMapping = async () => {
    if (!canManageChannels) {
      toast.error('You do not have permission to manage channels.')
      return
    }
    if (!selectedChannel?.persisted) {
      toast.error('Configure this channel before saving a room mapping.')
      return
    }
    if (!mappingDraft.externalRoomTypeName.trim() || !mappingDraft.roomTypeId || mappingDraft.roomIds.length === 0) {
      toast.error('Add the OTA room name, PMS room type, and at least one room.')
      return
    }
    if (mappingDraft.reason.trim().length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }

    setSaving(true)
    const payload = {
      channelId: selectedChannel.persisted.id,
      externalRoomTypeId: mappingDraft.externalRoomTypeId.trim() || mappingExternalId(mappingDraft.externalRoomTypeName),
      externalRoomTypeName: mappingDraft.externalRoomTypeName.trim(),
      externalRatePlanId: mappingDraft.externalRatePlanId.trim() || null,
      roomTypeId: mappingDraft.roomTypeId,
      roomIds: mappingDraft.roomIds,
      active: mappingDraft.active,
      reason: mappingDraft.reason.trim(),
    }
    const intent = `mapping-save:${editingMappingId || 'new'}:${JSON.stringify(payload)}`
    try {
      const path = editingMappingId
        ? `/api/channels/mappings/${encodeURIComponent(editingMappingId)}`
        : '/api/channels/mappings'
      await pmsApi(path, null, {
        method: editingMappingId ? 'PATCH' : 'POST',
        headers: { 'x-idempotency-key': idempotencyKeyFor(intent) },
        body: JSON.stringify(payload),
      })
      retireIdempotencyKey(intent)
      resetMappingDraft()
      toast.success(`${selectedChannel.name} room mapping saved to the PMS.`)
      await load()
    } catch (error) {
      toast.error(safeError(error, 'The room mapping was not saved.'))
    } finally {
      setSaving(false)
    }
  }

  const editMapping = (mapping: ChannelRoomMapping) => {
    setEditingMappingId(mapping.id)
    setMappingDraft({
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRoomTypeName: mapping.externalRoomTypeName,
      externalRatePlanId: mapping.externalRatePlanId || '',
      roomTypeId: mapping.roomTypeId,
      roomIds: mapping.roomIds,
      active: mapping.active,
      reason: '',
    })
  }

  const updateMappingState = async (mapping: ChannelRoomMapping, active: boolean) => {
    if (!canManageChannels) {
      toast.error('You do not have permission to manage channels.')
      return
    }
    const reason = window.prompt(`Operational reason required to ${active ? 'activate' : 'pause'} this mapping:`)?.trim() || ''
    if (reason.length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }
    setSaving(true)
    const intent = `mapping-state:${mapping.id}:${active}:${reason}`
    try {
      await pmsApi(`/api/channels/mappings/${encodeURIComponent(mapping.id)}`, null, {
        method: 'PATCH',
        headers: { 'x-idempotency-key': idempotencyKeyFor(intent) },
        body: JSON.stringify({ active, reason }),
      })
      retireIdempotencyKey(intent)
      await load()
    } catch (error) {
      toast.error(safeError(error, 'The mapping status was not saved.'))
    } finally {
      setSaving(false)
    }
  }

  const deleteMapping = async (mapping: ChannelRoomMapping) => {
    if (!canManageChannels) {
      toast.error('You do not have permission to manage channels.')
      return
    }
    const reason = window.prompt('Operational reason required to remove this mapping:')?.trim() || ''
    if (reason.length < 3) {
      toast.error('Enter an operational reason of at least 3 characters.')
      return
    }
    setSaving(true)
    const intent = `mapping-delete:${mapping.id}:${reason}`
    try {
      await pmsApi(`/api/channels/mappings/${encodeURIComponent(mapping.id)}`, null, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKeyFor(intent) },
        body: JSON.stringify({ reason }),
      })
      retireIdempotencyKey(intent)
      resetMappingDraft()
      await load()
    } catch (error) {
      toast.error(safeError(error, 'The room mapping was not removed.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8" aria-label="Loading authoritative channel data">
        <ArrowsClockwise className="mr-3 h-6 w-6 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading channel data from the PMS…</span>
      </div>
    )
  }

  if (!snapshot || loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="w-full max-w-2xl border-destructive/40" role="alert">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warning className="h-5 w-5 text-destructive" />
              Channel Manager unavailable
            </CardTitle>
            <CardDescription>
              Authoritative channel, mapping, room, or capability data could not be loaded. No browser-backed channel state is being shown and all writes are blocked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button onClick={() => void load()}>
              <ArrowsClockwise className="mr-2 h-4 w-4" />
              Retry authoritative load
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const icalCapability = snapshot.capabilities.integrations.ical
  const otaCapability = snapshot.capabilities.integrations.ota
  const configuredCount = channels.filter((channel) => channel.persisted).length
  const mappedRoomCount = new Set(snapshot.mappings.filter((mapping) => mapping.active).flatMap((mapping) => mapping.roomIds)).size

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Channel Manager</h1>
            <p className="text-sm text-muted-foreground">Authoritative iCal configuration and property-scoped OTA room mapping</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={saving}>
            <ArrowsClockwise className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <Card className="border-amber-300 bg-amber-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5" />
                Provider boundary
              </CardTitle>
              <CardDescription>
                {icalCapability.evidence}. OTA writes are {otaCapability.writeMode}; provider proof is {otaCapability.providerProof ? 'recorded' : 'not recorded'}.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Rate push, real-time inventory sync, provider performance, sync logs, and browser reservation imports are unavailable in server mode until authenticated provider services persist and verify those results.
              {!canManageChannels && ' Your role has read-only channel access; configuration controls are disabled.'}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Configured feeds</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{configuredCount}/{channels.length}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Mapped rooms</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{mappedRoomCount}/{snapshot.roomSetup.rooms.length}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Operating mode</CardTitle></CardHeader>
              <CardContent><Badge variant="outline">{icalCapability.writeMode}</Badge></CardContent>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="channels">iCal channels</TabsTrigger>
              <TabsTrigger value="mapping">Room mapping</TabsTrigger>
            </TabsList>

            <TabsContent value="channels" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {channels.map((channel) => {
                  const issuedUrl = issuedFeedUrls[channel.provider]
                  return (
                    <Card key={channel.provider}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle>{channel.name}</CardTitle>
                            <CardDescription>Manual iCal date-block exchange only</CardDescription>
                          </div>
                          <Badge variant={channel.persisted ? 'outline' : 'secondary'}>
                            {channel.persisted ? <CheckCircle className="mr-1 h-3.5 w-3.5" /> : <LinkBreak className="mr-1 h-3.5 w-3.5" />}
                            {channel.persisted ? 'Configured' : 'Not configured'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {channel.persisted && (
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><span className="text-muted-foreground">Inbound reservations</span><p className="font-medium">Booking Inbox / adapter only</p></div>
                            <div><span className="text-muted-foreground">Export token</span><p className="font-medium">{channel.persisted.exportTokenConfigured ? 'Hashed and configured' : 'Not issued'}</p></div>
                          </div>
                        )}
                        {issuedUrl && (
                          <div className="rounded-md border p-3">
                            <Label htmlFor={`issued-${channel.key}`}>Newly issued URL — copy now</Label>
                            <div className="mt-2 flex gap-2">
                              <Input id={`issued-${channel.key}`} value={issuedUrl} readOnly />
                              <Button
                                size="icon"
                                variant="outline"
                                aria-label={`Copy ${channel.name} iCal URL`}
                                onClick={() => void navigator.clipboard.writeText(issuedUrl).then(() => toast.success('iCal URL copied.'))}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">This bearer URL is retained only in this browser session and is not returned by later API reads.</p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => openChannelConfiguration(channel)} disabled={saving || !canManageChannels}>
                            <Link className="mr-2 h-4 w-4" />
                            {channel.persisted ? 'Edit configuration' : 'Configure iCal'}
                          </Button>
                          {channel.persisted && (
                            <Button variant="outline" onClick={() => void disconnectChannel(channel)} disabled={saving || !canManageChannels}>
                              <XCircle className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </TabsContent>

            <TabsContent value="mapping" className="mt-4">
              <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Mapping editor</CardTitle>
                    <CardDescription>Map an OTA room category to authoritative PMS rooms.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Channel</Label>
                      <Select value={selectedProvider} onValueChange={(value) => { setSelectedProvider(value as ChannelProvider); resetMappingDraft() }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {channels.map((channel) => (
                            <SelectItem key={channel.provider} value={channel.provider}>{channel.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {!selectedChannel?.persisted ? (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Configure {selectedChannel?.name} on the iCal channels tab before saving mappings.
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="external-room-name">OTA room name</Label>
                          <Input id="external-room-name" value={mappingDraft.externalRoomTypeName} onChange={(event) => setMappingDraft((current) => ({ ...current, externalRoomTypeName: event.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="external-room-id">OTA room ID</Label>
                          <Input id="external-room-id" value={mappingDraft.externalRoomTypeId} onChange={(event) => setMappingDraft((current) => ({ ...current, externalRoomTypeId: event.target.value }))} placeholder="Generated from the room name when blank" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="external-rate-plan-id">OTA rate-plan ID</Label>
                          <Input id="external-rate-plan-id" value={mappingDraft.externalRatePlanId} onChange={(event) => setMappingDraft((current) => ({ ...current, externalRatePlanId: event.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>PMS room type</Label>
                          <Select
                            value={mappingDraft.roomTypeId}
                            onValueChange={(roomTypeId) => setMappingDraft((current) => ({
                              ...current,
                              roomTypeId,
                              roomIds: snapshot.roomSetup.rooms.filter((room) => room.roomTypeId === roomTypeId).map((room) => room.id),
                            }))}
                          >
                            <SelectTrigger><SelectValue placeholder="Select a room type" /></SelectTrigger>
                            <SelectContent>
                              {snapshot.roomSetup.roomTypes.map((roomType) => (
                                <SelectItem key={roomType.id} value={roomType.id}>{roomType.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {mappingDraft.roomTypeId && (
                          <div className="space-y-2">
                            <Label>Rooms</Label>
                            <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                              {selectedRoomTypeRooms.map((room) => (
                                <label key={room.id} className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={mappingDraft.roomIds.includes(room.id)}
                                    onCheckedChange={() => setMappingDraft((current) => ({
                                      ...current,
                                      roomIds: current.roomIds.includes(room.id)
                                        ? current.roomIds.filter((roomId) => roomId !== room.id)
                                        : [...current.roomIds, room.id],
                                    }))}
                                  />
                                  {room.number}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="mapping-reason">Operational reason</Label>
                          <Input id="mapping-reason" value={mappingDraft.reason} onChange={(event) => setMappingDraft((current) => ({ ...current, reason: event.target.value }))} />
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => void saveMapping()} disabled={saving || !canManageChannels}>{editingMappingId ? 'Update mapping' : 'Save mapping'}</Button>
                          {editingMappingId && <Button variant="outline" onClick={resetMappingDraft}>Cancel</Button>}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{selectedChannel?.name} mappings</CardTitle>
                    <CardDescription>These records are persisted, property-scoped, audited, and do not write to the provider.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedMappings.length === 0 ? (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        <Bed className="mx-auto mb-3 h-10 w-10" />
                        No persisted mappings.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selectedMappings.map((mapping) => (
                          <div key={mapping.id} className="rounded-md border p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold">{mapping.externalRoomTypeName}</p>
                                  <Badge variant={mapping.active ? 'outline' : 'secondary'}>{mapping.active ? 'Active' : 'Paused'}</Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">OTA ID: {mapping.externalRoomTypeId} · {mapping.roomIds.length} PMS room(s)</p>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => editMapping(mapping)} disabled={!canManageChannels}>Edit</Button>
                                <Button size="sm" variant="outline" onClick={() => void updateMappingState(mapping, !mapping.active)} disabled={saving || !canManageChannels}>
                                  {mapping.active ? 'Pause' : 'Activate'}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => void deleteMapping(mapping)} disabled={saving || !canManageChannels}>Remove</Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      <Dialog open={Boolean(configuringChannel)} onOpenChange={(open) => { if (!open) setConfiguringChannel(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{configuringChannel?.name} iCal configuration</DialogTitle>
            <DialogDescription>
              Publish a PMS-hosted date-block feed. Inbound provider URLs are not stored until an approved secret-reference service exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-export-file">Export filename</Label>
              <Input id="channel-export-file" value={exportFileName} onChange={(event) => setExportFileName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel-configuration-reason">Operational reason</Label>
              <Input id="channel-configuration-reason" value={configurationReason} onChange={(event) => setConfigurationReason(event.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {configuringChannel?.persisted?.exportTokenConfigured && (
              <Button variant="outline" onClick={() => void saveChannelConfiguration(true)} disabled={saving || !canManageChannels}>Rotate and issue URL</Button>
            )}
            <Button onClick={() => void saveChannelConfiguration(false)} disabled={saving || !canManageChannels}>Save to PMS</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
