import {
  getRoomAssignmentDecision,
  nightsBetween,
  reservationsOverlap,
  type RoomAssignmentCandidate,
} from './business-rules'

export type OperationalReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'HOLD'
export type OperationalRoomCleanStatus = 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'MAINTENANCE'

export interface OperationalReservation {
  id: string
  status: OperationalReservationStatus
  guestName: string
  checkIn: Date | string
  checkOut: Date | string
  assignedRoomId?: string
  roomNumber?: string
  totalAmount?: number
  paidAmount?: number
  balanceDue?: number
}

export interface OperationalRoom extends RoomAssignmentCandidate {
  roomId: string
  cleanStatus: OperationalRoomCleanStatus
}

export interface AuditRecord {
  id: string
  entityType: 'reservation' | 'room' | 'payment' | 'housekeeping'
  entityId: string
  action: string
  message: string
  actor: string
  createdAt: string
}

export interface GuardResult {
  ok: boolean
  message?: string
  warnings: string[]
}

export interface TransitionResult<TReservation = OperationalReservation, TRoom = OperationalRoom> {
  reservation: TReservation
  room: TRoom
  audit: AuditRecord
  warnings: string[]
}

export interface PaymentSummary {
  total: number
  paid: number
  balance: number
  status: 'paid' | 'partial' | 'unpaid' | 'overpaid'
}

function todayKey(now: Date | string): string {
  return (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10)
}

function reservationDateAllowsCheckIn(reservation: OperationalReservation, now: Date | string) {
  const today = todayKey(now)
  return today >= todayKey(reservation.checkIn) && today < todayKey(reservation.checkOut)
}

export function createAuditRecord(
  entityType: AuditRecord['entityType'],
  entityId: string,
  action: string,
  message: string,
  actor = 'Staff',
  now: Date | string = new Date(),
): AuditRecord {
  return {
    id: `${entityType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entityType,
    entityId,
    action,
    message,
    actor,
    createdAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
}

export function validateRoomAssignment(
  reservation: OperationalReservation,
  room: OperationalRoom,
  existingAssignments: Array<OperationalReservation & { assignedRoomId?: string }> = [],
): GuardResult {
  const warnings: string[] = []

  if (nightsBetween(reservation.checkIn, reservation.checkOut) === 0) {
    return { ok: false, message: 'Check-out must be after check-in.', warnings }
  }

  const roomDecision = getRoomAssignmentDecision(room, {
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    excludeReservationId: reservation.id,
  })

  if (!roomDecision.assignable) {
    const messages = {
      non_sellable: `Room ${room.number} is non-sellable and cannot be assigned.`,
      blocked: `Room ${room.number} is blocked and cannot be assigned.`,
      out_of_order: `Room ${room.number} is out of order and cannot be assigned.`,
      occupied: `Room ${room.number} is occupied for the selected dates.`,
      invalid_dates: 'Check-out must be after check-in.',
      assignable: '',
    }
    return { ok: false, message: messages[roomDecision.reason], warnings }
  }

  const hasOverlap = existingAssignments.some((existing) =>
    existing.id !== reservation.id &&
    existing.assignedRoomId === room.roomId &&
    !['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(existing.status) &&
    reservationsOverlap(reservation.checkIn, reservation.checkOut, existing.checkIn, existing.checkOut)
  )

  if (hasOverlap) {
    return { ok: false, message: `Room ${room.number} already has a reservation for these dates.`, warnings }
  }

  if (room.cleanStatus === 'DIRTY' || room.cleanStatus === 'CLEANING') {
    warnings.push(`Room ${room.number} is not ready yet.`)
  }

  return { ok: true, warnings }
}

export function validateCheckIn(
  reservation: OperationalReservation,
  room: OperationalRoom | undefined,
  options: { now?: Date | string; allowRoomReadinessOverride?: boolean } = {},
): GuardResult {
  const warnings: string[] = []

  if (reservation.status !== 'CONFIRMED' && reservation.status !== 'PENDING') {
    return { ok: false, message: 'Only confirmed or pending reservations can be checked in.', warnings }
  }

  if (!reservationDateAllowsCheckIn(reservation, options.now ?? new Date())) {
    return { ok: false, message: 'This reservation is not within the allowed check-in date range.', warnings }
  }

  if (!reservation.assignedRoomId || !reservation.roomNumber || !room) {
    return { ok: false, message: 'Assign a room before checking in this reservation.', warnings }
  }

  const assignment = validateRoomAssignment(reservation, room)
  if (!assignment.ok) return assignment

  if (room.cleanStatus !== 'CLEAN' && room.cleanStatus !== 'INSPECTED') {
    if (!options.allowRoomReadinessOverride) {
      return { ok: false, message: `Room ${room.number} must be clean or inspected before check-in.`, warnings }
    }
    warnings.push(`Room ${room.number} was checked in with a room-readiness override.`)
  }

  const balance = reservation.balanceDue ?? Math.max(0, (reservation.totalAmount ?? 0) - (reservation.paidAmount ?? 0))
  if (balance > 0) {
    warnings.push(`Outstanding balance: THB ${balance.toLocaleString('en-TH')}.`)
  }

  return { ok: true, warnings }
}

export function applyCheckInTransition<TReservation extends OperationalReservation, TRoom extends OperationalRoom>(
  reservation: TReservation,
  room: TRoom,
  actor = 'Front desk',
  now: Date | string = new Date(),
): TransitionResult<TReservation, TRoom> {
  return {
    reservation: {
      ...reservation,
      status: 'CHECKED_IN',
      assignedRoomId: room.roomId,
      roomNumber: room.number,
    },
    room: {
      ...room,
      status: room.cleanStatus === 'DIRTY' || room.cleanStatus === 'CLEANING' ? 'OCCUPIED_DIRTY' : 'OCCUPIED_CLEAN',
      reservationId: reservation.id,
    },
    audit: createAuditRecord('reservation', reservation.id, 'CHECKED_IN', `${reservation.guestName} checked in to Room ${room.number}.`, actor, now),
    warnings: [],
  }
}

export function validateCheckOut(
  reservation: OperationalReservation,
  options: { allowUnpaidOverride?: boolean } = {},
): GuardResult {
  const warnings: string[] = []

  if (reservation.status !== 'CHECKED_IN') {
    return { ok: false, message: 'Only checked-in reservations can be checked out.', warnings }
  }

  const balance = reservation.balanceDue ?? Math.max(0, (reservation.totalAmount ?? 0) - (reservation.paidAmount ?? 0))
  if (balance > 0) {
    if (!options.allowUnpaidOverride) {
      return { ok: false, message: 'Collect or override the remaining balance before checkout.', warnings }
    }
    warnings.push(`Checkout completed with unpaid balance: THB ${balance.toLocaleString('en-TH')}.`)
  }

  return { ok: true, warnings }
}

export function applyCheckOutTransition<TReservation extends OperationalReservation, TRoom extends OperationalRoom>(
  reservation: TReservation,
  room: TRoom,
  actor = 'Front desk',
  now: Date | string = new Date(),
): TransitionResult<TReservation, TRoom> {
  return {
    reservation: {
      ...reservation,
      status: 'CHECKED_OUT',
    },
    room: {
      ...room,
      status: 'VACANT_DIRTY',
      cleanStatus: 'DIRTY',
      reservationId: undefined,
    },
    audit: createAuditRecord('reservation', reservation.id, 'CHECKED_OUT', `${reservation.guestName} checked out from Room ${room.number}. Room marked dirty.`, actor, now),
    warnings: [],
  }
}

export function transitionHousekeepingStatus<TRoom extends OperationalRoom>(
  room: TRoom,
  toStatus: OperationalRoomCleanStatus,
  actor = 'Housekeeping',
  now: Date | string = new Date(),
): { room: TRoom; audit: AuditRecord } {
  const isOccupied = room.status === 'OCCUPIED_CLEAN' || room.status === 'OCCUPIED_DIRTY'
  const boardStatus = toStatus === 'CLEAN' || toStatus === 'INSPECTED'
    ? (isOccupied ? 'OCCUPIED_CLEAN' : 'VACANT_CLEAN')
    : (isOccupied ? 'OCCUPIED_DIRTY' : 'VACANT_DIRTY')

  return {
    room: {
      ...room,
      cleanStatus: toStatus === 'CLEANING' ? 'DIRTY' : toStatus,
      status: boardStatus,
      operationalStatus: toStatus === 'MAINTENANCE' ? 'OUT_OF_ORDER' : room.operationalStatus,
    },
    audit: createAuditRecord('housekeeping', room.roomId, toStatus, `Room ${room.number} marked ${toStatus.toLowerCase().replace('_', ' ')}.`, actor, now),
  }
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

export function summarizePayments(totalAmount: number, payments: number[]): PaymentSummary {
  const total = roundMoney(totalAmount)
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment, 0))
  const balance = roundMoney(total - paid)

  return {
    total,
    paid,
    balance,
    status: balance < 0 ? 'overpaid' : balance === 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  }
}

export function validatePaymentAmount(
  amount: number,
  balanceDue: number,
  options: { allowOverpayment?: boolean; refundMode?: boolean } = {},
): GuardResult {
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, message: 'Enter a valid payment amount.', warnings: [] }
  }

  if (!options.refundMode && amount < 0) {
    return { ok: false, message: 'Payments cannot be negative. Use a refund flow for refunds.', warnings: [] }
  }

  if (options.refundMode && amount > 0) {
    return { ok: false, message: 'Refund amounts must be entered as a negative value.', warnings: [] }
  }

  if (!options.allowOverpayment && amount > balanceDue) {
    return { ok: false, message: 'Payment cannot exceed the remaining balance.', warnings: [] }
  }

  return { ok: true, warnings: [] }
}
