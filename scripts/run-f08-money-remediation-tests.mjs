/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { createPayment, createReservation, getTodayData } from '../server/pms-service.mjs'

function oddBookingFixture() {
  const property = {
    id: 'property-f08',
    code: 'SANDBOX',
    extraGuestFee: 300,
    extraGuestFeeSatang: 30_000n,
    childFee: 300,
    childFeeSatang: 30_000n,
  }
  const roomType = {
    id: 'room-type-f08',
    code: 'TWIN',
    name: 'Twin',
    baseRate: 50.01,
    baseRateSatang: 5_001n,
    standardOcc: 2,
    maxOccupancy: 4,
  }
  const sourceEvent = { id: 'booking-email-f08', propertyId: property.id }
  const charges = []
  const payments = []
  let reservation
  let folio

  const composedReservation = () => ({
    ...reservation,
    guest: reservation?.guest,
    roomType,
    assignedRoom: null,
    sourceEmailEvent: sourceEvent,
    bookingEmailEvents: [],
    folio: folio ? { ...folio, charges: [...charges], payments: [...payments] } : null,
  })

  const tx = {
    property: { findUnique: async ({ where }) => where.id === property.id || where.code === property.code ? property : null },
    bookingEmailEvent: { findFirst: async ({ where }) => where.id === sourceEvent.id && where.propertyId === property.id ? sourceEvent : null },
    roomType: { findFirst: async ({ where }) => where.propertyId === property.id && where.code === roomType.code ? roomType : null },
    room: { count: async () => 1 },
    guest: {
      create: async ({ data }) => ({ id: 'guest-f08', ...data }),
    },
    reservation: {
      count: async () => 0,
      create: async ({ data }) => {
        reservation = {
          id: 'reservation-f08',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          ...data,
          guest: { id: data.guestId, firstName: 'Odd', lastName: 'Total' },
        }
        return composedReservation()
      },
      findUnique: async ({ where }) => where.id === reservation?.id ? composedReservation() : null,
      findFirst: async ({ where }) => where.id === reservation?.id && where.propertyId === property.id ? composedReservation() : null,
    },
    folio: {
      create: async ({ data }) => {
        folio = { id: 'folio-f08', status: 'OPEN', createdAt: new Date(), updatedAt: new Date(), ...data }
        return { ...folio }
      },
      findFirst: async ({ where }) => where.id === folio?.id ? { ...folio, reservation: composedReservation() } : null,
      findUnique: async ({ where }) => where.id === folio?.id ? { ...folio, charges: [...charges], payments: [...payments] } : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, folio.id)
        Object.assign(folio, data, { updatedAt: new Date() })
        return { ...folio, charges: [...charges], payments: [...payments], reservation: composedReservation() }
      },
    },
    charge: {
      create: async ({ data }) => {
        const charge = { id: 'charge-f08', createdAt: new Date(), updatedAt: new Date(), void: false, ...data }
        charges.push(charge)
        return charge
      },
      findMany: async ({ where }) => charges.filter((charge) => charge.folioId === where.folioId && !charge.void),
    },
    payment: {
      findUnique: async ({ where }) => {
        if (where.propertyId_idempotencyKey) {
          return payments.find((payment) => payment.propertyId === where.propertyId_idempotencyKey.propertyId && payment.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey) || null
        }
        if (where.propertyId_referenceFingerprint) return null
        if (where.sourceEmailEventId) return payments.find((payment) => payment.sourceEmailEventId === where.sourceEmailEventId) || null
        return null
      },
      findMany: async ({ where }) => payments.filter((payment) => payment.folioId === where.folioId),
      create: async ({ data }) => {
        const payment = { id: 'payment-f08', createdAt: new Date(), updatedAt: new Date(), ...data }
        payments.push(payment)
        return payment
      },
    },
    reservationLog: { create: async ({ data }) => data },
    auditLog: { create: async ({ data }) => data },
    domainEvent: { create: async ({ data }) => ({ id: 1n, createdAt: new Date(), ...data }) },
  }
  return {
    actor: { id: 'manager-f08', propertyId: property.id, role: 'MANAGER', name: 'Manager' },
    prisma: { ...tx, $transaction: async (callback) => callback(tx) },
    charges,
    payments,
    getFolio: () => folio,
  }
}

const fixture = oddBookingFixture()
const created = await createReservation(fixture.prisma, {
  guest: { firstName: 'Odd', lastName: 'Total' },
  confirmationCode: 'ODD-10001',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  roomTypeCode: 'TWIN',
  adults: 2,
  children: 0,
  childAges: [],
  ratePerNight: 50.01,
  ratePerNightSatang: '5001',
  totalAmountSatang: '10001',
  sourceEmailEventId: 'booking-email-f08',
  source: 'EMAIL',
}, fixture.actor)
assert.equal(created.totalAmountSatang, 10_001n, 'reservation persists the authoritative odd booking total')
assert.equal(fixture.getFolio().totalSatang, 10_001n, 'folio persists the same authoritative odd booking total')
assert.equal(fixture.getFolio().balanceSatang, 10_001n)
assert.equal(fixture.charges[0].amountSatang, 5_001n, 'nightly display rate remains deterministic')
assert.equal(fixture.charges[0].totalSatang, 10_001n, 'charge total is explicit rather than nightly rate multiplied back to 10002')

const paid = await createPayment(fixture.prisma, {
  folioId: fixture.getFolio().id,
  amountSatang: '10001',
  method: 'CASH',
  idempotencyKey: 'pay-odd-total-f08',
}, fixture.actor)
assert.equal(paid.folio.balanceSatang, 0n, 'payment of the exact odd total leaves zero due')
assert.equal(paid.folio.status, 'CLOSED')

function todayPrisma(missingExact) {
  const property = { id: 'property-today', code: 'SANDBOX' }
  let folioCount = 0
  return {
    property: { findUnique: async () => property },
    folio: {
      count: async ({ where }) => {
        folioCount += 1
        if (where.status === 'OPEN' && where.balanceSatang === null) return missingExact ? 1 : 0
        return 2
      },
    },
    room: { findMany: async () => [] },
    reservation: { count: async () => 0 },
    bookingEmailEvent: { count: async () => 0 },
    housekeepingIssue: { count: async () => 0 },
    calls: () => folioCount,
  }
}

const invalidToday = todayPrisma(true)
await assert.rejects(
  getTodayData(invalidToday, { propertyId: 'property-today', role: 'MANAGER' }),
  (error) => error?.statusCode === 503 && /missing balanceSatang exact money/i.test(error.message),
  'Today fails closed when an open folio has a null exact balance',
)
assert.equal(invalidToday.calls(), 1, 'Today stops before publishing an under-counted unpaid total')

const validToday = todayPrisma(false)
const today = await getTodayData(validToday, { propertyId: 'property-today', role: 'MANAGER' })
assert.equal(today.unpaidFolios, 2)

const serviceSource = await readFile(new URL('../server/pms-service.mjs', import.meta.url), 'utf8')
assert.match(serviceSource, /totalAmountSatang:\s*satangToApiString\(amountSatang\)/, 'booking-email creation carries authoritative totalAmountSatang')
assert.match(serviceSource, /update\.totalAmountSatang\s*=\s*satangToApiString\(amountSatang\)/, 'booking-email modification carries authoritative totalAmountSatang')

console.log('F08 exact-money remediation tests passed.')
