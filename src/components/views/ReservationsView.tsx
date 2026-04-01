import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MagnifyingGlass, Plus, FunnelSimple, Calendar, User, CreditCard, MapPin, Phone, Printer } from '@phosphor-icons/react'
import { format, addDays, differenceInDays, isBefore, isToday, isTomorrow } from 'date-fns'
import { cn } from '@/lib/utils'
import { printReservationsList } from '@/lib/print-utils'
import { toast } from 'sonner'

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
  
  source: 'DIRECT' | 'BOOKING_COM' | 'AGODA' | 'EXPEDIA' | 'AIRBNB' | 'WALK_IN'
  channelConfirmation?: string
  
  isVIP: boolean
  specialRequests?: string
  notes?: string
  
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

function generateMockReservations(): Reservation[] {
  const sources: Reservation['source'][] = ['DIRECT', 'BOOKING_COM', 'AGODA', 'EXPEDIA', 'AIRBNB']
  const statuses: Reservation['status'][] = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'PENDING']
  const names = [
    'Sarah Johnson', 'Michael Chen', 'Emma Williams', 'James Brown', 'Lisa Anderson',
    'David Martinez', 'Sophie Taylor', 'Alex Kumar', 'Maria Garcia', 'John Smith',
    'Anna Kowalski', 'Tom Wilson', 'Julia Roberts', 'Chris Evans', 'Nina Patel'
  ]
  
  const reservations: Reservation[] = []
  const today = new Date()
  
  for (let i = 0; i < 50; i++) {
    const checkInOffset = Math.floor(Math.random() * 60) - 30
    const checkIn = addDays(today, checkInOffset)
    const nights = Math.floor(Math.random() * 7) + 1
    const checkOut = addDays(checkIn, nights)
    
    const adults = Math.floor(Math.random() * 3) + 1
    const children = Math.random() < 0.3 ? Math.floor(Math.random() * 2) : 0
    
    const ratePerNight = Math.floor(Math.random() * 2000) + 1500
    const totalAmount = ratePerNight * nights
    const depositAmount = totalAmount * 0.3
    
    let status: Reservation['status'] = 'CONFIRMED'
    if (isBefore(checkOut, today)) {
      status = Math.random() < 0.9 ? 'CHECKED_OUT' : 'NO_SHOW'
    } else if (isBefore(checkIn, today) && !isBefore(checkOut, today)) {
      status = 'CHECKED_IN'
    } else if (Math.random() < 0.05) {
      status = 'CANCELLED'
    } else if (Math.random() < 0.1) {
      status = 'PENDING'
    }
    
    const depositPaid = status === 'PENDING' ? 0 : Math.random() < 0.8 ? depositAmount : 0
    const depositStatus: Reservation['depositStatus'] = 
      depositPaid >= depositAmount ? 'PAID' : depositPaid > 0 ? 'PENDING' : 'NONE'
    
    const balanceDue = totalAmount - depositPaid
    
    reservations.push({
      id: `RES${1000 + i}`,
      confirmationNumber: `SB${today.getFullYear()}${String(1000 + i).padStart(4, '0')}`,
      status,
      guestId: `GUEST${100 + i}`,
      guestName: names[i % names.length],
      guestEmail: `${names[i % names.length].toLowerCase().replace(' ', '.')}@example.com`,
      guestPhone: `+66-${Math.floor(Math.random() * 900000000) + 100000000}`,
      roomNumber: status === 'CHECKED_IN' ? `${Math.random() < 0.5 ? '2' : '3'}${String(Math.floor(Math.random() * 15) + 1).padStart(2, '0')}` : undefined,
      roomType: Math.random() < 0.5 ? 'TWIN' : 'DOUBLE',
      checkIn,
      checkOut,
      nights,
      adults,
      children,
      ratePerNight,
      totalAmount,
      depositAmount,
      depositPaid,
      depositStatus,
      balanceDue,
      source: sources[Math.floor(Math.random() * sources.length)],
      channelConfirmation: Math.random() < 0.6 ? `CH${Math.floor(Math.random() * 1000000)}` : undefined,
      isVIP: Math.random() < 0.1,
      specialRequests: Math.random() < 0.3 ? 'High floor, quiet room' : undefined,
      notes: Math.random() < 0.2 ? 'Returning guest' : undefined,
      createdAt: addDays(checkIn, -Math.floor(Math.random() * 30)),
      updatedAt: new Date(),
      createdBy: 'system'
    })
  }
  
  return reservations.sort((a, b) => b.checkIn.getTime() - a.checkIn.getTime())
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

export function ReservationsView() {
  const [reservationsRaw, setReservationsRaw] = useKV<Reservation[]>('reservations-data', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<'all' | 'upcoming' | 'in-house' | 'past'>('upcoming')
  
  const reservations = useMemo(() => 
    (reservationsRaw || []).map(deserializeReservation),
    [reservationsRaw]
  )
  
  const setReservations = (updater: Reservation[] | ((current: Reservation[]) => Reservation[])) => {
    setReservationsRaw((current) => {
      const deserialized = (current || []).map(deserializeReservation)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }
  
  useState(() => {
    if (reservations.length === 0) {
      setReservations(generateMockReservations())
    }
  })
  
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
            <Button className="gap-2">
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
    </div>
  )
}
