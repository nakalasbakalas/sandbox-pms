import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { getLiteBookingDetail } from '../server/lite-service.mjs'

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
    id: 'reservation-1',
    confirmationCode: 'SBX-1001',
    guestId: 'guest-1',
    roomTypeId: 'room-type-1',
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
      id: 'guest-1',
      firstName: 'Guest',
      lastName: 'One',
      nationality: null,
      idType: null,
      idNumber: null,
      vipStatus: false,
      blacklisted: false,
    },
    roomType: {
      id: 'room-type-1',
      code: 'STD',
      name: 'Standard',
      baseRateSatang: 100_000,
      maxOccupancy: 2,
      standardOcc: 2,
    },
    assignedRoom: null,
    folio: null,
  }
}

test('Lite booking detail property-scopes lifecycle audit rows and returns only safe timeline fields', async () => {
  const reservationQueries = []
  const auditQueries = []
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: {
      findFirst: async (query) => {
        reservationQueries.push(query)
        return reservation()
      },
    },
    reservationLog: {
      count: async ({ where }) => {
        auditQueries.push({ kind: 'count', where })
        return 2
      },
      findMany: async (query) => {
        auditQueries.push({ kind: 'findMany', ...query })
        assert.equal(query.select.changes, undefined)
        assert.equal(query.select.notes, undefined)
        return [
          {
            id: 'audit-2',
            performedBy: 'front.desk@sandboxhotel.com',
            action: 'CHECKED_IN',
            createdAt: new Date('2026-07-20T07:00:00.000Z'),
            changes: { paymentCard: '4111111111111111' },
          },
          {
            id: 'audit-1',
            performedBy: 'system',
            action: 'SECRET_GUEST_EMAIL_guest@example.com',
            createdAt: new Date('2026-07-14T01:00:00.000Z'),
            changes: { guestEmail: 'guest@example.com' },
          },
        ]
      },
    },
    user: {
      findMany: async (query) => {
        assert.deepEqual(query.where.OR, [
          { id: 'front.desk@sandboxhotel.com' },
          { email: 'front.desk@sandboxhotel.com' },
          { username: 'front.desk@sandboxhotel.com' },
        ])
        return [{ id: 'user-1', firstName: 'Front', lastName: 'Desk', email: 'front.desk@sandboxhotel.com', username: 'front.desk' }]
      },
    },
  }

  const detail = await getLiteBookingDetail(prisma, 'reservation-1')

  assert.deepEqual(reservationQueries[0].where, { id: 'reservation-1', propertyId: 'property-sandbox' })
  assert.deepEqual(auditQueries[0].where, { reservationId: 'reservation-1' })
  assert.equal(auditQueries[1].take, 100)
  assert.deepEqual(detail.auditTimeline.events, [
    {
      id: 'audit-2',
      action: 'CHECKED_IN',
      label: 'Guest checked in',
      actorLabel: 'Front Desk',
      occurredAt: '2026-07-20T07:00:00.000Z',
      source: 'RESERVATION_LOG',
    },
    {
      id: 'audit-1',
      action: 'OTHER',
      label: 'Reservation activity',
      actorLabel: 'System',
      occurredAt: '2026-07-14T01:00:00.000Z',
      source: 'RESERVATION_LOG',
    },
  ])
  const serializedTimeline = JSON.stringify(detail.auditTimeline)
  assert.doesNotMatch(serializedTimeline, /guest@example\.com|front\.desk@sandboxhotel\.com|4111111111111111|user-1|SECRET_GUEST_EMAIL/)
  assert.equal(Object.hasOwn(detail.auditTimeline.events[0], 'changes'), false)
})

test('Lite booking detail does not read audit rows when the booking is outside the resolved property', async () => {
  let auditRead = false
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'reservation-elsewhere', propertyId: 'property-sandbox' })
        return null
      },
    },
    reservationLog: {
      count: async () => { auditRead = true },
      findMany: async () => { auditRead = true },
    },
    user: { findMany: async () => [] },
  }

  await assert.rejects(
    getLiteBookingDetail(prisma, 'reservation-elsewhere'),
    (error) => error?.statusCode === 404 && /not found in this property/i.test(error.message),
  )
  assert.equal(auditRead, false)
})

test('Lite booking detail route contract stays authenticated GET-only at the request handler boundary', () => {
  assert.deepEqual(resolveApiRouteContract('/api/lite/v1/bookings/reservation-1'), {
    methods: ['GET'],
    allow: 'GET',
  })
})
