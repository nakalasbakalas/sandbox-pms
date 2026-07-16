/* global console */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  convertPublicHold,
  createPublicHold,
  createPublicQuote,
  directBookingPolicy,
  getPublicAvailability,
} from '../server/direct-booking-service.mjs'

const enabledEnv = {
  DIRECT_BOOKING_ENABLED: 'true',
  DIRECT_BOOKING_TOKEN_SECRET: 'test-only-direct-booking-secret-1234567890',
}
const now = new Date('2026-07-16T05:00:00.000Z')
const properties = [
  { id: 'property-1', code: 'SANDBOX', currency: 'THB' },
  { id: 'property-2', code: 'OTHER', currency: 'THB' },
]
const roomTypes = [
  {
    id: 'room-type-1', propertyId: 'property-1', code: 'DELUXE', name: 'Deluxe Room',
    baseRate: 1250, baseRateSatang: 125000n, maxOccupancy: 3,
  },
  {
    id: 'room-type-2', propertyId: 'property-2', code: 'DELUXE', name: 'Other Deluxe',
    baseRate: 999, baseRateSatang: 99900n, maxOccupancy: 2,
  },
]
const rooms = [
  { id: 'room-1', propertyId: 'property-1', roomTypeId: 'room-type-1', operationalStatus: 'AVAILABLE' },
  { id: 'room-2', propertyId: 'property-2', roomTypeId: 'room-type-2', operationalStatus: 'AVAILABLE' },
]
const quotes = []
const holds = []
const guests = []
const reservations = []
const folios = []
const charges = []
const reservationLogs = []
const audits = []
const events = []
let sequence = 1
let lockTail = Promise.resolve()

function overlaps(row, where) {
  return row.checkIn < where.checkIn.lt && row.checkOut > where.checkOut.gt
}

function quoteWithInclude(row, args = {}) {
  if (!row) return null
  return args.include?.roomType
    ? { ...row, roomType: roomTypes.find((roomType) => roomType.id === row.roomTypeId) }
    : { ...row }
}

function reservationWithInclude(row, args = {}) {
  if (!row) return null
  return {
    ...row,
    ...(args.include?.roomType ? { roomType: roomTypes.find((roomType) => roomType.id === row.roomTypeId) } : {}),
    ...(args.include?.folio ? { folio: folios.find((folio) => folio.reservationId === row.id) || null } : {}),
  }
}

function holdWithInclude(row, args = {}) {
  if (!row) return null
  const result = { ...row }
  if (args.include?.quote) {
    const quote = quotes.find((candidate) => candidate.id === row.quoteId) || null
    result.quote = quote ? quoteWithInclude(quote, args.include.quote) : null
  }
  if (args.include?.reservation) {
    const reservation = reservations.find((candidate) => candidate.id === row.reservationId) || null
    result.reservation = reservationWithInclude(reservation, args.include.reservation)
  }
  return result
}

const prisma = {
  property: {
    findUnique: async ({ where }) => properties.find((property) => property.code === where.code) || null,
  },
  roomType: {
    findMany: async ({ where }) => roomTypes
      .filter((roomType) => roomType.propertyId === where.propertyId && (!where.code || roomType.code === where.code))
      .sort((left, right) => left.code.localeCompare(right.code)),
    findFirst: async ({ where }) => roomTypes.find((roomType) => (
      roomType.propertyId === where.propertyId && roomType.code === where.code
    )) || null,
  },
  room: {
    count: async ({ where }) => rooms.filter((room) => (
      room.propertyId === where.propertyId
      && room.roomTypeId === where.roomTypeId
      && room.operationalStatus === where.operationalStatus
    )).length,
  },
  publicBookingQuote: {
    findUnique: async ({ where, ...args }) => quoteWithInclude(quotes.find((quote) => (
      quote.propertyId === where.propertyId_idempotencyKey.propertyId
      && quote.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey
    )) || null, args),
    findFirst: async ({ where, ...args }) => quoteWithInclude(quotes.find((quote) => (
      quote.id === where.id && quote.propertyId === where.propertyId
    )) || null, args),
    create: async ({ data, ...args }) => {
      if (quotes.some((quote) => quote.propertyId === data.propertyId && quote.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error('Unique quote idempotency key'), { code: 'P2002' })
      }
      const row = { id: `quote-${sequence++}`, createdAt: now, ...data }
      quotes.push(row)
      return quoteWithInclude(row, args)
    },
  },
  inventoryHold: {
    count: async ({ where }) => holds.filter((hold) => (
      hold.propertyId === where.propertyId
      && hold.roomTypeId === where.roomTypeId
      && hold.status === where.status
      && hold.expiresAt > where.expiresAt.gt
      && overlaps(hold, where)
    )).length,
    findUnique: async ({ where }) => holdWithInclude(holds.find((hold) => (
      hold.propertyId === where.propertyId_idempotencyKey.propertyId
      && hold.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey
    )) || null),
    findFirst: async ({ where, ...args }) => holdWithInclude(holds.find((hold) => (
      (!where.id || hold.id === where.id)
      && hold.propertyId === where.propertyId
      && (!where.publicTokenHash || hold.publicTokenHash === where.publicTokenHash)
    )) || null, args),
    create: async ({ data }) => {
      if (holds.some((hold) => hold.propertyId === data.propertyId && hold.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error('Unique hold idempotency key'), { code: 'P2002' })
      }
      const row = { id: `hold-${sequence++}`, reservationId: null, conversionIdempotencyKey: null, createdAt: now, updatedAt: now, ...data }
      holds.push(row)
      return { ...row }
    },
    update: async ({ where, data }) => {
      const row = holds.find((hold) => hold.id === where.id)
      Object.assign(row, data, { updatedAt: now })
      return { ...row }
    },
    updateMany: async ({ where, data }) => {
      let count = 0
      for (const hold of holds) {
        if (hold.propertyId === where.propertyId && hold.status === where.status && hold.expiresAt <= where.expiresAt.lte) {
          Object.assign(hold, data, { updatedAt: now })
          count += 1
        }
      }
      return { count }
    },
  },
  reservation: {
    count: async ({ where }) => reservations.filter((reservation) => (
      reservation.propertyId === where.propertyId
      && reservation.roomTypeId === where.roomTypeId
      && where.status.in.includes(reservation.status)
      && overlaps(reservation, where)
    )).length,
    create: async ({ data }) => {
      const row = { id: `reservation-${sequence++}`, createdAt: now, updatedAt: now, ...data }
      reservations.push(row)
      return { ...row }
    },
  },
  guest: {
    create: async ({ data }) => {
      const row = { id: `guest-${sequence++}`, createdAt: now, updatedAt: now, ...data }
      guests.push(row)
      return { ...row }
    },
  },
  folio: {
    create: async ({ data }) => {
      const row = { id: `folio-${sequence++}`, status: 'OPEN', createdAt: now, updatedAt: now, ...data }
      folios.push(row)
      return { ...row }
    },
  },
  charge: {
    create: async ({ data }) => {
      const row = { id: `charge-${sequence++}`, createdAt: now, ...data }
      charges.push(row)
      return { ...row }
    },
  },
  reservationLog: {
    create: async ({ data }) => {
      reservationLogs.push(data)
      return { id: `reservation-log-${reservationLogs.length}`, ...data }
    },
  },
  auditLog: {
    create: async ({ data }) => {
      audits.push(data)
      return { id: `audit-${audits.length}`, ...data }
    },
  },
  domainEvent: {
    create: async ({ data }) => {
      const row = { id: BigInt(events.length + 1), createdAt: now, ...data }
      events.push(row)
      return row
    },
  },
  $queryRawUnsafe: async () => [],
  $transaction: async (callback) => {
    const previous = lockTail
    let release
    lockTail = new Promise((resolve) => { release = resolve })
    const tx = Object.create(prisma)
    tx.$queryRawUnsafe = async (sql, key) => {
      assert.match(sql, /pg_advisory_xact_lock/, 'holds acquire a PostgreSQL transaction lock')
      assert.match(key, /^direct-booking:property-\d:room-type-\d$/)
      await previous
      return []
    }
    try {
      return await callback(tx)
    } finally {
      release()
    }
  },
}

assert.equal(directBookingPolicy.enabledByDefault, false)
assert.equal(directBookingPolicy.holdMinutes, 15)
assert.equal(directBookingPolicy.acceptsCardData, false)
const migrationSql = await readFile(
  new URL('../prisma/migrations/20260716160000_direct_booking_foundation/migration.sql', import.meta.url),
  'utf8',
)
assert.match(migrationSql, /PublicBookingQuote_immutable/)
assert.match(migrationSql, /BEFORE UPDATE OR DELETE/, 'quote immutability is enforced by PostgreSQL, not only service convention')

await assert.rejects(
  () => getPublicAvailability(prisma, {
    checkIn: '2026-08-01', checkOut: '2026-08-03', adults: 2, children: 0,
  }, { env: {} }),
  (error) => error.statusCode === 503 && /not available/.test(error.message),
  'direct booking is disabled unless explicitly enabled',
)

const stay = {
  propertyCode: 'SANDBOX',
  checkIn: '2026-08-01',
  checkOut: '2026-08-03',
  adults: 2,
  children: 0,
  roomTypeCode: 'DELUXE',
}
const availability = await getPublicAvailability(prisma, stay, { env: enabledEnv, now })
assert.equal(availability.roomTypes[0].availableRooms, 1)
assert.equal(availability.roomTypes[0].stayTotalSatang, '250000')

const quote = await createPublicQuote(prisma, stay, {
  env: enabledEnv, now, idempotencyKey: 'quote-request-00000001',
})
const quoteReplay = await createPublicQuote(prisma, stay, {
  env: enabledEnv, now, idempotencyKey: 'quote-request-00000001',
})
assert.equal(quoteReplay.quoteId, quote.quoteId, 'quote retries return the original immutable snapshot')
assert.equal(quotes.length, 1)
assert.equal(quote.immutable, true)

const holdAttempts = await Promise.allSettled([
  createPublicHold(prisma, { propertyCode: 'SANDBOX', quoteId: quote.quoteId }, {
    env: enabledEnv, now, idempotencyKey: 'hold-request-000000001',
  }),
  createPublicHold(prisma, { propertyCode: 'SANDBOX', quoteId: quote.quoteId }, {
    env: enabledEnv, now, idempotencyKey: 'hold-request-000000002',
  }),
])
const successfulHolds = holdAttempts.filter((attempt) => attempt.status === 'fulfilled')
const rejectedHolds = holdAttempts.filter((attempt) => attempt.status === 'rejected')
assert.equal(successfulHolds.length, 1, 'only one simultaneous last-room hold succeeds')
assert.equal(rejectedHolds.length, 1)
assert.equal(rejectedHolds[0].reason.statusCode, 409)

const publicHold = successfulHolds[0].value
const storedHold = holds.find((hold) => hold.id === publicHold.holdId)
assert.notEqual(storedHold.publicTokenHash, publicHold.holdToken)
assert.equal(storedHold.publicTokenHash, createHash('sha256').update(publicHold.holdToken).digest('hex'))
assert.equal(Object.values(storedHold).includes(publicHold.holdToken), false, 'the raw public token is never persisted')
assert.equal(storedHold.expiresAt.toISOString(), '2026-07-16T05:15:00.000Z')

const holdReplay = await createPublicHold(prisma, { propertyCode: 'SANDBOX', quoteId: quote.quoteId }, {
  env: enabledEnv,
  now,
  idempotencyKey: storedHold.idempotencyKey,
})
assert.equal(holdReplay.holdId, publicHold.holdId)
assert.equal(holdReplay.holdToken, publicHold.holdToken, 'a retry deterministically returns the original token without storing it raw')
assert.equal(holds.length, 1)

await assert.rejects(
  () => convertPublicHold(prisma, {
    propertyCode: 'SANDBOX',
    holdToken: publicHold.holdToken,
    guest: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    cardNumber: '4111111111111111',
  }, { env: enabledEnv, now, idempotencyKey: 'booking-request-000001' }),
  /Unrecognized key/,
  'card data and unknown fields are rejected by the strict public contract',
)

const bookingInput = {
  propertyCode: 'SANDBOX',
  holdToken: publicHold.holdToken,
  guest: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  specialRequests: 'Quiet room if available',
}
const booking = await convertPublicHold(prisma, bookingInput, {
  env: enabledEnv, now, idempotencyKey: 'booking-request-000001',
})
const bookingReplay = await convertPublicHold(prisma, bookingInput, {
  env: enabledEnv, now, idempotencyKey: 'booking-request-000001',
})
assert.equal(bookingReplay.bookingId, booking.bookingId, 'booking retries return the original atomic result')
assert.equal(reservations.length, 1)
assert.equal(guests.length, 1)
assert.equal(folios.length, 1)
assert.equal(charges.length, 1)
assert.equal(reservationLogs.length, 1)
assert.equal(reservations[0].propertyId, 'property-1')
assert.equal(reservations[0].source, 'WEBSITE')
assert.equal(reservations[0].totalAmountSatang, 250000n)
assert.equal(charges[0].totalSatang, 250000n)
assert.equal(holds[0].status, 'CONVERTED')
assert.equal(audits.at(-1).action, 'PUBLIC_BOOKING_CREATED')
assert.equal(events.at(-1).eventType, 'PUBLIC_BOOKING_CREATED')
assert.deepEqual(Object.keys(booking).sort(), [
  'bookingId', 'checkIn', 'checkOut', 'confirmationCode', 'currency', 'roomType', 'status', 'totalSatang',
].sort(), 'public response excludes guest PII, internal audit data, and token hashes')

console.log('Direct booking service tests passed')
