import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Calendar as CalendarIcon, 
  MagnifyingGlass, 
  Plus, 
  Funnel,
  User,
  MapPin,
  Phone,
  Envelope,
  Bed,
  Clock,
  CurrencyCircleDollar,
  CheckCircle,
  X,
  Warning,
  Note,
  ArrowRight
} from '@phosphor-icons/react'
import type { ReservationWithDetails, Reservation, Guest, BookingSource, ReservationStatus } from '@/types'
import { toast } from 'sonner'
import { format, addDays, differenceInDays } from 'date-fns'
import { cn } from '@/lib/utils'

interface ReservationData extends Omit<Reservation, 'guest' | 'roomType'> {
  guest: Guest
  roomTypeName: string
  roomNumber?: string
}

export function ReservationsView() {
  const [reservations, setReservations] = useKV<ReservationData[]>('reservations', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedReservation, setSelectedReservation] = useState<ReservationData | null>(null)
  const [showNewReservationDialog, setShowNewReservationDialog] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | 'ALL'>('ALL')

  const filteredReservations = useMemo(() => {
    let filtered = reservations || []

    if (statusFilter !== 'ALL') {
      filtered = filtered.filter(r => r.status === statusFilter)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(r => 
        r.guest.firstName.toLowerCase().includes(query) ||
        r.guest.lastName.toLowerCase().includes(query) ||
        r.guest.email?.toLowerCase().includes(query) ||
        r.guest.phone?.toLowerCase().includes(query) ||
        r.roomNumber?.includes(query) ||
        r.id.toLowerCase().includes(query)
      )
    }

    return filtered.sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())
  }, [reservations, searchQuery, statusFilter])

  const upcomingReservations = filteredReservations.filter(r => 
    r.status === 'CONFIRMED' && new Date(r.checkIn) > new Date()
  )

  const activeReservations = filteredReservations.filter(r => 
    r.status === 'CHECKED_IN'
  )

  const todayArrivals = filteredReservations.filter(r => {
    const today = new Date()
    const checkIn = new Date(r.checkIn)
    return r.status === 'CONFIRMED' && 
           checkIn.toDateString() === today.toDateString()
  })

  const todayDepartures = filteredReservations.filter(r => {
    const today = new Date()
    const checkOut = new Date(r.checkOut)
    return r.status === 'CHECKED_IN' && 
           checkOut.toDateString() === today.toDateString()
  })

  const cancelledReservations = filteredReservations.filter(r => 
    r.status === 'CANCELLED' || r.status === 'NO_SHOW'
  )

  const handleCancelReservation = (reservationId: string) => {
    setReservations(current => 
      (current || []).map(r => 
        r.id === reservationId 
          ? { ...r, status: 'CANCELLED' as ReservationStatus }
          : r
      )
    )
    toast.success('Reservation cancelled')
    setSelectedReservation(null)
  }

  return (
    <div className="h-full flex flex-col bg-background p-6 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted-foreground">
            Manage all bookings and reservations
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowNewReservationDialog(true)}>
            <Plus className="w-4 h-4 mr-2" weight="bold" />
            New Reservation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1">Today's Arrivals</div>
          <div className="text-3xl font-bold">{todayArrivals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1">Today's Departures</div>
          <div className="text-3xl font-bold">{todayDepartures.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1">Active Stays</div>
          <div className="text-3xl font-bold">{activeReservations.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1">Upcoming</div>
          <div className="text-3xl font-bold">{upcomingReservations.length}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by guest name, email, phone, or room..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReservationStatus | 'ALL')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="CONFIRMED">Confirmed</SelectItem>
            <SelectItem value="CHECKED_IN">Checked In</SelectItem>
            <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="NO_SHOW">No Show</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon">
          <Funnel className="w-4 h-4" />
        </Button>
      </div>

      <Tabs defaultValue="all" className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="all">All ({filteredReservations.length})</TabsTrigger>
          <TabsTrigger value="arrivals">Arrivals ({todayArrivals.length})</TabsTrigger>
          <TabsTrigger value="departures">Departures ({todayDepartures.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({activeReservations.length})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcomingReservations.length})</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled ({cancelledReservations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="flex-1 mt-4">
          <ReservationsList 
            reservations={filteredReservations} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>

        <TabsContent value="arrivals" className="flex-1 mt-4">
          <ReservationsList 
            reservations={todayArrivals} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>

        <TabsContent value="departures" className="flex-1 mt-4">
          <ReservationsList 
            reservations={todayDepartures} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>

        <TabsContent value="active" className="flex-1 mt-4">
          <ReservationsList 
            reservations={activeReservations} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>

        <TabsContent value="upcoming" className="flex-1 mt-4">
          <ReservationsList 
            reservations={upcomingReservations} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>

        <TabsContent value="cancelled" className="flex-1 mt-4">
          <ReservationsList 
            reservations={cancelledReservations} 
            onSelect={setSelectedReservation}
          />
        </TabsContent>
      </Tabs>

      <ReservationDetailDialog
        reservation={selectedReservation}
        open={!!selectedReservation}
        onClose={() => setSelectedReservation(null)}
        onCancel={handleCancelReservation}
      />

      <NewReservationDialog
        open={showNewReservationDialog}
        onClose={() => setShowNewReservationDialog(false)}
        onSubmit={(data) => {
          setReservations(current => [...(current || []), data])
          toast.success('Reservation created')
          setShowNewReservationDialog(false)
        }}
      />
    </div>
  )
}

interface ReservationsListProps {
  reservations: ReservationData[]
  onSelect: (reservation: ReservationData) => void
}

function ReservationsList({ reservations, onSelect }: ReservationsListProps) {
  if (reservations.length === 0) {
    return (
      <Card className="p-12">
        <div className="text-center text-muted-foreground">
          <CalendarIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>No reservations found</p>
        </div>
      </Card>
    )
  }

  return (
    <ScrollArea className="h-[calc(100vh-400px)]">
      <div className="space-y-2 pr-4">
        {reservations.map(reservation => (
          <ReservationCard 
            key={reservation.id} 
            reservation={reservation}
            onClick={() => onSelect(reservation)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

interface ReservationCardProps {
  reservation: ReservationData
  onClick: () => void
}

function ReservationCard({ reservation, onClick }: ReservationCardProps) {
  const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))
  
  return (
    <Card 
      className="p-4 hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-lg">
              {reservation.guest.firstName} {reservation.guest.lastName}
            </h3>
            <StatusBadge status={reservation.status} />
            {!reservation.depositPaid && reservation.status !== 'CANCELLED' && (
              <Badge variant="destructive" className="text-xs">
                <Warning size={12} className="mr-1" weight="bold" />
                Deposit Pending
              </Badge>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarIcon size={14} />
              <span>{format(new Date(reservation.checkIn), 'MMM d')} - {format(new Date(reservation.checkOut), 'MMM d, yyyy')}</span>
              <span className="text-xs">({nights}N)</span>
            </div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <Bed size={14} />
              <span>{reservation.roomTypeName}</span>
              {reservation.roomNumber && (
                <span className="font-medium text-foreground">Room {reservation.roomNumber}</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <User size={14} />
              <span>{reservation.adults} Adult{reservation.adults > 1 ? 's' : ''}</span>
              {reservation.children > 0 && (
                <span>, {reservation.children} Child{reservation.children > 1 ? 'ren' : ''}</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
              <CurrencyCircleDollar size={14} />
              <span className="font-medium text-foreground">฿{reservation.totalAmount.toLocaleString()}</span>
              <span className="text-xs">({reservation.source})</span>
            </div>
          </div>

          {reservation.specialRequests && (
            <div className="mt-2 text-sm flex items-start gap-2 text-primary">
              <Note size={14} className="mt-0.5" weight="bold" />
              <span className="line-clamp-1">{reservation.specialRequests}</span>
            </div>
          )}
        </div>

        <ArrowRight size={20} className="text-muted-foreground flex-shrink-0" />
      </div>
    </Card>
  )
}

interface StatusBadgeProps {
  status: ReservationStatus
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    PENDING: { label: 'Pending', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
    CONFIRMED: { label: 'Confirmed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    CHECKED_IN: { label: 'Checked In', className: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
    CHECKED_OUT: { label: 'Checked Out', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
    NO_SHOW: { label: 'No Show', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  }

  const { label, className } = config[status]

  return (
    <Badge className={cn('text-xs', className)} variant="secondary">
      {label}
    </Badge>
  )
}

interface ReservationDetailDialogProps {
  reservation: ReservationData | null
  open: boolean
  onClose: () => void
  onCancel: (reservationId: string) => void
}

function ReservationDetailDialog({ reservation, open, onClose, onCancel }: ReservationDetailDialogProps) {
  if (!reservation) return null

  const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Reservation Details</DialogTitle>
            <StatusBadge status={reservation.status} />
          </div>
          <DialogDescription>Booking ID: {reservation.id}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6 pr-4">
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <User size={18} />
                Guest Information
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Name</div>
                  <div className="font-medium">{reservation.guest.firstName} {reservation.guest.lastName}</div>
                </div>
                {reservation.guest.email && (
                  <div>
                    <div className="text-muted-foreground">Email</div>
                    <div className="font-medium">{reservation.guest.email}</div>
                  </div>
                )}
                {reservation.guest.phone && (
                  <div>
                    <div className="text-muted-foreground">Phone</div>
                    <div className="font-medium">{reservation.guest.phone}</div>
                  </div>
                )}
                {reservation.guest.nationality && (
                  <div>
                    <div className="text-muted-foreground">Nationality</div>
                    <div className="font-medium">{reservation.guest.nationality}</div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <CalendarIcon size={18} />
                Stay Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Check-in</div>
                  <div className="font-medium">{format(new Date(reservation.checkIn), 'PPP')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Check-out</div>
                  <div className="font-medium">{format(new Date(reservation.checkOut), 'PPP')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Nights</div>
                  <div className="font-medium">{nights} Night{nights > 1 ? 's' : ''}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Guests</div>
                  <div className="font-medium">
                    {reservation.adults} Adult{reservation.adults > 1 ? 's' : ''}
                    {reservation.children > 0 && `, ${reservation.children} Child${reservation.children > 1 ? 'ren' : ''}`}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Room Type</div>
                  <div className="font-medium">{reservation.roomTypeName}</div>
                </div>
                {reservation.roomNumber && (
                  <div>
                    <div className="text-muted-foreground">Room Number</div>
                    <div className="font-medium">Room {reservation.roomNumber}</div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <CurrencyCircleDollar size={18} />
                Payment Information
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Rate per Night</div>
                  <div className="font-medium">฿{reservation.ratePerNight.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Total Amount</div>
                  <div className="font-medium text-lg">฿{reservation.totalAmount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Deposit</div>
                  <div className="font-medium">฿{reservation.depositAmount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Deposit Status</div>
                  <div>
                    {reservation.depositPaid ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle size={12} className="mr-1" weight="bold" />
                        Paid
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <Warning size={12} className="mr-1" weight="bold" />
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Booking Source</div>
                  <div className="font-medium">{reservation.source}</div>
                </div>
              </div>
            </Card>

            {reservation.specialRequests && (
              <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <Note size={18} weight="bold" />
                  Special Requests
                </h3>
                <p className="text-sm text-blue-600 dark:text-blue-400">{reservation.specialRequests}</p>
              </Card>
            )}

            {reservation.notes && (
              <Card className="p-4">
                <h3 className="font-semibold mb-2">Internal Notes</h3>
                <p className="text-sm text-muted-foreground">{reservation.notes}</p>
              </Card>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          {reservation.status === 'CONFIRMED' && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (confirm('Are you sure you want to cancel this reservation?')) {
                    onCancel(reservation.id)
                  }
                }}
              >
                <X size={16} className="mr-2" weight="bold" />
                Cancel Reservation
              </Button>
              <Button>
                <CheckCircle size={16} className="mr-2" weight="bold" />
                Check In
              </Button>
            </>
          )}
          {reservation.status === 'CHECKED_IN' && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button>
                <CheckCircle size={16} className="mr-2" weight="bold" />
                Check Out
              </Button>
            </>
          )}
          {(reservation.status === 'CHECKED_OUT' || reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') && (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface NewReservationDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (reservation: ReservationData) => void
}

function NewReservationDialog({ open, onClose, onSubmit }: NewReservationDialogProps) {
  const [checkIn, setCheckIn] = useState<Date>(addDays(new Date(), 1))
  const [checkOut, setCheckOut] = useState<Date>(addDays(new Date(), 2))
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roomType: 'TWIN' as 'TWIN' | 'DOUBLE',
    adults: 1,
    children: 0,
    ratePerNight: 1500,
    source: 'DIRECT' as BookingSource,
    specialRequests: '',
  })

  const nights = differenceInDays(checkOut, checkIn)
  const totalAmount = nights * formData.ratePerNight
  const depositAmount = Math.floor(totalAmount * 0.3)

  const handleSubmit = () => {
    if (!formData.firstName || !formData.lastName) {
      toast.error('Please fill in guest name')
      return
    }

    const guest: Guest = {
      id: `guest-${Date.now()}`,
      propertyId: 'prop-1',
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email || null,
      phone: formData.phone || null,
      nationality: null,
      idType: null,
      idNumber: null,
      dateOfBirth: null,
      vipStatus: false,
      blacklisted: false,
      cautionFlag: false,
      preferences: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const reservation: ReservationData = {
      id: `RES-${Date.now()}`,
      propertyId: 'prop-1',
      guestId: guest.id,
      roomTypeId: formData.roomType === 'TWIN' ? 'rt-1' : 'rt-2',
      assignedRoomId: null,
      status: 'CONFIRMED',
      source: formData.source,
      channelRef: null,
      checkIn,
      checkOut,
      actualCheckIn: null,
      actualCheckOut: null,
      adults: formData.adults,
      children: formData.children,
      childAges: null,
      ratePerNight: formData.ratePerNight,
      totalAmount,
      depositAmount,
      depositPaid: false,
      specialRequests: formData.specialRequests || null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      guest,
      roomTypeName: formData.roomType === 'TWIN' ? 'Twin Room' : 'Double Room',
      roomNumber: undefined,
    }

    onSubmit(reservation)
    
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      roomType: 'TWIN',
      adults: 1,
      children: 0,
      ratePerNight: 1500,
      source: 'DIRECT',
      specialRequests: '',
    })
    setCheckIn(addDays(new Date(), 1))
    setCheckOut(addDays(new Date(), 2))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Reservation</DialogTitle>
          <DialogDescription>Create a new booking</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Check-in Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-2 justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(checkIn, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkIn}
                      onSelect={(date) => date && setCheckIn(date)}
                      disabled={(date) => date < new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Check-out Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-2 justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(checkOut, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkOut}
                      onSelect={(date) => date && setCheckOut(date)}
                      disabled={(date) => date <= checkIn}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="roomType">Room Type</Label>
                <Select value={formData.roomType} onValueChange={(v) => setFormData(prev => ({ ...prev, roomType: v as 'TWIN' | 'DOUBLE' }))}>
                  <SelectTrigger id="roomType" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TWIN">Twin Room</SelectItem>
                    <SelectItem value="DOUBLE">Double Room</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="adults">Adults</Label>
                <Input
                  id="adults"
                  type="number"
                  min="1"
                  value={formData.adults}
                  onChange={(e) => setFormData(prev => ({ ...prev, adults: parseInt(e.target.value) || 1 }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="children">Children</Label>
                <Input
                  id="children"
                  type="number"
                  min="0"
                  value={formData.children}
                  onChange={(e) => setFormData(prev => ({ ...prev, children: parseInt(e.target.value) || 0 }))}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="ratePerNight">Rate per Night (฿)</Label>
                <Input
                  id="ratePerNight"
                  type="number"
                  min="0"
                  value={formData.ratePerNight}
                  onChange={(e) => setFormData(prev => ({ ...prev, ratePerNight: parseInt(e.target.value) || 0 }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="source">Booking Source</Label>
                <Select value={formData.source} onValueChange={(v) => setFormData(prev => ({ ...prev, source: v as BookingSource }))}>
                  <SelectTrigger id="source" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="BOOKING_COM">Booking.com</SelectItem>
                    <SelectItem value="AGODA">Agoda</SelectItem>
                    <SelectItem value="EXPEDIA">Expedia</SelectItem>
                    <SelectItem value="AIRBNB">Airbnb</SelectItem>
                    <SelectItem value="WALK_IN">Walk-in</SelectItem>
                    <SelectItem value="PHONE">Phone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="specialRequests">Special Requests</Label>
              <Textarea
                id="specialRequests"
                value={formData.specialRequests}
                onChange={(e) => setFormData(prev => ({ ...prev, specialRequests: e.target.value }))}
                className="mt-2"
                rows={3}
                placeholder="Any special requests from the guest..."
              />
            </div>

            <Card className="p-4 bg-muted">
              <h4 className="font-semibold mb-2">Booking Summary</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nights:</span>
                  <span className="font-medium">{nights}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rate per Night:</span>
                  <span className="font-medium">฿{formData.ratePerNight.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-base font-semibold pt-2 border-t">
                  <span>Total Amount:</span>
                  <span>฿{totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit (30%):</span>
                  <span className="font-medium">฿{depositAmount.toLocaleString()}</span>
                </div>
              </div>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            <Plus className="w-4 h-4 mr-2" weight="bold" />
            Create Reservation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
