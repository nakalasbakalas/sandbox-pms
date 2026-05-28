import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { ArrivalItem, CheckInData, CheckOutData, DepartureItem, InHouseItem } from '@/types/front-desk'
import type { BoardRoomCard } from '@/types/board'
import type { PropertySetup } from '@/types/onboarding'
import { ArrivalList } from './ArrivalList'
import { DepartureList } from './DepartureList'
import { CheckInDialog } from './CheckInDialog'
import { CheckOutDialog } from './CheckOutDialog'
import { WalkInDialog, type WalkInPayload } from './WalkInDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyDisplay } from '@/components/ui/money-display'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/use-auth'
import { useNavigation } from '@/hooks/use-navigation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { createSandboxRooms, isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { getBangkokDateKey, nightsBetween } from '@/lib/hotel/business-rules'
import {
  amountDueForArrival,
  buildRoomReadinessSummary,
  toInHouseItem,
} from '@/lib/front-desk-workflow'
import { mapServerBoardRooms, pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { Calendar, House, MagnifyingGlass, Plus, SignOut, Users } from '@phosphor-icons/react'
import { toast } from 'sonner'

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

type ServerBoard = {
  property?: { defaultCheckIn?: string; defaultCheckOut?: string }
  rooms?: any[]
  reservations?: any[]
}

function isOccupied(room: BoardRoomCard) {
  return room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY' || room.status === 'OCCUPIED'
}

function isSameHotelDate(value: Date | string | undefined, hotelDateKey: string) {
  return Boolean(value) && getBangkokDateKey(value as Date | string) === hotelDateKey
}

function guestName(reservation: any) {
  return `${reservation?.guest?.firstName || ''} ${reservation?.guest?.lastName || ''}`.trim() || 'Guest name required'
}

function paymentStatus(balance: number, paid = 0): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (balance <= 0) return 'PAID'
  return paid > 0 ? 'PARTIAL' : 'UNPAID'
}

function roomCleanLabel(room: any): 'CLEAN' | 'DIRTY' | 'INSPECTED' {
  if (room?.currentStatus === 'INSPECTED') return 'INSPECTED'
  if (room?.currentStatus === 'VACANT_DIRTY' || room?.currentStatus === 'OCCUPIED_DIRTY' || room?.currentStatus === 'CLEANING') return 'DIRTY'
  return 'CLEAN'
}

function roomToArrival(room: BoardRoomCard): ArrivalItem {
  const roomReady = isRoomReadyForArrival(room)
  const balanceDue = Math.max(0, room.balanceDue ?? room.reservation?.balanceDue ?? 0)
  return {
    id: room.reservationId || room.currentReservationId || room.roomId,
    reservationId: room.reservationId || room.currentReservationId || room.roomId,
    confirmationCode: room.reservation?.id,
    guestName: room.guestName || 'Guest name required',
    roomNumber: room.number,
    assignedRoomId: room.roomId,
    roomType: room.type,
    checkInTime: '14:00',
    checkInDate: room.checkIn,
    checkOutDate: room.checkOut,
    nights: room.checkIn && room.checkOut ? nightsBetween(room.checkIn, room.checkOut) : 1,
    adults: Math.max(1, room.guestCount || 1),
    children: Math.max(0, (room.guestCount || 1) - 1),
    status: isOccupied(room) ? 'CHECKED_IN' : roomReady ? 'READY' : 'DUE_IN',
    reservationStatus: isOccupied(room) ? 'CHECKED_IN' : 'CONFIRMED',
    roomReady,
    depositPaid: room.depositStatus === 'PAID',
    documentVerified: Boolean(room.reservation?.id),
    source: 'Direct',
    bookedRate: room.reservation?.totalAmount || 0,
    totalAmount: room.reservation?.totalAmount || balanceDue,
    paidAmount: Math.max(0, (room.reservation?.totalAmount || balanceDue) - balanceDue),
    balanceDue,
    paymentStatus: paymentStatus(balanceDue),
    roomStatus: room.status,
    operationalStatus: room.operationalStatus,
  }
}

function unassignedToArrival(reservation: UnassignedReservation): ArrivalItem {
  return {
    id: reservation.id,
    reservationId: reservation.id,
    guestName: reservation.guestName,
    roomType: reservation.roomType,
    checkInTime: '14:00',
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    nights: reservation.nights || nightsBetween(reservation.checkIn, reservation.checkOut),
    adults: Math.max(1, reservation.guestCount || 1),
    children: Math.max(0, (reservation.guestCount || 1) - 1),
    status: 'DUE_IN',
    reservationStatus: 'CONFIRMED',
    roomReady: false,
    depositPaid: false,
    documentVerified: false,
    source: reservation.source || 'Direct',
    bookedRate: 0,
    totalAmount: 0,
    balanceDue: 0,
    paymentStatus: 'PAID',
  }
}

function serverReservationToArrival(reservation: any, rooms: BoardRoomCard[]): ArrivalItem {
  const mappedRoom = reservation.assignedRoomId ? rooms.find((room) => room.roomId === reservation.assignedRoomId) : undefined
  const balanceDue = Math.max(0, reservation.folio?.balance || 0)
  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    guestName: guestName(reservation),
    roomNumber: reservation.assignedRoom?.number,
    assignedRoomId: reservation.assignedRoomId,
    roomType: reservation.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
    checkInTime: '14:00',
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    nights: nightsBetween(reservation.checkIn, reservation.checkOut),
    adults: reservation.adults || 1,
    children: reservation.children || 0,
    status: reservation.status === 'CHECKED_IN' ? 'CHECKED_IN' : mappedRoom && isRoomReadyForArrival(mappedRoom) ? 'READY' : 'DUE_IN',
    reservationStatus: reservation.status,
    roomReady: Boolean(mappedRoom && isRoomReadyForArrival(mappedRoom)),
    depositPaid: Boolean(reservation.depositPaid),
    documentVerified: Boolean(reservation.guest?.nationality && reservation.guest?.idNumber),
    guestNationality: reservation.guest?.nationality || undefined,
    guestIdNumber: reservation.guest?.idNumber || undefined,
    phone: reservation.guest?.phone || undefined,
    email: reservation.guest?.email || undefined,
    specialRequests: reservation.specialRequests || undefined,
    notes: reservation.notes || undefined,
    source: reservation.source || 'DIRECT',
    bookedRate: reservation.ratePerNight || 0,
    totalAmount: reservation.totalAmount || reservation.folio?.total || 0,
    paidAmount: reservation.folio?.paid || 0,
    balanceDue,
    depositAmount: reservation.depositAmount || 0,
    paymentStatus: paymentStatus(balanceDue, reservation.folio?.paid || 0),
    roomStatus: reservation.assignedRoom?.currentStatus,
    operationalStatus: reservation.assignedRoom?.operationalStatus,
  }
}

function serverReservationToDeparture(reservation: any): DepartureItem {
  const balanceDue = Math.max(0, reservation.folio?.balance || 0)
  const paid = reservation.folio?.paid || 0
  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    guestName: guestName(reservation),
    roomNumber: reservation.assignedRoom?.number || 'TBD',
    assignedRoomId: reservation.assignedRoomId,
    roomType: reservation.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
    checkOutTime: '11:00',
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    actualCheckIn: reservation.actualCheckIn,
    nights: nightsBetween(reservation.checkIn, reservation.checkOut),
    nightsRemaining: 0,
    status: 'IN_HOUSE',
    reservationStatus: reservation.status,
    balanceDue,
    paidAmount: paid,
    folioTotal: reservation.folio?.total || reservation.totalAmount || 0,
    folioStatus: reservation.folio?.status || 'OPEN',
    paymentStatus: paymentStatus(balanceDue, paid),
    roomStatus: roomCleanLabel(reservation.assignedRoom),
    specialRequests: reservation.specialRequests || undefined,
    notes: reservation.notes || undefined,
  }
}

function inHouseToDeparture(item: InHouseItem): DepartureItem {
  return {
    id: item.id,
    reservationId: item.reservationId,
    confirmationCode: item.confirmationCode,
    guestName: item.guestName,
    roomNumber: item.roomNumber,
    assignedRoomId: item.assignedRoomId,
    roomType: item.roomType,
    checkOutTime: '11:00',
    checkInDate: item.checkInDate,
    checkOutDate: item.checkOutDate,
    nights: item.nights,
    nightsRemaining: item.nightsRemaining,
    status: 'IN_HOUSE',
    reservationStatus: 'CHECKED_IN',
    balanceDue: item.balanceDue,
    folioTotal: item.folioTotal || item.balanceDue,
    folioStatus: item.folioStatus,
    paymentStatus: item.paymentStatus,
    roomStatus: item.roomStatus,
  }
}

export function FrontDeskView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArrival, setSelectedArrival] = useState<ArrivalItem | null>(null)
  const [selectedDeparture, setSelectedDeparture] = useState<DepartureItem | null>(null)
  const [checkInMode, setCheckInMode] = useState<'express' | 'guided'>('guided')
  const [checkOutMode, setCheckOutMode] = useState<'express' | 'guided'>('guided')
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false)
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [serverBoard, setServerBoard] = useState<ServerBoard | null>(null)
  const [unassignedReservations, setUnassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  const { user } = useAuth()
  const { navigate } = useNavigation()
  const { rooms, initializeRooms, setRooms, getRoomById, updateRoomStatus } = useRoomSync()

  useEffect(() => {
    if (rooms.length === 0) initializeRooms(createSandboxRooms())
  }, [initializeRooms, rooms.length])

  const refreshServerBoard = async () => {
    if (!SERVER_API_ENABLED || !authToken) return
    const board = await pmsApi<{ ok: true; data: ServerBoard }>('/api/front-desk/board', authToken)
    setServerBoard(board.data)
    setRooms(mapServerBoardRooms(board.data))
  }

  useEffect(() => {
    void refreshServerBoard().catch(() => undefined)
  }, [authToken])

  const todayKey = getBangkokDateKey(new Date())

  const arrivals = useMemo(() => {
    if (SERVER_API_ENABLED && serverBoard?.reservations) {
      return serverBoard.reservations
        .filter((reservation) => ['PENDING', 'CONFIRMED', 'HOLD'].includes(reservation.status))
        .filter((reservation) => isSameHotelDate(reservation.checkIn, todayKey))
        .map((reservation) => serverReservationToArrival(reservation, rooms))
    }

    const roomArrivals = rooms
      .filter((room) => room.guestName && !isOccupied(room) && isSameHotelDate(room.checkIn, todayKey))
      .map(roomToArrival)
    const unassignedArrivals = (unassignedReservations || [])
      .filter((reservation) => isSameHotelDate(reservation.checkIn, todayKey))
      .map(unassignedToArrival)
    return [...roomArrivals, ...unassignedArrivals]
  }, [rooms, serverBoard, todayKey, unassignedReservations])

  const departures = useMemo(() => {
    if (SERVER_API_ENABLED && serverBoard?.reservations) {
      return serverBoard.reservations
        .filter((reservation) => reservation.status === 'CHECKED_IN')
        .filter((reservation) => isSameHotelDate(reservation.checkOut, todayKey))
        .map(serverReservationToDeparture)
    }

    return rooms
      .filter((room) => room.guestName && isOccupied(room) && isSameHotelDate(room.checkOut, todayKey))
      .map((room) => toInHouseItem(room, todayKey))
      .filter(Boolean)
      .map((item) => inHouseToDeparture(item as InHouseItem))
  }, [rooms, serverBoard, todayKey])

  const inHouse = useMemo(() => {
    if (SERVER_API_ENABLED && serverBoard?.reservations) {
      return serverBoard.reservations
        .filter((reservation) => reservation.status === 'CHECKED_IN')
        .map((reservation) => {
          const departure = serverReservationToDeparture(reservation)
          return {
            id: departure.id,
            reservationId: departure.reservationId,
            confirmationCode: departure.confirmationCode,
            guestName: departure.guestName,
            roomNumber: departure.roomNumber,
            assignedRoomId: departure.assignedRoomId,
            roomType: departure.roomType,
            checkInDate: departure.checkInDate,
            checkOutDate: departure.checkOutDate,
            nights: departure.nights,
            nightsRemaining: departure.checkOutDate ? nightsBetween(todayKey, departure.checkOutDate) : 0,
            balanceDue: departure.balanceDue,
            folioTotal: departure.folioTotal,
            folioStatus: departure.folioStatus,
            paymentStatus: departure.paymentStatus,
            roomStatus: departure.roomStatus,
            serviceFlags: departure.balanceDue > 0 ? ['Balance due'] : [],
            mainAction: departure.balanceDue > 0 ? 'SETTLE_BALANCE' : 'CHECK_OUT',
          } satisfies InHouseItem
        })
    }
    return rooms.map((room) => toInHouseItem(room, todayKey)).filter(Boolean) as InHouseItem[]
  }, [rooms, serverBoard, todayKey])

  const filteredArrivals = useMemo(() => filterByQuery(arrivals, searchQuery), [arrivals, searchQuery])
  const filteredDepartures = useMemo(() => filterByQuery(departures, searchQuery), [departures, searchQuery])
  const filteredInHouse = useMemo(() => filterByQuery(inHouse, searchQuery), [inHouse, searchQuery])
  const readiness = useMemo(() => buildRoomReadinessSummary(rooms), [rooms])

  const openCheckIn = (arrival: ArrivalItem, mode: 'express' | 'guided') => {
    setSelectedArrival(arrival)
    setCheckInMode(mode)
    setCheckInDialogOpen(true)
  }

  const openCheckOut = (departure: DepartureItem, mode: 'express' | 'guided') => {
    setSelectedDeparture(departure)
    setCheckOutMode(mode)
    setCheckOutDialogOpen(true)
  }

  const markRoomReady = async (roomId: string) => {
    if (SERVER_API_ENABLED && authToken) {
      try {
        await pmsApi(`/api/housekeeping/rooms/${roomId}/status`, authToken, {
          method: 'POST',
          body: JSON.stringify({ status: 'INSPECTED', notes: 'Front desk quick action: room ready for arrival' }),
        })
        await refreshServerBoard()
        toast.success('Room marked clean/inspected.')
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Room readiness update failed.')
        return
      }
    }
    updateRoomStatus({ roomId, cleanStatus: 'INSPECTED', cleanedBy: user?.displayName || 'Front desk' })
    toast.success('Room marked clean/inspected.')
  }

  const confirmCheckIn = async (data: CheckInData) => {
    if (!selectedArrival) return
    const assignedRoom = getRoomById(data.roomId)
    if (!assignedRoom) {
      toast.error('Assign a valid room before check-in.')
      return
    }

    if (SERVER_API_ENABLED && authToken) {
      try {
        if (selectedArrival.assignedRoomId !== data.roomId) {
          await pmsApi(`/api/reservations/${selectedArrival.reservationId}/assign-room`, authToken, {
            method: 'POST',
            body: JSON.stringify({ roomId: data.roomId }),
          })
        }
        const payload = await pmsApi<{ ok: true; message?: string }>(`/api/reservations/${selectedArrival.reservationId}/check-in`, authToken, {
          method: 'POST',
          body: JSON.stringify({
            guest: {
              nationality: data.nationality,
              idType: data.idNumber ? 'PASSPORT' : undefined,
              idNumber: data.idNumber,
            },
            payment: data.payment ? {
              amount: data.payment.amount,
              method: data.payment.method,
              reference: data.payment.reference,
              notes: data.additionalNotes,
            } : undefined,
            recordIdentityLater: data.recordIdentityLater,
            recordIdentityLaterReason: data.overrideReason,
            allowPayLater: Boolean(data.payLaterReason),
            payLaterReason: data.payLaterReason,
            allowRoomReadinessOverride: data.allowRoomReadinessOverride,
            allowDateOverride: data.allowDateOverride,
            overrideReason: data.overrideReason,
            additionalNotes: data.additionalNotes,
          }),
        })
        await refreshServerBoard()
        toast.success(payload.message || `Checked in: ${selectedArrival.guestName} -> Room ${assignedRoom.number}`)
        setCheckInDialogOpen(false)
        setSelectedArrival(null)
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-in failed.')
        return
      }
    }

    const due = amountDueForArrival(selectedArrival)
    const paid = data.payment?.amount || 0
    setRooms((current) => current.map((room) => room.roomId === assignedRoom.roomId
      ? {
          ...room,
          status: 'OCCUPIED_CLEAN',
          cleanStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          housekeepingStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          reservationId: selectedArrival.reservationId,
          currentReservationId: selectedArrival.reservationId,
          guestName: selectedArrival.guestName,
          checkIn: selectedArrival.checkInDate ? new Date(selectedArrival.checkInDate) : new Date(),
          checkOut: selectedArrival.checkOutDate ? new Date(selectedArrival.checkOutDate) : new Date(Date.now() + Math.max(1, selectedArrival.nights) * 86_400_000),
          guestCount: selectedArrival.adults + selectedArrival.children,
          balanceDue: Math.max(0, due - paid),
          depositStatus: due - paid <= 0 ? 'PAID' : 'PENDING',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Front desk',
        }
      : room))
    setUnassignedReservations((current) => (current || []).filter((reservation) => reservation.id !== selectedArrival.reservationId))
    toast.success(`Checked in: ${selectedArrival.guestName} -> Room ${assignedRoom.number}`)
    setCheckInDialogOpen(false)
    setSelectedArrival(null)
  }

  const confirmCheckOut = async (data: CheckOutData) => {
    if (!selectedDeparture) return

    if (SERVER_API_ENABLED && authToken) {
      try {
        const payload = await pmsApi<{ ok: true; message?: string }>(`/api/reservations/${selectedDeparture.reservationId}/check-out`, authToken, {
          method: 'POST',
          body: JSON.stringify({
            payment: data.paymentAmount ? {
              amount: data.paymentAmount,
              method: data.paymentMethod,
              reference: data.paymentReference,
              notes: data.additionalNotes,
            } : undefined,
            allowUnpaidOverride: data.forceCheckout,
            overrideReason: data.overrideReason,
            additionalNotes: data.additionalNotes,
          }),
        })
        await refreshServerBoard()
        toast.success(payload.message || `Checked out: ${selectedDeparture.guestName} -> Room ${selectedDeparture.roomNumber} marked for cleaning`)
        setCheckOutDialogOpen(false)
        setSelectedDeparture(null)
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-out failed.')
        return
      }
    }

    const room = rooms.find((candidate) => candidate.number === selectedDeparture.roomNumber)
    if (!room) {
      toast.error(`Room ${selectedDeparture.roomNumber} was not found.`)
      return
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
          balanceDue: undefined,
          depositStatus: 'NONE',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Front desk',
        }
      : currentRoom))
    toast.success(`Checked out: ${selectedDeparture.guestName} -> Room ${selectedDeparture.roomNumber} marked for cleaning`)
    setCheckOutDialogOpen(false)
    setSelectedDeparture(null)
  }

  const confirmWalkIn = async (payload: WalkInPayload) => {
    if (SERVER_API_ENABLED && authToken) {
      try {
        const response = await pmsApi<{ ok: true; message?: string; data?: any }>('/api/front-desk/walk-in', authToken, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        await refreshServerBoard()
        toast.success(response.message || `Walk-in checked in: ${payload.guest.firstName} ${payload.guest.lastName}`)
        setWalkInOpen(false)
        return
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Walk-in check-in failed.')
        return
      }
    }

    const room = getRoomById(payload.assignedRoomId || '')
    if (!room) {
      toast.error('Assign a valid room before walk-in check-in.')
      return
    }
    const reservationId = `walk-in-${Date.now()}`
    const guest = `${payload.guest.firstName} ${payload.guest.lastName}`.trim()
    const totalPaid = payload.payment?.amount || 0
    const total = payload.ratePerNight * Math.max(1, nightsBetween(payload.checkIn, payload.checkOut))
    setRooms((current) => current.map((currentRoom) => currentRoom.roomId === room.roomId
      ? {
          ...currentRoom,
          status: 'OCCUPIED_CLEAN',
          cleanStatus: currentRoom.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          housekeepingStatus: currentRoom.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          reservationId,
          currentReservationId: reservationId,
          guestName: guest,
          checkIn: new Date(payload.checkIn),
          checkOut: new Date(payload.checkOut),
          guestCount: payload.adults + payload.children,
          balanceDue: Math.max(0, total - totalPaid),
          depositStatus: total - totalPaid <= 0 ? 'PAID' : 'PENDING',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Front desk',
        }
      : currentRoom))
    toast.success(`Checked in walk-in: ${guest} -> Room ${room.number}`)
    setWalkInOpen(false)
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-blue-700">
              <Calendar size={15} weight="bold" />
              Front Desk Today - {todayKey}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Arrivals, stays, departures</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-80">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} weight="bold" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search guest, room, code..."
                className="pl-9"
              />
            </div>
            <Button onClick={() => setWalkInOpen(true)} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
              <Plus size={16} weight="bold" />
              Walk-In
            </Button>
            <Button variant="outline" onClick={() => navigate('board')} className="gap-1.5">
              <House size={16} weight="bold" />
              Board
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1700px] space-y-4 px-4 py-4 lg:px-6">
        <RoomReadinessStrip readiness={readiness} totalRooms={rooms.length} />

        <div className="grid gap-4 xl:grid-cols-[1fr_0.95fr]">
          <section className="space-y-2">
            <SectionHeader title="Arrivals Today" count={filteredArrivals.length} />
            <ArrivalList
              arrivals={filteredArrivals}
              rooms={rooms}
              hotelDateKey={todayKey}
              role={user?.role}
              onCheckIn={openCheckIn}
            />
          </section>

          <section className="space-y-2">
            <SectionHeader title="Departures Today" count={filteredDepartures.length} />
            <DepartureList
              departures={filteredDepartures}
              hotelDateKey={todayKey}
              role={user?.role}
              onCheckOut={openCheckOut}
            />
          </section>
        </div>

        <section className="space-y-2">
          <SectionHeader title="In-House" count={filteredInHouse.length} />
          <InHouseList stays={filteredInHouse} onCheckOut={(item) => openCheckOut(inHouseToDeparture(item), item.balanceDue > 0 ? 'guided' : 'express')} />
        </section>
      </main>

      <CheckInDialog
        arrival={selectedArrival}
        rooms={rooms}
        mode={checkInMode}
        role={user?.role}
        open={checkInDialogOpen}
        onOpenChange={setCheckInDialogOpen}
        onConfirm={confirmCheckIn}
        onMarkRoomReady={markRoomReady}
      />

      <CheckOutDialog
        departure={selectedDeparture}
        mode={checkOutMode}
        role={user?.role}
        open={checkOutDialogOpen}
        onOpenChange={setCheckOutDialogOpen}
        onConfirm={confirmCheckOut}
      />

      <WalkInDialog
        open={walkInOpen}
        rooms={rooms}
        role={user?.role}
        onOpenChange={setWalkInOpen}
        onConfirm={confirmWalkIn}
      />
    </div>
  )
}

function filterByQuery<T extends { guestName: string; roomNumber?: string; reservationId: string; confirmationCode?: string }>(items: T[], query: string) {
  if (!query.trim()) return items
  const lowered = query.toLowerCase()
  return items.filter((item) =>
    item.guestName.toLowerCase().includes(lowered) ||
    item.roomNumber?.toLowerCase().includes(lowered) ||
    item.reservationId.toLowerCase().includes(lowered) ||
    item.confirmationCode?.toLowerCase().includes(lowered)
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold">{title}</h2>
      <Badge variant="outline">{count}</Badge>
    </div>
  )
}

function RoomReadinessStrip({ readiness, totalRooms }: { readiness: ReturnType<typeof buildRoomReadinessSummary>; totalRooms: number }) {
  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <ReadinessTile label="Clean/inspected" value={readiness.cleanInspected} tone="ok" />
      <ReadinessTile label="Dirty" value={readiness.dirty} tone="warning" />
      <ReadinessTile label="Occupied" value={readiness.occupied} />
      <ReadinessTile label="Out of order" value={readiness.outOfOrder} tone="danger" />
      <ReadinessTile label="Twin available" value={readiness.availableByType.TWIN} tone="ok" />
      <ReadinessTile label="Double available" value={readiness.availableByType.DOUBLE} tone="ok" detail={`${totalRooms} rooms tracked`} />
    </section>
  )
}

function ReadinessTile({ label, value, tone, detail }: { label: string; value: number; tone?: 'ok' | 'warning' | 'danger'; detail?: string }) {
  const toneClass = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'danger'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-slate-200 bg-white text-slate-800'
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] font-medium uppercase text-current/65">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="text-[11px] text-current/60">{detail}</div>}
    </div>
  )
}

function InHouseList({ stays, onCheckOut }: { stays: InHouseItem[]; onCheckOut: (item: InHouseItem) => void }) {
  if (stays.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
        <Users className="mx-auto mb-2" size={30} weight="duotone" />
        No in-house guests
      </div>
    )
  }

  return (
    <div className="divide-y rounded-lg border bg-white">
      {stays.map((stay) => (
        <div key={stay.id} className="grid gap-3 p-3 md:grid-cols-[1.3fr_1fr_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate font-semibold">{stay.guestName}</div>
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">Room {stay.roomNumber}</Badge>
              {stay.serviceFlags.map((flag) => <Badge key={flag} variant="outline" className="h-5 border-amber-300 text-amber-800">{flag}</Badge>)}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{stay.roomType}</span>
              <span>{stay.nightsRemaining} night{stay.nightsRemaining === 1 ? '' : 's'} remaining</span>
              <span>{stay.folioStatus || 'OPEN'} folio</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <MiniStatus label="Balance" value={stay.balanceDue > 0 ? `THB ${stay.balanceDue.toLocaleString('en-US')}` : 'THB 0'} ok={stay.balanceDue <= 0} />
            <MiniStatus label="Payment" value={stay.paymentStatus} ok={stay.balanceDue <= 0} />
            <MiniStatus label="Room" value={stay.roomStatus} ok />
          </div>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground">Folio</div>
              <MoneyDisplay amount={stay.folioTotal || stay.balanceDue} className="font-semibold" />
            </div>
            <Button
              size="sm"
              onClick={() => onCheckOut(stay)}
              className={stay.balanceDue > 0 ? 'min-w-[136px] gap-1.5 bg-rose-600 hover:bg-rose-700' : 'min-w-[136px] gap-1.5 bg-emerald-600 hover:bg-emerald-700'}
            >
              <SignOut size={15} weight="bold" />
              {stay.balanceDue > 0 ? 'Settle Balance' : 'Express Check-Out'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function MiniStatus({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={ok ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800' : 'rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800'}>
      <div className="text-[10px] uppercase text-current/60">{label}</div>
      <div className="truncate font-semibold">{value}</div>
    </div>
  )
}
