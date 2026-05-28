import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MagnifyingGlass, Plus, FunnelSimple, Calendar, User, CreditCard, MapPin, Phone, Printer } from '@phosphor-icons/react'
import { format, isBefore, isToday } from 'date-fns'
import { cn } from '@/lib/utils'
import { printReservationsList } from '@/lib/print-utils'
import { toast } from 'sonner'
import { NewReservationDialog, type NewReservationData } from '@/components/board/NewReservationDialog'
import { useRoomSync } from '@/hooks/use-room-sync'
import { getBangkokDateKey, nightsBetween } from '@/lib/hotel/business-rules'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import type { BoardRoomCard } from '@/types/board'

export interface Reservation {
  id: string
  confirmationNumber: string
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'PENDING'
  
  guestId: string
  guestName: string
  guestEmail?: string
  guestPhone?: string
  
  roomId?: string
  roomNumber?: string
  roomType: 'TWIN' | 'DOUBLE'
  
  checkIn: Date
  checkOut: Date
  nights: number
  
  adults: number
  children: number
  
  ratePerNight: number
  totalAmount: number
  
  depositAmount: number
  depositPaid: number
  depositStatus: 'PAID' | 'PENDING' | 'NONE'
  
  balanceDue: number
  
  source: 'DIRECT' | 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB' | 'WALK_IN' | 'PHONE'
  channelConfirmation?: string
  
  isVIP: boolean
  specialRequests?: string
  notes?: string
  
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

function generateMockReservations(): Reservation[] {
  return []
}

interface UnassignedReservation {
  id: string
  guestName: string
  checkIn: Date | string
  checkOut: Date | string
  roomType: 'TWIN' | 'DOUBLE'
  guestCount: number
  nights: number
  source: string
  isVIP?: boolean
  needsAttention?: boolean
}

interface GuestDirectoryRecord {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email?: string
  phone?: string
  nationality?: string
  isVIP: boolean
  tags: string[]
  totalStays: number
  totalNights: number
  totalSpent: number
  firstStayDate: Date
  lastStayDate?: Date
  preferredRoomType?: 'TWIN' | 'DOUBLE'
  preferredContact?: 'EMAIL' | 'PHONE' | 'LINE'
  createdAt: Date
  updatedAt: Date
}

function isOccupied(room: BoardRoomCard) {
  return room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
}

function reservationFromRoom(room: BoardRoomCard): Reservation | null {
  if (!room.guestName || !room.checkIn || !room.checkOut) return null
  const nights = Math.max(1, nightsBetween(room.checkIn, room.checkOut))
  const totalAmount = room.reservation?.totalAmount ?? room.balanceDue ?? 0
  const depositPaid = room.depositStatus === 'PAID' ? Math.min(totalAmount, Math.floor(totalAmount * 0.3)) : 0

  return {
    id: room.reservationId || room.currentReservationId || `room-${room.number}-${getBangkokDateKey(room.checkIn)}`,
    confirmationNumber: (room.reservationId || room.currentReservationId || `ROOM-${room.number}`).replace(/^RES-/, 'SH-'),
    status: isOccupied(room) ? 'CHECKED_IN' : 'CONFIRMED',
    guestId: `guest-${room.reservationId || room.number}`,
    guestName: room.guestName,
    roomId: room.roomId,
    roomNumber: room.number,
    roomType: room.type,
    checkIn: new Date(room.checkIn),
    checkOut: new Date(room.checkOut),
    nights,
    adults: Math.max(1, room.guestCount || 1),
    children: 0,
    ratePerNight: nights > 0 ? Math.round(totalAmount / nights) : 0,
    totalAmount,
    depositAmount: Math.floor(totalAmount * 0.3),
    depositPaid,
    depositStatus: room.depositStatus === 'PAID' ? 'PAID' : totalAmount > 0 ? 'PENDING' : 'NONE',
    balanceDue: room.balanceDue || 0,
    source: 'DIRECT',
    isVIP: room.isVIP,
    createdAt: new Date(room.checkIn),
    updatedAt: room.lastUpdatedAt ? new Date(room.lastUpdatedAt) : new Date(),
    createdBy: 'Front desk board',
  }
}

function reservationFromUnassigned(reservation: UnassignedReservation): Reservation {
  const checkIn = new Date(reservation.checkIn)
  const checkOut = new Date(reservation.checkOut)
  const nights = reservation.nights || Math.max(1, nightsBetween(checkIn, checkOut))
  const source = reservation.source === 'Booking.com'
    ? 'BOOKING_COM'
    : reservation.source === 'Walk-in'
      ? 'WALK_IN'
      : reservation.source === 'Phone'
        ? 'PHONE'
        : 'DIRECT'

  return {
    id: reservation.id,
    confirmationNumber: reservation.id.replace(/^RES-/, 'SH-'),
    status: reservation.needsAttention ? 'PENDING' : 'CONFIRMED',
    guestId: `guest-${reservation.id}`,
    guestName: reservation.guestName,
    roomType: reservation.roomType,
    checkIn,
    checkOut,
    nights,
    adults: Math.max(1, reservation.guestCount || 1),
    children: Math.max(0, (reservation.guestCount || 1) - 1),
    ratePerNight: 0,
    totalAmount: 0,
    depositAmount: 0,
    depositPaid: 0,
    depositStatus: 'NONE',
    balanceDue: 0,
    source,
    isVIP: reservation.isVIP || false,
    createdAt: checkIn,
    updatedAt: new Date(),
    createdBy: 'Front desk board',
  }
}

function toReservationRecord(reservation: NewReservationData): Reservation {
  const nights = Math.max(1, nightsBetween(reservation.checkIn, reservation.checkOut))
  const roomType = reservation.roomTypeName === 'Twin Room' ? 'TWIN' : 'DOUBLE'

  return {
    id: reservation.id,
    confirmationNumber: reservation.id.replace(/^RES-/, 'SH-'),
    status: reservation.status,
    guestId: reservation.guestId,
    guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
    guestEmail: reservation.guest.email ?? undefined,
    guestPhone: reservation.guest.phone ?? undefined,
    roomId: reservation.assignedRoomId ?? undefined,
    roomNumber: reservation.roomNumber,
    roomType,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    nights,
    adults: reservation.adults,
    children: reservation.children,
    ratePerNight: reservation.ratePerNight,
    totalAmount: reservation.totalAmount,
    depositAmount: reservation.depositAmount,
    depositPaid: reservation.depositPaid ? reservation.depositAmount : 0,
    depositStatus: reservation.depositAmount > 0 ? 'PENDING' : 'NONE',
    balanceDue: reservation.totalAmount,
    source: reservation.source as Reservation['source'],
    isVIP: reservation.guest.vipStatus,
    specialRequests: reservation.specialRequests ?? undefined,
    notes: reservation.notes ?? undefined,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    createdBy: 'Reservations',
  }
}

function toGuestRecord(reservation: NewReservationData): GuestDirectoryRecord {
  const nights = Math.max(1, nightsBetween(reservation.checkIn, reservation.checkOut))
  const roomType = reservation.roomTypeName === 'Twin Room' ? 'TWIN' : 'DOUBLE'

  return {
    id: reservation.guest.id,
    firstName: reservation.guest.firstName,
    lastName: reservation.guest.lastName,
    fullName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
    email: reservation.guest.email ?? undefined,
    phone: reservation.guest.phone ?? undefined,
    nationality: reservation.guest.nationality ?? undefined,
    isVIP: reservation.guest.vipStatus,
    tags: reservation.guest.vipStatus ? ['VIP'] : [],
    totalStays: 0,
    totalNights: nights,
    totalSpent: reservation.totalAmount,
    firstStayDate: reservation.checkIn,
    preferredRoomType: roomType,
    preferredContact: reservation.guest.email ? 'EMAIL' : reservation.guest.phone ? 'PHONE' : undefined,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  }
}

function deserializeReservation(res: Reservation): Reservation {
  return {
    ...res,
    checkIn: new Date(res.checkIn),
    checkOut: new Date(res.checkOut),
    createdAt: new Date(res.createdAt),
    updatedAt: new Date(res.updatedAt),
  }
}

function sourceFromServer(source: string): Reservation['source'] {
  return ['DIRECT', 'BOOKING_COM', 'AGODA', 'EXPEDIA', 'AIRBNB', 'WALK_IN', 'PHONE'].includes(source)
    ? source as Reservation['source']
    : 'DIRECT'
}

function reservationFromServer(record: any): Reservation {
  const checkIn = new Date(record.checkIn)
  const checkOut = new Date(record.checkOut)
  const guestName = record.guest
    ? `${record.guest.firstName} ${record.guest.lastName}`.trim()
    : 'Guest name required'

  return {
    id: record.id,
    confirmationNumber: record.confirmationCode,
    status: record.status,
    guestId: record.guestId,
    guestName,
    guestEmail: record.guest?.email ?? undefined,
    guestPhone: record.guest?.phone ?? undefined,
    roomId: record.assignedRoomId ?? undefined,
    roomNumber: record.assignedRoom?.number,
    roomType: record.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
    checkIn,
    checkOut,
    nights: Math.max(1, nightsBetween(checkIn, checkOut)),
    adults: record.adults,
    children: record.children,
    ratePerNight: record.ratePerNight,
    totalAmount: record.totalAmount,
    depositAmount: record.depositAmount,
    depositPaid: record.depositPaid ? record.depositAmount : 0,
    depositStatus: record.depositPaid ? 'PAID' : record.depositAmount > 0 ? 'PENDING' : 'NONE',
    balanceDue: record.folio?.balance ?? record.totalAmount,
    source: sourceFromServer(record.source),
    channelConfirmation: record.channelRef ?? undefined,
    isVIP: Boolean(record.guest?.vipStatus),
    specialRequests: record.specialRequests ?? undefined,
    notes: record.notes ?? undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    createdBy: 'PMS API',
  }
}

export function ReservationsView() {
  const [reservationsRaw, setReservationsRaw] = useKV<Reservation[]>('reservations-data', [])
  const [unassignedReservations, setUnassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [, setGuestDirectory] = useKV<GuestDirectoryRecord[]>('guests-data', [])
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  const { rooms } = useRoomSync()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<'all' | 'upcoming' | 'in-house' | 'past'>('upcoming')
  const [showNewReservationDialog, setShowNewReservationDialog] = useState(false)
  
  const reservations = useMemo(() => {
    const merged = new Map<string, Reservation>()
    ;(reservationsRaw || []).map(deserializeReservation).forEach((reservation) => {
      merged.set(reservation.id, reservation)
    })
    rooms.map(reservationFromRoom).filter(Boolean).forEach((reservation) => {
      if (reservation && !merged.has(reservation.id)) merged.set(reservation.id, reservation)
    })
    ;(unassignedReservations || []).map(reservationFromUnassigned).forEach((reservation) => {
      if (!merged.has(reservation.id)) merged.set(reservation.id, reservation)
    })
    return [...merged.values()]
  }, [reservationsRaw, rooms, unassignedReservations])
  
  const setReservations = (updater: Reservation[] | ((current: Reservation[]) => Reservation[])) => {
    setReservationsRaw((current) => {
      const deserialized = (current || []).map(deserializeReservation)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }

  useEffect(() => {
    if (!SERVER_API_ENABLED || !authToken) return

    let cancelled = false
    pmsApi<{ ok: true; data: any[] }>('/api/reservations', authToken)
      .then((payload) => {
        if (!cancelled) setReservationsRaw(payload.data.map(reservationFromServer))
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load reservations from the PMS API.')
      })

    return () => {
      cancelled = true
    }
  }, [authToken, setReservationsRaw])
  
  const handleCreateReservation = async (reservation: NewReservationData) => {
    if (SERVER_API_ENABLED && authToken) {
      const payload = await pmsApi<{ ok: true; data: any; message?: string }>('/api/reservations', authToken, {
        method: 'POST',
        body: JSON.stringify({
          guest: {
            firstName: reservation.guest.firstName,
            lastName: reservation.guest.lastName,
            email: reservation.guest.email,
            phone: reservation.guest.phone,
            nationality: reservation.guest.nationality,
            vipStatus: reservation.guest.vipStatus,
          },
          roomTypeCode: reservation.roomTypeName === 'Twin Room' ? 'TWIN' : 'DOUBLE',
          checkIn: getBangkokDateKey(reservation.checkIn),
          checkOut: getBangkokDateKey(reservation.checkOut),
          adults: reservation.adults,
          children: reservation.children,
          childAges: reservation.childAges ?? [],
          ratePerNight: reservation.ratePerNight,
          source: reservation.source,
          specialRequests: reservation.specialRequests,
          notes: reservation.notes,
        }),
      })
      const serverReservation = reservationFromServer(payload.data)
      setReservations((current) => [...current.filter((item) => item.id !== serverReservation.id), serverReservation])
      toast.success(payload.message || `Reservation ${serverReservation.confirmationNumber} created.`)
      setShowNewReservationDialog(false)
      return
    }

    const reservationRecord = toReservationRecord(reservation)
    const guestRecord = toGuestRecord(reservation)

    setReservations((current) => {
      if (current.some((item) => item.id === reservationRecord.id)) return current
      return [...current, reservationRecord]
    })
    setGuestDirectory((current) => {
      const existing = current || []
      if (existing.some((guest) => guest.id === guestRecord.id)) return existing
      return [...existing, guestRecord]
    })
    setUnassignedReservations((current) => [
      ...(current || []),
      {
        id: reservation.id,
        guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        roomType: reservation.roomTypeName === 'Twin Room' ? 'TWIN' : 'DOUBLE',
        guestCount: reservation.adults + reservation.children,
        nights: reservationRecord.nights,
        source: reservation.source === 'DIRECT' ? 'Direct' : reservation.source === 'BOOKING_COM' ? 'Booking.com' : reservation.source,
        isVIP: reservation.guest.vipStatus,
      },
    ])
    toast.success('Reservation created and added to the assignment queue.')
    setShowNewReservationDialog(false)
  }
  
  const filteredReservations = useMemo(() => {
    let result = reservations
    
    switch (selectedTab) {
      case 'upcoming':
        result = result.filter(r => 
          (r.status === 'CONFIRMED' || r.status === 'PENDING') &&
          isBefore(new Date(), r.checkIn)
        )
        break
      case 'in-house':
        result = result.filter(r => r.status === 'CHECKED_IN')
        break
      case 'past':
        result = result.filter(r => 
          r.status === 'CHECKED_OUT' || 
          r.status === 'CANCELLED' || 
          r.status === 'NO_SHOW'
        )
        break
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(r =>
        r.guestName.toLowerCase().includes(query) ||
        r.confirmationNumber.toLowerCase().includes(query) ||
        r.roomNumber?.includes(query) ||
        r.channelConfirmation?.toLowerCase().includes(query)
      )
    }
    
    return result
  }, [reservations, selectedTab, searchQuery])
  
  const stats = useMemo(() => {
    const upcoming = reservations.filter(r => 
      (r.status === 'CONFIRMED' || r.status === 'PENDING') &&
      isBefore(new Date(), r.checkIn)
    ).length
    
    const inHouse = reservations.filter(r => r.status === 'CHECKED_IN').length
    
    const arrivingToday = reservations.filter(r => 
      r.status === 'CONFIRMED' && isToday(r.checkIn)
    ).length
    
    const departingToday = reservations.filter(r => 
      r.status === 'CHECKED_IN' && isToday(r.checkOut)
    ).length
    
    return { upcoming, inHouse, arrivingToday, departingToday }
  }, [reservations])
  
  const getStatusColor = (status: Reservation['status']) => {
    switch (status) {
      case 'CONFIRMED': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'CHECKED_IN': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'CHECKED_OUT': return 'bg-slate-100 text-slate-600 border-slate-200'
      case 'CANCELLED': return 'bg-red-100 text-red-800 border-red-200'
      case 'NO_SHOW': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'PENDING': return 'bg-amber-100 text-amber-800 border-amber-200'
    }
  }
  
  const getSourceColor = (source: Reservation['source']) => {
    switch (source) {
      case 'DIRECT': return 'bg-violet-100 text-violet-800'
      case 'BOOKING_COM': return 'bg-sky-100 text-sky-800'
      case 'AGODA': return 'bg-pink-100 text-pink-800'
      case 'EXPEDIA': return 'bg-cyan-100 text-cyan-800'
      case 'AIRBNB': return 'bg-rose-100 text-rose-800'
      case 'WALK_IN': return 'bg-slate-100 text-slate-800'
      case 'PHONE': return 'bg-amber-100 text-amber-800'
    }
  }

  const handlePrint = () => {
    const tabTitles = {
      all: 'All Reservations',
      upcoming: 'Upcoming Reservations',
      'in-house': 'In-House Guests',
      past: 'Past Reservations'
    }
    
    const groupByOptions = {
      all: 'status' as const,
      upcoming: 'date' as const,
      'in-house': 'none' as const,
      past: 'status' as const
    }
    
    printReservationsList(
      filteredReservations,
      `${tabTitles[selectedTab]} - ${format(new Date(), 'MMMM d, yyyy')}`,
      {
        groupBy: groupByOptions[selectedTab],
        showFinancials: true
      }
    )
    toast.success('Opening print preview...')
  }
  
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Reservations</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage all guest reservations and bookings
              </p>
            </div>
            <Button className="gap-2" onClick={() => setShowNewReservationDialog(true)}>
              <Plus size={18} weight="bold" />
              New Reservation
            </Button>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input
                placeholder="Search by name, confirmation, room..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" className="gap-2">
              <FunnelSimple size={18} />
              Filters
            </Button>
            <Button variant="outline" className="gap-2" onClick={handlePrint}>
              <Printer size={18} weight="bold" />
              Print
            </Button>
          </div>
        </div>
        
        <div className="px-6 pb-4">
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Upcoming</div>
              <div className="text-2xl font-bold text-foreground">{stats.upcoming}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">In-House</div>
              <div className="text-2xl font-bold text-blue-600">{stats.inHouse}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Arriving Today</div>
              <div className="text-2xl font-bold text-emerald-600">{stats.arrivingToday}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Departing Today</div>
              <div className="text-2xl font-bold text-orange-600">{stats.departingToday}</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-6">
          <TabsList className="bg-transparent">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="in-house">In-House</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value={selectedTab} className="flex-1 m-0 p-6">
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {filteredReservations.length === 0 ? (
                <Card className="p-12 text-center">
                  <Calendar className="mx-auto mb-4 text-muted-foreground" size={48} weight="light" />
                  <h3 className="text-lg font-medium text-foreground mb-2">No reservations found</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'Try adjusting your search terms' : 'No reservations in this category'}
                  </p>
                </Card>
              ) : (
                filteredReservations.map(reservation => (
                  <Card 
                    key={reservation.id}
                    className="p-4 hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-base font-semibold text-foreground">{reservation.guestName}</h3>
                          {reservation.isVIP && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">VIP</Badge>
                          )}
                          <Badge className={cn('text-xs border', getStatusColor(reservation.status))}>
                            {reservation.status.replace('_', ' ')}
                          </Badge>
                          <Badge variant="outline" className={cn('text-xs', getSourceColor(reservation.source))}>
                            {reservation.source.replace('_', ' ')}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-5 gap-4 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar size={16} />
                            <span>{format(reservation.checkIn, 'MMM d')} - {format(reservation.checkOut, 'MMM d, yyyy')}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin size={16} />
                            <span>{reservation.roomNumber || 'Unassigned'} • {reservation.roomType}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <User size={16} />
                            <span>{reservation.adults} {reservation.adults === 1 ? 'adult' : 'adults'}{reservation.children > 0 ? `, ${reservation.children} ${reservation.children === 1 ? 'child' : 'children'}` : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Phone size={16} />
                            <span className="truncate">{reservation.guestEmail}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-mono">#{reservation.confirmationNumber}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right ml-6">
                        <div className="text-lg font-bold text-foreground">
                          ฿{reservation.totalAmount.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          ฿{reservation.ratePerNight.toLocaleString()} × {reservation.nights} {reservation.nights === 1 ? 'night' : 'nights'}
                        </div>
                        {reservation.depositStatus !== 'NONE' && (
                          <Badge 
                            variant="outline" 
                            className={cn(
                              'text-xs',
                              reservation.depositStatus === 'PAID' 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            )}
                          >
                            <CreditCard size={12} className="mr-1" />
                            {reservation.depositStatus === 'PAID' ? 'Deposit Paid' : 'Deposit Pending'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    {(reservation.specialRequests || reservation.notes) && (
                      <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                        {reservation.specialRequests && (
                          <div><span className="font-medium">Special Requests:</span> {reservation.specialRequests}</div>
                        )}
                        {reservation.notes && (
                          <div className="mt-1"><span className="font-medium">Notes:</span> {reservation.notes}</div>
                        )}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      <NewReservationDialog
        open={showNewReservationDialog}
        onClose={() => setShowNewReservationDialog(false)}
        onSubmit={handleCreateReservation}
      />
    </div>
  )
}
