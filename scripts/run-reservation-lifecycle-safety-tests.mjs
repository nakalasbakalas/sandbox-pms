/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { checkInReservation, checkOutReservation } from '../server/pms-service.mjs'

function bangkokDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

function lifecycleFixture(initialStatus) {
  const property = { id: 'property-a', code: 'SANDBOX' }
  const actor = { id: 'front-desk-a', propertyId: property.id, role: 'FRONT_DESK', name: 'Front Desk' }
  const today = bangkokDateKey()
  const room = {
    id: 'room-a',
    propertyId: property.id,
    roomTypeId: 'room-type-a',
    number: '101',
    operationalStatus: 'AVAILABLE',
    currentStatus: initialStatus === 'CHECKED_IN' ? 'OCCUPIED' : 'VACANT_CLEAN',
    currentReservation: initialStatus === 'CHECKED_IN' ? 'reservation-a' : null,
  }
  const reservation = {
    id: 'reservation-a',
    propertyId: property.id,
    confirmationCode: 'CONF-A',
    status: initialStatus,
    assignedRoomId: room.id,
    assignedRoom: room,
    roomTypeId: room.roomTypeId,
    checkIn: addDays(today, 0),
    checkOut: addDays(today, 1),
    updatedAt: new Date(`${today}T01:00:00.000Z`),
    adults: 1,
    children: 0,
    guestId: 'guest-a',
    guest: {
      id: 'guest-a',
      propertyId: property.id,
      nationality: 'TH',
      idNumber: 'TEST-ID',
    },
    folio: {
      id: 'folio-a',
      propertyId: property.id,
      status: 'OPEN',
      balance: 0,
      balanceSatang: 0n,
      charges: [],
      payments: [],
    },
    bookingEmailEvents: [],
  }
  const attempts = new Map()
  const evidence = { audits: [], events: [], locks: [], reservationLogs: [], roomLogs: [], transactionOptions: [] }

  const tx = {
    $queryRawUnsafe: async (_statement, lockKey) => {
      evidence.locks.push(lockKey)
      return [{ locked: '1' }]
    },
    property: {
      findUnique: async ({ where }) => where.id === property.id ? property : null,
    },
    reservation: {
      findFirst: async ({ where }) => {
        if (typeof where.id === 'object') return null
        return where.id === reservation.id && where.propertyId === property.id ? reservation : null
      },
      findUnique: async ({ where }) => where.id === reservation.id ? reservation : null,
      updateMany: async ({ where, data }) => {
        const allowed = where.id === reservation.id
          && (typeof where.status === 'string'
            ? reservation.status === where.status
            : where.status.in.includes(reservation.status))
        if (!allowed) return { count: 0 }
        Object.assign(reservation, data, { updatedAt: new Date(`${today}T02:00:00.000Z`) })
        return { count: 1 }
      },
    },
    room: {
      findUnique: async ({ where }) => where.id === room.id ? room : null,
      updateMany: async ({ where, data }) => {
        const statusAllowed = !where.currentStatus
          || (where.currentStatus.in ? where.currentStatus.in.includes(room.currentStatus) : !where.currentStatus.notIn.includes(room.currentStatus))
        const reservationAllowed = where.OR
          ? where.OR.some((condition) => condition.currentReservation === room.currentReservation)
          : where.currentReservation === room.currentReservation
        if (where.id !== room.id || !statusAllowed || !reservationAllowed) return { count: 0 }
        Object.assign(room, data)
        return { count: 1 }
      },
    },
    roomDateInventory: {
      findFirst: async () => null,
    },
    folio: {
      update: async ({ where, data }) => {
        if (where.id !== reservation.folio.id) throw new Error('Unexpected folio')
        Object.assign(reservation.folio, data)
        return reservation.folio
      },
    },
    reservationMutationAttempt: {
      findUnique: async ({ where }) => attempts.get(`${where.propertyId_idempotencyKey.propertyId}:${where.propertyId_idempotencyKey.idempotencyKey}`) || null,
      create: async ({ data }) => {
        const attempt = { id: `attempt-${attempts.size + 1}`, ...data, resultFingerprint: null }
        attempts.set(`${data.propertyId}:${data.idempotencyKey}`, attempt)
        return attempt
      },
      update: async ({ where, data }) => {
        const attempt = [...attempts.values()].find((entry) => entry.id === where.id)
        Object.assign(attempt, data)
        return attempt
      },
    },
    reservationLog: {
      create: async ({ data }) => {
        evidence.reservationLogs.push(data)
        return data
      },
    },
    roomStatusLog: {
      create: async ({ data }) => {
        evidence.roomLogs.push(data)
        return data
      },
    },
    auditLog: {
      create: async ({ data }) => {
        evidence.audits.push(data)
        return data
      },
    },
    domainEvent: {
      create: async ({ data }) => {
        evidence.events.push(data)
        return data
      },
    },
  }

  return {
    actor,
    evidence,
    property,
    reservation,
    prisma: {
      $transaction: async (callback, options) => {
        evidence.transactionOptions.push(options)
        return callback(tx)
      },
    },
  }
}

await assert.rejects(
  checkInReservation({}, 'reservation-a', { propertyId: 'property-a' }),
  /lifecycle idempotency key is required/i,
  'check-in requires an explicit lifecycle retry key before database work',
)
await assert.rejects(
  checkOutReservation({}, 'reservation-a', { propertyId: 'property-a' }),
  /lifecycle idempotency key is required/i,
  'check-out requires an explicit lifecycle retry key before database work',
)

const staleCheckIn = lifecycleFixture('CONFIRMED')
await assert.rejects(
  checkInReservation(staleCheckIn.prisma, staleCheckIn.reservation.id, staleCheckIn.actor, {
    idempotencyKey: 'check-in-stale',
    expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
  }),
  (error) => error?.statusCode === 409 && /changed after the front desk loaded/i.test(error.message),
  'stale check-in tokens fail before lifecycle changes',
)
assert.equal(staleCheckIn.reservation.status, 'CONFIRMED')
assert.equal(staleCheckIn.evidence.audits.length, 0)

const oneSatangDue = lifecycleFixture('CONFIRMED')
oneSatangDue.reservation.folio.balance = 0
oneSatangDue.reservation.folio.balanceSatang = 1n
await assert.rejects(
  checkInReservation(oneSatangDue.prisma, oneSatangDue.reservation.id, oneSatangDue.actor, {
    idempotencyKey: 'check-in-one-satang-due',
    expectedUpdatedAt: oneSatangDue.reservation.updatedAt.toISOString(),
  }),
  /collect or override the amount due/i,
  'one satang due blocks check-in even when the legacy Float says zero',
)
assert.equal(oneSatangDue.reservation.status, 'CONFIRMED')

const missingExactBalance = lifecycleFixture('CONFIRMED')
missingExactBalance.reservation.folio.balanceSatang = null
await assert.rejects(
  checkInReservation(missingExactBalance.prisma, missingExactBalance.reservation.id, missingExactBalance.actor, {
    idempotencyKey: 'check-in-missing-exact-balance',
    expectedUpdatedAt: missingExactBalance.reservation.updatedAt.toISOString(),
  }),
  (error) => error?.statusCode === 503 && /balanceSatang exact money shadow is required/i.test(error.message),
  'check-in fails closed when the exact balance shadow is missing',
)

const checkIn = lifecycleFixture('CONFIRMED')
const checkInOptions = {
  idempotencyKey: 'check-in-retry-a',
  expectedUpdatedAt: checkIn.reservation.updatedAt.toISOString(),
}
const checkedIn = await checkInReservation(checkIn.prisma, checkIn.reservation.id, checkIn.actor, checkInOptions)
assert.equal(checkedIn.status, 'CHECKED_IN')
assert.equal(checkIn.evidence.audits.length, 1)
assert.equal(checkIn.evidence.events.length, 1)
assert.equal(checkIn.evidence.reservationLogs.length, 1)
assert.equal(checkIn.evidence.roomLogs.length, 1)
assert.equal(checkIn.evidence.transactionOptions[0].isolationLevel, 'Serializable')
assert.ok(checkIn.evidence.locks.some((key) => key === 'reservation-mutation:reservation:property-a:reservation-a'))
assert.ok(checkIn.evidence.locks.some((key) => key === 'reservation-mutation:idempotency:property-a:check-in-retry-a'))

const replayedCheckIn = await checkInReservation(checkIn.prisma, checkIn.reservation.id, checkIn.actor, checkInOptions)
assert.equal(replayedCheckIn.status, 'CHECKED_IN')
assert.equal(checkIn.evidence.audits.length, 1, 'lost-response retry does not duplicate check-in audit evidence')
assert.equal(checkIn.evidence.events.length, 1, 'lost-response retry does not duplicate check-in events')
assert.equal(checkIn.evidence.reservationLogs.length, 1, 'lost-response retry does not duplicate reservation logs')
assert.equal(checkIn.evidence.roomLogs.length, 1, 'lost-response retry does not duplicate room logs')
await assert.rejects(
  checkInReservation(checkIn.prisma, checkIn.reservation.id, checkIn.actor, {
    ...checkInOptions,
    additionalNotes: 'Changed command',
  }),
  /different command/i,
  'a completed check-in key cannot authorize a changed command',
)

const checkOut = lifecycleFixture('CHECKED_IN')
const checkOutOptions = {
  idempotencyKey: 'check-out-retry-a',
  expectedUpdatedAt: checkOut.reservation.updatedAt.toISOString(),
}
const checkedOut = await checkOutReservation(checkOut.prisma, checkOut.reservation.id, checkOut.actor, checkOutOptions)
assert.equal(checkedOut.status, 'CHECKED_OUT')
assert.equal(checkedOut.folio.status, 'CLOSED')
assert.equal(checkedOut.assignedRoom.currentStatus, 'VACANT_DIRTY')
assert.equal(checkOut.evidence.audits.length, 1)
assert.equal(checkOut.evidence.events.length, 1)

const replayedCheckOut = await checkOutReservation(checkOut.prisma, checkOut.reservation.id, checkOut.actor, checkOutOptions)
assert.equal(replayedCheckOut.status, 'CHECKED_OUT')
assert.equal(replayedCheckOut.folio.balanceSatang, checkedOut.folio.balanceSatang, 'checkout replay preserves the exact balance total')
assert.equal(checkOut.evidence.audits.length, 1, 'lost-response retry does not duplicate check-out audit evidence')
assert.equal(checkOut.evidence.events.length, 1, 'lost-response retry does not duplicate check-out events')
assert.equal(checkOut.evidence.reservationLogs.length, 1, 'lost-response retry does not duplicate check-out logs')
assert.equal(checkOut.evidence.roomLogs.length, 1, 'lost-response retry does not duplicate housekeeping handoff logs')

const routeSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
for (const action of ['check-in', 'check-out']) {
  const start = routeSource.indexOf(`/(?<id>[^/]+)\\/${action}$/`)
  assert.notEqual(start, -1, `${action} route remains available`)
  const routeSlice = routeSource.slice(start, start + 1_900)
  assert.match(routeSlice, /body\.expectedUpdatedAt/)
  assert.match(routeSlice, /x-reservation-expected-updated-at/)
  assert.match(routeSlice, /x-reservation-expected-version/)
  assert.match(routeSlice, /Reservation update tokens do not match/)
  assert.match(routeSlice, /idempotencyKey:\s*context\.idempotencyKey/)
}

const apiSource = await readFile(new URL('../server/api-routes.mjs', import.meta.url), 'utf8')
assert.match(apiSource, /requiredIdempotencyKeyParameter[\s\S]*required:\s*true/)
for (const action of ['check-in', 'check-out']) {
  const contract = resolveApiRouteContract(`/api/reservations/reservation-a/${action}`)
  assert.deepEqual(contract.methods, ['POST'], `${action} remains on its backward-compatible POST path`)
  assert.equal(
    contract.parameters.find((parameter) => parameter.name === 'x-idempotency-key')?.required,
    true,
    `OpenAPI requires a lifecycle retry key for ${action}`,
  )
  assert.equal(
    contract.parameters.some((parameter) => parameter.name === 'x-reservation-expected-updated-at'),
    true,
    `OpenAPI documents the primary stale-write header for ${action}`,
  )
  assert.equal(
    contract.parameters.some((parameter) => parameter.name === 'x-reservation-expected-version'),
    true,
    `OpenAPI documents the compatibility stale-write header for ${action}`,
  )
}

console.log('Reservation lifecycle safety tests passed.')
