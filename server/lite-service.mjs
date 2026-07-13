import {
  SANDBOX_RULES,
  activeReservationStatuses,
  getBangkokDateKey,
  PmsValidationError,
} from './pms-domain.mjs'

const DAY_MS = 86_400_000
const DEFAULT_BOOKING_LIMIT = 25
const MAX_BOOKING_LIMIT = 100
const MAX_BOOKING_RANGE_DAYS = 730
const DEFAULT_BOARD_DAYS = 14
const MAX_BOARD_DAYS = 90
const PENDING_EMAIL_SAMPLE_LIMIT = 25
const CHANNEL_DESK_EVENT_LIMIT = 100
const CHANNEL_DESK_TASK_LIMIT = 250

const LITE_MANUAL_CHANNELS = Object.freeze([
  Object.freeze({ providerCode: 'booking_com', displayName: 'Booking.com' }),
  Object.freeze({ providerCode: 'agoda', displayName: 'Agoda' }),
  Object.freeze({ providerCode: 'trip_com', displayName: 'Trip.com' }),
])

const RESERVATION_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'HOLD',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
])

const BOOKING_SOURCES = new Set([
  'DIRECT',
  'WALK_IN',
  'PHONE',
  'EMAIL',
  'WEBSITE',
  'BOOKING_COM',
  'AGODA',
  'TRIP_COM',
  'EXPEDIA',
  'AIRBNB',
  'OTHER',
])

const PROPERTY_SELECT = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  currency: true,
  defaultCheckIn: true,
  defaultCheckOut: true,
}

const RESERVATION_SELECT = {
  id: true,
  confirmationCode: true,
  guestId: true,
  roomTypeId: true,
  assignedRoomId: true,
  checkIn: true,
  checkOut: true,
  actualCheckIn: true,
  actualCheckOut: true,
  status: true,
  adults: true,
  children: true,
  childAges: true,
  ratePerNightSatang: true,
  totalAmountSatang: true,
  depositAmountSatang: true,
  depositPaid: true,
  source: true,
  channelRef: true,
  providerCode: true,
  externalReservationId: true,
  sourceEmailEventId: true,
  createdAt: true,
  updatedAt: true,
  guest: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nationality: true,
      idType: true,
      idNumber: true,
      vipStatus: true,
      blacklisted: true,
    },
  },
  roomType: {
    select: {
      id: true,
      code: true,
      name: true,
      baseRateSatang: true,
      maxOccupancy: true,
      standardOcc: true,
    },
  },
  assignedRoom: {
    select: {
      id: true,
      number: true,
      floor: true,
      roomTypeId: true,
      operationalStatus: true,
      currentStatus: true,
    },
  },
  folio: {
    select: {
      id: true,
      status: true,
      subtotalSatang: true,
      taxSatang: true,
      totalSatang: true,
      paidSatang: true,
      balanceSatang: true,
      updatedAt: true,
      charges: {
        select: {
          id: true,
          date: true,
          description: true,
          category: true,
          amountSatang: true,
          quantity: true,
          totalSatang: true,
          void: true,
          voidReason: true,
          createdBy: true,
          createdAt: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      },
      payments: {
        select: {
          id: true,
          amountSatang: true,
          method: true,
          reference: true,
          notes: true,
          processedBy: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
}

const HOUSEKEEPING_STAY_SELECT = {
  id: true,
  assignedRoomId: true,
  checkIn: true,
  checkOut: true,
  status: true,
}

const ROOM_SELECT = {
  id: true,
  roomTypeId: true,
  number: true,
  floor: true,
  operationalStatus: true,
  currentStatus: true,
  blockedUntil: true,
  updatedAt: true,
  roomType: {
    select: {
      id: true,
      code: true,
      name: true,
      baseRateSatang: true,
    },
  },
}

const HOUSEKEEPING_ROOM_SELECT = {
  id: true,
  roomTypeId: true,
  number: true,
  floor: true,
  operationalStatus: true,
  currentStatus: true,
  blockedUntil: true,
  updatedAt: true,
  roomType: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
}

function requirePrisma(prisma) {
  if (!prisma || typeof prisma !== 'object' || !prisma.property || !prisma.reservation) {
    throw new TypeError('A Prisma client is required for Lite reads.')
  }
  return prisma
}

function normalizeFilterObject(value) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PmsValidationError('Lite read filters must be an object.')
  }
  return value
}

function assertAllowedFilters(filters, allowed) {
  const unknown = Object.keys(filters).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new PmsValidationError(`Unknown filter${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`)
  }
}

function singleFilterValue(value, label) {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value) || typeof value === 'object') {
    throw new PmsValidationError(`${label} must be supplied once.`)
  }
  return value
}

function parseDateKey(value, label, fallback) {
  const supplied = singleFilterValue(value, label)
  if (supplied === undefined) return fallback
  if (typeof supplied !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(supplied)) {
    throw new PmsValidationError(`${label} must use YYYY-MM-DD format.`)
  }
  const parsed = new Date(`${supplied}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== supplied) {
    throw new PmsValidationError(`${label} must be a real calendar date.`)
  }
  return supplied
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`)
}

function addDays(key, days) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  return (dateFromKey(to).getTime() - dateFromKey(from).getTime()) / DAY_MS
}

function dateKeys(from, to) {
  const length = daysBetween(from, to)
  return Array.from({ length }, (_, index) => addDays(from, index))
}

function parseDateRange(filters, { defaultDays, maxDays, label }) {
  const today = getBangkokDateKey(new Date())
  const from = parseDateKey(filters.from, `${label} from`, today)
  const to = parseDateKey(filters.to, `${label} to`, addDays(from, defaultDays))
  const days = daysBetween(from, to)
  if (!Number.isInteger(days) || days < 1) {
    throw new PmsValidationError(`${label} to must be after from.`)
  }
  if (days > maxDays) {
    throw new PmsValidationError(`${label} cannot exceed ${maxDays} days.`)
  }
  return { from, to, days }
}

function parseInteger(value, label, fallback, minimum, maximum) {
  const supplied = singleFilterValue(value, label)
  if (supplied === undefined) return fallback
  if ((typeof supplied !== 'number' && typeof supplied !== 'string') || !/^\d+$/.test(String(supplied))) {
    throw new PmsValidationError(`${label} must be a whole number.`)
  }
  const parsed = Number(supplied)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PmsValidationError(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function parseEnumList(value, label, allowed) {
  const supplied = singleFilterValue(value, label)
  if (supplied === undefined) return undefined
  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw new PmsValidationError(`${label} must not be empty.`)
  }
  const values = supplied.split(',').map((item) => item.trim().toUpperCase())
  if (values.some((item) => !item || !allowed.has(item))) {
    throw new PmsValidationError(`${label} contains an unsupported value.`)
  }
  return [...new Set(values)]
}

function parseSearch(value) {
  const supplied = singleFilterValue(value, 'query')
  if (supplied === undefined) return undefined
  if (typeof supplied !== 'string') throw new PmsValidationError('query must be text.')
  const query = supplied.trim()
  if (!query) return undefined
  if (query.length > 100) throw new PmsValidationError('query cannot exceed 100 characters.')
  return query
}

function parseCursor(value) {
  const supplied = singleFilterValue(value, 'cursor')
  if (supplied === undefined) return undefined
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(supplied)) {
    throw new PmsValidationError('cursor is invalid.')
  }
  return supplied
}

function isoDateKey(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PmsValidationError('Stored reservation date is invalid.', 503)
  }
  return value.toISOString().slice(0, 10)
}

function isoTimestamp(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function storedMoneySatang(value, label, { nullable = false } = {}) {
  if (value === undefined || value === null) {
    if (nullable) return null
    throw new PmsValidationError(`Stored ${label} is missing its MoneySatang value. Run reconciliation before serving PMS Lite.`, 503)
  }
  const satang = Number(value)
  if (!Number.isSafeInteger(satang)) {
    throw new PmsValidationError(`Stored ${label} exceeds the MoneySatang safe range.`, 503)
  }
  return Object.is(satang, -0) ? 0 : satang
}

function safeProviderCode(value) {
  if (value === undefined || value === null) return null
  const code = String(value).trim().toUpperCase()
  return /^[A-Z0-9_.-]{1,32}$/.test(code) ? code : null
}

function safeCurrency(value, fallback = 'THB') {
  const code = String(value || fallback).trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : fallback
}

function safeNullableCurrency(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const code = String(value).trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function mapProperty(property) {
  return {
    id: property.id,
    code: property.code,
    name: property.name,
    timezone: property.timezone,
    currency: safeCurrency(property.currency),
    defaultCheckIn: property.defaultCheckIn,
    defaultCheckOut: property.defaultCheckOut,
  }
}

function mapRoomType(roomType) {
  return {
    id: roomType.id,
    code: roomType.code,
    name: roomType.name,
    baseRateSatang: storedMoneySatang(roomType.baseRateSatang, 'room type base rate'),
    maxOccupancy: roomType.maxOccupancy,
    standardOccupancy: roomType.standardOcc,
  }
}

function mapRoom(room) {
  return {
    id: room.id,
    roomTypeId: room.roomTypeId,
    number: room.number,
    floor: room.floor,
    operationalStatus: room.operationalStatus,
    housekeepingStatus: room.currentStatus,
    blockedUntil: isoTimestamp(room.blockedUntil),
    statusUpdatedAt: isoTimestamp(room.updatedAt),
    roomType: {
      id: room.roomType.id,
      code: room.roomType.code,
      name: room.roomType.name,
      baseRateSatang: storedMoneySatang(room.roomType.baseRateSatang, 'room type base rate'),
    },
  }
}

function mapGuest(guest) {
  const firstName = String(guest.firstName || '').trim()
  const lastName = String(guest.lastName || '').trim()
  return {
    id: guest.id,
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(' ') || 'Guest',
    nationality: guest.nationality || null,
    idType: guest.idType || null,
    identityComplete: Boolean(String(guest.nationality || '').trim() && String(guest.idNumber || '').trim()),
    idNumberLast4: guest.idNumber ? String(guest.idNumber).slice(-4) : null,
    vip: Boolean(guest.vipStatus),
    blacklisted: Boolean(guest.blacklisted),
  }
}

function mapFolio(folio) {
  if (!folio) return null
  const subtotalSatang = storedMoneySatang(folio.subtotalSatang, 'folio subtotal')
  const taxSatang = storedMoneySatang(folio.taxSatang, 'folio tax')
  const totalSatang = storedMoneySatang(folio.totalSatang, 'folio total')
  const paidSatang = storedMoneySatang(folio.paidSatang, 'folio paid')
  const balanceSatang = storedMoneySatang(folio.balanceSatang, 'folio balance')
  return {
    id: folio.id,
    status: folio.status,
    subtotalSatang,
    taxSatang,
    totalSatang,
    paidSatang,
    balanceSatang,
    paymentState: balanceSatang <= 0 ? 'SETTLED' : paidSatang > 0 ? 'PARTIAL' : 'UNPAID',
    charges: (folio.charges || []).map((charge) => ({
      id: charge.id,
      date: isoDateKey(charge.date),
      description: charge.description,
      category: charge.category,
      amountSatang: storedMoneySatang(charge.amountSatang, 'charge amount'),
      quantity: charge.quantity,
      totalSatang: storedMoneySatang(charge.totalSatang, 'charge total'),
      void: Boolean(charge.void),
      voidReason: charge.voidReason || null,
      createdBy: charge.createdBy,
      createdAt: isoTimestamp(charge.createdAt),
    })),
    payments: (folio.payments || []).map((payment) => ({
      id: payment.id,
      amountSatang: storedMoneySatang(payment.amountSatang, 'payment amount'),
      method: payment.method,
      reference: payment.reference || null,
      notes: payment.notes || null,
      processedBy: payment.processedBy,
      createdAt: isoTimestamp(payment.createdAt),
    })),
    updatedAt: isoTimestamp(folio.updatedAt),
  }
}

function mapAssignedRoom(room) {
  if (!room) return null
  return {
    id: room.id,
    number: room.number,
    floor: room.floor,
    roomTypeId: room.roomTypeId,
    operationalStatus: room.operationalStatus,
    housekeepingStatus: room.currentStatus,
  }
}

function mapReservation(reservation) {
  const checkIn = isoDateKey(reservation.checkIn)
  const checkOut = isoDateKey(reservation.checkOut)
  return {
    id: reservation.id,
    confirmationCode: reservation.confirmationCode,
    status: reservation.status,
    checkIn,
    checkOut,
    actualCheckIn: isoTimestamp(reservation.actualCheckIn),
    actualCheckOut: isoTimestamp(reservation.actualCheckOut),
    nights: daysBetween(checkIn, checkOut),
    adults: reservation.adults,
    children: reservation.children,
    childAges: Array.isArray(reservation.childAges) ? reservation.childAges.map(Number) : [],
    source: reservation.source,
    providerCode: safeProviderCode(reservation.providerCode),
    channelRef: reservation.channelRef || null,
    externalReservationId: reservation.externalReservationId || null,
    sourceEmailEventId: reservation.sourceEmailEventId || null,
    guest: mapGuest(reservation.guest),
    roomType: mapRoomType(reservation.roomType),
    assignedRoomId: reservation.assignedRoomId || null,
    assignedRoom: mapAssignedRoom(reservation.assignedRoom),
    ratePerNightSatang: storedMoneySatang(reservation.ratePerNightSatang, 'reservation nightly rate'),
    totalAmountSatang: storedMoneySatang(reservation.totalAmountSatang, 'reservation total'),
    depositAmountSatang: storedMoneySatang(reservation.depositAmountSatang, 'reservation deposit'),
    depositPaid: Boolean(reservation.depositPaid),
    folio: mapFolio(reservation.folio),
    createdAt: isoTimestamp(reservation.createdAt),
    updatedAt: isoTimestamp(reservation.updatedAt),
  }
}

async function resolveProperty(prisma) {
  const property = await prisma.property.findUnique({
    where: { code: SANDBOX_RULES.propertyCode },
    select: PROPERTY_SELECT,
  })
  if (!property) throw new PmsValidationError('Property setup has not been completed yet.', 503)
  return property
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1
}

async function loadPendingReviewEmailMetadata(prisma, propertyId) {
  const where = { propertyId, status: 'NEEDS_REVIEW', legacyReadOnly: false }
  const [total, events] = await Promise.all([
    prisma.bookingEmailEvent.count({ where }),
    prisma.bookingEmailEvent.findMany({
      where,
      select: {
        id: true,
        eventType: true,
        status: true,
        receivedAt: true,
        providerCode: true,
        checkIn: true,
        checkOut: true,
        amountSatang: true,
        currency: true,
        confidence: true,
        reservationId: true,
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: PENDING_EMAIL_SAMPLE_LIMIT,
    }),
  ])

  const byEventType = {}
  const byProviderCode = {}
  for (const event of events) {
    incrementCount(byEventType, event.eventType)
    incrementCount(byProviderCode, safeProviderCode(event.providerCode) || 'UNCLASSIFIED')
  }

  return {
    total,
    returned: events.length,
    truncated: total > events.length,
    latestReceivedAt: isoTimestamp(events[0]?.receivedAt),
    sampleByEventType: byEventType,
    sampleByProviderCode: byProviderCode,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      providerCode: safeProviderCode(event.providerCode),
      receivedAt: isoTimestamp(event.receivedAt),
      checkIn: event.checkIn ? isoDateKey(event.checkIn) : null,
      checkOut: event.checkOut ? isoDateKey(event.checkOut) : null,
      amountSatang: storedMoneySatang(event.amountSatang, 'booking email amount', { nullable: true }),
      currency: safeNullableCurrency(event.currency),
      confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0,
      linkedToReservation: Boolean(event.reservationId),
    })),
    piiBoundary: 'No sender, recipient, subject, guest name, raw headers, raw text, external reference, or parsed details are returned.',
  }
}

function roomIsReady(room) {
  return room.operationalStatus === 'AVAILABLE' && ['VACANT_CLEAN', 'INSPECTED'].includes(room.currentStatus)
}

function roomIsDirty(room) {
  return ['VACANT_DIRTY', 'OCCUPIED_DIRTY'].includes(room.currentStatus)
}

export async function getLiteFrontDesk(prisma, input = {}) {
  requirePrisma(prisma)
  const filters = normalizeFilterObject(input)
  assertAllowedFilters(filters, new Set(['date']))
  const hotelDate = parseDateKey(filters.date, 'date', getBangkokDateKey(new Date()))
  const dayStart = dateFromKey(hotelDate)
  const nextDay = dateFromKey(addDays(hotelDate, 1))
  const property = await resolveProperty(prisma)
  const propertyWhere = { propertyId: property.id }

  const [arrivalRows, departureRows, inHouseRows, rooms, pendingReviewEmail] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        ...propertyWhere,
        status: { in: ['PENDING', 'CONFIRMED'] },
        checkIn: { gte: dayStart, lt: nextDay },
      },
      select: RESERVATION_SELECT,
      orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        ...propertyWhere,
        status: 'CHECKED_IN',
        checkOut: { gte: dayStart, lt: nextDay },
      },
      select: RESERVATION_SELECT,
      orderBy: [{ checkOut: 'asc' }, { id: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        ...propertyWhere,
        status: 'CHECKED_IN',
        checkIn: { lt: nextDay },
        checkOut: { gt: dayStart },
      },
      select: RESERVATION_SELECT,
      orderBy: [{ checkOut: 'asc' }, { id: 'asc' }],
    }),
    prisma.room.findMany({
      where: propertyWhere,
      select: ROOM_SELECT,
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    loadPendingReviewEmailMetadata(prisma, property.id),
  ])

  const arrivals = arrivalRows.map(mapReservation)
  const departures = departureRows.map(mapReservation)
  const inHouse = inHouseRows.map(mapReservation)

  return {
    property: mapProperty(property),
    hotelDate,
    summary: {
      arrivals: arrivals.length,
      departures: departures.length,
      inHouse: inHouse.length,
      unpaidDepartures: departures.filter((reservation) => (reservation.folio?.balanceSatang || 0) > 0).length,
      roomsTotal: rooms.length,
      roomsReady: rooms.filter(roomIsReady).length,
      roomsDirty: rooms.filter(roomIsDirty).length,
      roomsBlocked: rooms.filter((room) => room.operationalStatus !== 'AVAILABLE').length,
    },
    arrivals,
    departures,
    inHouse,
    pendingReviewEmail,
  }
}

function bookingDateFilters(filters) {
  const from = parseDateKey(filters.from, 'from', undefined)
  const to = parseDateKey(filters.to, 'to', undefined)
  if (from && to) {
    const days = daysBetween(from, to)
    if (!Number.isInteger(days) || days < 1) throw new PmsValidationError('to must be after from.')
    if (days > MAX_BOOKING_RANGE_DAYS) {
      throw new PmsValidationError(`Booking date range cannot exceed ${MAX_BOOKING_RANGE_DAYS} days.`)
    }
  }
  return { from, to }
}

export function bookingSearchWhere(query) {
  if (!query) return undefined
  const contains = { contains: query, mode: 'insensitive' }
  const guestNameTerms = String(query).trim().split(/\s+/).filter(Boolean)
  const combinedGuestNameMatch = guestNameTerms.length > 1
    ? {
        guest: {
          is: {
            AND: guestNameTerms.map((term) => ({
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
              ],
            })),
          },
        },
      }
    : null
  return [
    { confirmationCode: contains },
    { channelRef: contains },
    { externalReservationId: contains },
    { providerCode: contains },
    { roomType: { is: { OR: [{ code: contains }, { name: contains }] } } },
    {
      guest: {
        is: {
          OR: [
            { firstName: contains },
            { lastName: contains },
            { email: contains },
            { phone: contains },
          ],
        },
      },
    },
    ...(combinedGuestNameMatch ? [combinedGuestNameMatch] : []),
  ]
}

export async function listLiteBookings(prisma, input = {}) {
  requirePrisma(prisma)
  const filters = normalizeFilterObject(input)
  assertAllowedFilters(filters, new Set(['from', 'to', 'status', 'source', 'query', 'cursor', 'limit']))
  const property = await resolveProperty(prisma)
  const { from, to } = bookingDateFilters(filters)
  const statuses = parseEnumList(filters.status, 'status', RESERVATION_STATUSES)
  const sources = parseEnumList(filters.source, 'source', BOOKING_SOURCES)
  const query = parseSearch(filters.query)
  const cursor = parseCursor(filters.cursor)
  const limit = parseInteger(filters.limit, 'limit', DEFAULT_BOOKING_LIMIT, 1, MAX_BOOKING_LIMIT)

  if (cursor) {
    const validCursor = await prisma.reservation.findFirst({
      where: { id: cursor, propertyId: property.id },
      select: { id: true },
    })
    if (!validCursor) throw new PmsValidationError('cursor does not identify a booking in this property.')
  }

  const where = {
    propertyId: property.id,
    status: statuses ? { in: statuses } : undefined,
    source: sources ? { in: sources } : undefined,
    checkOut: from ? { gt: dateFromKey(from) } : undefined,
    checkIn: to ? { lt: dateFromKey(to) } : undefined,
    OR: bookingSearchWhere(query),
  }

  const [rows, total, pendingReviewEmail] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: RESERVATION_SELECT,
      orderBy: [{ checkIn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined,
      take: limit + 1,
    }),
    prisma.reservation.count({ where }),
    loadPendingReviewEmailMetadata(prisma, property.id),
  ])

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  return {
    property: mapProperty(property),
    filters: {
      from: from || null,
      to: to || null,
      statuses: statuses || [],
      sources: sources || [],
      query: query || null,
    },
    page: {
      limit,
      total,
      hasMore,
      nextCursor: hasMore ? pageRows.at(-1)?.id || null : null,
    },
    items: pageRows.map(mapReservation),
    pendingReviewEmail,
  }
}

function clipSegment(reservation, from, to) {
  const mapped = mapReservation(reservation)
  return {
    ...mapped,
    segmentStart: mapped.checkIn < from ? from : mapped.checkIn,
    segmentEnd: mapped.checkOut > to ? to : mapped.checkOut,
  }
}

export async function getLiteBoard(prisma, input = {}) {
  requirePrisma(prisma)
  const filters = normalizeFilterObject(input)
  assertAllowedFilters(filters, new Set(['from', 'to']))
  const range = parseDateRange(filters, {
    defaultDays: DEFAULT_BOARD_DAYS,
    maxDays: MAX_BOARD_DAYS,
    label: 'Board range',
  })
  const property = await resolveProperty(prisma)

  const [roomTypes, rooms, reservations, pendingReviewEmail] = await Promise.all([
    prisma.roomType.findMany({
      where: { propertyId: property.id },
      select: {
        id: true,
        code: true,
        name: true,
        baseRateSatang: true,
        maxOccupancy: true,
        standardOcc: true,
        _count: { select: { rooms: true } },
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    }),
    prisma.room.findMany({
      where: { propertyId: property.id },
      select: ROOM_SELECT,
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        propertyId: property.id,
        status: { in: activeReservationStatuses() },
        checkIn: { lt: dateFromKey(range.to) },
        checkOut: { gt: dateFromKey(range.from) },
      },
      select: RESERVATION_SELECT,
      orderBy: [{ checkIn: 'asc' }, { checkOut: 'asc' }, { id: 'asc' }],
    }),
    loadPendingReviewEmailMetadata(prisma, property.id),
  ])

  const segments = reservations.map((reservation) => clipSegment(reservation, range.from, range.to))
  const reservationSegments = segments.filter((reservation) => reservation.assignedRoomId)
  const unassignedBookings = segments.filter((reservation) => !reservation.assignedRoomId)

  return {
    property: mapProperty(property),
    range: {
      from: range.from,
      to: range.to,
      days: dateKeys(range.from, range.to),
      dayCount: range.days,
      semantics: '[from,to)',
      maximumDays: MAX_BOARD_DAYS,
    },
    roomTypes: roomTypes.map((roomType) => ({
      ...mapRoomType(roomType),
      roomCount: roomType._count.rooms,
    })),
    rooms: rooms.map(mapRoom),
    reservationSegments,
    unassignedBookings,
    counts: {
      rooms: rooms.length,
      assignedSegments: reservationSegments.length,
      unassignedBookings: unassignedBookings.length,
    },
    pendingReviewEmail,
  }
}

function housekeepingPriority(room, arrivals, departures) {
  if (room.operationalStatus !== 'AVAILABLE') return { code: 'BLOCKED', rank: 0 }
  if (departures.length > 0 && roomIsDirty(room)) return { code: 'TURNOVER', rank: 1 }
  if (arrivals.length > 0 && !roomIsReady(room)) return { code: 'ARRIVAL_NOT_READY', rank: 2 }
  if (room.currentStatus === 'CLEANING') return { code: 'CLEANING', rank: 3 }
  if (roomIsDirty(room)) return { code: 'DIRTY', rank: 4 }
  if (room.currentStatus === 'INSPECTED') return { code: 'INSPECTED', rank: 5 }
  return { code: 'READY', rank: 6 }
}

function mapHousekeepingStay(reservation) {
  return {
    id: reservation.id,
    assignedRoomId: reservation.assignedRoomId,
    checkIn: isoDateKey(reservation.checkIn),
    checkOut: isoDateKey(reservation.checkOut),
    status: reservation.status,
  }
}

function mapHousekeepingRoom(room) {
  return {
    id: room.id,
    roomTypeId: room.roomTypeId,
    number: room.number,
    floor: room.floor,
    operationalStatus: room.operationalStatus,
    housekeepingStatus: room.currentStatus,
    blockedUntil: isoTimestamp(room.blockedUntil),
    statusUpdatedAt: isoTimestamp(room.updatedAt),
    roomType: {
      id: room.roomType.id,
      code: room.roomType.code,
      name: room.roomType.name,
    },
  }
}

export async function getLiteHousekeeping(prisma, input = {}) {
  requirePrisma(prisma)
  const filters = normalizeFilterObject(input)
  assertAllowedFilters(filters, new Set(['date']))
  const hotelDate = parseDateKey(filters.date, 'date', getBangkokDateKey(new Date()))
  const dayStart = dateFromKey(hotelDate)
  const nextDay = dateFromKey(addDays(hotelDate, 1))
  const property = await resolveProperty(prisma)

  const [rooms, reservations] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: property.id },
      select: HOUSEKEEPING_ROOM_SELECT,
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        propertyId: property.id,
        assignedRoomId: { not: null },
        status: { in: activeReservationStatuses() },
        checkIn: { lt: nextDay },
        checkOut: { gte: dayStart },
      },
      select: HOUSEKEEPING_STAY_SELECT,
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    }),
  ])

  const reservationsByRoom = new Map()
  for (const reservation of reservations) {
    const existing = reservationsByRoom.get(reservation.assignedRoomId) || []
    existing.push(mapHousekeepingStay(reservation))
    reservationsByRoom.set(reservation.assignedRoomId, existing)
  }

  const queue = rooms.map((room) => {
    const stays = reservationsByRoom.get(room.id) || []
    const arrivals = stays.filter((reservation) =>
      reservation.checkIn === hotelDate && ['PENDING', 'CONFIRMED', 'HOLD'].includes(reservation.status)
    )
    const departures = stays.filter((reservation) =>
      reservation.checkOut === hotelDate && reservation.status === 'CHECKED_IN'
    )
    const inHouse = stays.filter((reservation) => reservation.status === 'CHECKED_IN')
    const priority = housekeepingPriority(room, arrivals, departures)
    return {
      ...mapHousekeepingRoom(room),
      priority: priority.code,
      priorityRank: priority.rank,
      readyForArrival: roomIsReady(room),
      arrivals,
      departures,
      inHouse,
    }
  }).sort((left, right) =>
    left.priorityRank - right.priorityRank ||
    left.floor - right.floor ||
    left.number.localeCompare(right.number, undefined, { numeric: true })
  )

  return {
    property: mapProperty(property),
    hotelDate,
    statusSemantics: 'Room housekeeping and operational status are the current PostgreSQL snapshot; stay lists are scoped to hotelDate.',
    summary: {
      total: queue.length,
      ready: queue.filter((room) => room.readyForArrival).length,
      dirty: queue.filter((room) => ['VACANT_DIRTY', 'OCCUPIED_DIRTY'].includes(room.housekeepingStatus)).length,
      cleaning: queue.filter((room) => room.housekeepingStatus === 'CLEANING').length,
      inspected: queue.filter((room) => room.housekeepingStatus === 'INSPECTED').length,
      blocked: queue.filter((room) => room.operationalStatus !== 'AVAILABLE').length,
      arrivalNotReady: queue.filter((room) => room.priority === 'ARRIVAL_NOT_READY').length,
      turnover: queue.filter((room) => room.priority === 'TURNOVER').length,
    },
    rooms: queue,
  }
}

function safeManualProviderCode(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll('.', '_')
  if (normalized === 'bookingcom') return 'booking_com'
  if (normalized === 'tripcom') return 'trip_com'
  return LITE_MANUAL_CHANNELS.some((provider) => provider.providerCode === normalized) ? normalized : null
}

function mapChannelDeskEvent(event) {
  const parsedDetails = event.parsedDetails && typeof event.parsedDetails === 'object' && !Array.isArray(event.parsedDetails)
    ? event.parsedDetails
    : {}
  const adults = Number(parsedDetails.adults)
  const children = Number(parsedDetails.children)
  const parsedChildAges = Array.isArray(parsedDetails.childAges) ? parsedDetails.childAges.map(Number) : []
  const childAges = parsedChildAges.every((age) => Number.isInteger(age) && age >= 0 && age <= 17)
    ? parsedChildAges
    : []
  return {
    id: event.id,
    eventType: event.eventType,
    status: event.status,
    providerCode: safeManualProviderCode(event.providerCode),
    reservationId: event.reservationId || null,
    channelRef: event.channelRef || null,
    receivedAt: isoTimestamp(event.receivedAt),
    reviewReason: event.reviewReason || null,
    errorReason: event.errorReason || null,
    guestName: event.guestName || null,
    checkIn: event.checkIn ? isoDateKey(event.checkIn) : null,
    checkOut: event.checkOut ? isoDateKey(event.checkOut) : null,
    roomType: event.roomType || null,
    amountSatang: storedMoneySatang(event.amountSatang, 'booking email amount', { nullable: true }),
    currency: safeNullableCurrency(event.currency),
    confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0,
    adults: Number.isInteger(adults) && adults > 0 ? adults : null,
    children: Number.isInteger(children) && children >= 0 ? children : null,
    childAges,
  }
}

function mapManualConnection(connection, fallback) {
  if (!connection) {
    return {
      id: `unconfigured:${fallback.providerCode}`,
      providerCode: fallback.providerCode,
      displayName: fallback.displayName,
      deliveryMode: 'MANUAL',
      externalPropertyId: null,
      extranetUrl: null,
      enabled: false,
      configured: false,
      mappings: [],
    }
  }
  return {
    id: connection.id,
    providerCode: fallback.providerCode,
    displayName: connection.displayName || fallback.displayName,
    deliveryMode: connection.deliveryMode,
    externalPropertyId: connection.externalPropertyId || null,
    extranetUrl: connection.extranetUrl || null,
    enabled: Boolean(connection.enabled),
    configured: true,
    mappings: (connection.mappings || []).map((mapping) => ({
      id: mapping.id,
      roomTypeId: mapping.roomTypeId,
      roomTypeName: mapping.roomType?.name || null,
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRoomTypeName: mapping.externalRoomTypeName,
      externalRatePlanId: mapping.externalRatePlanId || null,
      active: Boolean(mapping.active),
    })),
  }
}

function groupedStatusCount(rows, status) {
  const row = (rows || []).find((item) => item.status === status)
  return Number(row?._count?._all || 0)
}

/**
 * Channel Desk is deliberately a composite read. It exposes review work and
 * manual Extranet tasks, but never OTA credentials or email bodies.
 */
export async function getLiteChannelDesk(prisma, options = {}) {
  requirePrisma(prisma)
  const normalized = normalizeFilterObject(options)
  assertAllowedFilters(normalized, new Set(['credentialStatus', 'pubsubConfig']))
  const property = await resolveProperty(prisma)
  const today = dateFromKey(getBangkokDateKey(new Date()))

  const reviewEventWhere = {
    propertyId: property.id,
    legacyReadOnly: false,
    AND: [
      {
        OR: [
          { checkIn: null },
          { checkOut: { gte: today } },
        ],
      },
      {
        OR: [
          { status: 'ERROR' },
          { status: 'NEEDS_REVIEW', eventType: { in: ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE'] } },
        ],
      },
    ],
  }
  const taskWhere = {
    propertyId: property.id,
    status: { in: ['PENDING', 'IN_PROGRESS', 'FAILED'] },
    stayDate: { gte: today },
  }

  const [
    source,
    reviewEvents,
    reviewEventStatusCounts,
    storedConnections,
    roomTypes,
    tasks,
    taskStatusCounts,
    pendingDeliveries,
    failedDeliveries,
  ] = await Promise.all([
    prisma.bookingEmailSource.findFirst({
      where: { propertyId: property.id, provider: 'GMAIL', enabled: true },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.bookingEmailEvent.findMany({
      where: reviewEventWhere,
      select: {
        id: true,
        eventType: true,
        status: true,
        providerCode: true,
        reservationId: true,
        channelRef: true,
        receivedAt: true,
        reviewReason: true,
        errorReason: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        roomType: true,
        amountSatang: true,
        currency: true,
        confidence: true,
        parsedDetails: true,
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: CHANNEL_DESK_EVENT_LIMIT,
    }),
    prisma.bookingEmailEvent.groupBy({
      by: ['status'],
      where: reviewEventWhere,
      _count: { _all: true },
    }),
    prisma.manualChannelConnection.findMany({
      where: { propertyId: property.id },
      include: {
        mappings: {
          include: { roomType: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { providerCode: 'asc' },
    }),
    prisma.roomType.findMany({
      where: {
        propertyId: property.id,
        rooms: { some: {} },
      },
      select: {
        id: true,
        code: true,
        name: true,
        _count: { select: { rooms: true } },
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    }),
    prisma.manualChannelTask.findMany({
      where: taskWhere,
      include: {
        connection: true,
        roomType: { select: { id: true, name: true } },
      },
      orderBy: [{ stayDate: 'asc' }, { createdAt: 'asc' }],
      take: CHANNEL_DESK_TASK_LIMIT,
    }),
    prisma.manualChannelTask.groupBy({
      by: ['status'],
      where: taskWhere,
      _count: { _all: true },
    }),
    prisma.bookingEmailPushDelivery?.count?.({
      where: { source: { propertyId: property.id }, status: { in: ['PENDING', 'PROCESSING'] } },
    }) || 0,
    prisma.bookingEmailPushDelivery?.count?.({
      where: { source: { propertyId: property.id }, status: 'FAILED' },
    }) || 0,
  ])

  const connectionByProvider = new Map(storedConnections.map((connection) => [connection.providerCode, connection]))
  const connections = LITE_MANUAL_CHANNELS.map((fallback) => mapManualConnection(connectionByProvider.get(fallback.providerCode), fallback))
  const reviewEventTotal = (reviewEventStatusCounts || []).reduce((total, row) => total + Number(row?._count?._all || 0), 0)
  const taskTotal = (taskStatusCounts || []).reduce((total, row) => total + Number(row?._count?._all || 0), 0)
  const pubsubConfig = normalized.pubsubConfig && typeof normalized.pubsubConfig === 'object' ? normalized.pubsubConfig : {}
  const credentialStatus = normalized.credentialStatus && typeof normalized.credentialStatus === 'object' ? normalized.credentialStatus : {}

  return {
    syncHealth: {
      enabled: Boolean(source?.enabled && pubsubConfig.enabled),
      credentialReady: Boolean(credentialStatus.configured),
      watchReady: Boolean(source?.watchExpiresAt && new Date(source.watchExpiresAt).getTime() > Date.now()),
      lastSyncAt: isoTimestamp(source?.lastSyncAt),
      lastPushAt: isoTimestamp(source?.lastPushAt),
      lastReconciledAt: isoTimestamp(source?.lastReconciledAt),
      watchExpiresAt: isoTimestamp(source?.watchExpiresAt),
      lastError: source?.lastError || null,
      pendingDeliveries: Number(pendingDeliveries || 0),
      failedDeliveries: Number(failedDeliveries || 0),
      consecutiveFailures: Number(source?.consecutiveFailures || 0),
      missingConfiguration: [...new Set([...(credentialStatus.missing || []), ...(pubsubConfig.missing || [])])],
    },
    reviewEvents: reviewEvents.map((event) => mapChannelDeskEvent(event)),
    connections,
    roomTypes: roomTypes.map((roomType) => ({
      id: roomType.id,
      code: roomType.code,
      name: roomType.name,
      physicalRoomCount: Number(roomType._count?.rooms || 0),
    })),
    tasks: tasks.map((task) => {
      return {
        id: task.id,
        providerCode: safeManualProviderCode(task.connection.providerCode),
        connectionId: task.connectionId,
        roomTypeId: task.roomTypeId,
        roomTypeName: task.roomType.name,
        externalRoomTypeId: task.targetExternalRoomTypeId,
        externalRoomTypeName: task.targetExternalRoomTypeName,
        externalRatePlanId: task.targetExternalRatePlanId || null,
        stayDate: isoDateKey(task.stayDate),
        desiredAvailability: task.desiredAvailability,
        confirmedAvailability: task.confirmedAvailability,
        status: task.status,
        revision: task.revision,
        extranetUrl: task.connection.extranetUrl || null,
        completedAt: isoTimestamp(task.completedAt),
        completedBy: task.completedBy || null,
        completionNotes: task.completionNotes || null,
        lastErrorCode: task.lastErrorCode || null,
        lastErrorMessage: task.lastErrorMessage || null,
      }
    }),
    pagination: {
      reviewEvents: {
        limit: CHANNEL_DESK_EVENT_LIMIT,
        returned: reviewEvents.length,
        total: reviewEventTotal,
        truncated: reviewEventTotal > reviewEvents.length,
      },
      tasks: {
        limit: CHANNEL_DESK_TASK_LIMIT,
        returned: tasks.length,
        total: taskTotal,
        truncated: taskTotal > tasks.length,
      },
    },
    counts: {
      reviewEvents: groupedStatusCount(reviewEventStatusCounts, 'NEEDS_REVIEW'),
      parserErrors: groupedStatusCount(reviewEventStatusCounts, 'ERROR'),
      activeReviewWork: reviewEventTotal,
      pendingTasks: groupedStatusCount(taskStatusCounts, 'PENDING'),
      inProgressTasks: groupedStatusCount(taskStatusCounts, 'IN_PROGRESS'),
      failedTasks: groupedStatusCount(taskStatusCounts, 'FAILED'),
      activeTasks: taskTotal,
      pendingDeliveries: Number(pendingDeliveries || 0),
      failedDeliveries: Number(failedDeliveries || 0),
    },
    warning: 'Manual OTA availability updates are not zero-lag synchronization. Staff must update each Extranet promptly; overbooking risk remains until every task is confirmed.',
  }
}

function safeReleaseIdentifier(value, maximumLength = 120) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  if (!normalized || normalized.length > maximumLength || !/^[A-Za-z0-9._:/-]+$/.test(normalized)) return null
  return normalized
}

function safeCommitSha(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : null
}

function safeBuildTime(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function getLiteVersion(options = {}) {
  const normalized = normalizeFilterObject(options)
  assertAllowedFilters(normalized, new Set(['env', 'now']))
  const env = normalized.env === undefined ? process.env : normalized.env
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new PmsValidationError('Version env must be an object.')
  }
  const now = normalized.now === undefined ? new Date() : new Date(normalized.now)
  if (Number.isNaN(now.getTime())) throw new PmsValidationError('Version timestamp is invalid.')
  const configuredUiVariant = String(env.PMS_UI_VARIANT || 'lite').trim().toLowerCase()
  const uiVariant = ['legacy', 'lite'].includes(configuredUiVariant) ? configuredUiVariant : 'unknown'

  return {
    apiVersion: 'lite/v1',
    dtoVersion: 'lite-read-v1',
    uiVariant,
    commitSha: safeCommitSha(env.RENDER_GIT_COMMIT || env.GIT_COMMIT_SHA || env.COMMIT_SHA),
    buildTime: safeBuildTime(env.LITE_BUILD_TIME || env.BUILD_TIME),
    assetIdentifier: safeReleaseIdentifier(env.LITE_ASSET_IDENTIFIER || env.ASSET_IDENTIFIER),
    releaseId: safeReleaseIdentifier(env.RENDER_SERVICE_ID || env.RELEASE_ID),
    serviceName: safeReleaseIdentifier(env.RENDER_SERVICE_NAME),
    environment: safeReleaseIdentifier(env.NODE_ENV, 32) || 'development',
    generatedAt: now.toISOString(),
  }
}
