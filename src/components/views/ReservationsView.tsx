import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowsClockwise,
  Calendar,
  CheckCircle,
  CreditCard,
  EnvelopeSimple,
  Eye,
  FunnelSimple,
  House,
  MagnifyingGlass,
  MapPin,
  Phone,
  Plus,
  Prohibit,
  Printer,
  Receipt,
  SignIn,
  SignOut,
  SquaresFour,
  User,
  Warning,
} from '@phosphor-icons/react'
import { format, isBefore, isToday, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { printReservationsList } from '@/lib/print-utils'
import { toast } from 'sonner'
import { NewReservationDialog, type NewReservationData } from '@/components/board/NewReservationDialog'
import { CheckInDialog } from '@/components/front-desk/CheckInDialog'
import { CheckOutDialog } from '@/components/front-desk/CheckOutDialog'
import { useRoomSync } from '@/hooks/use-room-sync'
import { useAuth } from '@/hooks/use-auth'
import { useBookingEmailInbox } from '@/hooks/use-booking-email-inbox'
import { useNavigation } from '@/hooks/use-navigation'
import { getBangkokDateKey, nightsBetween, reservationsOverlap } from '@/lib/hotel/business-rules'
import { isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { emailReservationDocument, printReservationDocument } from '@/lib/reservation-document-actions'
import type { BoardRoomCard } from '@/types/board'
import type { BookingEmailEvent } from '@/types/booking-email'
import type { ArrivalItem, CheckInData, CheckOutData, DepartureItem } from '@/types/front-desk'

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
  actualCheckIn?: Date | null
  actualCheckOut?: Date | null
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
  sourceEmailEventId?: string
  sourceEmailSubject?: string
  sourceEmailStatus?: string
  
  isVIP: boolean
  specialRequests?: string
  notes?: string
  
  createdAt: Date
  updatedAt: Date
  createdBy: string
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
  ratePerNight?: number
  totalAmount?: number
  depositAmount?: number
  balanceDue?: number
  paidAmount?: number
  phone?: string
  email?: string
  specialRequests?: string
  notes?: string
  sourceEmailEventId?: string
  sourceEmailSubject?: string
  sourceEmailStatus?: string
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

type ReservationTab = 'all' | 'arrivals' | 'departures' | 'upcoming' | 'in-house' | 'past'

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
    : reservation.source === 'Walk-in' || reservation.source === 'Front desk'
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
    guestEmail: reservation.email,
    guestPhone: reservation.phone,
    roomType: reservation.roomType,
    checkIn,
    checkOut,
    nights,
    adults: Math.max(1, reservation.guestCount || 1),
    children: Math.max(0, (reservation.guestCount || 1) - 1),
    ratePerNight: reservation.ratePerNight || 0,
    totalAmount: reservation.totalAmount || 0,
    depositAmount: reservation.depositAmount || 0,
    depositPaid: reservation.paidAmount || 0,
    depositStatus: (reservation.paidAmount || 0) > 0 ? 'PAID' : (reservation.depositAmount || 0) > 0 ? 'PENDING' : 'NONE',
    balanceDue: Math.max(0, reservation.balanceDue ?? reservation.totalAmount ?? 0),
    source,
    sourceEmailEventId: reservation.sourceEmailEventId,
    sourceEmailSubject: reservation.sourceEmailSubject,
    sourceEmailStatus: reservation.sourceEmailStatus,
    isVIP: reservation.isVIP || false,
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
    createdAt: checkIn,
    updatedAt: new Date(),
    createdBy: 'Front desk board',
  }
}

function toReservationRecord(reservation: NewReservationData): Reservation {
  const nights = Math.max(1, nightsBetween(reservation.checkIn, reservation.checkOut))
  const roomType = /twin/i.test(reservation.roomTypeName) ? 'TWIN' : 'DOUBLE'

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
  const roomType = /twin/i.test(reservation.roomTypeName) ? 'TWIN' : 'DOUBLE'

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
    sourceEmailEventId: record.sourceEmailEventId ?? record.sourceEmailEvent?.id ?? record.bookingEmailEventId ?? undefined,
    sourceEmailSubject: record.sourceEmailSubject ?? record.sourceEmailEvent?.subject ?? record.bookingEmailSubject ?? undefined,
    sourceEmailStatus: record.sourceEmailStatus ?? record.sourceEmailEvent?.status ?? undefined,
    isVIP: Boolean(record.guest?.vipStatus),
    specialRequests: record.specialRequests ?? undefined,
    notes: record.notes ?? undefined,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    createdBy: 'PMS API',
  }
}

function formatCurrency(amount: number | undefined) {
  return `THB ${(amount || 0).toLocaleString('en-US')}`
}

function formatReservationLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function cleanLabel(room?: BoardRoomCard): DepartureItem['roomStatus'] {
  if (room?.cleanStatus === 'INSPECTED') return 'INSPECTED'
  return room?.cleanStatus === 'DIRTY' || room?.cleanStatus === 'CLEANING' ? 'DIRTY' : 'CLEAN'
}

function paymentStatus(balanceDue: number, paidAmount = 0): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (balanceDue <= 0) return 'PAID'
  return paidAmount > 0 ? 'PARTIAL' : 'UNPAID'
}

const ACTIVE_ASSIGNMENT_STATUSES: Reservation['status'][] = ['PENDING', 'CONFIRMED', 'CHECKED_IN']

interface RoomAssignmentOption {
  room: BoardRoomCard
  assignable: boolean
  reason: string
  note?: string
  priority: number
}

function isRoomOccupied(room: BoardRoomCard) {
  return room.status === 'OCCUPIED' || room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
}

function findOverlappingReservation(reservation: Reservation, room: BoardRoomCard, reservations: Reservation[]) {
  return reservations.find((candidate) =>
    candidate.id !== reservation.id &&
    ACTIVE_ASSIGNMENT_STATUSES.includes(candidate.status) &&
    (candidate.roomId === room.roomId || candidate.roomNumber === room.number) &&
    reservationsOverlap(reservation.checkIn, reservation.checkOut, candidate.checkIn, candidate.checkOut)
  )
}

function roomReadinessLabel(room: BoardRoomCard) {
  if (room.operationalStatus !== 'AVAILABLE') return formatReservationLabel(room.operationalStatus)
  if (room.cleanStatus === 'INSPECTED') return 'Inspected'
  if (room.cleanStatus === 'CLEAN') return 'Clean'
  if (room.cleanStatus === 'CLEANING') return 'Cleaning'
  return 'Dirty'
}

function buildRoomAssignmentOptions(reservation: Reservation, rooms: BoardRoomCard[], reservations: Reservation[]): RoomAssignmentOption[] {
  const arrivalIsToday = getBangkokDateKey(reservation.checkIn) === getBangkokDateKey(new Date())

  return rooms
    .map<RoomAssignmentOption>((room) => {
      if (room.type !== reservation.roomType) {
        return { room, assignable: false, reason: `Room type is ${room.type}; booking needs ${reservation.roomType}.`, priority: 0 }
      }

      if (room.operationalStatus !== 'AVAILABLE') {
        return { room, assignable: false, reason: `Room is ${formatReservationLabel(room.operationalStatus)}.`, priority: 0 }
      }

      const overlappingReservation = findOverlappingReservation(reservation, room, reservations)
      if (overlappingReservation) {
        return { room, assignable: false, reason: `Overlaps ${overlappingReservation.confirmationNumber} for ${overlappingReservation.guestName}.`, priority: 0 }
      }

      const ready = isRoomReadyForArrival(room)
      const occupied = isRoomOccupied(room)

      if (arrivalIsToday && occupied) {
        return { room, assignable: false, reason: 'Room is occupied today.', priority: 0 }
      }

      if (arrivalIsToday && !ready) {
        return { room, assignable: false, reason: `Same-day arrival needs a clean or inspected room. Current state: ${roomReadinessLabel(room)}.`, priority: 0 }
      }

      if (occupied) {
        return { room, assignable: true, reason: 'Free for the stay dates.', note: 'Occupied now; verify turnover before arrival.', priority: 20 }
      }

      if (!ready) {
        return { room, assignable: true, reason: 'Free for the stay dates.', note: `Needs housekeeping before arrival: ${roomReadinessLabel(room)}.`, priority: 40 }
      }

      return { room, assignable: true, reason: 'Safe room match.', note: room.cleanStatus === 'INSPECTED' ? 'Inspected and ready.' : 'Clean and ready.', priority: room.cleanStatus === 'INSPECTED' ? 100 : 90 }
    })
    .sort((first, second) => {
      const priorityDiff = second.priority - first.priority
      return priorityDiff !== 0 ? priorityDiff : first.room.number.localeCompare(second.room.number, undefined, { numeric: true })
    })
}

function findBookingEmailEventForReservation(reservation: Reservation | null, events: BookingEmailEvent[]) {
  if (!reservation) return undefined
  return events.find((event) =>
    event.id === reservation.sourceEmailEventId ||
    event.reservationId === reservation.id ||
    event.reservationConfirmation === reservation.confirmationNumber ||
    (reservation.channelConfirmation && event.channelRef === reservation.channelConfirmation)
  )
}

function reservationNextAction(reservation: Reservation) {
  if (reservation.status === 'CANCELLED') return 'Cancellation documented'
  if (reservation.status === 'NO_SHOW') return 'No-show documented'
  if (reservation.status === 'CHECKED_OUT') return 'Stay complete'
  if (!reservation.roomId && !reservation.roomNumber) return 'Assign room'
  if (reservation.balanceDue > 0) return 'Collect payment'
  if (reservation.status === 'CHECKED_IN') return 'Prepare checkout'
  return 'Ready for check-in'
}

function reservationToDetailRoom(reservation: Reservation, room?: BoardRoomCard): BoardRoomCard {
  const checkedIn = reservation.status === 'CHECKED_IN'
  const checkedOut = reservation.status === 'CHECKED_OUT'
  const status: BoardRoomCard['status'] = checkedIn
    ? 'OCCUPIED_CLEAN'
    : checkedOut
      ? 'VACANT_DIRTY'
      : room?.status || 'VACANT_CLEAN'

  return {
    roomId: room?.roomId || reservation.roomId || `reservation-${reservation.id}`,
    number: room?.number || reservation.roomNumber || 'Unassigned',
    roomNumber: room?.roomNumber || reservation.roomNumber,
    floor: room?.floor ?? 0,
    type: room?.type || reservation.roomType,
    roomType: room?.roomType || reservation.roomType,
    roomTypeId: room?.roomTypeId,
    status,
    operationalStatus: room?.operationalStatus || 'AVAILABLE',
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    guestPhone: reservation.guestPhone,
    reservationId: reservation.id,
    currentReservationId: checkedIn ? reservation.id : room?.currentReservationId,
    reservation: {
      id: reservation.confirmationNumber,
      guestName: reservation.guestName,
      guestEmail: reservation.guestEmail,
      guestPhone: reservation.guestPhone,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      status: reservation.status,
      isVIP: reservation.isVIP,
      totalAmount: reservation.totalAmount,
      balanceDue: reservation.balanceDue,
      depositStatus: reservation.depositStatus,
    },
    nextReservation: room?.nextReservation,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    nightsRemaining: room?.nightsRemaining,
    guestCount: reservation.adults + reservation.children,
    isArrivalToday: isToday(reservation.checkIn),
    isDepartureToday: isToday(reservation.checkOut),
    isVIP: reservation.isVIP,
    hasIssue: room?.hasIssue || false,
    hasIssues: room?.hasIssues,
    needsAttention: reservation.status === 'PENDING',
    cleanStatus: room?.cleanStatus || 'CLEAN',
    housekeepingStatus: room?.housekeepingStatus || room?.cleanStatus || 'CLEAN',
    lastCleaned: room?.lastCleaned,
    lastUpdatedAt: reservation.updatedAt.toISOString(),
    lastUpdatedBy: reservation.createdBy,
    notes: reservation.notes || reservation.specialRequests || room?.notes,
    extendedStay: room?.extendedStay,
    maintenanceIssue: room?.maintenanceIssue,
    depositStatus: reservation.depositStatus,
    balanceDue: reservation.balanceDue,
  }
}

function reservationToArrival(reservation: Reservation, room?: BoardRoomCard): ArrivalItem {
  const balanceDue = Math.max(0, reservation.balanceDue)
  const paidAmount = Math.max(0, reservation.totalAmount - balanceDue)
  const roomReady = Boolean(room && isRoomReadyForArrival(room))

  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationNumber,
    guestName: reservation.guestName,
    roomNumber: reservation.roomNumber,
    assignedRoomId: reservation.roomId,
    roomType: reservation.roomType,
    checkInTime: '14:00',
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    nights: reservation.nights,
    adults: reservation.adults,
    children: reservation.children,
    status: reservation.status === 'CHECKED_IN' ? 'CHECKED_IN' : roomReady ? 'READY' : 'DUE_IN',
    reservationStatus: reservation.status,
    roomReady,
    depositPaid: reservation.depositStatus === 'PAID' || balanceDue <= 0,
    documentVerified: false,
    phone: reservation.guestPhone,
    email: reservation.guestEmail,
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
    source: reservation.source,
    bookedRate: reservation.ratePerNight,
    totalAmount: reservation.totalAmount,
    paidAmount,
    balanceDue,
    depositAmount: reservation.depositAmount,
    paymentStatus: paymentStatus(balanceDue, paidAmount),
    roomStatus: room?.status,
    operationalStatus: room?.operationalStatus,
  }
}

function reservationToDeparture(reservation: Reservation, room?: BoardRoomCard): DepartureItem {
  const balanceDue = Math.max(0, reservation.balanceDue)
  const paidAmount = Math.max(0, reservation.totalAmount - balanceDue)

  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationNumber,
    guestName: reservation.guestName,
    roomNumber: reservation.roomNumber || room?.number || 'TBD',
    assignedRoomId: reservation.roomId || room?.roomId,
    roomType: reservation.roomType,
    checkOutTime: '12:00',
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    actualCheckIn: reservation.actualCheckIn || undefined,
    nights: reservation.nights,
    nightsRemaining: Math.max(0, nightsBetween(new Date(), reservation.checkOut)),
    status: reservation.status === 'CHECKED_OUT' ? 'CHECKED_OUT' : 'IN_HOUSE',
    reservationStatus: reservation.status,
    balanceDue,
    paidAmount,
    folioTotal: reservation.totalAmount,
    folioStatus: balanceDue > 0 ? 'OPEN' : 'CLOSED',
    paymentStatus: paymentStatus(balanceDue, paidAmount),
    roomStatus: cleanLabel(room),
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
  }
}

export function ReservationsView() {
  const [reservationsRaw, setReservationsRaw] = useKV<Reservation[]>('reservations-data', [])
  const [canonicalReservationsRaw, setCanonicalReservations] = useKV<Reservation[]>('reservations', [])
  const [unassignedReservations, setUnassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [, setGuestDirectory] = useKV<GuestDirectoryRecord[]>('guests-data', [])
  const [, setCanonicalGuestDirectory] = useKV<GuestDirectoryRecord[]>('guests', [])
  const authToken = null
  const { rooms, setRooms } = useRoomSync()
  const { user } = useAuth()
  const { navigate } = useNavigation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<ReservationTab>('all')
  const [showNewReservationDialog, setShowNewReservationDialog] = useState(false)
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)
  const [selectedArrival, setSelectedArrival] = useState<ArrivalItem | null>(null)
  const [selectedDeparture, setSelectedDeparture] = useState<DepartureItem | null>(null)
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false)
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false)
  const [checkInMode, setCheckInMode] = useState<'express' | 'guided'>('guided')
  const [checkOutMode, setCheckOutMode] = useState<'express' | 'guided'>('guided')
  const [manualRoomSelection, setManualRoomSelection] = useState('')
  const [statusAction, setStatusAction] = useState<{ reservation: Reservation; action: 'cancel' | 'no-show' } | null>(null)
  const [statusActionReason, setStatusActionReason] = useState('')
  const { events: bookingEmailEvents } = useBookingEmailInbox()
  
  const reservations = useMemo(() => {
    const merged = new Map<string, Reservation>()
    ;(canonicalReservationsRaw || []).map(deserializeReservation).forEach((reservation) => {
      merged.set(reservation.id, reservation)
    })
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
  }, [canonicalReservationsRaw, reservationsRaw, rooms, unassignedReservations])
  
  const setReservations = (updater: Reservation[] | ((current: Reservation[]) => Reservation[])) => {
    setReservationsRaw((current) => {
      const base = current?.length ? current : canonicalReservationsRaw || []
      const deserialized = base.map(deserializeReservation)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      setCanonicalReservations(updated)
      return updated
    })
  }

  useEffect(() => {
    if (!SERVER_API_ENABLED) return

    let cancelled = false
    pmsApi<{ ok: true; data: any[] }>('/api/reservations', authToken)
      .then((payload) => {
        if (!cancelled) {
          const nextReservations = payload.data.map(reservationFromServer)
          setReservationsRaw(nextReservations)
          setCanonicalReservations(nextReservations)
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load reservations from the PMS API.')
      })

    return () => {
      cancelled = true
    }
  }, [authToken, setCanonicalReservations, setReservationsRaw])

  useEffect(() => {
    setManualRoomSelection('')
  }, [selectedReservation?.id])
  
  const handleCreateReservation = async (reservation: NewReservationData) => {
    if (SERVER_API_ENABLED) {
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
          roomTypeCode: /twin/i.test(reservation.roomTypeName) ? 'TWIN' : 'DOUBLE',
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
    setCanonicalGuestDirectory((current) => {
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
        roomType: /twin/i.test(reservation.roomTypeName) ? 'TWIN' : 'DOUBLE',
        guestCount: reservation.adults + reservation.children,
        nights: reservationRecord.nights,
        source: reservation.source === 'DIRECT' ? 'Direct' : reservation.source === 'BOOKING_COM' ? 'Booking.com' : reservation.source === 'WALK_IN' ? 'Front desk' : reservation.source,
        isVIP: reservation.guest.vipStatus,
        ratePerNight: reservation.ratePerNight,
        totalAmount: reservation.totalAmount,
        depositAmount: reservation.depositAmount,
        balanceDue: reservation.totalAmount,
        paidAmount: reservation.depositPaid ? reservation.depositAmount : 0,
        phone: reservation.guest.phone ?? undefined,
        email: reservation.guest.email ?? undefined,
        specialRequests: reservation.specialRequests ?? undefined,
        notes: reservation.notes ?? undefined,
      },
    ])
    toast.success('Reservation created and added to the assignment queue.')
    setShowNewReservationDialog(false)
  }

  const findRoomForReservation = (reservation: Reservation) => {
    return rooms.find((room) =>
      room.roomId === reservation.roomId ||
      room.number === reservation.roomNumber ||
      room.reservationId === reservation.id ||
      room.currentReservationId === reservation.id ||
      room.reservation?.id === reservation.confirmationNumber ||
      room.reservation?.id === reservation.id
    )
  }

  const upsertReservation = (
    reservationId: string,
    fallback: Reservation | null,
    updater: (reservation: Reservation) => Reservation,
  ) => {
    setReservations((current) => {
      const existing = current.some((reservation) => reservation.id === reservationId || reservation.confirmationNumber === reservationId)
      if (!existing && fallback) return [...current, updater(fallback)]
      return current.map((reservation) =>
        reservation.id === reservationId || reservation.confirmationNumber === reservationId
          ? updater(reservation)
          : reservation
      )
    })
  }

  const openCheckIn = (reservation: Reservation, mode: 'express' | 'guided' = 'guided') => {
    if (reservation.status === 'CHECKED_IN') {
      toast.info(`${reservation.guestName} is already checked in.`)
      return
    }
    if (reservation.status === 'CHECKED_OUT' || reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') {
      toast.error('Only active reservations can be checked in.')
      return
    }

    const room = findRoomForReservation(reservation)
    setSelectedReservation(reservation)
    setSelectedArrival(reservationToArrival(reservation, room))
    setCheckInMode(mode)
    setCheckInDialogOpen(true)
  }

  const openCheckOut = (reservation: Reservation, mode: 'express' | 'guided' = 'guided') => {
    if (reservation.status !== 'CHECKED_IN') {
      toast.info('Only checked-in reservations can be checked out.')
      return
    }

    const room = findRoomForReservation(reservation)
    setSelectedReservation(reservation)
    setSelectedDeparture(reservationToDeparture(reservation, room))
    setCheckOutMode(mode)
    setCheckOutDialogOpen(true)
  }

  const markRoomReady = async (roomId: string) => {
    const room = rooms.find((candidate) => candidate.roomId === roomId)
    if (!room) return

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/housekeeping/rooms/${roomId}/status`, authToken, {
          method: 'POST',
          body: JSON.stringify({ status: 'INSPECTED', notes: 'Reservations quick action: room ready for check-in' }),
        })
        toast.success(`Room ${room.number} marked clean/inspected.`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Room readiness update failed.')
      }
      return
    }

    setRooms((current) => current.map((candidate) => candidate.roomId === roomId
      ? {
          ...candidate,
          status: 'VACANT_CLEAN',
          cleanStatus: 'INSPECTED',
          housekeepingStatus: 'INSPECTED',
          lastCleaned: new Date(),
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Reservations',
        }
      : candidate
    ))
    toast.success(`Room ${room.number} marked clean/inspected.`)
  }

  const assignRoomToReservation = async (reservation: Reservation, roomId: string) => {
    const option = buildRoomAssignmentOptions(reservation, rooms, reservations).find((candidate) => candidate.room.roomId === roomId)
    if (!option) {
      toast.error('Select a room before assigning.')
      return
    }
    if (!option.assignable) {
      toast.error(option.reason)
      return
    }

    if (SERVER_API_ENABLED) {
      try {
        const payload = await pmsApi<{ ok: true; data: any; message?: string }>(`/api/reservations/${reservation.id}/assign-room`, authToken, {
          method: 'POST',
          body: JSON.stringify({ roomId }),
        })
        const updated = reservationFromServer(payload.data)
        setReservations((current) => [...current.filter((item) => item.id !== updated.id), updated])
        setUnassignedReservations((current) => (current || []).filter((item) => item.id !== updated.id))
        setSelectedReservation(updated)
        setManualRoomSelection('')
        toast.success(payload.message || `Room ${option.room.number} assigned.`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Room assignment failed.')
      }
      return
    }

    const updatedReservation = {
      ...reservation,
      roomId: option.room.roomId,
      roomNumber: option.room.number,
      updatedAt: new Date(),
    }
    setReservations((current) => current.map((item) => item.id === reservation.id ? updatedReservation : item))
    if (!isRoomOccupied(option.room)) {
      setRooms((current) => current.map((room) => room.roomId === roomId
        ? {
            ...room,
            reservationId: reservation.id,
            reservation: {
              id: reservation.confirmationNumber,
              guestName: reservation.guestName,
              guestEmail: reservation.guestEmail,
              guestPhone: reservation.guestPhone,
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              status: reservation.status,
              totalAmount: reservation.totalAmount,
              balanceDue: reservation.balanceDue,
              depositStatus: reservation.depositStatus,
            },
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: user?.displayName || 'Reservations',
          }
        : room
      ))
    }
    setUnassignedReservations((current) => (current || []).filter((item) => item.id !== reservation.id))
    setSelectedReservation(updatedReservation)
    setManualRoomSelection('')
    toast.success(`Room ${option.room.number} assigned.`)
  }

  const openStatusAction = (reservation: Reservation, action: 'cancel' | 'no-show') => {
    setStatusAction({ reservation, action })
    setStatusActionReason('')
  }

  const confirmStatusAction = async () => {
    if (!statusAction) return
    const reason = statusActionReason.trim()
    if (!reason) {
      toast.error('Record a reason before changing this reservation.')
      return
    }

    const { reservation, action } = statusAction
    const nextStatus: Reservation['status'] = action === 'cancel' ? 'CANCELLED' : 'NO_SHOW'
    const endpoint = action === 'cancel' ? 'cancel' : 'no-show'

    if (SERVER_API_ENABLED) {
      try {
        const payload = await pmsApi<{ ok: true; data: any; message?: string }>(`/api/reservations/${reservation.id}/${endpoint}`, authToken, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        })
        const updated = reservationFromServer(payload.data)
        setReservations((current) => current.map((item) => item.id === updated.id ? updated : item))
        setUnassignedReservations((current) => (current || []).filter((item) => item.id !== updated.id))
        setSelectedReservation(updated)
        setStatusAction(null)
        setStatusActionReason('')
        toast.success(payload.message || `Reservation marked ${formatReservationLabel(nextStatus)}.`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Reservation status change failed.')
      }
      return
    }

    const updated = {
      ...reservation,
      status: nextStatus,
      notes: [reservation.notes, `${formatReservationLabel(nextStatus)} reason: ${reason}`].filter(Boolean).join('\n'),
      updatedAt: new Date(),
    }
    setReservations((current) => current.map((item) => item.id === reservation.id ? updated : item))
    setUnassignedReservations((current) => (current || []).filter((item) => item.id !== reservation.id))
    if (reservation.roomId && reservation.status !== 'CHECKED_IN') {
      setRooms((current) => current.map((room) => room.roomId === reservation.roomId
        ? {
            ...room,
            reservationId: undefined,
            reservation: undefined,
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: user?.displayName || 'Reservations',
          }
        : room
      ))
    }
    setSelectedReservation(updated)
    setStatusAction(null)
    setStatusActionReason('')
    toast.success(`Reservation marked ${formatReservationLabel(nextStatus)}.`)
  }

  const confirmCheckIn = async (data: CheckInData) => {
    if (!selectedArrival) return

    const assignedRoom = rooms.find((room) => room.roomId === data.roomId)
    if (!assignedRoom) {
      toast.error('Assign a valid room before check-in.')
      return
    }

    if (SERVER_API_ENABLED) {
      try {
        if (selectedArrival.assignedRoomId !== data.roomId) {
          await pmsApi(`/api/reservations/${selectedArrival.reservationId}/assign-room`, authToken, {
            method: 'POST',
            body: JSON.stringify({ roomId: data.roomId }),
          })
        }
        await pmsApi(`/api/reservations/${selectedArrival.reservationId}/check-in`, authToken, {
          method: 'POST',
          body: JSON.stringify({
            guest: {
              nationality: data.nationality,
              idType: data.idNumber ? 'PASSPORT' : undefined,
              idNumber: data.idNumber,
            },
            payment: data.payment,
            additionalNotes: data.additionalNotes,
          }),
        })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-in failed.')
        return
      }
    }

    const checkedInAt = data.actualCheckIn || new Date()
    const paidNow = data.payment?.amount || 0
    const startingBalance = Math.max(0, selectedArrival.balanceDue ?? selectedArrival.totalAmount - (selectedArrival.paidAmount || 0))
    const balanceDue = Math.max(0, startingBalance - paidNow)
    const sourceReservation = selectedReservation || reservations.find((reservation) => reservation.id === selectedArrival.reservationId) || null

    setRooms((current) => current.map((room) => room.roomId === assignedRoom.roomId
      ? {
          ...room,
          status: 'OCCUPIED_CLEAN',
          cleanStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          housekeepingStatus: room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : 'CLEAN',
          reservationId: selectedArrival.reservationId,
          currentReservationId: selectedArrival.reservationId,
          guestName: selectedArrival.guestName,
          guestEmail: selectedArrival.email,
          guestPhone: selectedArrival.phone,
          checkIn: selectedArrival.checkInDate ? new Date(selectedArrival.checkInDate) : new Date(),
          checkOut: selectedArrival.checkOutDate ? new Date(selectedArrival.checkOutDate) : new Date(),
          guestCount: selectedArrival.adults + selectedArrival.children,
          balanceDue,
          depositStatus: balanceDue <= 0 ? 'PAID' : 'PENDING',
          reservation: {
            id: selectedArrival.confirmationCode || selectedArrival.reservationId,
            guestName: selectedArrival.guestName,
            guestEmail: selectedArrival.email,
            guestPhone: selectedArrival.phone,
            checkIn: selectedArrival.checkInDate,
            checkOut: selectedArrival.checkOutDate,
            status: 'CHECKED_IN',
            totalAmount: selectedArrival.totalAmount,
            balanceDue,
            depositStatus: balanceDue <= 0 ? 'PAID' : 'PENDING',
          },
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Reservations',
        }
      : room
    ))

    upsertReservation(selectedArrival.reservationId, sourceReservation, (reservation) => {
      const nextPaid = Math.min(reservation.totalAmount, Math.max(reservation.depositPaid || 0, reservation.totalAmount - balanceDue))
      return {
        ...reservation,
        status: 'CHECKED_IN',
        roomId: assignedRoom.roomId,
        roomNumber: assignedRoom.number,
        actualCheckIn: checkedInAt,
        balanceDue,
        depositPaid: nextPaid,
        depositStatus: balanceDue <= 0 ? 'PAID' : nextPaid > 0 ? 'PENDING' : reservation.depositStatus,
        updatedAt: checkedInAt,
      }
    })
    setUnassignedReservations((current) => (current || []).filter((reservation) => reservation.id !== selectedArrival.reservationId))
    toast.success(`Checked in: ${selectedArrival.guestName} -> Room ${assignedRoom.number}`)
    setCheckInDialogOpen(false)
    setSelectedArrival(null)
    setSelectedReservation(null)
  }

  const confirmCheckOut = async (data: CheckOutData) => {
    if (!selectedDeparture) return

    if (SERVER_API_ENABLED) {
      try {
        await pmsApi(`/api/reservations/${selectedDeparture.reservationId}/check-out`, authToken, {
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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Check-out failed.')
        return
      }
    }

    const room = rooms.find((candidate) =>
      candidate.roomId === selectedDeparture.assignedRoomId ||
      candidate.number === selectedDeparture.roomNumber ||
      candidate.reservationId === selectedDeparture.reservationId ||
      candidate.currentReservationId === selectedDeparture.reservationId
    )
    if (!room) {
      toast.error(`Room ${selectedDeparture.roomNumber} was not found.`)
      return
    }

    const checkedOutAt = data.actualCheckOut || new Date()
    const balanceDue = Math.max(0, selectedDeparture.balanceDue - (data.paymentAmount || 0))
    const sourceReservation = selectedReservation || reservations.find((reservation) => reservation.id === selectedDeparture.reservationId) || null

    setRooms((current) => current.map((candidate) => candidate.roomId === room.roomId
      ? {
          ...candidate,
          status: 'VACANT_DIRTY',
          cleanStatus: 'DIRTY',
          housekeepingStatus: 'DIRTY',
          reservationId: undefined,
          currentReservationId: undefined,
          reservation: undefined,
          guestName: undefined,
          guestEmail: undefined,
          guestPhone: undefined,
          checkIn: undefined,
          checkOut: undefined,
          guestCount: undefined,
          isVIP: false,
          balanceDue: undefined,
          depositStatus: 'NONE',
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: user?.displayName || 'Reservations',
        }
      : candidate
    ))

    upsertReservation(selectedDeparture.reservationId, sourceReservation, (reservation) => ({
      ...reservation,
      status: 'CHECKED_OUT',
      actualCheckOut: checkedOutAt,
      balanceDue,
      updatedAt: checkedOutAt,
    }))
    toast.success(`Checked out: ${selectedDeparture.guestName} -> Room ${selectedDeparture.roomNumber}`)
    setCheckOutDialogOpen(false)
    setSelectedDeparture(null)
    setSelectedReservation(null)
  }

  const handlePrintReservation = (reservation: Reservation) => {
    const opened = printReservationDocument(reservationToDetailRoom(reservation, findRoomForReservation(reservation)), 'confirmation')
    if (!opened) {
      toast.error('Allow pop-ups to print this reservation.')
      return
    }
    toast.success('Reservation confirmation opened for printing.')
  }

  const handleEmailReservation = (reservation: Reservation) => {
    const result = emailReservationDocument(reservationToDetailRoom(reservation, findRoomForReservation(reservation)), 'confirmation')
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(result.message)
  }
  
  const filteredReservations = useMemo(() => {
    let result = reservations
    const today = startOfDay(new Date())
    
    switch (selectedTab) {
      case 'arrivals':
        result = result.filter(r =>
          (r.status === 'CONFIRMED' || r.status === 'PENDING') &&
          isToday(r.checkIn)
        )
        break
      case 'departures':
        result = result.filter(r =>
          r.status === 'CHECKED_IN' &&
          isToday(r.checkOut)
        )
        break
      case 'upcoming':
        result = result.filter(r => 
          (r.status === 'CONFIRMED' || r.status === 'PENDING') &&
          !isBefore(r.checkIn, today)
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
    
    return [...result].sort((first, second) => first.checkIn.getTime() - second.checkIn.getTime())
  }, [reservations, selectedTab, searchQuery])
  
  const stats = useMemo(() => {
    const today = startOfDay(new Date())
    const upcoming = reservations.filter(r => 
      (r.status === 'CONFIRMED' || r.status === 'PENDING') &&
      !isBefore(r.checkIn, today)
    ).length
    
    const inHouse = reservations.filter(r => r.status === 'CHECKED_IN').length
    
    const arrivingToday = reservations.filter(r =>
      (r.status === 'CONFIRMED' || r.status === 'PENDING') && isToday(r.checkIn)
    ).length
    
    const departingToday = reservations.filter(r => 
      r.status === 'CHECKED_IN' && isToday(r.checkOut)
    ).length

    const unassigned = reservations.filter(r =>
      ACTIVE_ASSIGNMENT_STATUSES.includes(r.status) && !r.roomId && !r.roomNumber
    ).length

    const openBalances = reservations.filter(r =>
      ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(r.status) && r.balanceDue > 0
    ).length

    const assignmentConflicts = reservations.filter((reservation) =>
      reservation.roomId &&
      ACTIVE_ASSIGNMENT_STATUSES.includes(reservation.status) &&
      rooms.some((room) => room.roomId === reservation.roomId && findOverlappingReservation(reservation, room, reservations))
    ).length

    const emailReview = bookingEmailEvents.filter((event) => event.status === 'NEEDS_REVIEW' || event.status === 'ERROR').length
    
    return { upcoming, inHouse, arrivingToday, departingToday, unassigned, openBalances, assignmentConflicts, emailReview }
  }, [bookingEmailEvents, reservations, rooms])
  
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
      arrivals: 'Arrivals Today',
      departures: 'Departures Today',
      upcoming: 'Upcoming Reservations',
      'in-house': 'In-House Guests',
      past: 'Past Reservations'
    }
    
    const groupByOptions = {
      all: 'status' as const,
      arrivals: 'date' as const,
      departures: 'none' as const,
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Reservations</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage all guest reservations and bookings
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={() => navigate('front-desk')}>
                <House size={18} weight="bold" />
                Front Desk
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => navigate('board')}>
                <SquaresFour size={18} weight="bold" />
                Board
              </Button>
              <Button className="gap-2" onClick={() => setShowNewReservationDialog(true)}>
                <Plus size={18} weight="bold" />
                New Reservation
              </Button>
            </div>
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
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setSearchQuery('')
                setSelectedTab('all')
                toast.success('Reservation filters reset.')
              }}
            >
              <FunnelSimple size={18} />
              Reset
            </Button>
            <Button variant="outline" className="gap-2" onClick={handlePrint}>
              <Printer size={18} weight="bold" />
              Print
            </Button>
          </div>
        </div>
        
        <div className="px-6 pb-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Unassigned</div>
              <div className="text-2xl font-bold text-amber-700">{stats.unassigned}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">Assign safe rooms before arrival</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Open Balances</div>
              <div className="text-2xl font-bold text-rose-700">{stats.openBalances}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">Collect or approve exceptions</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Booking Emails</div>
              <div className="text-2xl font-bold text-fuchsia-700">{stats.emailReview}</div>
              <button type="button" className="mt-1 text-[11px] font-medium text-fuchsia-800 underline-offset-2 hover:underline" onClick={() => navigate('booking-inbox')}>
                Review inbox
              </button>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Room Conflicts</div>
              <div className="text-2xl font-bold text-red-700">{stats.assignmentConflicts}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">Resolve before check-in</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-6">
          <TabsList className="bg-transparent">
            <TabsTrigger value="all">All ({reservations.length})</TabsTrigger>
            <TabsTrigger value="arrivals">Arrivals ({stats.arrivingToday})</TabsTrigger>
            <TabsTrigger value="departures">Departures ({stats.departingToday})</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({stats.upcoming})</TabsTrigger>
            <TabsTrigger value="in-house">In-House ({stats.inHouse})</TabsTrigger>
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
                    {searchQuery ? 'Try adjusting your search terms' : 'No reservations are available in this category yet.'}
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button variant="outline" onClick={() => setSelectedTab('all')}>Show All</Button>
                    <Button onClick={() => setShowNewReservationDialog(true)}>New Reservation</Button>
                  </div>
                </Card>
              ) : (
                filteredReservations.map(reservation => {
                  const sourceEmailEvent = findBookingEmailEventForReservation(reservation, bookingEmailEvents)
                  return (
                  <Card 
                    key={reservation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedReservation(reservation)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedReservation(reservation)
                      }
                    }}
                    className="p-4 hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-base font-semibold text-foreground">{reservation.guestName}</h3>
                          {reservation.isVIP && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">VIP</Badge>
                          )}
                          <Badge className={cn('text-xs border', getStatusColor(reservation.status))}>
                            {formatReservationLabel(reservation.status)}
                          </Badge>
                          <Badge variant="outline" className={cn('text-xs', getSourceColor(reservation.source))}>
                            {formatReservationLabel(reservation.source)}
                          </Badge>
                          {(sourceEmailEvent || reservation.sourceEmailEventId) && (
                            <Badge variant="outline" className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 text-xs">
                              Email event
                            </Badge>
                          )}
                        </div>
                        
                        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar size={16} />
                            <span>{format(reservation.checkIn, 'MMM d')} - {format(reservation.checkOut, 'MMM d, yyyy')}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin size={16} />
                            <span>{reservation.roomNumber || 'Unassigned'} - {reservation.roomType}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <User size={16} />
                            <span>{reservation.adults} {reservation.adults === 1 ? 'adult' : 'adults'}{reservation.children > 0 ? `, ${reservation.children} ${reservation.children === 1 ? 'child' : 'children'}` : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {reservation.guestPhone ? <Phone size={16} /> : <EnvelopeSimple size={16} />}
                            <span className="truncate">{reservation.guestPhone || reservation.guestEmail || 'No contact'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-mono">#{reservation.confirmationNumber}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                            Next: {reservationNextAction(reservation)}
                          </Badge>
                          {reservation.channelConfirmation && (
                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
                              Channel ref {reservation.channelConfirmation}
                            </Badge>
                          )}
                          {sourceEmailEvent?.reviewReason && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                              Email review: {sourceEmailEvent.reviewReason}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <div className="min-w-[220px] text-left xl:text-right">
                        <div className="text-lg font-bold text-foreground">{formatCurrency(reservation.totalAmount)}</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          {formatCurrency(reservation.ratePerNight)} x {reservation.nights} {reservation.nights === 1 ? 'night' : 'nights'}
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
                        {reservation.balanceDue > 0 && (
                          <div className="mt-2 text-sm font-semibold text-rose-700">
                            Balance due {formatCurrency(reservation.balanceDue)}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2 xl:justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedReservation(reservation)
                            }}
                          >
                            <Eye size={15} weight="bold" />
                            View
                          </Button>
                          {reservation.status === 'CHECKED_IN' ? (
                            <Button
                              size="sm"
                              className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                              onClick={(event) => {
                                event.stopPropagation()
                                openCheckOut(reservation, reservation.balanceDue > 0 ? 'guided' : 'express')
                              }}
                            >
                              <SignOut size={15} weight="bold" />
                              Check Out
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                              disabled={reservation.status === 'CHECKED_OUT' || reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW'}
                              onClick={(event) => {
                                event.stopPropagation()
                                openCheckIn(reservation, reservation.balanceDue <= 0 ? 'express' : 'guided')
                              }}
                            >
                              <SignIn size={15} weight="bold" />
                              Check In
                            </Button>
                          )}
                        </div>
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
                  )
                })
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
      <ReservationDetailDialog
        reservation={selectedReservation}
        open={Boolean(selectedReservation) && !checkInDialogOpen && !checkOutDialogOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedReservation(null)
        }}
        onCheckIn={(reservation) => openCheckIn(reservation)}
        onCheckOut={(reservation) => openCheckOut(reservation, reservation.balanceDue > 0 ? 'guided' : 'express')}
        onPrint={handlePrintReservation}
        onEmail={handleEmailReservation}
        onBoard={() => navigate('board')}
        onFrontDesk={() => navigate('front-desk')}
        onBookingInbox={() => navigate('booking-inbox')}
        onCashier={() => navigate('cashier')}
        rooms={rooms}
        reservations={reservations}
        sourceEmailEvent={findBookingEmailEventForReservation(selectedReservation, bookingEmailEvents)}
        manualRoomSelection={manualRoomSelection}
        onManualRoomSelectionChange={setManualRoomSelection}
        onAssignRoom={assignRoomToReservation}
        onStatusAction={openStatusAction}
      />
      <Dialog open={Boolean(statusAction)} onOpenChange={(open) => {
        if (!open) {
          setStatusAction(null)
          setStatusActionReason('')
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{statusAction?.action === 'cancel' ? 'Cancel reservation' : 'Mark no-show'}</DialogTitle>
            <DialogDescription>
              This changes booking status and must include an audit reason. Active checked-in stays must be checked out first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-semibold">{statusAction?.reservation.guestName}</div>
              <div className="text-xs text-muted-foreground">Reservation {statusAction?.reservation.confirmationNumber}</div>
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Reason</span>
              <Textarea
                value={statusActionReason}
                onChange={(event) => setStatusActionReason(event.target.value)}
                placeholder="Guest requested cancellation, OTA cancellation notice, no-show after contact attempt..."
                rows={4}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setStatusAction(null)
              setStatusActionReason('')
            }}>
              Keep Reservation
            </Button>
            <Button variant="destructive" onClick={() => void confirmStatusAction()}>
              {statusAction?.action === 'cancel' ? 'Cancel Reservation' : 'Mark No-show'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CheckInDialog
        arrival={selectedArrival}
        rooms={rooms}
        mode={checkInMode}
        role={user?.role}
        open={checkInDialogOpen}
        onOpenChange={(open) => {
          setCheckInDialogOpen(open)
          if (!open) setSelectedArrival(null)
        }}
        onConfirm={confirmCheckIn}
        onMarkRoomReady={markRoomReady}
      />
      <CheckOutDialog
        departure={selectedDeparture}
        mode={checkOutMode}
        role={user?.role}
        open={checkOutDialogOpen}
        onOpenChange={(open) => {
          setCheckOutDialogOpen(open)
          if (!open) setSelectedDeparture(null)
        }}
        onConfirm={confirmCheckOut}
      />
    </div>
  )
}

function ReservationDetailDialog({
  reservation,
  open,
  onOpenChange,
  onCheckIn,
  onCheckOut,
  onPrint,
  onEmail,
  onBoard,
  onFrontDesk,
  onBookingInbox,
  onCashier,
  rooms,
  reservations,
  sourceEmailEvent,
  manualRoomSelection,
  onManualRoomSelectionChange,
  onAssignRoom,
  onStatusAction,
}: {
  reservation: Reservation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCheckIn: (reservation: Reservation) => void
  onCheckOut: (reservation: Reservation) => void
  onPrint: (reservation: Reservation) => void
  onEmail: (reservation: Reservation) => void
  onBoard: () => void
  onFrontDesk: () => void
  onBookingInbox: () => void
  onCashier: () => void
  rooms: BoardRoomCard[]
  reservations: Reservation[]
  sourceEmailEvent?: BookingEmailEvent
  manualRoomSelection: string
  onManualRoomSelectionChange: (roomId: string) => void
  onAssignRoom: (reservation: Reservation, roomId: string) => void
  onStatusAction: (reservation: Reservation, action: 'cancel' | 'no-show') => void
}) {
  if (!reservation) return null

  const canCheckIn = reservation.status === 'CONFIRMED' || reservation.status === 'PENDING'
  const canCheckOut = reservation.status === 'CHECKED_IN'
  const canCancel = reservation.status === 'CONFIRMED' || reservation.status === 'PENDING'
  const canNoShow = reservation.status === 'CONFIRMED' || reservation.status === 'PENDING'
  const paidAmount = Math.max(0, reservation.totalAmount - reservation.balanceDue)
  const assignmentOptions = buildRoomAssignmentOptions(reservation, rooms, reservations)
  const safeAutoOption = assignmentOptions.find((option) => option.assignable)
  const selectedManualOption = assignmentOptions.find((option) => option.room.roomId === manualRoomSelection)
  const assignmentConflict = reservation.roomId
    ? rooms.some((room) => room.roomId === reservation.roomId && findOverlappingReservation(reservation, room, reservations))
    : false
  const documentLinks = [
    { label: 'Booking summary', action: () => onPrint(reservation) },
    { label: 'Registration card', action: () => onPrint(reservation) },
    { label: 'Check-in packet', action: () => onPrint(reservation) },
    { label: 'Payment receipt', action: () => onPrint(reservation) },
    { label: reservation.status === 'CANCELLED' ? 'Cancellation summary' : 'Modification summary', action: () => onPrint(reservation) },
    { label: 'Housekeeping note', action: onBoard },
    { label: 'Folio summary', action: onCashier },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[min(920px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Receipt size={21} weight="bold" className="text-primary" />
            Reservation {reservation.confirmationNumber}
            {reservation.isVIP && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">VIP</Badge>}
          </DialogTitle>
          <DialogDescription>
            {reservation.guestName} - {format(reservation.checkIn, 'MMM d')} to {format(reservation.checkOut, 'MMM d, yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="grid gap-3 sm:grid-cols-2">
              <DetailTile label="Guest" value={reservation.guestName} />
              <DetailTile label="Status" value={formatReservationLabel(reservation.status)} />
              <DetailTile label="Email" value={reservation.guestEmail || 'Not recorded'} />
              <DetailTile label="Phone" value={reservation.guestPhone || 'Not recorded'} />
              <DetailTile label="Room" value={`${reservation.roomNumber || 'Unassigned'} - ${reservation.roomType}`} />
              <DetailTile label="Guests" value={`${reservation.adults} adult${reservation.adults === 1 ? '' : 's'}${reservation.children ? `, ${reservation.children} child${reservation.children === 1 ? '' : 'ren'}` : ''}`} />
              <DetailTile label="Source" value={formatReservationLabel(reservation.source)} />
              <DetailTile label="Channel reference" value={reservation.channelConfirmation || sourceEmailEvent?.channelRef || 'Not recorded'} />
              <DetailTile label="Source email event" value={sourceEmailEvent?.id || reservation.sourceEmailEventId || 'Not linked'} />
              <DetailTile label="Next action" value={reservationNextAction(reservation)} />
            </section>

            <section className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Stay</div>
                <Badge variant="outline">{reservation.nights} night{reservation.nights === 1 ? '' : 's'}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <DetailTile label="Check-in" value={format(reservation.checkIn, 'EEE, MMM d, yyyy')} compact />
                <DetailTile label="Check-out" value={format(reservation.checkOut, 'EEE, MMM d, yyyy')} compact />
                <DetailTile label="Occupancy" value={`${reservation.adults} adults / ${reservation.children} children`} compact />
              </div>
            </section>

            <section className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Room assignment</div>
                {assignmentConflict && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">Conflict</Badge>}
              </div>
              {reservation.roomNumber ? (
                <div className="mb-3 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
                  Assigned to Room {reservation.roomNumber}. {assignmentConflict ? 'Review overlapping assignment before check-in.' : 'No overlapping active reservation detected in this workspace.'}
                </div>
              ) : (
                <div className="mb-3 rounded-md border bg-amber-50 p-3 text-sm text-amber-900">
                  Room is unassigned. Use auto assignment only when a safe room is available.
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-2">
                  {assignmentOptions.slice(0, 6).map((option) => (
                    <div key={option.room.roomId} className={cn('rounded-md border p-2 text-sm', option.assignable ? 'bg-background' : 'bg-muted/40 text-muted-foreground')}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">Room {option.room.number} - {option.room.type}</div>
                        <Badge variant="outline" className={option.assignable ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}>
                          {option.assignable ? roomReadinessLabel(option.room) : 'Cannot assign'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{option.reason}{option.note ? ` ${option.note}` : ''}</div>
                    </div>
                  ))}
                  {!safeAutoOption && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                      No safe room exists for this stay. Keep unassigned and resolve inventory or room readiness before forcing an assignment.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Button
                    className="w-full justify-start gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                    disabled={!safeAutoOption || !canCheckIn && reservation.status !== 'PENDING'}
                    onClick={() => safeAutoOption && onAssignRoom(reservation, safeAutoOption.room.roomId)}
                  >
                    <CheckCircle size={15} weight="bold" />
                    Auto Assign Safe Room
                  </Button>
                  <select
                    value={manualRoomSelection}
                    onChange={(event) => onManualRoomSelectionChange(event.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    aria-label="Assign manually"
                  >
                    <option value="">Assign manually...</option>
                    {assignmentOptions.map((option) => (
                      <option key={option.room.roomId} value={option.room.roomId} disabled={!option.assignable}>
                        Room {option.room.number} - {option.assignable ? option.reason : option.reason}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    disabled={!selectedManualOption?.assignable}
                    onClick={() => selectedManualOption && onAssignRoom(reservation, selectedManualOption.room.roomId)}
                  >
                    Assign Manually
                  </Button>
                  <Button variant="outline" className="w-full justify-start" disabled={Boolean(reservation.roomNumber)}>
                    Leave Unassigned
                  </Button>
                  <Button variant="outline" className="w-full justify-start gap-1.5" onClick={onBoard}>
                    <Warning size={15} weight="bold" />
                    Resolve Conflict
                  </Button>
                </div>
              </div>
            </section>

            {sourceEmailEvent && (
              <section className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-950">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-semibold">Source booking email</div>
                  <Badge variant="outline" className="border-fuchsia-200 bg-white text-fuchsia-800">{formatReservationLabel(sourceEmailEvent.status)}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailTile label="Sender" value={sourceEmailEvent.sender || 'Not recorded'} compact />
                  <DetailTile label="Event type" value={formatReservationLabel(sourceEmailEvent.eventType)} compact />
                  <DetailTile label="Source" value={sourceEmailEvent.sourceName || sourceEmailEvent.source} compact />
                  <DetailTile label="Reason" value={sourceEmailEvent.reviewReason || sourceEmailEvent.completedAction || sourceEmailEvent.errorReason || 'Linked to reservation'} compact />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={onBookingInbox}>Open Booking Inbox</Button>
                  {sourceEmailEvent.rawEmailUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={sourceEmailEvent.rawEmailUrl} target="_blank" rel="noreferrer">View Raw Email</a>
                    </Button>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-lg border p-3">
              <div className="mb-2 text-sm font-semibold">Documents</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {documentLinks.map((document) => (
                  <Button key={document.label} variant="outline" className="justify-start gap-1.5" onClick={document.action}>
                    <Receipt size={15} weight="bold" />
                    {document.label}
                  </Button>
                ))}
              </div>
            </section>

            {(reservation.specialRequests || reservation.notes) && (
              <section className="rounded-lg border p-3 text-sm">
                <div className="mb-2 font-semibold">Guest notes</div>
                {reservation.specialRequests && (
                  <p><span className="font-medium">Special requests:</span> {reservation.specialRequests}</p>
                )}
                {reservation.notes && (
                  <p className="mt-1 whitespace-pre-wrap"><span className="font-medium">Internal notes:</span> {reservation.notes}</p>
                )}
              </section>
            )}

            <section className="rounded-lg border p-3 text-sm">
              <div className="mb-2 text-sm font-semibold">Timeline / audit</div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <TimelineRow label="Created" value={`${format(reservation.createdAt, 'MMM d, yyyy HH:mm')} by ${reservation.createdBy || 'PMS'}`} />
                <TimelineRow label="Updated" value={format(reservation.updatedAt, 'MMM d, yyyy HH:mm')} />
                {sourceEmailEvent && <TimelineRow label="Email source" value={`${sourceEmailEvent.id} - ${formatReservationLabel(sourceEmailEvent.status)}`} />}
                {reservation.actualCheckIn && <TimelineRow label="Checked in" value={format(reservation.actualCheckIn, 'MMM d, yyyy HH:mm')} />}
                {reservation.actualCheckOut && <TimelineRow label="Checked out" value={format(reservation.actualCheckOut, 'MMM d, yyyy HH:mm')} />}
              </div>
            </section>
          </div>

          <aside className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-semibold">Folio Summary</div>
            <SummaryRow label="Room total" value={formatCurrency(reservation.totalAmount)} />
            <SummaryRow label="Paid" value={formatCurrency(paidAmount)} />
            <SummaryRow label="Deposit" value={formatCurrency(reservation.depositPaid)} />
            <SummaryRow label="Rate/night" value={formatCurrency(reservation.ratePerNight)} />
            <Separator />
            <SummaryRow label="Balance due" value={formatCurrency(reservation.balanceDue)} strong />
            <div className="rounded-md border bg-background p-2 text-xs">
              <div className="font-medium">Deposit status</div>
              <div className={reservation.depositStatus === 'PAID' ? 'text-emerald-700' : 'text-amber-700'}>
                {formatReservationLabel(reservation.depositStatus)}
              </div>
            </div>
            <div className="grid gap-2">
              <Button variant="outline" className="justify-start gap-1.5" onClick={onCashier}>
                <CreditCard size={15} weight="bold" />
                Collect Payment
              </Button>
              <Button variant="outline" className="justify-start gap-1.5" onClick={onCashier}>
                <Receipt size={15} weight="bold" />
                Add Charge
              </Button>
              <Button variant="outline" className="justify-start gap-1.5" onClick={() => onPrint(reservation)}>
                <Printer size={15} weight="bold" />
                Generate Receipt
              </Button>
            </div>
          </aside>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-1.5" onClick={onFrontDesk}>
              <House size={15} weight="bold" />
              Front Desk
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={onBoard}>
              <SquaresFour size={15} weight="bold" />
              Board
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={onBookingInbox}>
              <EnvelopeSimple size={15} weight="bold" />
              Booking Inbox
            </Button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="gap-1.5" onClick={onCashier}>
              <CreditCard size={15} weight="bold" />
              Folio
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => onEmail(reservation)}>
              <EnvelopeSimple size={15} weight="bold" />
              Email
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => onPrint(reservation)}>
              <Printer size={15} weight="bold" />
              Print
            </Button>
            <Button
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              disabled={!canCheckIn}
              onClick={() => onCheckIn(reservation)}
            >
              <SignIn size={15} weight="bold" />
              Check In
            </Button>
            <Button
              className="gap-1.5 bg-blue-600 hover:bg-blue-700"
              disabled={!canCheckOut}
              onClick={() => onCheckOut(reservation)}
            >
              <SignOut size={15} weight="bold" />
              Check Out
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 border-orange-200 text-orange-800 hover:bg-orange-50"
              disabled={!canNoShow}
              onClick={() => onStatusAction(reservation, 'no-show')}
            >
              <ArrowsClockwise size={15} weight="bold" />
              Mark No-show
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 border-red-200 text-red-800 hover:bg-red-50"
              disabled={!canCancel}
              onClick={() => onStatusAction(reservation, 'cancel')}
            >
              <Prohibit size={15} weight="bold" />
              Cancel Booking
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailTile({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-md border bg-background px-3 py-2', compact && 'bg-muted/20')}>
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm', strong && 'font-semibold')}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right tabular-nums', strong && 'text-rose-700')}>{value}</span>
    </div>
  )
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
