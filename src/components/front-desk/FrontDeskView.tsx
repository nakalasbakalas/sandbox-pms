import { useEffect, useMemo, useState } from 'react'
import type { ArrivalItem, DepartureItem, CheckInData, CheckOutData } from '@/types/front-desk'
import type { ReceiptData } from '@/types/receipt'
import type { PropertySetup } from '@/types/onboarding'
import type { BoardRoomCard } from '@/types/board'
import { useKV } from '@github/spark/hooks'
import { FrontDeskStatsBar } from './FrontDeskStatsBar'
import { ArrivalList } from './ArrivalList'
import { DepartureList } from './DepartureList'
import { CheckInDialog } from './CheckInDialog'
import { CheckOutDialog } from './CheckOutDialog'
import { ReceiptDialog } from './ReceiptDialog'
import { calculateFrontDeskStats } from '@/lib/front-desk-data'
import { generateReceiptFromCheckOut } from '@/lib/receipt-generator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SignIn, SignOut, MagnifyingGlass, Calendar, Command as CommandIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { createPMSCommands } from '@/lib/pms-commands'
import { useNavigation } from '@/hooks/use-navigation'
import { CommandPalette } from '@/components/CommandPalette'
import { useRoomSync } from '@/hooks/use-room-sync'
import { createSandboxRooms, isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { getBangkokDateKey, getRoomAssignmentDecision, nightsBetween } from '@/lib/hotel/business-rules'
import { mapServerBoardRooms, pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'

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

function isOccupied(room: BoardRoomCard) {
  return room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
}

function isSameHotelDate(value: Date | string | undefined, hotelDateKey: string) {
  return Boolean(value) && getBangkokDateKey(value as Date | string) === hotelDateKey
}

function roomToArrival(room: BoardRoomCard): ArrivalItem {
  const roomReady = isRoomReadyForArrival(room)
  const checkedIn = isOccupied(room)

  return {
    id: room.roomId,
    reservationId: room.reservationId || room.currentReservationId || `room-${room.number}`,
    guestName: room.guestName || 'Guest name required',
    roomNumber: room.number,
    roomType: room.type,
    checkInTime: '14:00',
    nights: room.checkIn && room.checkOut ? nightsBetween(room.checkIn, room.checkOut) : 1,
    adults: Math.max(1, room.guestCount || 1),
    children: 0,
    status: checkedIn ? 'CHECKED_IN' : roomReady ? 'READY' : 'DUE_IN',
    roomReady,
    depositPaid: room.depositStatus === 'PAID',
    documentVerified: false,
    source: 'Direct',
    bookedRate: 0,
    totalAmount: room.balanceDue || 0,
  }
}

function roomToDeparture(room: BoardRoomCard): DepartureItem {
  const balanceDue = room.balanceDue || 0

  return {
    id: room.roomId,
    reservationId: room.reservationId || room.currentReservationId || `room-${room.number}`,
    guestName: room.guestName || 'Guest name required',
    roomNumber: room.number,
    roomType: room.type,
    checkOutTime: '11:00',
    nights: room.checkIn && room.checkOut ? nightsBetween(room.checkIn, room.checkOut) : 1,
    status: 'IN_HOUSE',
    balanceDue,
    folioTotal: balanceDue,
    paymentStatus: balanceDue > 0 ? 'UNPAID' : 'PAID',
    roomStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : room.cleanStatus === 'CLEAN' ? 'CLEAN' : 'DIRTY',
  }
}

function unassignedToArrival(reservation: UnassignedReservation): ArrivalItem {
  return {
    id: reservation.id,
    reservationId: reservation.id,
    guestName: reservation.guestName,
    roomType: reservation.roomType,
    checkInTime: '14:00',
    nights: reservation.nights || nightsBetween(reservation.checkIn, reservation.checkOut),
    adults: Math.max(1, reservation.guestCount || 1),
    children: Math.max(0, (reservation.guestCount || 1) - 1),
    status: 'DUE_IN',
    roomReady: false,
    depositPaid: false,
    documentVerified: false,
    source: reservation.source || 'Direct',
    bookedRate: 0,
    totalAmount: 0,
  }
}

export function FrontDeskView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArrival, setSelectedArrival] = useState<ArrivalItem | null>(null)
  const [selectedDeparture, setDepartureItem] = useState<DepartureItem | null>(null)
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false)
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [currentReceipt, setCurrentReceipt] = useState<ReceiptData | null>(null)
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [unassignedReservations, setUnassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  
  const { navigate } = useNavigation()
  const commands = useMemo(() => createPMSCommands(navigate), [navigate])
  const commandPalette = useCommandPalette(commands)
  const { rooms, initializeRooms, setRooms, getRoomById, getRoomByNumber } = useRoomSync()

  useEffect(() => {
    if (rooms.length === 0) {
      initializeRooms(createSandboxRooms())
    }
  }, [initializeRooms, rooms.length])

  const todayKey = getBangkokDateKey(new Date())

  const arrivals = useMemo(() => {
    const roomArrivals = rooms
      .filter((room) => room.guestName && isSameHotelDate(room.checkIn, todayKey))
      .map(roomToArrival)
    const unassignedArrivals = (unassignedReservations || [])
      .filter((reservation) => isSameHotelDate(reservation.checkIn, todayKey))
      .map(unassignedToArrival)

    return [...roomArrivals, ...unassignedArrivals]
  }, [rooms, todayKey, unassignedReservations])

  const departures = useMemo(() => rooms
    .filter((room) => room.guestName && isSameHotelDate(room.checkOut, todayKey))
    .map(roomToDeparture),
    [rooms, todayKey],
  )

  const availableRoomsForSelectedArrival = useMemo(() => {
    if (!selectedArrival) return []

    return rooms
      .filter((room) => {
        const decision = getRoomAssignmentDecision(room, {
          checkIn: new Date(),
          checkOut: new Date(Date.now() + 24 * 60 * 60 * 1000),
          excludeReservationId: selectedArrival.reservationId,
        })
        return decision.assignable &&
          room.type === selectedArrival.roomType &&
          !room.guestName &&
          isRoomReadyForArrival(room)
      })
      .map((room) => ({ id: room.roomId, number: room.number }))
  }, [rooms, selectedArrival])

  const stats = useMemo(() => calculateFrontDeskStats(arrivals, departures), [arrivals, departures])

  const filteredArrivals = useMemo(() => {
    if (!searchQuery) return arrivals
    
    const query = searchQuery.toLowerCase()
    return arrivals.filter(arrival => 
      arrival.guestName.toLowerCase().includes(query) ||
      arrival.roomNumber?.includes(query) ||
      arrival.reservationId.toLowerCase().includes(query)
    )
  }, [arrivals, searchQuery])

  const filteredDepartures = useMemo(() => {
    if (!searchQuery) return departures
    
    const query = searchQuery.toLowerCase()
    return departures.filter(departure => 
      departure.guestName.toLowerCase().includes(query) ||
      departure.roomNumber.includes(query) ||
      departure.reservationId.toLowerCase().includes(query)
    )
  }, [departures, searchQuery])

  const handleCheckIn = (arrival: ArrivalItem) => {
    setSelectedArrival(arrival)
    setCheckInDialogOpen(true)
  }

  const handleCheckOut = (departure: DepartureItem) => {
    setDepartureItem(departure)
    setCheckOutDialogOpen(true)
  }

  const handleViewArrivalDetails = (arrival: ArrivalItem) => {
    setSelectedArrival(arrival)
    setDetailsDialogOpen(true)
  }

  const handleViewDepartureDetails = (departure: DepartureItem) => {
    setDepartureItem(departure)
    setDetailsDialogOpen(true)
  }

  const refreshServerBoard = async () => {
    if (!SERVER_API_ENABLED || !authToken) return
    const board = await pmsApi<{ ok: true; data: unknown }>('/api/front-desk/board', authToken)
    setRooms(mapServerBoardRooms(board.data))
  }

  const confirmCheckIn = async (data: CheckInData) => {
    if (!selectedArrival) return

    const assignedRoom = selectedArrival.roomNumber
      ? getRoomByNumber(selectedArrival.roomNumber)
      : getRoomById(data.roomId)

    if (!assignedRoom) {
      toast.error('Assign a valid room before checking in this reservation.')
      return
    }

    if (!isRoomReadyForArrival(assignedRoom)) {
      toast.error(`Room ${assignedRoom.number} must be clean or inspected before check-in.`)
      return
    }

    if (SERVER_API_ENABLED && authToken) {
      try {
        if (!selectedArrival.roomNumber) {
          await pmsApi(`/api/reservations/${selectedArrival.reservationId}/assign-room`, authToken, {
            method: 'POST',
            body: JSON.stringify({ roomId: assignedRoom.roomId }),
          })
        }
        const payload = await pmsApi<{ ok: true; message?: string }>(`/api/reservations/${selectedArrival.reservationId}/check-in`, authToken, {
          method: 'POST',
        })
        await refreshServerBoard()
        toast.success(payload.message || `Check-in complete. Room ${assignedRoom.number} is now occupied.`)
        setCheckInDialogOpen(false)
        setSelectedArrival(null)
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-in failed.')
        return
      }
    }

    setRooms((current) => current.map((room) => room.roomId === assignedRoom.roomId
      ? {
          ...room,
          status: 'OCCUPIED_CLEAN',
          cleanStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          housekeepingStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          reservationId: selectedArrival.reservationId,
          currentReservationId: selectedArrival.reservationId,
          guestName: selectedArrival.guestName,
          checkIn: room.checkIn || new Date(),
          checkOut: room.checkOut || new Date(Date.now() + Math.max(1, selectedArrival.nights) * 24 * 60 * 60 * 1000),
          guestCount: selectedArrival.adults + selectedArrival.children,
          isArrivalToday: true,
          isDepartureToday: false,
          balanceDue: selectedArrival.totalAmount,
          depositStatus: selectedArrival.depositPaid ? 'PAID' : 'PENDING',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: 'Front desk',
        }
      : room))

    setUnassignedReservations((current) => (current || []).filter((reservation) => reservation.id !== selectedArrival.reservationId))

    toast.success(`${selectedArrival.guestName} checked in successfully`, {
      description: `Room ${assignedRoom.number} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
    })

    setCheckInDialogOpen(false)
    setSelectedArrival(null)
  }

  const confirmCheckOut = async (data: CheckOutData) => {
    if (!selectedDeparture) return

    const room = getRoomByNumber(selectedDeparture.roomNumber)

    if (!room) {
      toast.error(`Room ${selectedDeparture.roomNumber} was not found.`)
      return
    }

    if (selectedDeparture.balanceDue > 0 && !data.balanceSettled) {
      toast.error(`Collect the remaining balance before checking out Room ${selectedDeparture.roomNumber}.`)
      return
    }

    if (SERVER_API_ENABLED && authToken) {
      try {
        const payload = await pmsApi<{ ok: true; message?: string }>(`/api/reservations/${selectedDeparture.reservationId}/check-out`, authToken, {
          method: 'POST',
          body: JSON.stringify({ allowUnpaidOverride: false }),
        })
        await refreshServerBoard()
        toast.success(payload.message || `Check-out complete. Room ${selectedDeparture.roomNumber} has been sent to housekeeping.`)
        setCheckOutDialogOpen(false)
        setDepartureItem(null)
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-out failed.')
        return
      }
    }

    setRooms((current) => current.map((currentRoom) => currentRoom.roomId === room.roomId
      ? {
          ...currentRoom,
          status: 'VACANT_DIRTY',
          cleanStatus: 'DIRTY',
          housekeepingStatus: 'DIRTY',
          reservationId: undefined,
          currentReservationId: undefined,
          guestName: undefined,
          checkIn: undefined,
          checkOut: undefined,
          guestCount: 0,
          isVIP: false,
          isArrivalToday: false,
          isDepartureToday: false,
          balanceDue: undefined,
          depositStatus: 'NONE',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: 'Front desk',
        }
      : currentRoom))

    const receipt = generateReceiptFromCheckOut(selectedDeparture, data, propertyData)
    setCurrentReceipt(receipt)

    toast.success(`${selectedDeparture.guestName} checked out successfully`, {
      description: `Room ${selectedDeparture.roomNumber} marked as dirty and ready for housekeeping`,
    })

    setCheckOutDialogOpen(false)
    setReceiptDialogOpen(true)
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="flex-none border-b bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Front Desk</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative w-80">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} weight="bold" />
              <Input
                placeholder="Search guests, rooms, reservations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate('board')}
              title="View Board"
            >
              <Calendar size={20} weight="bold" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={commandPalette.open}
              title="Open Command Palette (Ctrl+K)"
            >
              <CommandIcon size={20} weight="bold" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-none px-6 py-4 bg-white border-b">
        <FrontDeskStatsBar stats={stats} />
      </div>

      <div className="flex-1 overflow-hidden px-6 py-6">
        <Tabs defaultValue="arrivals" className="h-full flex flex-col">
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="arrivals" className="gap-2 px-6">
              <SignIn size={18} weight="bold" />
              Arrivals ({stats.arrivalsRemaining})
            </TabsTrigger>
            <TabsTrigger value="departures" className="gap-2 px-6">
              <SignOut size={18} weight="bold" />
              Departures ({stats.departuresRemaining})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="arrivals" className="flex-1 overflow-auto mt-0">
            <ArrivalList
              arrivals={filteredArrivals}
              onCheckIn={handleCheckIn}
              onViewDetails={handleViewArrivalDetails}
            />
          </TabsContent>

          <TabsContent value="departures" className="flex-1 overflow-auto mt-0">
            <DepartureList
              departures={filteredDepartures}
              onCheckOut={handleCheckOut}
              onViewDetails={handleViewDepartureDetails}
            />
          </TabsContent>
        </Tabs>
      </div>

      <CheckInDialog
        arrival={selectedArrival}
        open={checkInDialogOpen}
        onOpenChange={setCheckInDialogOpen}
        onConfirm={confirmCheckIn}
        availableRooms={availableRoomsForSelectedArrival}
      />

      <CheckOutDialog
        departure={selectedDeparture}
        open={checkOutDialogOpen}
        onOpenChange={setCheckOutDialogOpen}
        onConfirm={confirmCheckOut}
      />

      <ReceiptDialog
        receipt={currentReceipt}
        open={receiptDialogOpen}
        onOpenChange={(open) => {
          setReceiptDialogOpen(open)
          if (!open) {
            setCurrentReceipt(null)
            setDepartureItem(null)
          }
        }}
        type="RECEIPT"
      />

      <CommandPalette 
        open={commandPalette.isOpen}
        onOpenChange={(open) => open ? commandPalette.open() : commandPalette.close()}
        commands={commands}
      />
    </div>
  )
}
