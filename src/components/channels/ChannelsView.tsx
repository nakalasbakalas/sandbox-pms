import { useCallback, useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  CurrencyCircleDollar,
  Bed,
  Users,
  TrendUp,
  ArrowUp
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { downloadIcalFeed, generateIcalFeed, parseIcalEvents, type IcalEvent } from '@/lib/ical'
import { nightsBetween } from '@/lib/hotel/business-rules'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { InventorySyncPanel } from './InventorySyncPanel'
import { InventoryCalendar, InventoryOverview } from './InventoryCalendar'
import { RateParityPanel } from './RateParityPanel'
import { RatePushPanel } from '../rates/RatePushPanel'
import type { BoardRoomCard } from '@/types/board'

interface Channel {
  id: string
  name: string
  provider: 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB'
  connectionMode?: 'ICAL'
  enabled: boolean
  connected: boolean
  lastSync?: string
  status: 'ACTIVE' | 'ERROR' | 'WARNING' | 'DISCONNECTED'
  iCal?: {
    importUrl?: string
    exportFileName?: string
    exportFeedUrl?: string
    lastImportAt?: string
    lastExportAt?: string
    lastPublishedAt?: string
    exportTokenIssuedAt?: string
    lastError?: string
  }
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
  importedVia?: 'ICAL'
}

interface SyncLog {
  id: string
  channelId: string
  timestamp: string
  type: 'INVENTORY' | 'RATES' | 'RESERVATIONS' | 'RESTRICTIONS' | 'RATE_PUSH' | 'ICAL_IMPORT' | 'ICAL_EXPORT'
  status: 'SUCCESS' | 'ERROR' | 'WARNING'
  message: string
  details?: string
}

interface ChannelRoomMapping {
  id: string
  channelId: string
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId?: string
  roomTypeId: string
  roomIds: string[]
  active: boolean
  updatedAt: string
}

interface ServerIcalChannel {
  provider: Channel['provider']
  name: string
  importUrl?: string
  exportFileName?: string
  exportFeedUrl?: string
  lastPublishedAt?: string
  exportTokenIssuedAt?: string
}

interface RoomTypeOption {
  id: string
  code?: string
  name: string
  baseRate?: number
}

interface RoomOption {
  id: string
  number: string
  roomTypeId: string
  floor?: number
  unavailable: boolean
}

interface MappingFormState {
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId: string
  roomTypeId: string
  roomIds: string[]
}

const EMPTY_MAPPING_FORM: MappingFormState = {
  externalRoomTypeId: '',
  externalRoomTypeName: '',
  externalRatePlanId: '',
  roomTypeId: '',
  roomIds: []
}

function externalIdFromName(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || `OTA_ROOM_${Date.now()}`
}

function sortByRoomNumber(a: RoomOption, b: RoomOption) {
  return a.number.localeCompare(b.number, undefined, { numeric: true })
}

export function ChannelsView() {
  const [channels, setChannels] = useKV<Channel[]>('channels', [
    {
      id: 'booking',
      name: 'Booking.com',
      provider: 'BOOKING_COM',
      connectionMode: 'ICAL',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'agoda',
      name: 'Agoda',
      provider: 'AGODA',
      connectionMode: 'ICAL',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'expedia',
      name: 'Expedia',
      provider: 'EXPEDIA',
      connectionMode: 'ICAL',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    },
    {
      id: 'airbnb',
      name: 'Airbnb',
      provider: 'AIRBNB',
      connectionMode: 'ICAL',
      enabled: false,
      connected: false,
      status: 'DISCONNECTED',
      stats: { totalBookings: 0, monthlyRevenue: 0, occupancyRate: 0 }
    }
  ])
  const [reservations, setReservations] = useKV<ChannelReservation[]>('channel-reservations', [])
  const [syncLogs, setSyncLogs] = useKV<SyncLog[]>('channel-sync-logs', [])
  const [roomTypes] = useKV<RoomTypeOption[]>('room-types-config', [])
  const [setupRoomTypes] = useKV<RoomTypeOption[]>('onboarding-room-types', [])
  const [boardRooms] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [setupRooms] = useKV<Array<{ id: string; number: string; roomTypeId: string; floor?: number; status?: string }>>('onboarding-rooms', [])
  const [channelMappings, setChannelMappings] = useKV<ChannelRoomMapping[]>('channel-room-mappings', [])
  const [pmsReservations, setPmsReservations] = useKV<any[]>('reservations', [])
  const [, setReservationData] = useKV<any[]>('reservations-data', [])
  const [unassignedReservations, setUnassignedReservations] = useKV<any[]>('unassigned-reservations', [])

  const [activeTab, setActiveTab] = useState('channels')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [selectedMappingChannelId, setSelectedMappingChannelId] = useState('booking')
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [mappingForm, setMappingForm] = useState<MappingFormState>(EMPTY_MAPPING_FORM)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [publishingFeedId, setPublishingFeedId] = useState<string | null>(null)

  const [importUrl, setImportUrl] = useState('')
  const [icalText, setIcalText] = useState('')

  const effectiveRoomTypes = useMemo(() => {
    return roomTypes.length > 0 ? roomTypes : setupRoomTypes
  }, [roomTypes, setupRoomTypes])

  const roomOptions = useMemo<RoomOption[]>(() => {
    const boardRoomOptions = (boardRooms || [])
      .map((room) => ({
        id: room.roomId,
        number: room.number || room.roomNumber || room.roomId,
        roomTypeId: room.roomTypeId || '',
        floor: room.floor,
        unavailable: room.operationalStatus !== 'AVAILABLE'
      }))
      .filter((room) => room.id && room.number && room.roomTypeId)

    if (boardRoomOptions.length > 0) {
      return [...boardRoomOptions].sort(sortByRoomNumber)
    }

    return (setupRooms || [])
      .map((room) => ({
        id: room.id,
        number: room.number,
        roomTypeId: room.roomTypeId,
        floor: room.floor,
        unavailable: room.status === 'out-of-service'
      }))
      .filter((room) => room.id && room.number && room.roomTypeId)
      .sort(sortByRoomNumber)
  }, [boardRooms, setupRooms])

  const selectedMappingChannel = channels.find((channel) => channel.id === selectedMappingChannelId) || channels[0] || null
  const connectedChannels = channels.filter(c => c.connected)
  const pendingReservations = reservations.filter(r => r.status === 'PENDING')
  const totalRoomCount = roomOptions.length
  const mappedRoomCount = new Set(channelMappings.filter((mapping) => mapping.active).flatMap((mapping) => mapping.roomIds)).size

  const getRoomsForType = (roomTypeId: string) => roomOptions.filter((room) => room.roomTypeId === roomTypeId)
  const getRoomTypeName = (roomTypeId: string) => effectiveRoomTypes.find((roomType) => roomType.id === roomTypeId)?.name || roomTypeId
  const getRoomNumber = (roomId: string) => roomOptions.find((room) => room.id === roomId)?.number || roomId

  const getChannelMappings = (channelId: string) => {
    return channelMappings.filter((mapping) => mapping.channelId === channelId)
  }

  const providerPath = (provider: Channel['provider']) => provider.toLowerCase().replaceAll('_', '-')

  const mergeServerIcalChannels = useCallback((serverChannels: ServerIcalChannel[]) => {
    setChannels((current) => current.map((channel) => {
      const serverChannel = serverChannels.find((item) => item.provider === channel.provider)
      if (!serverChannel) return channel

      return {
        ...channel,
        connectionMode: 'ICAL',
        connected: true,
        status: 'ACTIVE',
        lastSync: serverChannel.lastPublishedAt || channel.lastSync,
        iCal: {
          ...channel.iCal,
          importUrl: serverChannel.importUrl || channel.iCal?.importUrl,
          exportFileName: serverChannel.exportFileName || channel.iCal?.exportFileName,
          exportFeedUrl: serverChannel.exportFeedUrl || channel.iCal?.exportFeedUrl,
          lastPublishedAt: serverChannel.lastPublishedAt || channel.iCal?.lastPublishedAt,
          exportTokenIssuedAt: serverChannel.exportTokenIssuedAt || channel.iCal?.exportTokenIssuedAt,
        }
      }
    }))
  }, [setChannels])

  useEffect(() => {
    if (!SERVER_API_ENABLED) return

    let cancelled = false
    void pmsApi<{ ok: true; data: ServerIcalChannel[] }>('/api/channels/ical', undefined)
      .then((payload) => {
        if (!cancelled) mergeServerIcalChannels(payload.data || [])
      })
      .catch(() => {
        // Channel setup remains usable locally if the server feed list is not available.
      })

    return () => {
      cancelled = true
    }
  }, [mergeServerIcalChannels])

  const getMappingStats = (channelId: string) => {
    const mappings = getChannelMappings(channelId).filter((mapping) => mapping.active)
    const mappedRoomIds = mappings.flatMap((mapping) => mapping.roomIds)
    const uniqueMappedRoomIds = new Set(mappedRoomIds)
    const duplicateRoomIds = mappedRoomIds.filter((roomId, index) => mappedRoomIds.indexOf(roomId) !== index)
    const unmappedRooms = roomOptions.filter((room) => !uniqueMappedRoomIds.has(room.id))

    return {
      mappingCount: mappings.length,
      mappedRoomCount: uniqueMappedRoomIds.size,
      unmappedRoomCount: unmappedRooms.length,
      duplicateRoomCount: new Set(duplicateRoomIds).size,
      complete: mappings.length > 0 && duplicateRoomIds.length === 0
    }
  }

  const selectedMappingStats = selectedMappingChannel ? getMappingStats(selectedMappingChannel.id) : null
  const selectedChannelMappings = selectedMappingChannel ? getChannelMappings(selectedMappingChannel.id) : []
  const roomsForSelectedType = mappingForm.roomTypeId ? getRoomsForType(mappingForm.roomTypeId) : []

  const openIcalDialog = (channel: Channel) => {
    setSelectedChannel(channel)
    setImportUrl(channel.iCal?.importUrl || '')
    setIcalText('')
    setShowConnectDialog(true)
  }

  const exportFileNameForChannel = (channel: Channel) =>
    channel.iCal?.exportFileName || `${channel.id}-sandbox-hotel-blocks.ics`

  const roomTypeCodeFromName = (value: string): 'TWIN' | 'DOUBLE' => {
    return /double/i.test(value) ? 'DOUBLE' : 'TWIN'
  }

  const mapIcalEventsToReservations = (channel: Channel, events: IcalEvent[]) => {
    const channelMappings = getChannelMappings(channel.id).filter((mapping) => mapping.active)
    const defaultMapping = channelMappings[0]
    const mappedRoomType = defaultMapping ? getRoomTypeName(defaultMapping.roomTypeId) : effectiveRoomTypes[0]?.name || 'Imported room'

    return events.map((event) => {
      const idSafeUid = event.uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      return {
        id: `ical_${channel.id}_${idSafeUid}`,
        channelId: channel.id,
        channelRef: event.uid,
        guestName: event.summary || `${channel.name} iCal booking`,
        checkIn: event.checkIn,
        checkOut: event.checkOut,
        roomType: mappedRoomType,
        nights: Math.max(1, nightsBetween(event.checkIn, event.checkOut)),
        totalAmount: 0,
        status: 'PENDING' as const,
        importedVia: 'ICAL' as const,
      }
    })
  }

  const importIcalTextForChannel = (channel: Channel, source: string) => {
    const result = parseIcalEvents(source)
    const importedReservations = mapIcalEventsToReservations(channel, result.events)
    const importedRefs = new Set(reservations.filter((item) => item.channelId === channel.id).map((item) => item.channelRef))
    const newReservations = importedReservations.filter((item) => !importedRefs.has(item.channelRef))

    setReservations((current) => {
      const byKey = new Map((current || []).map((item) => [`${item.channelId}:${item.channelRef}`, item]))
      for (const reservation of importedReservations) {
        const key = `${reservation.channelId}:${reservation.channelRef}`
        if (!byKey.has(key)) byKey.set(key, reservation)
      }
      return Array.from(byKey.values())
    })

    const importedAt = new Date().toISOString()
    setChannels((current) => current.map((item) =>
      item.id === channel.id
        ? {
            ...item,
            connected: true,
            status: result.events.length > 0 ? 'ACTIVE' : 'WARNING',
            lastSync: importedAt,
            iCal: {
              ...item.iCal,
              importUrl: item.iCal?.importUrl || importUrl.trim() || undefined,
              exportFileName: exportFileNameForChannel(item),
              lastImportAt: importedAt,
              lastError: undefined,
            },
          }
        : item
    ))

    setSyncLogs((current) => [{
      id: `log_${Date.now()}`,
      channelId: channel.id,
      timestamp: importedAt,
      type: 'ICAL_IMPORT',
      status: result.events.length > 0 ? 'SUCCESS' : 'WARNING',
      message: `Imported ${newReservations.length} new iCal event${newReservations.length === 1 ? '' : 's'} from ${channel.name}`,
      details: result.skipped > 0
        ? `${result.skipped} event${result.skipped === 1 ? '' : 's'} skipped because dates were missing or invalid.`
        : 'iCal carries date blocks only; guest/rate details may need manual completion.',
    }, ...current])

    return { imported: newReservations.length, parsed: result.events.length, skipped: result.skipped }
  }

  const getReservationDate = (record: any, key: 'checkIn' | 'checkOut') => {
    const value = record?.[key] || record?.[key === 'checkIn' ? 'checkInDate' : 'checkOutDate']
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const reservationMatchesChannel = (channel: Channel, record: any) => {
    const activeMappings = getChannelMappings(channel.id).filter((mapping) => mapping.active)
    if (activeMappings.length === 0) return true

    const values = [
      record?.roomTypeId,
      record?.roomType,
      record?.roomTypeName,
    ].filter(Boolean).map((value) => String(value).toLowerCase())

    return activeMappings.some((mapping) => {
      const roomTypeName = getRoomTypeName(mapping.roomTypeId).toLowerCase()
      return values.includes(mapping.roomTypeId.toLowerCase()) ||
        values.includes(roomTypeName) ||
        values.some((value) => roomTypeName.includes(value) || value.includes(roomTypeName))
    })
  }

  const buildExportEvents = (channel: Channel): IcalEvent[] => {
    const activeStatuses = new Set(['PENDING', 'CONFIRMED', 'HOLD', 'CHECKED_IN'])
    const records = [...pmsReservations, ...unassignedReservations]
    const uniqueRecords = new Map<string, any>()

    for (const record of records) {
      const id = String(record?.id || record?.reservationId || '')
      if (!id || uniqueRecords.has(id)) continue
      uniqueRecords.set(id, record)
    }

    return Array.from(uniqueRecords.values())
      .filter((record) => activeStatuses.has(String(record.status || 'CONFIRMED').toUpperCase()))
      .filter((record) => reservationMatchesChannel(channel, record))
      .map((record) => {
        const checkIn = getReservationDate(record, 'checkIn')
        const checkOut = getReservationDate(record, 'checkOut')
        if (!checkIn || !checkOut || checkOut <= checkIn) return null

        const roomTypeLabel = record.roomTypeName || record.roomType || 'Room'
        return {
          uid: `sandbox-${channel.id}-${record.id}@sandbox-hotel-pms`,
          summary: `Sandbox Hotel block - ${roomTypeLabel}`,
          checkIn: format(checkIn, 'yyyy-MM-dd'),
          checkOut: format(checkOut, 'yyyy-MM-dd'),
          description: `Unavailable in Sandbox Hotel PMS. Source reservation: ${record.id}`,
        }
      })
      .filter(Boolean) as IcalEvent[]
  }

  const publishServerIcalFeed = async (
    channel: Channel,
    options: { importUrl?: string; exportFileName?: string; rotateToken?: boolean } = {},
  ) => {
    const payload = await pmsApi<{ ok: true; data: ServerIcalChannel }>(
      `/api/channels/ical/${providerPath(channel.provider)}`,
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({
          importUrl: options.importUrl ?? channel.iCal?.importUrl,
          exportFileName: options.exportFileName ?? exportFileNameForChannel(channel),
          rotateToken: options.rotateToken || false,
        }),
      },
    )

    const publishedAt = payload.data.lastPublishedAt || new Date().toISOString()
    mergeServerIcalChannels([payload.data])
    setSyncLogs((current) => [{
      id: `log_${Date.now()}`,
      channelId: channel.id,
      timestamp: publishedAt,
      type: 'ICAL_EXPORT',
      status: 'SUCCESS',
      message: `${channel.name} hosted iCal URL published`,
      details: payload.data.exportFeedUrl
        ? `OTA subscription URL is ready: ${payload.data.exportFeedUrl}`
        : 'Hosted feed was saved but the URL was not returned by the server.',
    }, ...current])

    return payload.data
  }

  const handlePublishIcalFeed = async (channel: Channel, rotateToken = false) => {
    if (!SERVER_API_ENABLED) {
      toast.warning('Hosted iCal URLs require server mode', {
        description: 'This local preview can still export .ics files. The subscription URL is published by the deployed PMS server.',
      })
      return
    }

    setPublishingFeedId(channel.id)
    try {
      const published = await publishServerIcalFeed(channel, { rotateToken })
      toast.success(`${channel.name} iCal URL ${rotateToken ? 'rotated' : 'published'}`, {
        description: published.exportFeedUrl || 'The hosted feed is ready for your OTA or channel manager.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hosted iCal feed could not be published.'
      toast.error(`Could not publish ${channel.name} iCal URL`, { description: message })
      setSyncLogs((current) => [{
        id: `log_${Date.now()}`,
        channelId: channel.id,
        timestamp: new Date().toISOString(),
        type: 'ICAL_EXPORT',
        status: 'ERROR',
        message: `Could not publish ${channel.name} hosted iCal URL`,
        details: message,
      }, ...current])
    } finally {
      setPublishingFeedId(null)
    }
  }

  const handleCopyIcalFeedUrl = async (channel: Channel) => {
    const url = channel.iCal?.exportFeedUrl
    if (!url) return
    await navigator.clipboard.writeText(url)
    toast.success(`${channel.name} iCal URL copied`)
  }

  const handleDownloadIcalExport = (channel: Channel) => {
    const events = buildExportEvents(channel)
    const contents = generateIcalFeed(`${channel.name} - Sandbox Hotel Blocks`, events)
    downloadIcalFeed(exportFileNameForChannel(channel), contents)

    const exportedAt = new Date().toISOString()
    setChannels((current) => current.map((item) =>
      item.id === channel.id
        ? {
            ...item,
            iCal: {
              ...item.iCal,
              exportFileName: exportFileNameForChannel(item),
              lastExportAt: exportedAt,
            },
          }
        : item
    ))
    setSyncLogs((current) => [{
      id: `log_${Date.now()}`,
      channelId: channel.id,
      timestamp: exportedAt,
      type: 'ICAL_EXPORT',
      status: 'SUCCESS',
      message: `Generated ${channel.name} iCal export`,
      details: `${events.length} date block${events.length === 1 ? '' : 's'} included. iCal does not carry rates, restrictions, or payment data.`,
    }, ...current])
    toast.success(`${channel.name} iCal file generated`, {
      description: `${events.length} date block${events.length === 1 ? '' : 's'} exported.`,
    })
  }

  const handleConnectChannel = async () => {
    if (!selectedChannel) return

    const trimmedImportUrl = importUrl.trim()
    const pastedIcal = icalText.trim()
    const exportFileName = exportFileNameForChannel(selectedChannel)

    setChannels(current => 
      current.map(c => 
        c.id === selectedChannel.id 
          ? {
              ...c,
              connectionMode: 'ICAL',
              connected: true,
              enabled: c.enabled,
              status: 'WARNING',
              credentials: undefined,
              iCal: {
                ...c.iCal,
                importUrl: trimmedImportUrl || undefined,
                exportFileName,
                lastError: undefined,
              }
            }
          : c
      )
    )

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      channelId: selectedChannel.id,
      timestamp: new Date().toISOString(),
      type: 'ICAL_IMPORT',
      status: 'WARNING',
      message: `Configured ${selectedChannel.name} iCal feed`,
      details: 'iCal supports date blocks and reservation pulls only. Rates, restrictions, payments, and guest details stay manual in the OTA or channel manager.'
    }
    setSyncLogs(current => [log, ...current])

    if (pastedIcal) {
      const result = importIcalTextForChannel(selectedChannel, pastedIcal)
      toast.success(`${selectedChannel.name} iCal configured`, {
        description: `Imported ${result.imported} new event${result.imported === 1 ? '' : 's'} from pasted calendar.`,
      })
    } else if (trimmedImportUrl) {
      toast.success(`${selectedChannel.name} iCal configured`, {
        description: 'Use Import iCal to pull reservations from the feed URL.',
      })
    } else {
      toast.success(`${selectedChannel.name} iCal configured`, {
        description: 'Export-only setup saved. Add an OTA feed URL later to pull iCal reservations.',
      })
    }

    if (SERVER_API_ENABLED) {
      try {
        const published = await publishServerIcalFeed(selectedChannel, {
          importUrl: trimmedImportUrl,
          exportFileName,
        })
        toast.success(`${selectedChannel.name} hosted iCal URL published`, {
          description: published.exportFeedUrl || 'Use the hosted URL in your OTA or channel manager.',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Hosted feed URL could not be published.'
        toast.warning(`${selectedChannel.name} local iCal setup saved`, {
          description: `Server feed URL was not published: ${message}`,
        })
      }
    }

    setImportUrl('')
    setIcalText('')
    setShowConnectDialog(false)
  }

  const handleDisconnect = async (channelId: string) => {
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
              iCal: {
                ...c.iCal,
                exportFeedUrl: undefined,
                lastError: undefined,
              },
              credentials: undefined
            }
          : c
      )
    )

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      channelId,
      timestamp: new Date().toISOString(),
      type: 'ICAL_IMPORT',
      status: 'WARNING',
      message: `Removed iCal feed from ${channel.name}`
    }
    setSyncLogs(current => [log, ...current])

    toast.success(`Removed ${channel.name} iCal setup`)

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/channels/ical/${providerPath(channel.provider)}`, undefined, { method: 'DELETE' })
      } catch (error) {
        toast.warning(`${channel.name} was removed locally`, {
          description: error instanceof Error ? error.message : 'The hosted feed could not be disabled on the server.',
        })
      }
    }
  }

  const handleSync = async (channelId: string) => {
    const channel = channels.find(c => c.id === channelId)
    if (!channel) return

    const feedUrl = channel.iCal?.importUrl?.trim()
    if (!feedUrl) {
      toast.error(`Add a ${channel.name} iCal feed URL first`)
      return
    }

    setSyncing(true)
    try {
      const response = await fetch(feedUrl, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Feed returned HTTP ${response.status}`)
      }
      const text = await response.text()
      const result = importIcalTextForChannel(channel, text)
      toast.success(`Imported ${channel.name} iCal feed`, {
        description: `${result.imported} new event${result.imported === 1 ? '' : 's'} added to the review queue.`,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to fetch iCal feed'
      setChannels(current => current.map(c => c.id === channelId
        ? {
            ...c,
            status: 'ERROR',
            iCal: { ...c.iCal, lastError: errorMessage },
          }
        : c
      ))
      setSyncLogs(current => [{
        id: `log_${Date.now()}`,
        channelId,
        timestamp: new Date().toISOString(),
        type: 'ICAL_IMPORT',
        status: 'ERROR',
        message: `Could not import ${channel.name} iCal feed`,
        details: `${errorMessage}. If the OTA blocks browser fetches, paste the .ics contents in the iCal setup dialog.`,
      }, ...current])
      toast.error(`Could not import ${channel.name} iCal`, {
        description: errorMessage,
      })
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncAll = async () => {
    setSyncing(true)

    for (const channel of connectedChannels.filter((item) => item.iCal?.importUrl)) {
      await handleSync(channel.id)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    setSyncing(false)
  }

  const handleImportReservation = (reservation: ChannelReservation) => {
    const channel = channels.find(c => c.id === reservation.channelId)
    const roomTypeCode = roomTypeCodeFromName(reservation.roomType)
    const checkIn = new Date(reservation.checkIn)
    const checkOut = new Date(reservation.checkOut)
    const importedAt = new Date()
    const reservationRecord = {
      id: reservation.id,
      confirmationNumber: reservation.channelRef,
      status: 'CONFIRMED' as const,
      guestId: `guest_${reservation.id}`,
      guestName: reservation.guestName,
      guestEmail: undefined,
      guestPhone: undefined,
      roomType: roomTypeCode,
      roomTypeName: reservation.roomType,
      checkIn,
      checkOut,
      nights: reservation.nights,
      adults: 1,
      children: 0,
      ratePerNight: 0,
      totalAmount: reservation.totalAmount,
      depositAmount: 0,
      depositPaid: 0,
      depositStatus: 'NONE' as const,
      balanceDue: reservation.totalAmount,
      source: channel?.provider || 'OTHER',
      channelRef: reservation.channelRef,
      isVIP: false,
      notes: 'Imported from iCal. Confirm guest details, payment, and room assignment manually.',
      createdAt: importedAt,
      updatedAt: importedAt,
      createdBy: 'iCal import',
    }
    const unassignedRecord = {
      id: reservation.id,
      guestName: reservation.guestName,
      checkIn,
      checkOut,
      roomType: roomTypeCode,
      guestCount: 1,
      nights: reservation.nights,
      source: `${channel?.name || reservation.channelId} iCal`,
      ratePerNight: 0,
      totalAmount: reservation.totalAmount,
      depositAmount: 0,
      balanceDue: reservation.totalAmount,
      notes: reservationRecord.notes,
    }
    const appendUnique = (record: any) => (current: any[] = []) => {
      if ((current || []).some((item) => item.id === record.id)) return current || []
      return [record, ...(current || [])]
    }

    setPmsReservations(appendUnique(reservationRecord))
    setReservationData(appendUnique(reservationRecord))
    setUnassignedReservations(appendUnique(unassignedRecord))
    setReservations(current => 
      current.map(r => 
        r.id === reservation.id 
          ? { ...r, status: 'SYNCED', syncedAt: new Date().toISOString() }
          : r
      )
    )

    toast.success(`Imported reservation from ${channel?.name}`, {
      description: 'It is now in the PMS assignment queue. Confirm guest details before check-in.',
    })
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

  const resetMappingForm = () => {
    setEditingMappingId(null)
    setMappingForm(EMPTY_MAPPING_FORM)
  }

  const handleSelectMappingChannel = (channelId: string) => {
    setSelectedMappingChannelId(channelId)
    resetMappingForm()
  }

  const handleMappingRoomTypeChange = (roomTypeId: string) => {
    setMappingForm((current) => ({
      ...current,
      roomTypeId,
      roomIds: getRoomsForType(roomTypeId).map((room) => room.id)
    }))
  }

  const handleToggleMappedRoom = (roomId: string) => {
    setMappingForm((current) => ({
      ...current,
      roomIds: current.roomIds.includes(roomId)
        ? current.roomIds.filter((id) => id !== roomId)
        : [...current.roomIds, roomId]
    }))
  }

  const handleSaveMapping = () => {
    if (!selectedMappingChannel) return
    const externalRoomTypeName = mappingForm.externalRoomTypeName.trim()
    const externalRoomTypeId = mappingForm.externalRoomTypeId.trim() || externalIdFromName(externalRoomTypeName)
    const externalRatePlanId = mappingForm.externalRatePlanId.trim()

    if (!externalRoomTypeName && !mappingForm.externalRoomTypeId.trim()) {
      toast.error('Add an OTA room name or OTA room ID')
      return
    }

    if (!mappingForm.roomTypeId) {
      toast.error('Select a PMS room type')
      return
    }

    if (mappingForm.roomIds.length === 0) {
      toast.error('Select at least one PMS room')
      return
    }

    const mapping: ChannelRoomMapping = {
      id: editingMappingId || `map_${Date.now()}`,
      channelId: selectedMappingChannel.id,
      externalRoomTypeId,
      externalRoomTypeName: externalRoomTypeName || externalRoomTypeId,
      externalRatePlanId: externalRatePlanId || undefined,
      roomTypeId: mappingForm.roomTypeId,
      roomIds: mappingForm.roomIds,
      active: true,
      updatedAt: new Date().toISOString()
    }

    setChannelMappings((current) => {
      if (editingMappingId) {
        return current.map((item) => item.id === editingMappingId ? mapping : item)
      }

      return [mapping, ...current]
    })

    resetMappingForm()
    toast.success(`${selectedMappingChannel.name} room mapping saved`)
  }

  const handleEditMapping = (mapping: ChannelRoomMapping) => {
    setSelectedMappingChannelId(mapping.channelId)
    setEditingMappingId(mapping.id)
    setMappingForm({
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRoomTypeName: mapping.externalRoomTypeName,
      externalRatePlanId: mapping.externalRatePlanId || '',
      roomTypeId: mapping.roomTypeId,
      roomIds: mapping.roomIds
    })
    setActiveTab('mapping')
  }

  const handleDeleteMapping = (mappingId: string) => {
    setChannelMappings((current) => current.filter((mapping) => mapping.id !== mappingId))
    if (editingMappingId === mappingId) resetMappingForm()
    toast.success('Room mapping removed')
  }

  const handleAutoMapChannel = (channelId: string) => {
    const channel = channels.find((item) => item.id === channelId)
    if (!channel) return

    if (effectiveRoomTypes.length === 0 || roomOptions.length === 0) {
      toast.error('Configure PMS room types and rooms first')
      return
    }

    const existingRoomTypeIds = new Set(
      channelMappings
        .filter((mapping) => mapping.channelId === channelId)
        .map((mapping) => mapping.roomTypeId)
    )

    const generatedMappings = effectiveRoomTypes
      .filter((roomType) => !existingRoomTypeIds.has(roomType.id))
      .map((roomType) => {
        const typeRooms = getRoomsForType(roomType.id)
        if (typeRooms.length === 0) return null

        return {
          id: `map_${Date.now()}_${roomType.id}`,
          channelId,
          externalRoomTypeId: roomType.code || externalIdFromName(roomType.name),
          externalRoomTypeName: roomType.name,
          roomTypeId: roomType.id,
          roomIds: typeRooms.map((room) => room.id),
          active: true,
          updatedAt: new Date().toISOString()
        } satisfies ChannelRoomMapping
      })
      .filter(Boolean) as ChannelRoomMapping[]

    if (generatedMappings.length === 0) {
      toast.info(`${channel.name} already has mappings for all PMS room types`)
      return
    }

    setChannelMappings((current) => [...generatedMappings, ...current])
    toast.success(`Added ${generatedMappings.length} ${channel.name} mapping${generatedMappings.length > 1 ? 's' : ''}`)
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
              <p className="text-sm text-muted-foreground">OTA iCal feeds, room mapping, and import review</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={handleSyncAll}
              disabled={syncing || connectedChannels.filter((item) => item.iCal?.importUrl).length === 0}
            >
              <ArrowClockwise className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
              Import All iCal
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList>
            <TabsTrigger value="channels">
              Channels ({connectedChannels.length}/{channels.length})
            </TabsTrigger>
            <TabsTrigger value="mapping">
              <Bed className="w-4 h-4 mr-2" />
              Room Mapping ({mappedRoomCount}/{totalRoomCount})
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

          <TabsContent value="channels" className="flex-1 mt-6 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <div className="space-y-6 pb-6">
                <div className="grid grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">iCal Feeds</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{connectedChannels.length}/{channels.length}</div>
                      <p className="text-xs text-muted-foreground">OTA feeds configured</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Mapped Rooms</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{mappedRoomCount}/{totalRoomCount}</div>
                      <p className="text-xs text-muted-foreground">Unique PMS rooms in OTA mappings</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Pending iCal Imports</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{pendingReservations.length}</div>
                      <p className="text-xs text-muted-foreground">Date blocks awaiting PMS import</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Setup Path</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" className="w-full" onClick={() => setActiveTab('mapping')}>
                        <Bed className="w-4 h-4 mr-2" />
                        Configure Room Mapping
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {channels.map(channel => {
                    const mappingStats = getMappingStats(channel.id)

                    return (
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
                        disabled={!channel.connected || !mappingStats.complete}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {channel.connected ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Mode</p>
                            <p className="text-xl font-bold">iCal</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Import feed</p>
                            <p className="text-xl font-bold">{channel.iCal?.importUrl ? 'Saved' : 'Missing'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Rates</p>
                            <p className="text-xl font-bold">Manual</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Export feed</p>
                            <p className="text-xl font-bold">{channel.iCal?.exportFeedUrl ? 'Live' : SERVER_API_ENABLED ? 'Draft' : 'File'}</p>
                          </div>
                        </div>

                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          iCal syncs blocked dates and simple reservation events only. Keep rates, restrictions, payments, and full guest details in your OTA or channel manager.
                        </div>

                        <div className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">Hosted export feed</p>
                              <p className="text-xs text-muted-foreground">
                                {channel.iCal?.exportFeedUrl
                                  ? 'Copy this URL into the OTA or channel manager calendar import.'
                                  : SERVER_API_ENABLED
                                    ? 'Publish the server feed URL before adding this channel to an OTA.'
                                    : 'Available after deployment in server mode; local preview can download .ics files.'}
                              </p>
                            </div>
                            {channel.iCal?.lastPublishedAt && (
                              <Badge variant="outline">
                                {format(new Date(channel.iCal.lastPublishedAt), 'MMM d, HH:mm')}
                              </Badge>
                            )}
                          </div>
                          {channel.iCal?.exportFeedUrl && (
                            <div className="mt-3 flex gap-2">
                              <Input
                                readOnly
                                value={channel.iCal.exportFeedUrl}
                                className="h-8 text-xs"
                              />
                              <Button size="sm" variant="outline" onClick={() => handleCopyIcalFeedUrl(channel)}>
                                Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePublishIcalFeed(channel, true)}
                                disabled={publishingFeedId === channel.id}
                              >
                                Rotate
                              </Button>
                            </div>
                          )}
                        </div>

                        <Separator />

                        <div className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">Room mapping</p>
                              <p className="text-xs text-muted-foreground">
                                {mappingStats.mappedRoomCount}/{totalRoomCount} rooms mapped
                                {mappingStats.duplicateRoomCount > 0 ? `, ${mappingStats.duplicateRoomCount} duplicate` : ''}
                              </p>
                            </div>
                            <Badge variant={mappingStats.complete ? 'outline' : 'secondary'}>
                              {mappingStats.complete ? 'Ready' : 'Needs setup'}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-3 w-full justify-start"
                            onClick={() => {
                              setSelectedMappingChannelId(channel.id)
                              setActiveTab('mapping')
                            }}
                          >
                            <Bed className="w-4 h-4 mr-2" />
                            Configure mapped rooms
                          </Button>
                        </div>

                        <Separator />

                        <div>
                          <p className="text-sm text-muted-foreground mb-2">
                            Last import: {channel.iCal?.lastImportAt ? format(new Date(channel.iCal.lastImportAt), 'MMM d, HH:mm') : 'Never'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="flex-1"
                              variant="outline"
                              size="sm"
                              onClick={() => handleSync(channel.id)}
                              disabled={syncing || !channel.iCal?.importUrl}
                            >
                              <ArrowClockwise className={cn("w-4 h-4 mr-2", syncing && "animate-spin")} />
                              Import iCal
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadIcalExport(channel)}
                            >
                              <ArrowUp className="w-4 h-4 mr-2" />
                              Export .ics
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePublishIcalFeed(channel)}
                              disabled={!SERVER_API_ENABLED || publishingFeedId === channel.id}
                              title={SERVER_API_ENABLED ? 'Publish hosted iCal URL' : 'Hosted URLs require server mode'}
                            >
                              <Link className="w-4 h-4 mr-2" />
                              Publish URL
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openIcalDialog(channel)}
                            >
                              <Link className="w-4 h-4 mr-2" />
                              Setup
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
                          Add a {channel.name} iCal feed URL to import OTA date blocks and export PMS blocks.
                        </p>
                        <div className="flex justify-center gap-2">
                          <Button onClick={() => openIcalDialog(channel)}>
                            <Link className="w-4 h-4 mr-2" />
                            Set Up iCal
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedMappingChannelId(channel.id)
                              setActiveTab('mapping')
                            }}
                          >
                            <Bed className="w-4 h-4 mr-2" />
                            Map Rooms
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                    )
                  })}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="mapping" className="flex-1 mt-6 overflow-hidden">
            <div className="grid grid-cols-4 gap-6 h-full">
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>OTA Channels</CardTitle>
                  <CardDescription>Choose a channel, then map OTA inventory to PMS rooms.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {channels.map((channel) => {
                      const stats = getMappingStats(channel.id)
                      const selected = selectedMappingChannel?.id === channel.id

                      return (
                        <button
                          key={channel.id}
                          type="button"
                          className={cn(
                            "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted",
                            selected && "border-primary bg-primary/5"
                          )}
                          onClick={() => handleSelectMappingChannel(channel.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className={cn("w-7 h-7 rounded flex items-center justify-center", getProviderLogo(channel.provider))}>
                                <span className="text-white text-xs font-bold">{channel.name.charAt(0)}</span>
                              </div>
                              <span className="font-medium text-sm">{channel.name}</span>
                            </div>
                            <Badge variant={stats.complete ? 'outline' : 'secondary'} className="text-xs">
                              {stats.complete ? 'Ready' : 'Map'}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {stats.mappingCount} mapping{stats.mappingCount === 1 ? '' : 's'} - {stats.mappedRoomCount}/{totalRoomCount} rooms
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              <ScrollArea className="col-span-3 h-full pr-4">
                <div className="space-y-6 pb-6">
                  {selectedMappingChannel && selectedMappingStats ? (
                    <>
                      <Card>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <CardTitle>{selectedMappingChannel.name} Room Mapping</CardTitle>
                              <CardDescription>
                                Map each OTA room or rate-plan listing to a PMS room type and specific sellable rooms.
                              </CardDescription>
                            </div>
                            <Badge variant={selectedMappingStats.complete ? 'outline' : 'secondary'}>
                              {selectedMappingStats.complete
                                ? 'Ready to enable'
                                : selectedMappingStats.duplicateRoomCount > 0
                                  ? `${selectedMappingStats.duplicateRoomCount} duplicate rooms`
                                  : 'No active mapping'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-4 gap-4">
                            <div className="rounded-md border p-3">
                              <p className="text-xs text-muted-foreground">Mappings</p>
                              <p className="text-2xl font-bold">{selectedMappingStats.mappingCount}</p>
                            </div>
                            <div className="rounded-md border p-3">
                              <p className="text-xs text-muted-foreground">Mapped rooms</p>
                              <p className="text-2xl font-bold">{selectedMappingStats.mappedRoomCount}/{totalRoomCount}</p>
                            </div>
                            <div className="rounded-md border p-3">
                              <p className="text-xs text-muted-foreground">Duplicates</p>
                              <p className={cn("text-2xl font-bold", selectedMappingStats.duplicateRoomCount > 0 && "text-orange-600")}>
                                {selectedMappingStats.duplicateRoomCount}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => handleAutoMapChannel(selectedMappingChannel.id)}
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Auto-Fill Types
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>{editingMappingId ? 'Edit Mapping' : 'Add OTA Mapping'}</CardTitle>
                          <CardDescription>
                            Use this when an OTA room category should only sell selected physical rooms.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="external-room-name">OTA Room Name</Label>
                              <Input
                                id="external-room-name"
                                placeholder="e.g., Deluxe Double"
                                value={mappingForm.externalRoomTypeName}
                                onChange={(event) => setMappingForm((current) => ({ ...current, externalRoomTypeName: event.target.value }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="external-room-id">OTA Room ID</Label>
                              <Input
                                id="external-room-id"
                                placeholder="Optional external ID"
                                value={mappingForm.externalRoomTypeId}
                                onChange={(event) => setMappingForm((current) => ({ ...current, externalRoomTypeId: event.target.value }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="external-rate-plan-id">OTA Rate Plan ID</Label>
                              <Input
                                id="external-rate-plan-id"
                                placeholder="Optional rate plan"
                                value={mappingForm.externalRatePlanId}
                                onChange={(event) => setMappingForm((current) => ({ ...current, externalRatePlanId: event.target.value }))}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label>PMS Room Type</Label>
                              <Select value={mappingForm.roomTypeId} onValueChange={handleMappingRoomTypeChange}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select room type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {effectiveRoomTypes.map((roomType) => (
                                    <SelectItem key={roomType.id} value={roomType.id}>
                                      {roomType.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="rounded-md border p-3">
                              <p className="text-xs text-muted-foreground">Selected rooms</p>
                              <p className="text-2xl font-bold">{mappingForm.roomIds.length}</p>
                            </div>
                            <div className="rounded-md border p-3">
                              <p className="text-xs text-muted-foreground">Available in type</p>
                              <p className="text-2xl font-bold">{roomsForSelectedType.length}</p>
                            </div>
                          </div>

                          <div className="rounded-md border">
                            <div className="flex items-center justify-between gap-3 border-b p-3">
                              <div>
                                <Label>Specific PMS Rooms</Label>
                                <p className="text-xs text-muted-foreground">
                                  Select exactly which rooms this OTA listing can sell.
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!mappingForm.roomTypeId}
                                  onClick={() => setMappingForm((current) => ({
                                    ...current,
                                    roomIds: getRoomsForType(current.roomTypeId).map((room) => room.id)
                                  }))}
                                >
                                  Select All
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={mappingForm.roomIds.length === 0}
                                  onClick={() => setMappingForm((current) => ({ ...current, roomIds: [] }))}
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>

                            <ScrollArea className="h-[230px]">
                              {mappingForm.roomTypeId ? (
                                roomsForSelectedType.length > 0 ? (
                                  <div className="grid grid-cols-4 gap-2 p-3">
                                    {roomsForSelectedType.map((room) => {
                                      const selected = mappingForm.roomIds.includes(room.id)

                                      return (
                                        <label
                                          key={room.id}
                                          className={cn(
                                            "flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-sm",
                                            selected && "border-primary bg-primary/5",
                                            room.unavailable && "opacity-70"
                                          )}
                                        >
                                          <span className="flex items-center gap-2">
                                            <Checkbox
                                              checked={selected}
                                              onCheckedChange={() => handleToggleMappedRoom(room.id)}
                                            />
                                            <span className="font-medium">{room.number}</span>
                                          </span>
                                          {room.unavailable && <Badge variant="secondary" className="text-xs">OOS</Badge>}
                                        </label>
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <div className="p-8 text-center text-sm text-muted-foreground">
                                    No PMS rooms exist for this room type.
                                  </div>
                                )
                              ) : (
                                <div className="p-8 text-center text-sm text-muted-foreground">
                                  Select a PMS room type to choose specific rooms.
                                </div>
                              )}
                            </ScrollArea>
                          </div>

                          <div className="flex justify-end gap-2">
                            {editingMappingId && (
                              <Button type="button" variant="outline" onClick={resetMappingForm}>
                                Cancel Edit
                              </Button>
                            )}
                            <Button type="button" onClick={handleSaveMapping}>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Save Mapping
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Saved Mappings</CardTitle>
                          <CardDescription>
                            Saved mappings define how OTA listings should match PMS rooms for iCal imports and block exports.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {selectedChannelMappings.length === 0 ? (
                            <div className="rounded-md border border-dashed p-8 text-center">
                              <Bed className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                              <p className="text-sm text-muted-foreground">No mappings saved for {selectedMappingChannel.name}.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {selectedChannelMappings.map((mapping) => (
                                <div key={mapping.id} className="rounded-md border p-4">
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold">{mapping.externalRoomTypeName}</p>
                                        <Badge variant="outline">{mapping.roomIds.length} rooms</Badge>
                                        {!mapping.active && <Badge variant="secondary">Paused</Badge>}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        OTA ID: {mapping.externalRoomTypeId}
                                        {mapping.externalRatePlanId ? ` - Rate plan: ${mapping.externalRatePlanId}` : ''}
                                      </p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        PMS type: {getRoomTypeName(mapping.roomTypeId)}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        checked={mapping.active}
                                        onCheckedChange={(checked) => {
                                          setChannelMappings((current) => current.map((item) =>
                                            item.id === mapping.id
                                              ? { ...item, active: Boolean(checked), updatedAt: new Date().toISOString() }
                                              : item
                                          ))
                                        }}
                                      />
                                      <Button variant="outline" size="sm" onClick={() => handleEditMapping(mapping)}>
                                        Edit
                                      </Button>
                                      <Button variant="outline" size="sm" onClick={() => handleDeleteMapping(mapping.id)}>
                                        <XCircle className="w-4 h-4 mr-2" />
                                        Remove
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {mapping.roomIds.map((roomId) => (
                                      <Badge key={roomId} variant="secondary" className="text-xs">
                                        {getRoomNumber(roomId)}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <Card className="p-12 text-center">
                      <Bed className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No Channel Selected</h3>
                      <p className="text-sm text-muted-foreground">Select an OTA channel to configure room mappings.</p>
                    </Card>
                  )}
                </div>
              </ScrollArea>
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
              {effectiveRoomTypes.length === 0 ? (
                <Card className="p-12 text-center">
                  <Bed className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Room Types Configured</h3>
                  <p className="text-sm text-muted-foreground">
                    Complete property setup before publishing inventory to channels.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  {effectiveRoomTypes.map((roomType) => (
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
                              <span className="text-xl font-bold">THB {reservation.totalAmount.toLocaleString()}</span>
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
                        <p className="text-2xl font-bold">THB {((channel.stats?.monthlyRevenue || 0) / 1000).toFixed(0)}k</p>
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
            <DialogTitle>Set Up {selectedChannel?.name} iCal</DialogTitle>
            <DialogDescription>
              Use calendar feeds when private PMS API access is not available. Import feeds pull OTA date blocks; exports produce PMS blocks for your OTA or channel manager.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>OTA Import iCal URL</Label>
              <Input
                placeholder="https://.../calendar.ics"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Paste the private iCal export URL from {selectedChannel?.name} or from your channel manager.
              </p>
            </div>
            <div className="space-y-2">
              <Label>One-Time iCal Import</Label>
              <Textarea
                placeholder="Paste BEGIN:VCALENDAR ... END:VCALENDAR if the OTA feed cannot be fetched directly."
                value={icalText}
                onChange={(e) => setIcalText(e.target.value)}
                rows={6}
              />
            </div>
            <div className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
              Export file: {selectedChannel ? exportFileNameForChannel(selectedChannel) : 'sandbox-hotel-blocks.ics'}. Download it locally or publish a hosted /ical feed URL in server mode for OTA subscription imports.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConnectDialog(false)}>Cancel</Button>
            <Button
              onClick={handleConnectChannel}
              disabled={Boolean(selectedChannel && publishingFeedId === selectedChannel.id)}
            >
              Save iCal Setup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
