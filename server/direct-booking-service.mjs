import { createHash, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { bahtToSatang, dualWriteMoney, parseSatang, satangToApiString } from './money.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'HOLD', 'CHECKED_IN']
const HOLD_MINUTES = 15
const MAX_STAY_NIGHTS = 30
const PUBLIC_ACTOR = 'public-booking'

const propertyCodeSchema = z.string().trim().min(1).max(32).regex(/^[A-Z0-9_-]+$/).default('SANDBOX')
const dateKeySchema = z.string().regex(DATE_KEY_PATTERN, 'Use an ISO date in YYYY-MM-DD format.')
const identifierSchema = z.string().trim().min(1).max(200)
const idempotencyKeySchema = z.string().trim().min(16).max(200)

const staySchema = z.object({
  propertyCode: propertyCodeSchema,
  checkIn: dateKeySchema,
  checkOut: dateKeySchema,
  adults: z.number().int().min(1).max(12).default(1),
  children: z.number().int().min(0).max(12).default(0),
  roomTypeCode: z.string().trim().min(1).max(32).optional(),
}).strict()

const quoteSchema = staySchema.extend({
  roomTypeCode: z.string().trim().min(1).max(32),
}).strict()

const holdSchema = z.object({
  propertyCode: propertyCodeSchema,
  quoteId: identifierSchema,
}).strict()

const guestSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  nationality: z.string().trim().min(2).max(100).optional(),
}).strict()

const bookingSchema = z.object({
  propertyCode: propertyCodeSchema,
  holdToken: z.string().trim().min(32).max(200),
  guest: guestSchema,
  specialRequests: z.string().trim().max(2_000).optional(),
}).strict()

export const directBookingSchemas = Object.freeze({
  availability: staySchema,
  quote: quoteSchema,
  hold: holdSchema,
  booking: bookingSchema,
  idempotencyKey: idempotencyKeySchema,
})

export const directBookingPolicy = Object.freeze({
  enabledByDefault: false,
  holdMinutes: HOLD_MINUTES,
  maximumStayNights: MAX_STAY_NIGHTS,
  acceptsCardData: false,
  inventoryLock: 'POSTGRES_ADVISORY_TRANSACTION_LOCK',
})

function validationMessage(error) {
  const issue = error?.issues?.[0]
  const path = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
  return `${path}${issue?.message || 'Enter valid public booking data.'}`
}

function parseInput(schema, input) {
  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) throw new PmsValidationError(validationMessage(parsed.error))
  return parsed.data
}

function requireEnabled(env = process.env) {
  if (String(env?.DIRECT_BOOKING_ENABLED || 'false').trim().toLowerCase() !== 'true') {
    throw new PmsValidationError('Direct booking is not available.', 503)
  }
}

function requireIdempotencyKey(value) {
  return parseInput(idempotencyKeySchema, value)
}

function requireTokenSecret(env = process.env) {
  const secret = String(env?.DIRECT_BOOKING_TOKEN_SECRET || '')
  if (secret.length < 32) {
    throw new PmsValidationError('Direct booking token protection is not configured.', 503)
  }
  return secret
}

function dateFromKey(key, label) {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError(`${label} is not a real calendar date.`)
  }
  return date
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function validateStay(stay) {
  const checkIn = dateFromKey(stay.checkIn, 'Check-in')
  const checkOut = dateFromKey(stay.checkOut, 'Check-out')
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)
  if (nights < 1) throw new PmsValidationError('Check-out must be after check-in.')
  if (nights > MAX_STAY_NIGHTS) throw new PmsValidationError(`Public stays cannot exceed ${MAX_STAY_NIGHTS} nights.`)
  return { checkIn, checkOut, nights }
}

function normalizeNow(value) {
  const now = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date.')
  return now
}

function roomRateSatang(roomType) {
  return roomType.baseRateSatang === null || roomType.baseRateSatang === undefined
    ? bahtToSatang(roomType.baseRate, 'Room type base rate')
    : parseSatang(roomType.baseRateSatang, 'Room type base rate')
}

function holdTokenFor(propertyId, idempotencyKey, secret) {
  return createHmac('sha256', secret)
    .update(`direct-booking-hold:v1:${propertyId}:${idempotencyKey}`)
    .digest('base64url')
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

function confirmationCode() {
  return `SBX-WEB-${randomBytes(9).toString('hex').toUpperCase()}`
}

async function serializableTransaction(prisma, callback) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 15_000,
      })
    } catch (error) {
      if ((error?.code === 'P2034' || error?.code === 'P2002') && attempt < 2) continue
      throw error
    }
  }
}

async function propertyByCode(tx, propertyCode) {
  const property = await tx.property.findUnique({ where: { code: propertyCode } })
  if (!property) throw new PmsValidationError('Booking inventory is not available.', 404)
  return property
}

async function acquireInventoryLock(tx, propertyId, roomTypeId) {
  if (typeof tx.$queryRawUnsafe !== 'function') {
    throw new Error('Direct booking requires PostgreSQL transaction-lock support.')
  }
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `direct-booking:${propertyId}:${roomTypeId}`,
  )
}

async function roomTypeCapacity(tx, { propertyId, roomTypeId, checkIn, checkOut, now }) {
  const overlap = { checkIn: { lt: checkOut }, checkOut: { gt: checkIn } }
  const [roomCount, reservationCount, holdCount] = await Promise.all([
    tx.room.count({
      where: { propertyId, roomTypeId, operationalStatus: 'AVAILABLE' },
    }),
    tx.reservation.count({
      where: { propertyId, roomTypeId, status: { in: ACTIVE_RESERVATION_STATUSES }, ...overlap },
    }),
    tx.inventoryHold.count({
      where: {
        propertyId,
        roomTypeId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        ...overlap,
      },
    }),
  ])
  return {
    roomCount,
    reservationCount,
    holdCount,
    available: Math.max(0, roomCount - reservationCount - holdCount),
  }
}

async function expireStaleHolds(tx, propertyId, now) {
  await tx.inventoryHold.updateMany({
    where: { propertyId, status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
}

function quoteResponse(quote) {
  return {
    quoteId: quote.id,
    propertyCode: quote.propertyCode,
    roomType: { code: quote.roomType.code, name: quote.roomType.name },
    checkIn: dateKey(quote.checkIn),
    checkOut: dateKey(quote.checkOut),
    adults: quote.adults,
    children: quote.children,
    currency: quote.currency,
    ratePerNightSatang: satangToApiString(quote.ratePerNightSatang),
    totalSatang: satangToApiString(quote.totalSatang),
    createdAt: quote.createdAt instanceof Date ? quote.createdAt.toISOString() : String(quote.createdAt),
    immutable: true,
  }
}

function holdResponse(hold, rawToken) {
  return {
    holdId: hold.id,
    holdToken: rawToken,
    quoteId: hold.quoteId,
    status: hold.status,
    checkIn: dateKey(hold.checkIn),
    checkOut: dateKey(hold.checkOut),
    expiresAt: hold.expiresAt instanceof Date ? hold.expiresAt.toISOString() : String(hold.expiresAt),
  }
}

function bookingResponse(reservation) {
  return {
    bookingId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    status: reservation.status,
    roomType: { code: reservation.roomType.code, name: reservation.roomType.name },
    checkIn: dateKey(reservation.checkIn),
    checkOut: dateKey(reservation.checkOut),
    currency: reservation.currency || 'THB',
    totalSatang: satangToApiString(reservation.totalAmountSatang ?? bahtToSatang(reservation.totalAmount)),
  }
}

const bookingInclude = {
  roomType: true,
  folio: true,
}

export async function getPublicAvailability(prisma, input, options = {}) {
  requireEnabled(options.env)
  const parsed = parseInput(staySchema, input)
  const now = normalizeNow(options.now)
  const { checkIn, checkOut, nights } = validateStay(parsed)
  const property = await propertyByCode(prisma, parsed.propertyCode)
  const roomTypes = await prisma.roomType.findMany({
    where: {
      propertyId: property.id,
      ...(parsed.roomTypeCode ? { code: parsed.roomTypeCode } : {}),
    },
    orderBy: [{ code: 'asc' }],
  })

  const rows = []
  for (const roomType of roomTypes) {
    if (parsed.adults + parsed.children > roomType.maxOccupancy) continue
    const capacity = await roomTypeCapacity(prisma, {
      propertyId: property.id,
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
      now,
    })
    const rate = roomRateSatang(roomType)
    rows.push({
      roomType: { code: roomType.code, name: roomType.name },
      availableRooms: capacity.available,
      currency: property.currency,
      ratePerNightSatang: satangToApiString(rate),
      stayTotalSatang: satangToApiString(rate * BigInt(nights)),
    })
  }

  return {
    propertyCode: property.code,
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    nights,
    roomTypes: rows,
  }
}

export async function createPublicQuote(prisma, input, options = {}) {
  requireEnabled(options.env)
  const idempotencyKey = requireIdempotencyKey(options.idempotencyKey)
  const parsed = parseInput(quoteSchema, input)
  const now = normalizeNow(options.now)
  const { checkIn, checkOut, nights } = validateStay(parsed)
  const property = await propertyByCode(prisma, parsed.propertyCode)
  const replay = await prisma.publicBookingQuote.findUnique({
    where: { propertyId_idempotencyKey: { propertyId: property.id, idempotencyKey } },
    include: { roomType: true },
  })
  if (replay) return quoteResponse({ ...replay, propertyCode: property.code })

  const roomType = await prisma.roomType.findFirst({
    where: { propertyId: property.id, code: parsed.roomTypeCode },
  })
  if (!roomType) throw new PmsValidationError('Requested room type is not available.', 404)
  if (parsed.adults + parsed.children > roomType.maxOccupancy) {
    throw new PmsValidationError('Guest count exceeds room capacity.')
  }
  const capacity = await roomTypeCapacity(prisma, {
    propertyId: property.id,
    roomTypeId: roomType.id,
    checkIn,
    checkOut,
    now,
  })
  if (capacity.available < 1) throw new PmsValidationError('Requested room type is no longer available.', 409)

  const ratePerNightSatang = roomRateSatang(roomType)
  const totalSatang = ratePerNightSatang * BigInt(nights)
  try {
    const quote = await prisma.publicBookingQuote.create({
      data: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        checkIn,
        checkOut,
        adults: parsed.adults,
        children: parsed.children,
        ratePerNightSatang,
        totalSatang,
        currency: property.currency,
        idempotencyKey,
        snapshot: {
          version: 1,
          roomTypeCode: roomType.code,
          roomTypeName: roomType.name,
          nights,
          pricingSource: 'ROOM_TYPE_BASE_RATE',
        },
      },
      include: { roomType: true },
    })
    return quoteResponse({ ...quote, propertyCode: property.code })
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    const replayAfterConflict = await prisma.publicBookingQuote.findUnique({
      where: { propertyId_idempotencyKey: { propertyId: property.id, idempotencyKey } },
      include: { roomType: true },
    })
    if (!replayAfterConflict) throw error
    return quoteResponse({ ...replayAfterConflict, propertyCode: property.code })
  }
}

export async function createPublicHold(prisma, input, options = {}) {
  requireEnabled(options.env)
  const env = options.env || process.env
  const idempotencyKey = requireIdempotencyKey(options.idempotencyKey)
  const parsed = parseInput(holdSchema, input)
  const now = normalizeNow(options.now)
  const secret = requireTokenSecret(env)

  return serializableTransaction(prisma, async (tx) => {
    const property = await propertyByCode(tx, parsed.propertyCode)
    const rawToken = holdTokenFor(property.id, idempotencyKey, secret)
    const replay = await tx.inventoryHold.findUnique({
      where: { propertyId_idempotencyKey: { propertyId: property.id, idempotencyKey } },
    })
    if (replay) return holdResponse(replay, rawToken)

    const quote = await tx.publicBookingQuote.findFirst({
      where: { id: parsed.quoteId, propertyId: property.id },
      include: { roomType: true },
    })
    if (!quote) throw new PmsValidationError('Quote was not found.', 404)

    await acquireInventoryLock(tx, property.id, quote.roomTypeId)
    await expireStaleHolds(tx, property.id, now)
    const capacity = await roomTypeCapacity(tx, {
      propertyId: property.id,
      roomTypeId: quote.roomTypeId,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      now,
    })
    if (capacity.available < 1) throw new PmsValidationError('Requested room type is no longer available.', 409)

    const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000)
    const hold = await tx.inventoryHold.create({
      data: {
        propertyId: property.id,
        roomTypeId: quote.roomTypeId,
        quoteId: quote.id,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        expiresAt,
        status: 'ACTIVE',
        createdBy: PUBLIC_ACTOR,
        publicTokenHash: tokenHash(rawToken),
        idempotencyKey,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: PUBLIC_ACTOR,
        action: 'PUBLIC_BOOKING_HOLD_CREATED',
        entityType: 'inventoryHold',
        entityId: hold.id,
        changes: { quoteId: quote.id, expiresAt: expiresAt.toISOString() },
      },
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'PUBLIC_BOOKING_HOLD_CREATED',
      aggregateType: 'inventoryHold',
      aggregateId: hold.id,
    })
    return holdResponse(hold, rawToken)
  })
}

export async function convertPublicHold(prisma, input, options = {}) {
  requireEnabled(options.env)
  const idempotencyKey = requireIdempotencyKey(options.idempotencyKey)
  const parsed = parseInput(bookingSchema, input)
  const now = normalizeNow(options.now)
  const publicTokenHash = tokenHash(parsed.holdToken)

  return serializableTransaction(prisma, async (tx) => {
    const property = await propertyByCode(tx, parsed.propertyCode)
    let hold = await tx.inventoryHold.findFirst({
      where: { propertyId: property.id, publicTokenHash },
      include: { quote: { include: { roomType: true } }, reservation: { include: bookingInclude } },
    })
    if (!hold || !hold.quote) throw new PmsValidationError('Hold was not found.', 404)

    await acquireInventoryLock(tx, property.id, hold.roomTypeId)
    hold = await tx.inventoryHold.findFirst({
      where: { id: hold.id, propertyId: property.id },
      include: { quote: { include: { roomType: true } }, reservation: { include: bookingInclude } },
    })
    if (hold.status === 'CONVERTED') {
      if (hold.conversionIdempotencyKey !== idempotencyKey || !hold.reservation) {
        throw new PmsValidationError('Hold has already been converted.', 409)
      }
      return bookingResponse({ ...hold.reservation, currency: property.currency })
    }
    if (hold.status !== 'ACTIVE') throw new PmsValidationError('Hold is no longer active.', 409)
    if (hold.expiresAt <= now) {
      throw new PmsValidationError('Hold has expired.', 410)
    }

    const quote = hold.quote
    const nights = Math.round((quote.checkOut.getTime() - quote.checkIn.getTime()) / 86_400_000)
    const guest = await tx.guest.create({
      data: {
        firstName: parsed.guest.firstName,
        lastName: parsed.guest.lastName,
        email: parsed.guest.email?.toLowerCase() || null,
        phone: parsed.guest.phone || null,
        nationality: parsed.guest.nationality || null,
      },
    })
    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: confirmationCode(),
        guestId: guest.id,
        roomTypeId: quote.roomTypeId,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        status: 'CONFIRMED',
        adults: quote.adults,
        children: quote.children,
        childAges: [],
        ...dualWriteMoney('ratePerNight', 'ratePerNightSatang', quote.ratePerNightSatang),
        ...dualWriteMoney('totalAmount', 'totalAmountSatang', quote.totalSatang),
        ...dualWriteMoney('depositAmount', 'depositAmountSatang', 0n),
        depositPaid: false,
        source: 'WEBSITE',
        channelRef: `PUBLIC:${hold.id}`,
        specialRequests: parsed.specialRequests || null,
      },
    })
    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        ...dualWriteMoney('subtotal', 'subtotalSatang', quote.totalSatang),
        ...dualWriteMoney('tax', 'taxSatang', 0n),
        ...dualWriteMoney('total', 'totalSatang', quote.totalSatang),
        ...dualWriteMoney('paid', 'paidSatang', 0n),
        ...dualWriteMoney('balance', 'balanceSatang', quote.totalSatang),
      },
    })
    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: quote.checkIn,
        description: `${quote.roomType.name} ${nights} night${nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        ...dualWriteMoney('amount', 'amountSatang', quote.ratePerNightSatang),
        quantity: nights,
        ...dualWriteMoney('total', 'totalSatang', quote.totalSatang),
        createdBy: 'Public Booking',
      },
    })
    await tx.reservationLog.create({
      data: {
        reservationId: reservation.id,
        action: 'CREATED',
        toStatus: 'CONFIRMED',
        changes: { source: 'WEBSITE', quoteId: quote.id, holdId: hold.id },
        performedBy: 'Public Booking',
      },
    })
    await tx.inventoryHold.update({
      where: { id: hold.id },
      data: {
        status: 'CONVERTED',
        reservationId: reservation.id,
        conversionIdempotencyKey: idempotencyKey,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: PUBLIC_ACTOR,
        action: 'PUBLIC_BOOKING_CREATED',
        entityType: 'reservation',
        entityId: reservation.id,
        changes: { quoteId: quote.id, holdId: hold.id, totalSatang: String(quote.totalSatang) },
      },
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'PUBLIC_BOOKING_CREATED',
      aggregateType: 'reservation',
      aggregateId: reservation.id,
    })

    return bookingResponse({ ...reservation, roomType: quote.roomType, folio, currency: property.currency })
  })
}
