/* global console */
import assert from 'node:assert/strict'
import { cancelReservation, updateReservationGuest } from '../server/pms-service.mjs'

const property = { id: 'property-a', code: 'SANDBOX' }
const actor = { id: 'manager-a', propertyId: property.id, role: 'MANAGER', name: 'Manager' }

function fixture() {
  const attempts = new Map()
  const evidence = { logs: [], audits: [], events: [] }
  const reservation = {
    id: 'reservation-a', propertyId: property.id, confirmationCode: 'CONF-A', status: 'CONFIRMED',
    assignedRoomId: null, checkIn: new Date('2026-07-18T00:00:00.000Z'), checkOut: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:00.000Z'), guestId: 'guest-a', roomTypeId: 'type-a', adults: 1, children: 0, childAges: [],
    guest: { id: 'guest-a', propertyId: property.id, firstName: 'Ada', lastName: 'Guest', email: 'ada@example.test', phone: '+6612345678', vipStatus: false, updatedAt: new Date('2026-07-17T00:00:00.000Z') },
  }
  const tx = {
    property: { findUnique: async ({ where }) => where.id === property.id ? property : null },
    reservation: {
      findFirst: async ({ where }) => where.id === reservation.id && where.propertyId === property.id ? reservation : null,
      findUnique: async () => reservation,
      update: async ({ data }) => {
        Object.assign(reservation, data, { updatedAt: new Date('2026-07-18T01:00:00.000Z') })
        return reservation
      },
    },
    reservationMutationAttempt: {
      findUnique: async ({ where }) => attempts.get(where.propertyId_idempotencyKey.idempotencyKey) || null,
      create: async ({ data }) => {
        const attempt = { id: `attempt-${attempts.size + 1}`, ...data, resultFingerprint: null }
        attempts.set(data.idempotencyKey, attempt)
        return attempt
      },
      update: async ({ where, data }) => {
        const attempt = [...attempts.values()].find((entry) => entry.id === where.id)
        Object.assign(attempt, data)
        return attempt
      },
    },
    roomDateInventory: { deleteMany: async () => ({ count: 0 }) },
    reservationLog: { create: async ({ data }) => { evidence.logs.push(data); return data } },
    auditLog: { create: async ({ data }) => { evidence.audits.push(data); return data } },
    domainEvent: { create: async ({ data }) => { evidence.events.push(data); return data } },
    guest: {
      update: async ({ data }) => {
        Object.assign(reservation.guest, data, { updatedAt: new Date('2026-07-18T02:00:00.000Z') })
        return reservation.guest
      },
    },
  }
  return { evidence, reservation, prisma: { $transaction: async (callback) => callback(tx) } }
}

await assert.rejects(
  cancelReservation({}, 'forged-reservation', actor, 'CANCELLED', ''),
  /reason is required/i,
  'cancellation requires an operational reason before any database work',
)

const cancel = fixture()
await assert.rejects(
  cancelReservation(cancel.prisma, 'forged-reservation', actor, 'CANCELLED', 'Guest asked'),
  /not found/i,
  'a forged reservation identifier cannot cross the active property boundary',
)
const cancelled = await cancelReservation(cancel.prisma, 'reservation-a', actor, 'CANCELLED', 'Guest asked', { idempotencyKey: 'cancel-a' })
assert.equal(cancelled.status, 'CANCELLED')
assert.equal(cancel.evidence.logs.length, 1)
assert.equal(cancel.evidence.audits.length, 1)
assert.equal(cancel.evidence.events.length, 1)
const replay = await cancelReservation(cancel.prisma, 'reservation-a', actor, 'CANCELLED', 'Guest asked', { idempotencyKey: 'cancel-a' })
assert.equal(replay.status, 'CANCELLED', 'same command returns its original outcome')
assert.equal(cancel.evidence.logs.length, 1, 'replay creates no duplicate reservation log')
assert.equal(cancel.evidence.audits.length, 1, 'replay creates no duplicate audit')
assert.equal(cancel.evidence.events.length, 1, 'replay creates no duplicate event')
await assert.rejects(
  cancelReservation(cancel.prisma, 'reservation-a', actor, 'CANCELLED', 'Different reason', { idempotencyKey: 'cancel-a' }),
  /different command/i,
  'idempotency keys cannot be reused with changed intent',
)
await assert.rejects(
  cancelReservation(fixture().prisma, 'reservation-a', actor, 'CANCELLED', 'Guest asked', { expectedUpdatedAt: '2026-07-16T00:00:00.000Z' }),
  /changed after the booking board loaded/i,
  'stale cancellation is rejected before changing reservation status',
)
const futureNoShow = fixture()
futureNoShow.reservation.checkIn = new Date('2099-01-01T00:00:00.000Z')
await assert.rejects(
  cancelReservation(futureNoShow.prisma, 'reservation-a', actor, 'NO_SHOW', 'Guest did not arrive'),
  /future arrival cannot be marked as a no-show/i,
  'future reservations cannot be prematurely marked no-show',
)

const guest = fixture()
const updatedGuestReservation = await updateReservationGuest(guest.prisma, 'reservation-a', {
  firstName: 'Grace',
  email: null,
  phone: null,
  vipStatus: true,
}, actor, { idempotencyKey: 'guest-a' })
assert.equal(updatedGuestReservation.guest.firstName, 'Grace')
assert.equal(updatedGuestReservation.guest.email, null, 'an explicit null clears the guest email')
assert.equal(updatedGuestReservation.guest.phone, null, 'an explicit null clears the guest phone')
assert.deepEqual(guest.evidence.logs[0].changes, { guestFields: ['email', 'firstName', 'phone', 'vipStatus'] }, 'guest log stores changed field names but no PII values')
assert.deepEqual(guest.evidence.audits[0].changes.fields, ['email', 'firstName', 'phone', 'vipStatus'], 'guest audit stores field names but no PII values')
assert.equal(guest.evidence.events.length, 1)
await updateReservationGuest(guest.prisma, 'reservation-a', {
  firstName: 'Grace',
  email: null,
  phone: null,
  vipStatus: true,
}, actor, { idempotencyKey: 'guest-a' })
assert.equal(guest.evidence.logs.length, 1, 'guest replay creates no duplicate log')
assert.equal(guest.evidence.audits.length, 1, 'guest replay creates no duplicate audit')
await assert.rejects(
  updateReservationGuest(fixture().prisma, 'reservation-a', { firstName: 'Grace', expectedGuestUpdatedAt: '2026-07-16T00:00:00.000Z' }, actor),
  /guest changed after the booking board loaded/i,
  'stale guest update is rejected',
)

console.log('Reservation command service tests passed.')
