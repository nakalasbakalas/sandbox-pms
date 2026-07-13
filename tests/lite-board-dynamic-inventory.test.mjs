import assert from 'node:assert/strict'
import test from 'node:test'

import { getLiteBoard } from '../server/lite-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

function addDays(dateKey, days) {
  const date = dateFromKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function propertyFixture() {
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

function roomTypeFixture({ id, code, name, baseRateSatang, maxOccupancy, standardOcc }) {
  return {
    id,
    code,
    name,
    baseRateSatang,
    maxOccupancy,
    standardOcc,
    _count: { rooms: 1 },
  }
}

function roomFixture({ id, number, floor, roomType }) {
  return {
    id,
    roomTypeId: roomType.id,
    number,
    floor,
    operationalStatus: 'AVAILABLE',
    currentStatus: 'VACANT_CLEAN',
    blockedUntil: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    roomType,
  }
}

function reservationFixture({ id, confirmationCode, guestName, room, checkIn, checkOut }) {
  const [firstName, lastName] = guestName.split(' ')
  return {
    id,
    confirmationCode,
    guestId: `guest-${id}`,
    roomTypeId: room.roomTypeId,
    assignedRoomId: room.id,
    checkIn: dateFromKey(checkIn),
    checkOut: dateFromKey(checkOut),
    actualCheckIn: null,
    actualCheckOut: null,
    status: 'CONFIRMED',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNightSatang: 180_000,
    totalAmountSatang: 360_000,
    depositAmountSatang: 0,
    depositPaid: false,
    source: 'DIRECT',
    channelRef: null,
    providerCode: null,
    externalReservationId: null,
    sourceEmailEventId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    guest: {
      id: `guest-${id}`,
      firstName,
      lastName,
      nationality: null,
      idType: null,
      idNumber: null,
      vipStatus: false,
      blacklisted: false,
    },
    roomType: room.roomType,
    assignedRoom: {
      id: room.id,
      number: room.number,
      floor: room.floor,
      roomTypeId: room.roomTypeId,
      operationalStatus: room.operationalStatus,
      currentStatus: room.currentStatus,
    },
    folio: null,
  }
}

test('Lite board includes a third room type and preserves non-overlapping segments assigned to the same room', async () => {
  const from = addDays(getBangkokDateKey(new Date()), 30)
  const to = addDays(from, 14)
  const firstStay = { checkIn: addDays(from, 1), checkOut: addDays(from, 3) }
  const secondStay = { checkIn: addDays(from, 6), checkOut: addDays(from, 8) }

  const standard = roomTypeFixture({
    id: 'room-type-standard',
    code: 'STANDARD',
    name: 'Standard Room',
    baseRateSatang: 100_000,
    maxOccupancy: 2,
    standardOcc: 2,
  })
  const twin = roomTypeFixture({
    id: 'room-type-twin',
    code: 'TWIN',
    name: 'Twin Room',
    baseRateSatang: 120_000,
    maxOccupancy: 2,
    standardOcc: 2,
  })
  const family = roomTypeFixture({
    id: 'room-type-family',
    code: 'FAMILY',
    name: 'Family Suite',
    baseRateSatang: 180_000,
    maxOccupancy: 4,
    standardOcc: 3,
  })

  const rooms = [
    roomFixture({ id: 'room-101', number: '101', floor: 1, roomType: standard }),
    roomFixture({ id: 'room-201', number: '201', floor: 2, roomType: twin }),
    roomFixture({ id: 'room-301', number: '301', floor: 3, roomType: family }),
  ]
  const familyRoom = rooms[2]
  const reservations = [
    reservationFixture({
      id: 'reservation-family-first',
      confirmationCode: 'FAMILY-FIRST',
      guestName: 'First Guest',
      room: familyRoom,
      ...firstStay,
    }),
    reservationFixture({
      id: 'reservation-family-second',
      confirmationCode: 'FAMILY-SECOND',
      guestName: 'Second Guest',
      room: familyRoom,
      ...secondStay,
    }),
  ]

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { code: 'SANDBOX' })
        return propertyFixture()
      },
    },
    roomType: {
      findMany: async ({ where, orderBy }) => {
        assert.deepEqual(where, { propertyId: 'property-1' })
        assert.deepEqual(orderBy, [{ name: 'asc' }, { code: 'asc' }])
        return [family, standard, twin]
      },
    },
    room: {
      findMany: async ({ where, orderBy }) => {
        assert.deepEqual(where, { propertyId: 'property-1' })
        assert.deepEqual(orderBy, [{ floor: 'asc' }, { number: 'asc' }])
        return rooms
      },
    },
    reservation: {
      findMany: async ({ where, orderBy }) => {
        assert.equal(where.propertyId, 'property-1')
        assert.deepEqual(where.status, { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD'] })
        assert.equal(where.checkIn.lt.toISOString().slice(0, 10), to)
        assert.equal(where.checkOut.gt.toISOString().slice(0, 10), from)
        assert.deepEqual(orderBy, [{ checkIn: 'asc' }, { checkOut: 'asc' }, { id: 'asc' }])
        return reservations
      },
    },
    bookingEmailEvent: {
      count: async ({ where }) => {
        assert.deepEqual(where, { propertyId: 'property-1', status: 'NEEDS_REVIEW', legacyReadOnly: false })
        return 0
      },
      findMany: async ({ where, take }) => {
        assert.deepEqual(where, { propertyId: 'property-1', status: 'NEEDS_REVIEW', legacyReadOnly: false })
        assert.equal(take, 25)
        return []
      },
    },
  }

  const board = await getLiteBoard(prisma, { from, to })

  assert.deepEqual(board.roomTypes.map(({ code }) => code), ['FAMILY', 'STANDARD', 'TWIN'])
  assert.deepEqual(board.roomTypes[0], {
    id: 'room-type-family',
    code: 'FAMILY',
    name: 'Family Suite',
    baseRateSatang: 180_000,
    maxOccupancy: 4,
    standardOccupancy: 3,
    roomCount: 1,
  })
  assert.equal(board.counts.rooms, 3)
  assert.equal(board.counts.assignedSegments, 2)
  assert.equal(board.counts.unassignedBookings, 0)

  const familySegments = board.reservationSegments.filter(({ assignedRoomId }) => assignedRoomId === familyRoom.id)
  assert.deepEqual(familySegments.map(({ id }) => id), [
    'reservation-family-first',
    'reservation-family-second',
  ])
  assert.deepEqual(
    familySegments.map(({ segmentStart, segmentEnd }) => ({ segmentStart, segmentEnd })),
    [
      { segmentStart: firstStay.checkIn, segmentEnd: firstStay.checkOut },
      { segmentStart: secondStay.checkIn, segmentEnd: secondStay.checkOut },
    ],
  )
  assert.ok(familySegments[0].segmentEnd < familySegments[1].segmentStart)
})
