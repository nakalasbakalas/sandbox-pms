import assert from 'node:assert/strict'
import test from 'node:test'

import { getLiteChannelDesk, getLiteHousekeeping } from '../server/lite-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

function property() {
  return {
    id: 'property-1',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    timezone: 'Asia/Bangkok',
    currency: 'THB',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
  }
}

function tomorrow() {
  const date = dateFromKey(getBangkokDateKey(new Date()))
  date.setUTCDate(date.getUTCDate() + 1)
  return date
}

test('Channel Desk is read-only while showing disabled provider fallbacks and exact totals beyond returned limits', async () => {
  let connectionWriteCalled = false
  const eventWhere = []
  const taskDate = tomorrow()
  const prisma = {
    property: { findUnique: async () => property() },
    reservation: {},
    bookingEmailSource: { findFirst: async () => null },
    bookingEmailEvent: {
      findMany: async ({ where }) => {
        eventWhere.push(where)
        return [{
          id: 'event-1',
          eventType: 'NEW_BOOKING',
          status: 'NEEDS_REVIEW',
          providerCode: 'booking_com',
          reservationId: null,
          channelRef: null,
          receivedAt: new Date(),
          reviewReason: null,
          errorReason: null,
          guestName: 'Hidden from other DTOs',
          checkIn: taskDate,
          checkOut: taskDate,
          roomType: 'Twin',
          amountSatang: 10000,
          currency: null,
          confidence: 0.9,
          parsedDetails: { adults: 2, children: 1, childAges: [] },
        }]
      },
      groupBy: async () => [
        { status: 'NEEDS_REVIEW', _count: { _all: 420 } },
        { status: 'ERROR', _count: { _all: 30 } },
      ],
    },
    manualChannelConnection: {
      findMany: async () => [],
      upsert: async () => {
        connectionWriteCalled = true
        throw new Error('Channel Desk GET must not write provider rows')
      },
    },
    roomType: {
      findMany: async () => [{
        id: 'room-type-twin',
        code: 'TWIN',
        name: 'Twin Room',
        _count: { rooms: 5 },
      }],
    },
    manualChannelTask: {
      findMany: async () => [{
        id: 'task-1',
        connectionId: 'connection-booking',
        connection: {
          id: 'connection-booking',
          providerCode: 'booking_com',
          displayName: 'Booking.com',
          deliveryMode: 'MANUAL',
          enabled: true,
          extranetUrl: null,
        },
        roomTypeId: 'room-type-twin',
        roomType: { id: 'room-type-twin', name: 'Twin Room' },
        stayDate: taskDate,
        desiredAvailability: 4,
        confirmedAvailability: null,
        targetExternalRoomTypeId: 'booking-twin',
        targetExternalRoomTypeName: 'Twin Room',
        targetExternalRatePlanId: 'flex',
        status: 'PENDING',
        revision: 1,
        completedAt: null,
        completedBy: null,
        completionNotes: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }],
      groupBy: async () => [
        { status: 'PENDING', _count: { _all: 600 } },
        { status: 'IN_PROGRESS', _count: { _all: 20 } },
        { status: 'FAILED', _count: { _all: 8 } },
      ],
    },
    bookingEmailPushDelivery: { count: async () => 0 },
  }

  const desk = await getLiteChannelDesk(prisma)

  assert.equal(connectionWriteCalled, false)
  assert.deepEqual(desk.connections.map((connection) => connection.providerCode), ['booking_com', 'agoda', 'trip_com'])
  assert.equal(desk.connections.every((connection) => connection.enabled === false), true)
  assert.equal(desk.connections.every((connection) => connection.configured === false), true)
  assert.equal(desk.connections.every((connection) => connection.deliveryMode === 'MANUAL'), true)
  assert.equal(eventWhere[0].legacyReadOnly, false)
  assert.match(JSON.stringify(eventWhere[0]), /PAYMENT_NOTICE/, 'Channel Desk query includes actionable payment notices')
  assert.equal(desk.reviewEvents[0].currency, null, 'Channel Desk does not invent property currency for unverified email money')
  assert.deepEqual(desk.roomTypes, [{
    id: 'room-type-twin',
    code: 'TWIN',
    name: 'Twin Room',
    physicalRoomCount: 5,
  }])
  assert.deepEqual(desk.pagination.reviewEvents, {
    limit: 100,
    returned: 1,
    total: 450,
    truncated: true,
  })
  assert.deepEqual(desk.pagination.tasks, {
    limit: 250,
    returned: 1,
    total: 628,
    truncated: true,
  })
  assert.equal(desk.counts.reviewEvents, 420)
  assert.equal(desk.counts.parserErrors, 30)
  assert.equal(desk.reviewEvents[0].adults, 2)
  assert.equal(desk.reviewEvents[0].children, 1)
  assert.deepEqual(desk.reviewEvents[0].childAges, [])
  assert.equal(desk.counts.pendingTasks, 600)
  assert.equal(desk.counts.inProgressTasks, 20)
  assert.equal(desk.counts.failedTasks, 8)
})

test('Housekeeping DTO contains operational occupancy context without guest, rate, or email-review data', async () => {
  const hotelDate = getBangkokDateKey(new Date())
  const checkIn = dateFromKey(hotelDate)
  const checkOut = new Date(checkIn)
  checkOut.setUTCDate(checkOut.getUTCDate() + 1)
  let bookingEmailRead = false
  const prisma = {
    property: { findUnique: async () => property() },
    room: {
      findMany: async ({ select }) => {
        assert.equal(select.roomType.select.baseRateSatang, undefined)
        return [{
          id: 'room-101',
          roomTypeId: 'room-type-twin',
          number: '101',
          floor: 1,
          operationalStatus: 'AVAILABLE',
          currentStatus: 'VACANT_DIRTY',
          blockedUntil: null,
          updatedAt: new Date(),
          roomType: { id: 'room-type-twin', code: 'TWIN', name: 'Twin Room' },
        }]
      },
    },
    reservation: {
      findMany: async ({ select }) => {
        assert.equal(select.guest, undefined)
        return [{
          id: 'reservation-1',
          assignedRoomId: 'room-101',
          checkIn,
          checkOut,
          status: 'CONFIRMED',
          guest: { firstName: 'Must', lastName: 'Not Leak' },
        }]
      },
    },
    bookingEmailEvent: {
      count: async () => { bookingEmailRead = true },
      findMany: async () => { bookingEmailRead = true },
    },
  }

  const housekeeping = await getLiteHousekeeping(prisma, { date: hotelDate })

  assert.equal(bookingEmailRead, false)
  assert.equal(Object.hasOwn(housekeeping, 'pendingReviewEmail'), false)
  assert.equal(Object.hasOwn(housekeeping.rooms[0].roomType, 'baseRateSatang'), false)
  assert.equal(Object.hasOwn(housekeeping.rooms[0].arrivals[0], 'guest'), false)
  assert.deepEqual(
    Object.keys(housekeeping.rooms[0].arrivals[0]).sort(),
    ['assignedRoomId', 'checkIn', 'checkOut', 'id', 'status'],
  )
})

test('Housekeeping classifies a checked-out dirty room as same-day turnover without exposing guest data', async () => {
  const hotelDate = '2030-09-01'
  const checkIn = dateFromKey('2030-08-30')
  const checkOut = dateFromKey(hotelDate)
  let reservationWhere
  const prisma = {
    property: { findUnique: async () => property() },
    room: {
      findMany: async () => [{
        id: 'room-102',
        roomTypeId: 'room-type-double',
        number: '102',
        floor: 1,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'VACANT_DIRTY',
        blockedUntil: null,
        updatedAt: new Date('2030-09-01T05:00:00.000Z'),
        roomType: { id: 'room-type-double', code: 'DOUBLE', name: 'Double Room' },
      }],
    },
    reservation: {
      findMany: async ({ where, select }) => {
        reservationWhere = where
        assert.equal(select.guest, undefined)
        return [{
          id: 'reservation-departed',
          assignedRoomId: 'room-102',
          checkIn,
          checkOut,
          status: 'CHECKED_OUT',
          guest: { firstName: 'Must', lastName: 'Remain Private' },
        }]
      },
    },
  }

  const housekeeping = await getLiteHousekeeping(prisma, { date: hotelDate })

  assert.equal(reservationWhere.status.in.includes('CHECKED_OUT'), true)
  assert.equal(housekeeping.summary.turnover, 1)
  assert.equal(housekeeping.rooms[0].priority, 'TURNOVER')
  assert.equal(housekeeping.rooms[0].departures.length, 1)
  assert.equal(housekeeping.rooms[0].inHouse.length, 0)
  assert.deepEqual(
    Object.keys(housekeeping.rooms[0].departures[0]).sort(),
    ['assignedRoomId', 'checkIn', 'checkOut', 'id', 'status'],
  )
})
