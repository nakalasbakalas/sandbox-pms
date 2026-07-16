import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
/* global URL */
import test from 'node:test'

import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { getWalkInQuote } from '../server/pms-service.mjs'

function quotePrisma() {
  let readyRoomWhere
  return {
    property: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { code: 'SANDBOX' })
        return {
          id: 'property-sandbox',
          code: 'SANDBOX',
          name: 'SANDBOX HOTEL',
          currency: 'THB',
          extraGuestFee: 300,
          extraGuestFeeSatang: 30_000,
          childFee: 300,
          childFeeSatang: 30_000,
        }
      },
    },
    roomType: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { propertyId: 'property-sandbox', code: 'DOUBLE' })
        return {
          id: 'room-type-double',
          code: 'DOUBLE',
          name: 'Standard Double',
          baseRate: 1_500,
          baseRateSatang: 150_000,
          standardOcc: 2,
          maxOccupancy: 3,
        }
      },
    },
    room: {
      count: async ({ where }) => {
        assert.deepEqual(where, {
          propertyId: 'property-sandbox',
          roomTypeId: 'room-type-double',
          operationalStatus: 'AVAILABLE',
        })
        return 15
      },
      findMany: async ({ where, select, orderBy }) => {
        readyRoomWhere = where
        assert.deepEqual(select, { id: true, number: true, floor: true, currentStatus: true })
        assert.deepEqual(orderBy, [{ floor: 'asc' }, { number: 'asc' }])
        return [
          { id: 'room-101', number: '101', floor: 1, currentStatus: 'INSPECTED' },
          { id: 'room-102', number: '102', floor: 1, currentStatus: 'VACANT_CLEAN' },
        ]
      },
    },
    reservation: {
      count: async ({ where }) => {
        assert.equal(where.propertyId, 'property-sandbox')
        assert.equal(where.roomTypeId, 'room-type-double')
        return 0
      },
    },
    inventoryHold: { findMany: async () => [] },
    roomDateInventory: { findMany: async () => [] },
    get readyRoomWhere() { return readyRoomWhere },
  }
}

test('walk-in quote is side-effect-free, server-priced, and returns only assignable clean rooms', async () => {
  const prisma = quotePrisma()
  const quote = await getWalkInQuote(prisma, {
    checkIn: '2026-07-16',
    checkOut: '2026-07-18',
    roomTypeCode: 'DOUBLE',
    adults: '2',
    children: '1',
    childAges: '8',
  }, { now: '2026-07-16T10:00:00+07:00' })

  assert.equal(quote.hotelDate, '2026-07-16')
  assert.deepEqual(quote.pricing, {
    nights: 2,
    ratePerNightSatang: 150_000,
    roomSubtotalSatang: 300_000,
    extraGuestFeeSatang: 0,
    childFeeSatang: 60_000,
    totalSatang: 360_000,
    depositAmountSatang: 108_000,
  })
  assert.equal(quote.paymentPolicy.amountDueSatang, 360_000)
  assert.equal(quote.paymentPolicy.fullPaymentRequired, true)
  assert.equal(quote.paymentPolicy.payLaterRequiresManager, true)
  assert.deepEqual(quote.readyRooms.map((room) => room.number), ['101', '102'])
  assert.deepEqual(prisma.readyRoomWhere.currentStatus, { in: ['VACANT_CLEAN', 'INSPECTED'] })
  assert.deepEqual(prisma.readyRoomWhere.operationalStatus, 'AVAILABLE')
  assert.deepEqual(prisma.readyRoomWhere.assignedReservations.none.status, {
    in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD'],
  })
  assert.deepEqual(prisma.readyRoomWhere.inventory.none.status, {
    in: ['RESERVED', 'HELD', 'BLOCKED', 'OUT_OF_SERVICE'],
  })
})

test('walk-in quote rejects a non-today check-in date before offering a room', async () => {
  const prisma = quotePrisma()
  await assert.rejects(
    () => getWalkInQuote(prisma, {
      checkIn: '2026-07-17',
      checkOut: '2026-07-18',
      roomTypeCode: 'DOUBLE',
      adults: 1,
      children: 0,
      childAges: '',
    }, { now: '2026-07-16T10:00:00+07:00' }),
    /today's hotel date/i,
  )
})

test('Lite publishes the read-only walk-in quote API contract', () => {
  assert.deepEqual(resolveApiRouteContract('/api/lite/v1/walk-in-quote'), {
    methods: ['GET'],
    allow: 'GET',
  })
})

test('Lite walk-in UI uses the atomic workflow and folio print stays React-escaped and non-tax', async () => {
  const [walkInSource, bookingsSource, frontDeskSource, folioSource] = await Promise.all([
    readFile(new URL('../src-lite/walk-in-check-in-form.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src-lite/views/BookingsView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src-lite/views/FrontDeskView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src-lite/guest-folio-document.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(walkInSource, /liteApi\.createWalkIn\(/)
  assert.doesNotMatch(walkInSource, /liteApi\.createReservation\(/)
  assert.match(bookingsSource, /<WalkInCheckInForm/)
  assert.match(frontDeskSource, /<WalkInCheckInForm/)
  assert.match(folioSource, /not a tax invoice/i)
  assert.match(folioSource, /reservation\.confirmationCode/)
  assert.match(folioSource, /folio\.id/)
  assert.doesNotMatch(folioSource, /dangerouslySetInnerHTML|innerHTML|document\.write/)
})
