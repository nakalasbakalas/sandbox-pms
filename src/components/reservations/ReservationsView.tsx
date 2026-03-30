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
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
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
  ArrowRight,
  DoorOpen,
  Key,
  IdentificationCard,
  CreditCard,
  Receipt,
  SignIn,
  SignOut,
  Info,
  PencilSimple,
  SelectionAll
} from '@phosphor-icons/react'
import type { ReservationWithDetails, Reservation, Guest, BookingSource, ReservationStatus, Room, RoomWithDetails } from '@/types'
import { toast } from 'sonner'
import { format, addDays, differenceInDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { BulkEditDialog, type BulkEditUpdates } from './BulkEditDialog'

interface ReservationData extends Omit<Reservation, 'guest' | 'roomType'> {
  guest: Guest
  roomTypeName: string
  roomNumber?: string
}

export function ReservationsView() {
  const [reservations, setReservations] = useKV<ReservationData[]>('reservations', [])
  const [rooms, setRooms] = useKV<RoomWithDetails[]>('rooms', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedReservation, setSelectedReservation] = useState<ReservationData | null>(null)
  const [showNewReservationDialog, setShowNewReservationDialog] = useState(false)
  const [showCheckInDialog, setShowCheckInDialog] = useState(false)
  const [showCheckOutDialog, setShowCheckOutDialog] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | 'ALL'>('ALL')
  const [selectedReservationIds, setSelectedReservationIds] = useState<Set<string>>(new Set())
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false)
  const [bulkSelectMode, setBulkSelectMode] = useState(false)

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

  const handleStartCheckIn = (reservation: ReservationData) => {
    setSelectedReservation(reservation)
    setShowCheckInDialog(true)
  }

  const handleStartCheckOut = (reservation: ReservationData) => {
    setSelectedReservation(reservation)
    setShowCheckOutDialog(true)
  }

  const handleCompleteCheckIn = (reservationId: string, roomNumber: string) => {
    setReservations(current => 
      (current || []).map(r => 
        r.id === reservationId 
          ? { 
              ...r, 
              status: 'CHECKED_IN' as ReservationStatus,
              actualCheckIn: new Date(),
              roomNumber 
            }
          : r
      )
    )
    toast.success(`Guest checked in to Room ${roomNumber}`)
    setShowCheckInDialog(false)
    setSelectedReservation(null)
  }

  const handleCompleteCheckOut = (reservationId: string) => {
    setReservations(current => 
      (current || []).map(r => 
        r.id === reservationId 
          ? { 
              ...r, 
              status: 'CHECKED_OUT' as ReservationStatus,
              actualCheckOut: new Date()
            }
          : r
      )
    )
    toast.success('Guest checked out successfully')
    setShowCheckOutDialog(false)
    setSelectedReservation(null)
  }

  const toggleReservationSelection = (reservationId: string) => {
    setSelectedReservationIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(reservationId)) {
        newSet.delete(reservationId)
      } else {
        newSet.add(reservationId)
      }
      return newSet
    })
  }

  const selectAllInView = (reservationsList: ReservationData[]) => {
    const allIds = new Set(reservationsList.map(r => r.id))
    setSelectedReservationIds(allIds)
  }

  const clearSelection = () => {
    setSelectedReservationIds(new Set())
    setBulkSelectMode(false)
  }

  const handleBulkEdit = (updates: BulkEditUpdates) => {
    const selectedReservations = (reservations || []).filter(r => selectedReservationIds.has(r.id))
    
    setReservations(current => 
      (current || []).map(reservation => {
        if (!selectedReservationIds.has(reservation.id)) {
          return reservation
        }

        let updated = { ...reservation }

        if (updates.status) {
          updated.status = updates.status
        }

        if (updates.addDays) {
          updated.checkOut = addDays(new Date(updated.checkOut), updates.addDays)
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.subtractDays) {
          updated.checkOut = addDays(new Date(updated.checkOut), -updates.subtractDays)
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.newCheckIn) {
          updated.checkIn = updates.newCheckIn
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.newCheckOut) {
          updated.checkOut = updates.newCheckOut
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.rateAdjustmentPercent !== undefined && updates.rateAdjustmentPercent !== 0) {
          const multiplier = 1 + (updates.rateAdjustmentPercent / 100)
          updated.ratePerNight = Math.round(updated.ratePerNight * multiplier)
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.rateAdjustmentFixed !== undefined && updates.rateAdjustmentFixed !== 0) {
          updated.ratePerNight = Math.round(updated.ratePerNight + updates.rateAdjustmentFixed)
          const nights = differenceInDays(new Date(updated.checkOut), new Date(updated.checkIn))
          updated.totalAmount = nights * updated.ratePerNight
          updated.depositAmount = Math.floor(updated.totalAmount * 0.3)
        }

        if (updates.depositPaid !== undefined) {
          updated.depositPaid = updates.depositPaid
        }

        if (updates.appendNotes) {
          const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm')
          const newNote = `[${timestamp}] ${updates.appendNotes}`
          updated.notes = updated.notes ? `${updated.notes}\n${newNote}` : newNote
        }

        if (updates.source) {
          updated.source = updates.source
        }

        updated.updatedAt = new Date()

        return updated
      })
    )

    toast.success(`Updated ${selectedReservationIds.size} reservation${selectedReservationIds.size !== 1 ? 's' : ''}`)
    clearSelection()
  }

  const selectedReservationsData = useMemo(() => 
    (reservations || []).filter(r => selectedReservationIds.has(r.id)),
    [reservations, selectedReservationIds]
  )

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
          {bulkSelectMode && selectedReservationIds.size > 0 && (
            <>
              <Badge variant="secondary" className="px-3 py-1.5">
                {selectedReservationIds.size} selected
              </Badge>
              <Button 
                variant="outline" 
                onClick={clearSelection}
              >
                <X className="w-4 h-4 mr-2" weight="bold" />
                Clear
              </Button>
              <Button onClick={() => setShowBulkEditDialog(true)}>
                <PencilSimple className="w-4 h-4 mr-2" weight="bold" />
                Bulk Edit
              </Button>
            </>
          )}
          {!bulkSelectMode && (
            <>
              <Button 
                variant="outline"
                onClick={() => setBulkSelectMode(true)}
              >
                <SelectionAll className="w-4 h-4 mr-2" />
                Select Multiple
              </Button>
              <Button onClick={() => setShowNewReservationDialog(true)}>
                <Plus className="w-4 h-4 mr-2" weight="bold" />
                New Reservation
              </Button>
            </>
          )}
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
          {bulkSelectMode && filteredReservations.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(filteredReservations)}
              >
                Select All ({filteredReservations.length})
              </Button>
              {selectedReservationIds.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedReservationIds.size} of {filteredReservations.length} selected
                </span>
              )}
            </div>
          )}
          <ReservationsList 
            reservations={filteredReservations} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>

        <TabsContent value="arrivals" className="flex-1 mt-4">
          {bulkSelectMode && todayArrivals.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(todayArrivals)}
              >
                Select All ({todayArrivals.length})
              </Button>
            </div>
          )}
          <ReservationsList 
            reservations={todayArrivals} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>

        <TabsContent value="departures" className="flex-1 mt-4">
          {bulkSelectMode && todayDepartures.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(todayDepartures)}
              >
                Select All ({todayDepartures.length})
              </Button>
            </div>
          )}
          <ReservationsList 
            reservations={todayDepartures} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>

        <TabsContent value="active" className="flex-1 mt-4">
          {bulkSelectMode && activeReservations.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(activeReservations)}
              >
                Select All ({activeReservations.length})
              </Button>
            </div>
          )}
          <ReservationsList 
            reservations={activeReservations} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>

        <TabsContent value="upcoming" className="flex-1 mt-4">
          {bulkSelectMode && upcomingReservations.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(upcomingReservations)}
              >
                Select All ({upcomingReservations.length})
              </Button>
            </div>
          )}
          <ReservationsList 
            reservations={upcomingReservations} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>

        <TabsContent value="cancelled" className="flex-1 mt-4">
          {bulkSelectMode && cancelledReservations.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => selectAllInView(cancelledReservations)}
              >
                Select All ({cancelledReservations.length})
              </Button>
            </div>
          )}
          <ReservationsList 
            reservations={cancelledReservations} 
            onSelect={setSelectedReservation}
            bulkSelectMode={bulkSelectMode}
            selectedIds={selectedReservationIds}
            onToggleSelect={toggleReservationSelection}
          />
        </TabsContent>
      </Tabs>

      <ReservationDetailDialog
        reservation={selectedReservation}
        open={!!selectedReservation && !showCheckInDialog && !showCheckOutDialog}
        onClose={() => setSelectedReservation(null)}
        onCancel={handleCancelReservation}
        onCheckIn={handleStartCheckIn}
        onCheckOut={handleStartCheckOut}
      />

      <CheckInDialog
        reservation={selectedReservation}
        open={showCheckInDialog}
        onClose={() => {
          setShowCheckInDialog(false)
          setSelectedReservation(null)
        }}
        onComplete={handleCompleteCheckIn}
        availableRooms={rooms || []}
      />

      <CheckOutDialog
        reservation={selectedReservation}
        open={showCheckOutDialog}
        onClose={() => {
          setShowCheckOutDialog(false)
          setSelectedReservation(null)
        }}
        onComplete={handleCompleteCheckOut}
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

      <BulkEditDialog
        open={showBulkEditDialog}
        onClose={() => setShowBulkEditDialog(false)}
        reservations={selectedReservationsData}
        onSave={handleBulkEdit}
      />
    </div>
  )
}

interface ReservationsListProps {
  reservations: ReservationData[]
  onSelect: (reservation: ReservationData) => void
  bulkSelectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}

function ReservationsList({ reservations, onSelect, bulkSelectMode, selectedIds, onToggleSelect }: ReservationsListProps) {
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
            onClick={() => !bulkSelectMode && onSelect(reservation)}
            bulkSelectMode={bulkSelectMode}
            isSelected={selectedIds.has(reservation.id)}
            onToggleSelect={() => onToggleSelect(reservation.id)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

interface ReservationCardProps {
  reservation: ReservationData
  onClick: () => void
  bulkSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}

function ReservationCard({ reservation, onClick, bulkSelectMode, isSelected, onToggleSelect }: ReservationCardProps) {
  const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))
  
  const handleClick = () => {
    if (bulkSelectMode) {
      onToggleSelect()
    } else {
      onClick()
    }
  }
  
  return (
    <Card 
      className={cn(
        "p-4 cursor-pointer transition-all",
        bulkSelectMode && isSelected && "ring-2 ring-primary bg-accent/30",
        !bulkSelectMode && "hover:bg-accent/50"
      )}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-4">
        {bulkSelectMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1"
          />
        )}
        
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

        {!bulkSelectMode && (
          <ArrowRight size={20} className="text-muted-foreground flex-shrink-0" />
        )}
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
  onCheckIn: (reservation: ReservationData) => void
  onCheckOut: (reservation: ReservationData) => void
}

function ReservationDetailDialog({ reservation, open, onClose, onCancel, onCheckIn, onCheckOut }: ReservationDetailDialogProps) {
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
              <Button onClick={() => onCheckIn(reservation)}>
                <SignIn size={16} className="mr-2" weight="bold" />
                Check In
              </Button>
            </>
          )}
          {reservation.status === 'CHECKED_IN' && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={() => onCheckOut(reservation)}>
                <SignOut size={16} className="mr-2" weight="bold" />
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

interface CheckInDialogProps {
  reservation: ReservationData | null
  open: boolean
  onClose: () => void
  onComplete: (reservationId: string, roomNumber: string) => void
  availableRooms: RoomWithDetails[]
}

function CheckInDialog({ reservation, open, onClose, onComplete }: CheckInDialogProps) {
  const [selectedRoom, setSelectedRoom] = useState('')
  const [idVerified, setIdVerified] = useState(false)
  const [depositCollected, setDepositCollected] = useState(false)
  const [keyHandedOver, setKeyHandedOver] = useState(false)
  const [notes, setNotes] = useState('')

  if (!reservation) return null

  const canCheckIn = selectedRoom && idVerified && depositCollected && keyHandedOver

  const handleCheckIn = () => {
    if (!canCheckIn) {
      toast.error('Please complete all check-in requirements')
      return
    }
    onComplete(reservation.id, selectedRoom)
  }

  const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SignIn size={24} weight="bold" className="text-primary" />
            Check-In Guest
          </DialogTitle>
          <DialogDescription>
            Complete check-in process for {reservation.guest.firstName} {reservation.guest.lastName}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <Info size={20} weight="bold" className="text-blue-600 dark:text-blue-400 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">Reservation Summary</h4>
                  <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <div>Guest: {reservation.guest.firstName} {reservation.guest.lastName}</div>
                    <div>Check-in: {format(new Date(reservation.checkIn), 'PPP')}</div>
                    <div>Check-out: {format(new Date(reservation.checkOut), 'PPP')}</div>
                    <div>Duration: {nights} night{nights > 1 ? 's' : ''}</div>
                    <div>Room Type: {reservation.roomTypeName}</div>
                    <div>Guests: {reservation.adults} Adult{reservation.adults > 1 ? 's' : ''}{reservation.children > 0 && `, ${reservation.children} Child${reservation.children > 1 ? 'ren' : ''}`}</div>
                  </div>
                </div>
              </div>
            </Card>

            <div>
              <Label htmlFor="room-assignment" className="flex items-center gap-2 mb-2">
                <DoorOpen size={18} />
                Room Assignment *
              </Label>
              <Select value={selectedRoom} onValueChange={setSelectedRoom}>
                <SelectTrigger id="room-assignment">
                  <SelectValue placeholder="Select a room..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="101">Room 101 - {reservation.roomTypeName}</SelectItem>
                  <SelectItem value="102">Room 102 - {reservation.roomTypeName}</SelectItem>
                  <SelectItem value="103">Room 103 - {reservation.roomTypeName}</SelectItem>
                  <SelectItem value="201">Room 201 - {reservation.roomTypeName}</SelectItem>
                  <SelectItem value="202">Room 202 - {reservation.roomTypeName}</SelectItem>
                  <SelectItem value="203">Room 203 - {reservation.roomTypeName}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="font-semibold">Check-In Requirements</h4>
              
              <div className="flex items-start gap-3">
                <Checkbox
                  id="id-verified"
                  checked={idVerified}
                  onCheckedChange={(checked) => setIdVerified(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="id-verified"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <IdentificationCard size={18} />
                    ID Document Verified
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Verify and copy guest's identification document
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="deposit-collected"
                  checked={depositCollected}
                  onCheckedChange={(checked) => setDepositCollected(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="deposit-collected"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <CreditCard size={18} />
                    Deposit Collected
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    ฿{reservation.depositAmount.toLocaleString()} security deposit {reservation.depositPaid ? '(Pre-paid)' : 'collected'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="key-handed"
                  checked={keyHandedOver}
                  onCheckedChange={(checked) => setKeyHandedOver(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="key-handed"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <Key size={18} />
                    Room Key Handed Over
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Physical key or access card given to guest
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <Card className="p-4 bg-muted">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Receipt size={18} />
                Payment Summary
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-medium">฿{reservation.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit:</span>
                  <span className="font-medium">฿{reservation.depositAmount.toLocaleString()}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between text-base font-semibold">
                  <span>Balance Due at Check-out:</span>
                  <span>฿{(reservation.totalAmount - reservation.depositAmount).toLocaleString()}</span>
                </div>
              </div>
            </Card>

            <div>
              <Label htmlFor="checkin-notes">Check-In Notes (Optional)</Label>
              <Textarea
                id="checkin-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                rows={3}
                placeholder="Any notes about the check-in process..."
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCheckIn} disabled={!canCheckIn}>
            <SignIn size={16} className="mr-2" weight="bold" />
            Complete Check-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CheckOutDialogProps {
  reservation: ReservationData | null
  open: boolean
  onClose: () => void
  onComplete: (reservationId: string) => void
}

function CheckOutDialog({ reservation, open, onClose, onComplete }: CheckOutDialogProps) {
  const [roomInspected, setRoomInspected] = useState(false)
  const [keyReturned, setKeyReturned] = useState(false)
  const [damagesChecked, setDamagesChecked] = useState(false)
  const [paymentSettled, setPaymentSettled] = useState(false)
  const [minibarChecked, setMinibarChecked] = useState(false)
  const [notes, setNotes] = useState('')
  const [additionalCharges, setAdditionalCharges] = useState(0)

  if (!reservation) return null

  const canCheckOut = roomInspected && keyReturned && damagesChecked && paymentSettled && minibarChecked

  const handleCheckOut = () => {
    if (!canCheckOut) {
      toast.error('Please complete all check-out requirements')
      return
    }
    onComplete(reservation.id)
  }

  const nights = differenceInDays(new Date(reservation.checkOut), new Date(reservation.checkIn))
  const balanceDue = reservation.totalAmount - reservation.depositAmount
  const finalAmount = balanceDue + additionalCharges

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SignOut size={24} weight="bold" className="text-primary" />
            Check-Out Guest
          </DialogTitle>
          <DialogDescription>
            Complete check-out process for {reservation.guest.firstName} {reservation.guest.lastName}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <Info size={20} weight="bold" className="text-blue-600 dark:text-blue-400 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">Stay Summary</h4>
                  <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <div>Guest: {reservation.guest.firstName} {reservation.guest.lastName}</div>
                    <div>Room: {reservation.roomNumber || 'N/A'}</div>
                    <div>Check-in: {format(new Date(reservation.checkIn), 'PPP')}</div>
                    <div>Check-out: {format(new Date(reservation.checkOut), 'PPP')}</div>
                    <div>Total Stay: {nights} night{nights > 1 ? 's' : ''}</div>
                  </div>
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <h4 className="font-semibold">Check-Out Requirements</h4>
              
              <div className="flex items-start gap-3">
                <Checkbox
                  id="room-inspected"
                  checked={roomInspected}
                  onCheckedChange={(checked) => setRoomInspected(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="room-inspected"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <DoorOpen size={18} />
                    Room Inspected
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Visual inspection of room completed
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="key-returned"
                  checked={keyReturned}
                  onCheckedChange={(checked) => setKeyReturned(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="key-returned"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <Key size={18} />
                    Room Key Returned
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    All keys and access cards collected
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="damages-checked"
                  checked={damagesChecked}
                  onCheckedChange={(checked) => setDamagesChecked(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="damages-checked"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <Warning size={18} />
                    Damages Assessed
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Room checked for damages or missing items
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="minibar-checked"
                  checked={minibarChecked}
                  onCheckedChange={(checked) => setMinibarChecked(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="minibar-checked"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <CurrencyCircleDollar size={18} />
                    Minibar & Extras Checked
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Minibar consumption and extra services verified
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="payment-settled"
                  checked={paymentSettled}
                  onCheckedChange={(checked) => setPaymentSettled(checked as boolean)}
                />
                <div className="flex-1">
                  <label
                    htmlFor="payment-settled"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                  >
                    <Receipt size={18} />
                    Final Payment Settled
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    All outstanding charges paid and receipt issued
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <Label htmlFor="additional-charges">Additional Charges (฿)</Label>
              <Input
                id="additional-charges"
                type="number"
                min="0"
                value={additionalCharges}
                onChange={(e) => setAdditionalCharges(parseInt(e.target.value) || 0)}
                className="mt-2"
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Extra charges for minibar, damages, late checkout, etc.
              </p>
            </div>

            <Card className="p-4 bg-muted">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Receipt size={18} />
                Final Bill
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Room Charges:</span>
                  <span className="font-medium">฿{reservation.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit Paid:</span>
                  <span className="font-medium text-green-600">-฿{reservation.depositAmount.toLocaleString()}</span>
                </div>
                {additionalCharges > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Additional Charges:</span>
                    <span className="font-medium">฿{additionalCharges.toLocaleString()}</span>
                  </div>
                )}
                <Separator className="my-2" />
                <div className="flex justify-between text-base font-semibold">
                  <span>Amount Due:</span>
                  <span className={cn(
                    finalAmount > 0 ? 'text-destructive' : 'text-green-600'
                  )}>
                    ฿{finalAmount.toLocaleString()}
                  </span>
                </div>
              </div>
            </Card>

            <div>
              <Label htmlFor="checkout-notes">Check-Out Notes (Optional)</Label>
              <Textarea
                id="checkout-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                rows={3}
                placeholder="Any notes about the check-out process..."
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCheckOut} disabled={!canCheckOut}>
            <SignOut size={16} className="mr-2" weight="bold" />
            Complete Check-Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
