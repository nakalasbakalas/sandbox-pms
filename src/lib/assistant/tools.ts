import type { BoardRoomCard } from '@/types/board'
import type { ArrivalItem, DepartureItem } from '@/types/front-desk'
import {
  buildCheckInGuards,
  buildCheckOutGuards,
  findBestAvailableRoom,
  isRoomOccupied,
} from '@/lib/front-desk-workflow'
import {
  getBangkokDateKey,
  getRoomAssignmentDecision,
  isSellableRoomNumber,
  nightsBetween,
  reservationsOverlap,
  SANDBOX_HOTEL_RULES,
} from '@/lib/hotel/business-rules'
import { isRoomReadyForArrival } from '@/lib/hotel/rooms'
import { canSeeFinancialDetails, withPermissionState } from './guards'
import type {
  AssistantAction,
  AssistantAnswer,
  AssistantEntities,
  AssistantRecordRef,
  AssistantReservation,
  AssistantSnapshot,
} from './types'

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'HOLD', 'CHECKED_IN'])

function answerId() {
  return `ai-answer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function money(amount: number) {
  return `THB ${Math.max(0, amount).toLocaleString('en-US')}`
}

function roomLabel(room: Pick<BoardRoomCard, 'number' | 'type' | 'cleanStatus' | 'operationalStatus'>) {
  return `Room ${room.number} (${room.type}, ${room.cleanStatus.toLowerCase()}, ${room.operationalStatus.toLowerCase().replaceAll('_', ' ')})`
}

function reservationLabel(reservation: AssistantReservation) {
  const code = reservation.confirmationCode || reservation.id
  const room = reservation.roomNumber ? `, Room ${reservation.roomNumber}` : ', no room assigned'
  return `${reservation.guestName}, ${code}${room}`
}

function roomRef(room: BoardRoomCard): AssistantRecordRef {
  return {
    type: 'room',
    id: room.roomId,
    label: `Room ${room.number}`,
    detail: `${room.type} - ${room.cleanStatus} - ${room.operationalStatus}`,
  }
}

function reservationRef(reservation: AssistantReservation): AssistantRecordRef {
  return {
    type: 'reservation',
    id: reservation.id,
    label: reservation.confirmationCode || reservation.id,
    detail: reservationLabel(reservation),
  }
}

function folioRef(reservation: AssistantReservation): AssistantRecordRef {
  return {
    type: 'folio',
    id: reservation.folioId || reservation.id,
    label: `${reservation.confirmationCode || reservation.id} folio`,
    detail: `${money(reservation.balanceDue)} balance due`,
  }
}

function makeAnswer(
  snapshot: AssistantSnapshot,
  partial: Omit<AssistantAnswer, 'id' | 'actions'> & { actions?: AssistantAction[] },
): AssistantAnswer {
  return {
    id: answerId(),
    ...partial,
    actions: withPermissionState(partial.actions || [], snapshot.user),
  }
}

export function normalizeServerReservation(reservation: any): AssistantReservation {
  const guestName = `${reservation?.guest?.firstName || ''} ${reservation?.guest?.lastName || ''}`.trim() || 'Guest name required'
  return {
    id: reservation.id,
    confirmationCode: reservation.confirmationCode,
    guestName,
    roomType: reservation.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN',
    status: reservation.status,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    adults: reservation.adults || 1,
    children: reservation.children || 0,
    assignedRoomId: reservation.assignedRoomId || undefined,
    roomNumber: reservation.assignedRoom?.number || undefined,
    balanceDue: Math.max(0, reservation.folio?.balance || 0),
    paidAmount: reservation.folio?.paid || 0,
    totalAmount: reservation.totalAmount || reservation.folio?.total || 0,
    folioId: reservation.folio?.id,
    folioStatus: reservation.folio?.status,
    depositPaid: Boolean(reservation.depositPaid),
    documentVerified: Boolean(reservation.guest?.nationality && reservation.guest?.idNumber),
    guestNationality: reservation.guest?.nationality || undefined,
    guestIdNumber: reservation.guest?.idNumber || undefined,
    specialRequests: reservation.specialRequests || undefined,
    notes: reservation.notes || undefined,
    source: reservation.source || undefined,
  }
}

export function normalizeRoomReservation(room: BoardRoomCard): AssistantReservation | null {
  if (!room.guestName || !(room.reservationId || room.currentReservationId)) return null
  return {
    id: room.currentReservationId || room.reservationId || room.roomId,
    confirmationCode: room.reservation?.id,
    guestName: room.guestName,
    roomType: room.type,
    status: isRoomOccupied(room) ? 'CHECKED_IN' : 'CONFIRMED',
    checkIn: room.checkIn || new Date(),
    checkOut: room.checkOut || new Date(Date.now() + 86_400_000),
    adults: Math.max(1, room.guestCount || 1),
    children: 0,
    assignedRoomId: room.roomId,
    roomNumber: room.number,
    balanceDue: Math.max(0, room.balanceDue ?? room.reservation?.balanceDue ?? 0),
    totalAmount: room.reservation?.totalAmount,
    depositPaid: room.depositStatus === 'PAID',
    documentVerified: Boolean(room.reservation?.id),
    source: 'Room board',
  }
}

export function mergeReservations(...groups: AssistantReservation[][]) {
  const byId = new Map<string, AssistantReservation>()
  for (const reservation of groups.flat()) {
    byId.set(reservation.id, { ...byId.get(reservation.id), ...reservation })
  }
  return [...byId.values()]
}

function activeReservations(snapshot: AssistantSnapshot) {
  return snapshot.reservations.filter((reservation) => ACTIVE_STATUSES.has(reservation.status))
}

function reservationsOnDate(snapshot: AssistantSnapshot, dateKey: string, statuses?: string[]) {
  return snapshot.reservations.filter((reservation) => {
    if (statuses && !statuses.includes(reservation.status)) return false
    return getBangkokDateKey(reservation.checkIn) === dateKey
  })
}

function departuresOnDate(snapshot: AssistantSnapshot, dateKey: string) {
  return snapshot.reservations.filter((reservation) =>
    reservation.status === 'CHECKED_IN' && getBangkokDateKey(reservation.checkOut) === dateKey
  )
}

function findRoom(snapshot: AssistantSnapshot, roomIdOrNumber?: string) {
  if (!roomIdOrNumber) return undefined
  return snapshot.rooms.find((room) => room.roomId === roomIdOrNumber || room.number === roomIdOrNumber)
}

function findReservation(snapshot: AssistantSnapshot, entities: AssistantEntities, query = '') {
  const lowered = query.toLowerCase()
  if (entities.reservationCode) {
    const code = entities.reservationCode.toLowerCase()
    return snapshot.reservations.filter((reservation) =>
      reservation.id.toLowerCase() === code ||
      reservation.confirmationCode?.toLowerCase() === code
    )
  }
  if (snapshot.currentReservationId && /\b(them|this guest|this reservation|current)\b/i.test(query)) {
    return snapshot.reservations.filter((reservation) => reservation.id === snapshot.currentReservationId)
  }
  if (entities.roomNumber) {
    return snapshot.reservations.filter((reservation) => reservation.roomNumber === entities.roomNumber)
  }
  const guest = entities.guestName || query
  const cleaned = guest
    .replace(/\b(find|search|booking|reservation|for|guest|can|i|check|in|out|why|cannot|can.t|them|this)\b/gi, '')
    .trim()
    .toLowerCase()
  if (!cleaned) return []
  return snapshot.reservations.filter((reservation) =>
    reservation.guestName.toLowerCase().includes(cleaned) ||
    reservation.confirmationCode?.toLowerCase().includes(cleaned) ||
    reservation.id.toLowerCase().includes(cleaned)
  )
}

function toArrival(reservation: AssistantReservation, room?: BoardRoomCard): ArrivalItem {
  const balanceDue = Math.max(0, reservation.balanceDue)
  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    guestName: reservation.guestName,
    roomNumber: reservation.roomNumber,
    assignedRoomId: reservation.assignedRoomId,
    roomType: reservation.roomType,
    checkInTime: SANDBOX_HOTEL_RULES.checkInTime,
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    nights: nightsBetween(reservation.checkIn, reservation.checkOut),
    adults: reservation.adults,
    children: reservation.children,
    status: reservation.status === 'CHECKED_IN' ? 'CHECKED_IN' : room && isRoomReadyForArrival(room) ? 'READY' : 'DUE_IN',
    reservationStatus: reservation.status,
    roomReady: Boolean(room && isRoomReadyForArrival(room)),
    depositPaid: Boolean(reservation.depositPaid || balanceDue <= 0),
    documentVerified: Boolean(reservation.documentVerified),
    guestNationality: reservation.guestNationality,
    guestIdNumber: reservation.guestIdNumber,
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
    source: reservation.source || 'PMS',
    bookedRate: 0,
    totalAmount: reservation.totalAmount || balanceDue,
    paidAmount: reservation.paidAmount,
    balanceDue,
    paymentStatus: balanceDue <= 0 ? 'PAID' : (reservation.paidAmount || 0) > 0 ? 'PARTIAL' : 'UNPAID',
    roomStatus: room?.status,
    operationalStatus: room?.operationalStatus,
  }
}

function toDeparture(reservation: AssistantReservation): DepartureItem {
  return {
    id: reservation.id,
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    guestName: reservation.guestName,
    roomNumber: reservation.roomNumber || 'TBD',
    assignedRoomId: reservation.assignedRoomId,
    roomType: reservation.roomType,
    checkOutTime: SANDBOX_HOTEL_RULES.checkOutTime,
    checkInDate: reservation.checkIn,
    checkOutDate: reservation.checkOut,
    nights: nightsBetween(reservation.checkIn, reservation.checkOut),
    status: 'IN_HOUSE',
    reservationStatus: reservation.status,
    balanceDue: Math.max(0, reservation.balanceDue),
    paidAmount: reservation.paidAmount,
    folioTotal: reservation.totalAmount || reservation.balanceDue,
    folioStatus: reservation.folioStatus || (reservation.balanceDue > 0 ? 'OPEN' : 'CLOSED'),
    paymentStatus: reservation.balanceDue <= 0 ? 'PAID' : (reservation.paidAmount || 0) > 0 ? 'PARTIAL' : 'UNPAID',
    roomStatus: 'CLEAN',
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
  }
}

function action(type: AssistantAction['type'], label: string, payload: Record<string, unknown>, options: Partial<AssistantAction> = {}): AssistantAction {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    label,
    payload,
    ...options,
  }
}

function availability(snapshot: AssistantSnapshot, entities: AssistantEntities) {
  const range = entities.dateRange || { checkIn: snapshot.hotelDateKey, checkOut: snapshot.hotelDateKey, label: 'today' }
  const candidates = snapshot.rooms
    .filter((room) => !entities.roomType || room.type === entities.roomType)
    .filter((room) => isSellableRoomNumber(room.number))
    .map((room) => {
      const overlaps = activeReservations(snapshot).filter((reservation) =>
        reservation.assignedRoomId === room.roomId &&
        reservationsOverlap(range.checkIn, range.checkOut, reservation.checkIn, reservation.checkOut)
      )
      const decision = getRoomAssignmentDecision(room, { checkIn: range.checkIn, checkOut: range.checkOut })
      return { room, overlaps, assignable: decision.assignable && overlaps.length === 0 }
    })

  const available = candidates.filter((candidate) => candidate.assignable)
  const ready = available.filter((candidate) => isRoomReadyForArrival(candidate.room))
  const blocked = candidates.filter((candidate) => !candidate.assignable)
  const typeLabel = entities.roomType ? ` ${entities.roomType.toLowerCase()}` : ''
  const best = ready[0] || available[0]
  const directAnswer = available.length
    ? `Yes. ${available.length}${typeLabel} room${available.length === 1 ? '' : 's'} appear available ${range.label}. ${ready.length} are clean/ready.${best ? ` Best option: Room ${best.room.number}.` : ''}`
    : `No${typeLabel} rooms appear available ${range.label}.`

  return makeAnswer(snapshot, {
    intent: 'CHECK_AVAILABILITY',
    title: 'Availability',
    directAnswer,
    records: [...available.slice(0, 8).map((item) => roomRef(item.room)), ...blocked.slice(0, 4).map((item) => ({
      ...roomRef(item.room),
      detail: item.overlaps.length ? `Unavailable: overlaps ${item.overlaps.map((reservation) => reservation.confirmationCode || reservation.id).join(', ')}` : `Unavailable: ${item.room.operationalStatus}`,
    }))],
    warnings: blocked.length ? [`${blocked.length} room${blocked.length === 1 ? '' : 's'} excluded due to occupancy, blocked, or out-of-order state.`] : [],
    nextAction: best ? `Use Room ${best.room.number} for the next matching reservation or assignment.` : 'Check another room type or date range.',
    actions: [
      ...(best ? [action('OPEN_ROOM', `View Room ${best.room.number}`, { roomId: best.room.roomId, roomNumber: best.room.number })] : []),
      action('CREATE_WALK_IN_DRAFT', 'New Reservation', { roomType: entities.roomType, roomId: best?.room.roomId }, {
        permission: 'create:reservation',
        description: 'Opens the front desk reservation workflow for staff entry and confirmation.',
      }),
    ],
  })
}

function arrivals(snapshot: AssistantSnapshot, entities: AssistantEntities) {
  const dateKey = entities.dateRange?.checkIn || snapshot.hotelDateKey
  const arrivals = reservationsOnDate(snapshot, dateKey, ['PENDING', 'CONFIRMED', 'HOLD'])
  const ready = arrivals.filter((reservation) => {
    const room = findRoom(snapshot, reservation.assignedRoomId)
    return room && buildCheckInGuards(toArrival(reservation, room), room, { hotelDateKey: dateKey, role: snapshot.user?.role }).blockers.length === 0
  })
  const blocked = arrivals.length - ready.length
  return makeAnswer(snapshot, {
    intent: 'LIST_ARRIVALS',
    title: 'Arrivals',
    directAnswer: arrivals.length
      ? `${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'} found for ${dateKey}. ${ready.length} appear ready for check-in; ${blocked} blocked or need review.`
      : `No arrivals found for ${dateKey}.`,
    records: arrivals.slice(0, 12).map(reservationRef),
    warnings: arrivals.filter((reservation) => !reservation.assignedRoomId).map((reservation) => `${reservation.guestName} has no room assigned.`).slice(0, 4),
    nextAction: ready[0] ? `Check in ${ready[0].guestName} if they are present.` : arrivals.length ? 'Resolve the blocked arrivals first.' : 'No arrival action needed.',
    actions: ready[0] ? [
      action('OPEN_CHECK_IN', `Open Check-In for ${ready[0].guestName}`, { reservationId: ready[0].id }, { permission: 'check-in:guest' }),
      action('COMPLETE_EXPRESS_CHECK_IN', `Express Check-In ${ready[0].guestName}`, { reservationId: ready[0].id }, { permission: 'check-in:guest', requiresConfirmation: true, risk: 'high' }),
    ] : [],
  })
}

function departures(snapshot: AssistantSnapshot, entities: AssistantEntities) {
  const dateKey = entities.dateRange?.checkIn || snapshot.hotelDateKey
  const departures = departuresOnDate(snapshot, dateKey)
  const unpaid = departures.filter((reservation) => reservation.balanceDue > 0)
  return makeAnswer(snapshot, {
    intent: 'LIST_DEPARTURES',
    title: 'Departures',
    directAnswer: departures.length
      ? `${departures.length} departure${departures.length === 1 ? '' : 's'} found for ${dateKey}. ${unpaid.length} have balance due.`
      : `No departures found for ${dateKey}.`,
    records: departures.slice(0, 12).map(reservationRef),
    warnings: canSeeFinancialDetails(snapshot.user?.role) ? unpaid.map((reservation) => `${reservation.guestName} owes ${money(reservation.balanceDue)}.`).slice(0, 5) : [],
    nextAction: unpaid[0] ? `Collect ${money(unpaid[0].balanceDue)} before checkout for ${unpaid[0].guestName}.` : departures[0] ? 'Express checkout is available for settled departures.' : 'No departure action needed.',
    actions: departures[0] ? [
      action('OPEN_CHECK_OUT', `Open Checkout for ${departures[0].guestName}`, { reservationId: departures[0].id }, { permission: 'check-out:guest' }),
      ...(unpaid.length === 0 ? [action('COMPLETE_EXPRESS_CHECK_OUT', `Express Checkout ${departures[0].guestName}`, { reservationId: departures[0].id }, { permission: 'check-out:guest', requiresConfirmation: true, risk: 'high' })] : []),
    ] : [],
  })
}

function inHouse(snapshot: AssistantSnapshot) {
  const stays = snapshot.reservations.filter((reservation) => reservation.status === 'CHECKED_IN')
  return makeAnswer(snapshot, {
    intent: 'LIST_IN_HOUSE',
    title: 'In-House Guests',
    directAnswer: stays.length ? `${stays.length} guest${stays.length === 1 ? ' is' : 's are'} currently in-house.` : 'No in-house guests were found.',
    records: stays.slice(0, 12).map(reservationRef),
    warnings: stays.filter((reservation) => reservation.balanceDue > 0 && canSeeFinancialDetails(snapshot.user?.role)).map((reservation) => `${reservation.guestName} has ${money(reservation.balanceDue)} balance due.`),
    nextAction: stays.some((reservation) => getBangkokDateKey(reservation.checkOut) === snapshot.hotelDateKey) ? 'Review today\'s departures for checkout readiness.' : 'Monitor room and housekeeping status.',
    actions: stays[0] ? [action('OPEN_RESERVATION', `Open ${stays[0].guestName}`, { reservationId: stays[0].id })] : [],
  })
}

function housekeeping(snapshot: AssistantSnapshot, entities: AssistantEntities) {
  const room = findRoom(snapshot, entities.roomNumber)
  if (room) {
    const next = room.cleanStatus === 'DIRTY' ? 'Mark clean after housekeeping finishes.' : room.cleanStatus === 'CLEAN' ? 'Inspect the room before marking ready.' : 'No housekeeping action is required.'
    return makeAnswer(snapshot, {
      intent: 'ROOM_STATUS',
      title: `Room ${room.number}`,
      directAnswer: `${roomLabel(room)}. ${room.guestName ? `Current guest: ${room.guestName}.` : 'No guest assigned in the current board state.'}`,
      records: [roomRef(room), ...(room.reservationId ? [{ type: 'reservation' as const, id: room.reservationId, label: room.reservationId, detail: room.guestName }] : [])],
      warnings: room.operationalStatus !== 'AVAILABLE' ? [`Room ${room.number} is ${room.operationalStatus.toLowerCase().replaceAll('_', ' ')}.`] : [],
      nextAction: next,
      actions: [
        action('OPEN_ROOM', `View Room ${room.number}`, { roomId: room.roomId, roomNumber: room.number }),
        ...(room.cleanStatus === 'DIRTY' ? [action('MARK_ROOM_CLEAN', 'Mark Clean', { roomId: room.roomId }, { permission: 'edit:room-status', requiresConfirmation: true, risk: 'medium' })] : []),
        ...(room.cleanStatus === 'CLEAN' ? [action('MARK_ROOM_READY', 'Mark Ready', { roomId: room.roomId }, { permission: 'edit:room-status', requiresConfirmation: true, risk: 'high' })] : []),
      ],
    })
  }

  const dirty = snapshot.rooms.filter((candidate) => candidate.cleanStatus === 'DIRTY' || candidate.status === 'VACANT_DIRTY' || candidate.status === 'OCCUPIED_DIRTY')
  const ready = snapshot.rooms.filter((candidate) => isRoomReadyForArrival(candidate))
  return makeAnswer(snapshot, {
    intent: 'HOUSEKEEPING_STATUS',
    title: 'Housekeeping',
    directAnswer: `${ready.length} rooms are ready now. ${dirty.length} rooms need cleaning or service attention.`,
    records: [...ready.slice(0, 8).map(roomRef), ...dirty.slice(0, 8).map(roomRef)],
    warnings: dirty.filter((candidate) => candidate.isArrivalToday).map((candidate) => `Room ${candidate.number} is dirty and needed for an arrival.`),
    nextAction: dirty.length ? `Prioritize ${dirty[0].number}${dirty[0].isArrivalToday ? ' for today\'s arrival' : ''}.` : 'No cleaning queue risk found.',
    actions: dirty[0] ? [
      action('OPEN_ROOM', `View Room ${dirty[0].number}`, { roomId: dirty[0].roomId, roomNumber: dirty[0].number }),
      action('MARK_ROOM_CLEANING', `Mark Room ${dirty[0].number} Cleaning`, { roomId: dirty[0].roomId }, { permission: 'edit:room-status', requiresConfirmation: true, risk: 'medium' }),
    ] : [],
  })
}

function payments(snapshot: AssistantSnapshot, entities: AssistantEntities, query: string) {
  if (!canSeeFinancialDetails(snapshot.user?.role)) {
    return makeAnswer(snapshot, {
      intent: 'PAYMENT_BALANCE',
      title: 'Payment Access Restricted',
      directAnswer: 'Your role cannot view guest payment or folio balances.',
      records: [],
      warnings: ['Payment details are hidden for this role.'],
      nextAction: 'Ask front desk, cashier, manager, or admin to review folio details.',
      actions: [],
    })
  }

  const matches = findReservation(snapshot, entities, query)
  const records = matches.length ? matches : snapshot.reservations.filter((reservation) => reservation.balanceDue > 0)
  const unpaid = records.filter((reservation) => reservation.balanceDue > 0)
  return makeAnswer(snapshot, {
    intent: 'PAYMENT_BALANCE',
    title: 'Balances',
    directAnswer: matches.length === 1
      ? `${matches[0].guestName} has ${money(matches[0].balanceDue)} balance due.`
      : `${unpaid.length} reservation${unpaid.length === 1 ? '' : 's'} have balance due.`,
    records: records.slice(0, 12).map((reservation) => reservation.balanceDue > 0 ? folioRef(reservation) : reservationRef(reservation)),
    warnings: unpaid.slice(0, 6).map((reservation) => `${reservation.guestName}: ${money(reservation.balanceDue)} due.`),
    nextAction: unpaid[0] ? `Open payment panel for ${unpaid[0].guestName}.` : 'No balance action needed.',
    actions: unpaid[0] ? [action('OPEN_PAYMENT', `Open Payment for ${unpaid[0].guestName}`, { reservationId: unpaid[0].id, folioId: unpaid[0].folioId }, { permission: 'process:payment' })] : [],
  })
}

function eligibility(snapshot: AssistantSnapshot, entities: AssistantEntities, query: string, mode: 'check-in' | 'check-out') {
  const matches = findReservation(snapshot, entities, query)
  if (matches.length !== 1) {
    return makeAnswer(snapshot, {
      intent: mode === 'check-in' ? 'CHECK_IN_ELIGIBILITY' : 'CHECK_OUT_ELIGIBILITY',
      title: 'Choose a Reservation',
      directAnswer: matches.length === 0 ? 'I could not find that reservation.' : `I found ${matches.length} matching reservations. Please choose one.`,
      records: matches.slice(0, 8).map(reservationRef),
      warnings: matches.length > 1 ? ['Multiple matches found; no action will run until one reservation is clear.'] : [],
      nextAction: matches.length ? 'Open the correct reservation or ask with the reservation code.' : 'Search by guest name, room number, or SBX code.',
      actions: matches.slice(0, 4).map((reservation) => action('OPEN_RESERVATION', `Open ${reservation.guestName}`, { reservationId: reservation.id })),
    })
  }

  const reservation = matches[0]
  const room = findRoom(snapshot, reservation.assignedRoomId)
  if (mode === 'check-in') {
    const arrival = toArrival(reservation, room)
    const guards = buildCheckInGuards(arrival, room, { hotelDateKey: snapshot.hotelDateKey, role: snapshot.user?.role })
    const bestRoom = !reservation.assignedRoomId ? findBestAvailableRoom(snapshot.rooms, arrival) : undefined
    const blockers = guards.blockers.map((item) => `${item.label}: ${item.status}`)
    return makeAnswer(snapshot, {
      intent: 'CHECK_IN_ELIGIBILITY',
      title: `Check-In: ${reservation.guestName}`,
      directAnswer: guards.blockers.length
        ? `${reservation.confirmationCode || reservation.id} cannot be checked in yet.`
        : `${reservation.guestName} is ready for check-in${room ? ` in Room ${room.number}` : ''}.`,
      records: [reservationRef(reservation), ...(room ? [roomRef(room)] : [])],
      warnings: [...blockers, ...guards.warnings.map((item) => `${item.label}: ${item.status}`)],
      nextAction: guards.blockers[0]?.requiredAction || 'Confirm with the guest, then complete express check-in.',
      actions: [
        ...(bestRoom ? [action('ASSIGN_BEST_ROOM', `Assign Room ${bestRoom.number}`, { reservationId: reservation.id, roomId: bestRoom.roomId }, { permission: 'edit:reservation', requiresConfirmation: true, risk: 'medium' })] : []),
        action('OPEN_CHECK_IN', 'Open Check-In', { reservationId: reservation.id }, { permission: 'check-in:guest' }),
        ...(guards.blockers.length === 0 ? [action('COMPLETE_EXPRESS_CHECK_IN', 'Complete Express Check-In', { reservationId: reservation.id }, { permission: 'check-in:guest', requiresConfirmation: true, risk: 'high' })] : []),
        ...(reservation.balanceDue > 0 ? [action('OPEN_PAYMENT', 'Collect Payment', { reservationId: reservation.id, folioId: reservation.folioId }, { permission: 'process:payment' })] : []),
      ],
    })
  }

  const departure = toDeparture(reservation)
  const guards = buildCheckOutGuards(departure, { hotelDateKey: snapshot.hotelDateKey, role: snapshot.user?.role })
  const assignedRoom = findRoom(snapshot, reservation.assignedRoomId)
  return makeAnswer(snapshot, {
    intent: 'CHECK_OUT_ELIGIBILITY',
    title: `Checkout: ${reservation.guestName}`,
    directAnswer: guards.blockers.length
      ? `${reservation.confirmationCode || reservation.id} cannot be checked out yet.`
      : `${reservation.guestName} is ready for express checkout.`,
    records: [reservationRef(reservation), ...(assignedRoom ? [roomRef(assignedRoom)] : [])],
    warnings: [...guards.blockers.map((item) => `${item.label}: ${item.status}`), ...guards.warnings.map((item) => `${item.label}: ${item.status}`)],
    nextAction: guards.blockers[0]?.requiredAction || 'Confirm key return and room condition, then complete checkout.',
    actions: [
      action('OPEN_CHECK_OUT', 'Open Checkout', { reservationId: reservation.id }, { permission: 'check-out:guest' }),
      ...(guards.blockers.length === 0 ? [action('COMPLETE_EXPRESS_CHECK_OUT', 'Complete Express Checkout', { reservationId: reservation.id }, { permission: 'check-out:guest', requiresConfirmation: true, risk: 'high' })] : []),
      ...(reservation.balanceDue > 0 ? [action('OPEN_PAYMENT', 'Collect Balance', { reservationId: reservation.id, folioId: reservation.folioId }, { permission: 'process:payment' })] : []),
    ],
  })
}

function search(snapshot: AssistantSnapshot, entities: AssistantEntities, query: string) {
  const matches = findReservation(snapshot, entities, query)
  return makeAnswer(snapshot, {
    intent: 'FIND_RESERVATION',
    title: 'Reservation Search',
    directAnswer: matches.length
      ? `I found ${matches.length} matching reservation${matches.length === 1 ? '' : 's'}.`
      : 'I could not find a matching reservation.',
    records: matches.slice(0, 12).map(reservationRef),
    warnings: matches.length > 1 ? ['Multiple matches found. Use the reservation code or room number for exact actions.'] : [],
    nextAction: matches[0] ? `Open ${matches[0].guestName}'s reservation.` : 'Search by SBX code, room number, or more of the guest name.',
    actions: matches.slice(0, 4).map((reservation) => action('OPEN_RESERVATION', `Open ${reservation.guestName}`, { reservationId: reservation.id })),
  })
}

function risks(snapshot: AssistantSnapshot) {
  const todayArrivals = reservationsOnDate(snapshot, snapshot.hotelDateKey, ['PENDING', 'CONFIRMED', 'HOLD'])
  const todayDepartures = departuresOnDate(snapshot, snapshot.hotelDateKey)
  const warnings: string[] = []

  for (const reservation of todayArrivals) {
    const room = findRoom(snapshot, reservation.assignedRoomId)
    if (!reservation.assignedRoomId) warnings.push(`${reservation.guestName}: no room assigned.`)
    if (room && !isRoomReadyForArrival(room)) warnings.push(`${reservation.guestName}: assigned Room ${room.number} is not ready.`)
    if (reservation.adults + reservation.children > SANDBOX_HOTEL_RULES.maxOccupancy) warnings.push(`${reservation.guestName}: over max occupancy.`)
    if (!reservation.documentVerified) warnings.push(`${reservation.guestName}: ID/passport details missing.`)
    if (reservation.guestNationality && !/^thai?land$|^thai$/i.test(reservation.guestNationality) && !reservation.guestIdNumber) warnings.push(`${reservation.guestName}: non-Thai guest registration details need attention.`)
  }

  for (const reservation of todayDepartures) {
    if (reservation.balanceDue > 0 && canSeeFinancialDetails(snapshot.user?.role)) warnings.push(`${reservation.guestName}: departure has ${money(reservation.balanceDue)} due.`)
  }

  for (const room of snapshot.rooms) {
    if (room.operationalStatus !== 'AVAILABLE' && room.reservationId) warnings.push(`Room ${room.number}: assigned while ${room.operationalStatus.toLowerCase().replaceAll('_', ' ')}.`)
  }

  const now = new Date()
  const afterCheckout = now.getHours() > 11 || (now.getHours() === 11 && now.getMinutes() > 0)
  if (afterCheckout) {
    for (const reservation of todayDepartures.filter((item) => item.status === 'CHECKED_IN')) {
      warnings.push(`${reservation.guestName}: still in-house after standard checkout time.`)
    }
  }

  return makeAnswer(snapshot, {
    intent: 'DAILY_RISKS',
    title: 'Today\'s Front Desk Risks',
    directAnswer: warnings.length ? `${warnings.length} operational risk${warnings.length === 1 ? '' : 's'} found for today.` : 'No front desk risks found for today in the current PMS data.',
    records: [...todayArrivals.slice(0, 8).map(reservationRef), ...todayDepartures.slice(0, 8).map(reservationRef)],
    warnings: warnings.slice(0, 12),
    nextAction: warnings[0] || 'Keep monitoring arrivals, departures, and room readiness.',
    actions: warnings.length ? [action('OPEN_RESERVATION', 'Open Reservations', { route: 'reservations' })] : [],
  })
}

export function runAssistantTool(snapshot: AssistantSnapshot, query: string, parsed: { intent: string; entities: AssistantEntities }) {
  switch (parsed.intent) {
    case 'CHECK_AVAILABILITY':
    case 'CREATE_WALK_IN':
      return availability(snapshot, parsed.entities)
    case 'LIST_ARRIVALS':
      return arrivals(snapshot, parsed.entities)
    case 'LIST_DEPARTURES':
      return departures(snapshot, parsed.entities)
    case 'LIST_IN_HOUSE':
      return inHouse(snapshot)
    case 'HOUSEKEEPING_STATUS':
    case 'ROOM_STATUS':
      return housekeeping(snapshot, parsed.entities)
    case 'PAYMENT_BALANCE':
      return payments(snapshot, parsed.entities, query)
    case 'CHECK_IN_ELIGIBILITY':
      return eligibility(snapshot, parsed.entities, query, 'check-in')
    case 'CHECK_OUT_ELIGIBILITY':
      return eligibility(snapshot, parsed.entities, query, 'check-out')
    case 'FIND_RESERVATION':
      return search(snapshot, parsed.entities, query)
    case 'DAILY_RISKS':
      return risks(snapshot)
    default:
      return makeAnswer(snapshot, {
        intent: 'HELP',
        title: 'Front Desk AI',
        directAnswer: 'Ask about arrivals, departures, availability, room readiness, balances, check-in blockers, checkout blockers, or today\'s risks.',
        records: [{ type: 'policy', id: 'front-desk-scope', label: 'Front desk scope', detail: 'Grounded in current PMS board, reservations, rooms, and folios.' }],
        warnings: [],
        nextAction: 'Try "Who is arriving today?" or "Show today\'s risks".',
        actions: [],
      })
  }
}

export function buildSnapshotFromData(input: {
  hotelDateKey: string
  rooms: BoardRoomCard[]
  reservations?: AssistantReservation[]
  currentRoute?: string
  currentRoomNumber?: string
  currentReservationId?: string
  user?: AssistantSnapshot['user']
}) {
  const roomReservations = input.rooms.map(normalizeRoomReservation).filter(Boolean) as AssistantReservation[]
  return {
    hotelDateKey: input.hotelDateKey,
    rooms: input.rooms,
    reservations: mergeReservations(input.reservations || [], roomReservations),
    currentRoute: input.currentRoute,
    currentRoomNumber: input.currentRoomNumber,
    currentReservationId: input.currentReservationId,
    user: input.user,
  } satisfies AssistantSnapshot
}
