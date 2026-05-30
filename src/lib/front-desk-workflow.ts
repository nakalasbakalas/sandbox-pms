import type {
  ArrivalItem,
  DepartureItem,
  FrontDeskActionState,
  InHouseItem,
  RoomReadinessSummary,
  WorkflowGuardItem,
  WorkflowGuardSummary,
} from '@/types/front-desk'
import type { BoardRoomCard } from '@/types/board'
import type { UserRole } from '@/types/auth'
import {
  getBangkokDateKey,
  getRoomAssignmentDecision,
  isSellableRoomNumber,
  nightsBetween,
  SANDBOX_HOTEL_RULES,
} from '@/lib/hotel/business-rules'
import { isRoomReadyForArrival } from '@/lib/hotel/rooms'

const OCCUPIED_STATUSES = new Set(['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'])
const TERMINAL_RESERVATION_STATUSES = new Set(['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'])

function guard(
  id: string,
  label: string,
  severity: WorkflowGuardItem['severity'],
  status: string,
  requiredAction: string,
  quickActionLabel: string,
  permissionRequired?: string,
): WorkflowGuardItem {
  return { id, label, severity, status, requiredAction, quickActionLabel, permissionRequired }
}

export function summarizeGuards(items: WorkflowGuardItem[], isExpressReady: boolean): WorkflowGuardSummary {
  const blockers = items.filter((item) => item.severity === 'blocker')
  const warnings = items.filter((item) => item.severity === 'warning')
  const info = items.filter((item) => item.severity === 'info')
  return {
    blockers,
    warnings,
    info,
    canProceed: blockers.length === 0,
    isExpressReady,
  }
}

export function isManagerRole(role?: UserRole | string | null) {
  return role === 'admin' || role === 'manager' || role === 'ADMIN' || role === 'MANAGER'
}

export function isRoomOccupied(room?: Pick<BoardRoomCard, 'status'> | null) {
  return Boolean(room && OCCUPIED_STATUSES.has(room.status))
}

export function amountDueForArrival(arrival: ArrivalItem) {
  if (typeof arrival.balanceDue === 'number') return Math.max(0, arrival.balanceDue)
  if (typeof arrival.paidAmount === 'number') return Math.max(0, arrival.totalAmount - arrival.paidAmount)
  return arrival.depositPaid ? 0 : Math.max(0, arrival.depositAmount ?? arrival.totalAmount)
}

export function totalGuests(arrival: Pick<ArrivalItem, 'adults' | 'children'>) {
  return Math.max(0, arrival.adults) + Math.max(0, arrival.children)
}

export function findRoomForArrival(arrival: ArrivalItem, rooms: BoardRoomCard[]) {
  if (arrival.assignedRoomId) return rooms.find((room) => room.roomId === arrival.assignedRoomId)
  if (arrival.roomNumber) return rooms.find((room) => room.number === arrival.roomNumber)
  return undefined
}

export function findBestAvailableRoom(rooms: BoardRoomCard[], arrival: Pick<ArrivalItem, 'roomType' | 'reservationId' | 'checkInDate' | 'checkOutDate'>) {
  return rooms
    .filter((room) => {
      if (room.type !== arrival.roomType) return false
      if (!isRoomReadyForArrival(room)) return false
      const decision = getRoomAssignmentDecision(room, {
        checkIn: arrival.checkInDate ?? new Date(),
        checkOut: arrival.checkOutDate ?? new Date(Date.now() + 86_400_000),
        excludeReservationId: arrival.reservationId,
      })
      return decision.assignable && !room.currentReservationId && !room.reservationId
    })
    .sort((first, second) => first.number.localeCompare(second.number, undefined, { numeric: true }))[0]
}

export function buildCheckInGuards(
  arrival: ArrivalItem,
  room: BoardRoomCard | undefined,
  options: { hotelDateKey?: string; role?: UserRole | string | null } = {},
): WorkflowGuardSummary {
  const hotelDateKey = options.hotelDateKey ?? getBangkokDateKey(new Date())
  const items: WorkflowGuardItem[] = []
  const reservationStatus = arrival.reservationStatus ?? (arrival.status === 'CHECKED_IN' ? 'CHECKED_IN' : 'CONFIRMED')
  const arrivalDateKey = arrival.checkInDate ? getBangkokDateKey(arrival.checkInDate) : hotelDateKey
  const departureDateKey = arrival.checkOutDate ? getBangkokDateKey(arrival.checkOutDate) : undefined
  const balanceDue = amountDueForArrival(arrival)

  if (arrival.status === 'CHECKED_IN' || reservationStatus === 'CHECKED_IN') {
    items.push(guard('already_checked_in', 'Reservation already checked in', 'info', 'Already in house', 'No check-in action is required.', 'Open Stay'))
  }

  if (TERMINAL_RESERVATION_STATUSES.has(reservationStatus)) {
    items.push(guard('invalid_reservation_status', 'Reservation cannot be checked in', 'blocker', reservationStatus, 'Use an active confirmed or pending reservation.', 'Review Reservation'))
  }

  if (!departureDateKey || nightsBetween(arrivalDateKey, departureDateKey) < 1) {
    items.push(guard('invalid_dates', 'Stay dates are invalid', 'blocker', 'Check-out is not after check-in', 'Correct the stay dates before check-in.', 'Edit Dates'))
  } else if (hotelDateKey < arrivalDateKey || hotelDateKey >= departureDateKey) {
    items.push(guard('date_mismatch', 'Arrival date needs approval', 'blocker', `Arrival ${arrivalDateKey}`, 'Manager/admin override is required outside the reserved arrival window.', 'Override with Reason', 'override:check-in'))
  }

  if (totalGuests(arrival) > SANDBOX_HOTEL_RULES.maxOccupancy) {
    items.push(guard('occupancy_exceeds_max', 'Occupancy exceeds room limit', 'blocker', `${totalGuests(arrival)} guests`, `Maximum occupancy is ${SANDBOX_HOTEL_RULES.maxOccupancy}.`, 'Edit Guests'))
  }

  if (!arrival.roomNumber && !arrival.assignedRoomId) {
    items.push(guard('no_room_assigned', 'No room assigned', 'blocker', 'Room TBD', 'Assign a clean available room before check-in.', 'Assign Room'))
  }

  if (room) {
    const assignment = getRoomAssignmentDecision(room, {
      checkIn: arrival.checkInDate ?? new Date(),
      checkOut: arrival.checkOutDate ?? new Date(Date.now() + 86_400_000),
      excludeReservationId: arrival.reservationId,
    })
    if (!isSellableRoomNumber(room.number)) {
      items.push(guard('room_non_sellable', 'Room is non-sellable', 'blocker', `Room ${room.number}`, 'Choose a sellable guest room.', 'Assign Room'))
    } else if (!assignment.assignable) {
      items.push(guard(`room_${assignment.reason}`, 'Room cannot be assigned', 'blocker', `Room ${room.number}`, 'Choose another room or resolve the room state.', 'Assign Room'))
    }

    if (isRoomOccupied(room)) {
      items.push(guard('room_occupied', 'Room is occupied', 'blocker', `Room ${room.number}`, 'Move this reservation to a vacant room.', 'Assign Room'))
    }

    if (!isRoomReadyForArrival(room)) {
      items.push(guard('room_not_ready', 'Room is not ready', 'blocker', room.cleanStatus, 'Housekeeping must mark the room clean/inspected, or a manager/admin must override with reason.', 'Mark Clean/Inspected', 'override:check-in'))
    }
  }

  if (!arrival.documentVerified) {
    items.push(guard('missing_identity', 'Guest identity not recorded', 'blocker', 'ID/passport missing', 'Record ID/passport and nationality, or use an authorized record-later override.', 'Add ID', 'override:check-in'))
  }

  if (balanceDue > 0) {
    items.push(guard('payment_due', 'Payment due at check-in', 'blocker', `THB ${balanceDue.toLocaleString('en-US')}`, 'Collect the due amount or use an authorized pay-later reason.', 'Collect Payment', 'override:check-in'))
  } else {
    items.push(guard('payment_clear', 'Payment handled', 'info', 'No balance due', 'No payment is required before check-in.', 'View Folio'))
  }

  if (!arrival.arrivalTime && !arrival.estimatedArrival) {
    items.push(guard('missing_arrival_time', 'Arrival time not captured', 'warning', 'No ETA', 'Ask for ETA if helpful for housekeeping coordination.', 'Add Note'))
  }

  if (arrival.guestNationality && !/^thai?land$|^thai$/i.test(arrival.guestNationality.trim())) {
    items.push(guard('immigration_reminder', 'Immigration reminder', 'warning', arrival.guestNationality, 'Confirm passport details are suitable for non-Thai guest reporting.', 'Review ID'))
  }

  if (arrival.specialRequests) {
    items.push(guard('special_request', 'Special request on booking', 'warning', arrival.specialRequests, 'Acknowledge the request during check-in.', 'Add Note'))
  }

  const blockers = items.filter((item) => item.severity === 'blocker')
  const warningOnly = blockers.length === 0 && items.some((item) => item.severity === 'warning')
  return summarizeGuards(items, blockers.length === 0 && !warningOnly)
}

export function buildCheckOutGuards(
  departure: DepartureItem,
  options: { hotelDateKey?: string; now?: Date; role?: UserRole | string | null } = {},
): WorkflowGuardSummary {
  const hotelDateKey = options.hotelDateKey ?? getBangkokDateKey(new Date())
  const now = options.now ?? new Date()
  const items: WorkflowGuardItem[] = []
  const reservationStatus = departure.reservationStatus ?? (departure.status === 'CHECKED_OUT' ? 'CHECKED_OUT' : 'CHECKED_IN')

  if (reservationStatus === 'CHECKED_OUT' || departure.status === 'CHECKED_OUT') {
    items.push(guard('already_checked_out', 'Reservation already checked out', 'blocker', 'Completed', 'Checkout has already been recorded.', 'Open Stay'))
  }

  if (reservationStatus !== 'CHECKED_IN' && reservationStatus !== 'CHECKED_OUT') {
    items.push(guard('not_in_house', 'Guest is not in house', 'blocker', reservationStatus, 'Only checked-in reservations can be checked out.', 'Review Reservation'))
  }

  if (!departure.roomNumber || !departure.assignedRoomId) {
    items.push(guard('room_mismatch', 'Room assignment missing', 'blocker', 'No assigned room', 'Resolve the room assignment before checkout.', 'Review Stay'))
  }

  if (departure.balanceDue > 0) {
    items.push(guard('unsettled_balance', 'Balance must be settled', 'blocker', `THB ${departure.balanceDue.toLocaleString('en-US')}`, 'Collect the balance or record an authorized exception.', 'Collect Balance', 'override:check-out'))
  } else {
    items.push(guard('folio_settled', 'Folio settled', 'info', 'THB 0 balance', 'No settlement action is required.', 'View Folio'))
  }

  if (departure.folioStatus && departure.folioStatus !== 'OPEN' && departure.folioStatus !== 'CLOSED') {
    items.push(guard('folio_status_warning', 'Folio status needs review', 'warning', departure.folioStatus, 'Review folio status before departure.', 'Review Charges'))
  }

  if (departure.checkOutDate && getBangkokDateKey(departure.checkOutDate) !== hotelDateKey) {
    items.push(guard('checkout_date_mismatch', 'Checkout date differs from today', 'warning', getBangkokDateKey(departure.checkOutDate), 'Confirm this is the intended departure date.', 'Add Note'))
  }

  const checkoutHour = Number(SANDBOX_HOTEL_RULES.checkOutTime.split(':')[0])
  const checkoutMinute = Number(SANDBOX_HOTEL_RULES.checkOutTime.split(':')[1])
  const afterStandardCheckout = now.getHours() > checkoutHour || (now.getHours() === checkoutHour && now.getMinutes() > checkoutMinute)
  if (afterStandardCheckout && (!departure.checkOutDate || getBangkokDateKey(departure.checkOutDate) === hotelDateKey)) {
    items.push(guard('late_checkout_warning', 'Late checkout time', 'warning', SANDBOX_HOTEL_RULES.checkOutTime, 'Apply late checkout fee if configured and applicable.', 'Review Charges'))
  }

  const blockers = items.filter((item) => item.severity === 'blocker')
  const warningOnly = blockers.length === 0 && items.some((item) => item.severity === 'warning')
  return summarizeGuards(items, blockers.length === 0 && !warningOnly)
}

export function getArrivalPrimaryAction(summary: WorkflowGuardSummary, arrival: ArrivalItem): FrontDeskActionState {
  if (arrival.status === 'CHECKED_IN') return { label: 'Checked In', intent: 'done', disabled: true }
  const firstBlocker = summary.blockers[0]
  if (!firstBlocker && summary.isExpressReady) return { label: 'Express Check-In', intent: 'express-check-in' }
  if (!firstBlocker) return { label: summary.warnings.length ? 'Check In' : 'Check In', intent: 'check-in' }
  if (firstBlocker.id === 'no_room_assigned') return { label: 'Assign Room', intent: 'assign-room' }
  if (firstBlocker.id === 'payment_due') return { label: 'Collect Payment', intent: 'collect-payment' }
  if (firstBlocker.id === 'room_not_ready') return { label: 'Room Not Ready', intent: 'room-not-ready' }
  return { label: 'Fix Issues', intent: 'fix-issues' }
}

export function getDeparturePrimaryAction(summary: WorkflowGuardSummary, departure: DepartureItem): FrontDeskActionState {
  if (departure.status === 'CHECKED_OUT') return { label: 'Checked Out', intent: 'done', disabled: true }
  const firstBlocker = summary.blockers[0]
  if (!firstBlocker && summary.isExpressReady) return { label: 'Express Check-Out', intent: 'express-check-out' }
  if (!firstBlocker) return { label: 'Check Out', intent: 'check-out' }
  if (firstBlocker.id === 'unsettled_balance') return { label: 'Settle Balance', intent: 'settle-balance' }
  return { label: 'Review Charges', intent: 'review-charges' }
}

export function buildRoomReadinessSummary(rooms: BoardRoomCard[]): RoomReadinessSummary {
  return rooms.reduce<RoomReadinessSummary>((summary, room) => {
    const occupied = isRoomOccupied(room)
    const outOfOrder = room.operationalStatus !== 'AVAILABLE' || !isSellableRoomNumber(room.number)
    if (occupied) summary.occupied += 1
    if (outOfOrder) summary.outOfOrder += 1
    if (room.cleanStatus === 'DIRTY' || room.status === 'VACANT_DIRTY' || room.status === 'OCCUPIED_DIRTY') summary.dirty += 1
    if (!occupied && !outOfOrder && (room.cleanStatus === 'CLEAN' || room.cleanStatus === 'INSPECTED')) {
      summary.cleanInspected += 1
      summary.availableByType[room.type] += 1
    }
    return summary
  }, {
    cleanInspected: 0,
    dirty: 0,
    occupied: 0,
    outOfOrder: 0,
    availableByType: { TWIN: 0, DOUBLE: 0 },
  })
}

export function toInHouseItem(room: BoardRoomCard, hotelDateKey: string): InHouseItem | null {
  if (!isRoomOccupied(room) || !room.guestName || !(room.currentReservationId || room.reservationId)) return null
  const checkOutDate = room.checkOut
  const nightsRemaining = checkOutDate ? Math.max(0, nightsBetween(hotelDateKey, checkOutDate)) : 0
  const balanceDue = Math.max(0, room.balanceDue ?? room.reservation?.balanceDue ?? 0)
  const roomStatus = room.cleanStatus === 'INSPECTED' ? 'INSPECTED' : room.cleanStatus === 'CLEAN' ? 'CLEAN' : 'DIRTY'
  const serviceFlags = [
    room.hasIssue || room.hasIssues ? 'Room issue' : '',
    room.cleanStatus === 'DIRTY' ? 'Service needed' : '',
    room.extendedStay ? 'Extended stay' : '',
  ].filter(Boolean)

  return {
    id: room.roomId,
    reservationId: room.currentReservationId || room.reservationId || room.roomId,
    confirmationCode: room.reservation?.id,
    guestName: room.guestName,
    roomNumber: room.number,
    assignedRoomId: room.roomId,
    roomType: room.type,
    checkInDate: room.checkIn,
    checkOutDate: room.checkOut,
    nights: room.checkIn && room.checkOut ? nightsBetween(room.checkIn, room.checkOut) : 1,
    nightsRemaining,
    balanceDue,
    folioTotal: room.reservation?.totalAmount,
    folioStatus: balanceDue > 0 ? 'OPEN' : 'CLOSED',
    paymentStatus: balanceDue > 0 ? 'UNPAID' : 'PAID',
    roomStatus,
    serviceFlags,
    mainAction: balanceDue > 0 ? 'SETTLE_BALANCE' : 'CHECK_OUT',
  }
}
