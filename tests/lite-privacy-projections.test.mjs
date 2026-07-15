import assert from 'node:assert/strict'
import test from 'node:test'

import { getLiteBookingDetail, getLiteFrontDesk, listLiteBookings } from '../server/lite-service.mjs'

function property() {
  return {
    id: 'property-sandbox',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    timezone: 'Asia/Bangkok',
    currency: 'THB',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
  }
}

function reservation() {
  return {
    id: 'reservation-privacy',
    confirmationCode: 'SBX-PRIVACY',
    guestId: 'guest-privacy',
    roomTypeId: 'room-type-standard',
    assignedRoomId: null,
    checkIn: new Date('2026-07-20T00:00:00.000Z'),
    checkOut: new Date('2026-07-22T00:00:00.000Z'),
    actualCheckIn: null,
    actualCheckOut: null,
    status: 'CONFIRMED',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNightSatang: 100_000,
    totalAmountSatang: 200_000,
    depositAmountSatang: 0,
    depositPaid: false,
    source: 'DIRECT',
    channelRef: null,
    providerCode: null,
    externalReservationId: null,
    sourceEmailEventId: null,
    createdAt: new Date('2026-07-14T01:00:00.000Z'),
    updatedAt: new Date('2026-07-14T02:00:00.000Z'),
    guest: {
      id: 'guest-privacy',
      firstName: 'Privacy',
      lastName: 'Guest',
      nationality: 'TH',
      idType: 'PASSPORT',
      idNumber: 'PASSPORT-1234',
      vipStatus: false,
      blacklisted: false,
    },
    roomType: {
      id: 'room-type-standard',
      code: 'STANDARD',
      name: 'Standard Room',
      baseRateSatang: 100_000,
      maxOccupancy: 2,
      standardOcc: 2,
    },
    assignedRoom: null,
    folio: {
      id: 'folio-privacy',
      status: 'OPEN',
      subtotalSatang: 200_000,
      taxSatang: 0,
      totalSatang: 200_000,
      paidSatang: 50_000,
      balanceSatang: 150_000,
      charges: [],
      payments: [{
        id: 'payment-privacy',
        amountSatang: 50_000,
        method: 'ONLINE',
        reference: 'OTA-PAYMENT-9876',
        notes: 'Guest supplied private banking context',
        processedBy: 'cashier-1',
        createdAt: new Date('2026-07-14T01:30:00.000Z'),
      }],
      updatedAt: new Date('2026-07-14T01:30:00.000Z'),
    },
  }
}

function bookingEmailDelegate() {
  return {
    count: async () => 0,
    findMany: async () => [],
  }
}

test('Lite booking lists omit identity suffixes and redact payment evidence', async () => {
  const row = reservation()
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: {
      findMany: async () => [row],
      count: async () => 1,
    },
    bookingEmailEvent: bookingEmailDelegate(),
  }

  const result = await listLiteBookings(prisma, { limit: 25 })
  const booking = result.items[0]
  assert.equal(Object.hasOwn(booking.guest, 'idNumberLast4'), false)
  assert.equal(booking.folio.payments[0].reference, '••••9876')
  assert.equal(Object.hasOwn(booking.folio.payments[0], 'notes'), false)
})

test('Lite Front Desk keeps the check-in identity suffix but redacts payment evidence', async () => {
  const row = reservation()
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: { findMany: async () => [row] },
    room: { findMany: async () => [] },
    bookingEmailEvent: bookingEmailDelegate(),
  }

  const result = await getLiteFrontDesk(prisma, { date: '2026-07-20' })
  const booking = result.arrivals[0]
  assert.equal(booking.guest.idNumberLast4, '1234')
  assert.equal(booking.folio.payments[0].reference, '••••9876')
  assert.equal(Object.hasOwn(booking.folio.payments[0], 'notes'), false)
})

const cashierRestrictedGuestFields = [
  'idNumberLast4',
  'nationality',
  'idType',
  'identityComplete',
  'vip',
  'blacklisted',
]

function assertCashierPaymentProjection(booking) {
  assert.equal(booking.confirmationCode, 'SBX-PRIVACY')
  assert.equal(booking.guest.displayName, 'Privacy Guest')
  for (const field of cashierRestrictedGuestFields) {
    assert.equal(Object.hasOwn(booking.guest, field), false, `${field} must be omitted`)
  }
  assert.equal(Object.hasOwn(booking, 'sourceEmailEventId'), false)
  for (const field of [
    'checkIn',
    'checkOut',
    'actualCheckIn',
    'actualCheckOut',
    'nights',
    'adults',
    'children',
    'childAges',
    'source',
    'providerCode',
    'channelRef',
    'externalReservationId',
    'roomType',
    'assignedRoomId',
    'assignedRoom',
    'ratePerNightSatang',
    'totalAmountSatang',
    'depositAmountSatang',
    'depositPaid',
    'createdAt',
    'updatedAt',
  ]) {
    assert.equal(Object.hasOwn(booking, field), false, `${field} must be omitted`)
  }
  assert.equal(booking.folio.totalSatang, 200_000)
  assert.equal(booking.folio.paidSatang, 50_000)
  assert.equal(booking.folio.balanceSatang, 150_000)
  assert.equal(booking.folio.paymentState, 'PARTIAL')
  assert.equal(booking.folio.payments[0].amountSatang, 50_000)
  assert.equal(booking.folio.payments[0].reference, '••••9876')
  assert.equal(Object.hasOwn(booking.folio.payments[0], 'notes'), false)
}

test('Cashier booking search avoids guest contact fields and returns only payment-reconciliation context', async () => {
  const row = reservation()
  row.sourceEmailEventId = 'booking-email-sensitive-id'
  row.guest.email = 'private.guest@example.test'
  row.guest.phone = '+66 81 234 5678'
  row.guest.vipStatus = true
  row.guest.blacklisted = true
  let capturedWhere
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: {
      findMany: async ({ where }) => {
        capturedWhere = where
        return [row]
      },
      count: async () => 1,
    },
    bookingEmailEvent: {
      count: async () => { throw new Error('Cashier list must not read booking-email metadata.') },
      findMany: async () => { throw new Error('Cashier list must not read booking-email metadata.') },
    },
  }

  const result = await listLiteBookings(
    prisma,
    { query: 'Privacy Guest', limit: 25 },
    { paymentReconciliationOnly: true },
  )

  const serializedSearch = JSON.stringify(capturedWhere.OR)
  assert.doesNotMatch(serializedSearch, /"email"\s*:/i)
  assert.doesNotMatch(serializedSearch, /"phone"\s*:/i)
  assert.doesNotMatch(serializedSearch, /channelRef|externalReservationId|providerCode|roomType/i)
  assert.equal(Object.hasOwn(result, 'pendingReviewEmail'), false)
  assertCashierPaymentProjection(result.items[0])
})

test('Cashier booking detail skips audit and booking-email metadata while retaining payment context', async () => {
  const row = reservation()
  row.sourceEmailEventId = 'booking-email-sensitive-id'
  row.guest.vipStatus = true
  row.guest.blacklisted = true
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: { findFirst: async () => row },
    reservationLog: {
      count: async () => { throw new Error('Cashier detail must not read the audit timeline.') },
      findMany: async () => { throw new Error('Cashier detail must not read the audit timeline.') },
    },
    user: {
      findMany: async () => { throw new Error('Cashier detail must not resolve audit actors.') },
    },
  }

  const result = await getLiteBookingDetail(prisma, row.id, {
    includeIdentitySuffix: true,
    paymentReconciliationOnly: true,
  })

  assert.equal(Object.hasOwn(result, 'auditTimeline'), false)
  assertCashierPaymentProjection(result.reservation)
})
