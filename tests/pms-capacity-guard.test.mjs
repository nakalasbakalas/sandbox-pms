import assert from 'node:assert/strict'
import test from 'node:test'

import { checkInReservation, createReservation, updateRoomType } from '../server/pms-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

const actor = { id: 'capacity-test-manager', name: 'Capacity Test Manager', role: 'MANAGER' }
const reservationInput = {
  checkIn: '2030-08-31',
  checkOut: '2030-09-02',
  roomTypeCode: 'TWIN',
  adults: 1,
  children: 0,
  childAges: [],
  ratePerNightSatang: 100_000,
  source: 'DIRECT',
  guest: { firstName: 'Capacity', lastName: 'Guard' },
}

function capacityPrisma({ holdsForDate = () => [], blocksForDate = () => [] } = {}) {
  const transactionOptions = []
  const queriedDates = []
  const tx = {
    property: {
      findUnique: async () => ({
        id: 'property-capacity',
        code: 'SANDBOX',
        currency: 'THB',
        extraGuestFee: 300,
        childFee: 300,
      }),
    },
    roomType: {
      findFirst: async () => ({
        id: 'room-type-capacity',
        propertyId: 'property-capacity',
        code: 'TWIN',
        name: 'Twin Room',
        standardOcc: 2,
        maxOccupancy: 2,
      }),
    },
    room: {
      count: async () => 1,
    },
    reservation: {
      count: async () => 0,
    },
    inventoryHold: {
      findMany: async ({ where }) => holdsForDate(getBangkokDateKey(where.checkOut.gt)),
    },
    roomDateInventory: {
      findMany: async ({ where, distinct }) => {
        const dateKey = getBangkokDateKey(where.date)
        queriedDates.push(dateKey)
        assert.deepEqual(where.status.in, ['BLOCKED', 'OUT_OF_SERVICE'])
        assert.equal(where.room.roomTypeId, 'room-type-capacity')
        assert.equal(where.room.operationalStatus, 'AVAILABLE')
        assert.deepEqual(distinct, ['roomId'])
        return blocksForDate(dateKey)
      },
    },
  }
  return {
    queriedDates,
    transactionOptions,
    prisma: {
      async $transaction(callback, options) {
        transactionOptions.push(options)
        return callback(tx)
      },
    },
  }
}

test('reservation admission subtracts active holds before accepting room-type capacity', async () => {
  const fixture = capacityPrisma({
    holdsForDate: (dateKey) => dateKey === '2030-08-31' ? [{ id: 'hold-1' }] : [],
  })

  await assert.rejects(
    createReservation(fixture.prisma, reservationInput, actor),
    /No room is available for 2030-08-31/,
  )
  assert.equal(fixture.transactionOptions[0]?.isolationLevel, 'Serializable')
})

test('reservation admission checks date-level blocks across a month boundary', async () => {
  const fixture = capacityPrisma({
    blocksForDate: (dateKey) => dateKey === '2030-09-01'
      ? [{ roomId: 'room-101' }, { roomId: 'room-101' }]
      : [],
  })

  await assert.rejects(
    createReservation(fixture.prisma, reservationInput, actor),
    /No room is available for 2030-09-01/,
  )
  assert.deepEqual(fixture.queriedDates, ['2030-08-31', '2030-09-01'])
})

test('room-type occupancy cannot be reduced below an active reservation', async () => {
  let roomTypeUpdates = 0
  const roomType = {
    id: 'room-type-capacity',
    propertyId: 'property-capacity',
    code: 'TWIN',
    name: 'Twin Room',
    description: null,
    baseRate: 1_000,
    baseRateSatang: 100_000,
    standardOcc: 2,
    maxOccupancy: 4,
  }
  const tx = {
    property: { findUnique: async () => ({ id: 'property-capacity', code: 'SANDBOX' }) },
    roomType: {
      findFirst: async () => roomType,
      update: async () => {
        roomTypeUpdates += 1
        return roomType
      },
    },
    reservation: {
      findMany: async () => [{ id: 'reservation-three-guests', adults: 2, children: 1 }],
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    updateRoomType(prisma, roomType.id, {
      code: 'TWIN',
      name: 'Twin Room',
      baseRate: 1_000,
      baseOccupancy: 2,
      maxOccupancy: 2,
    }, actor),
    (error) => error?.statusCode === 409 && /active reservation exceeds/i.test(error.message),
  )
  assert.equal(roomTypeUpdates, 0)
})

test('check-in revalidates the reservation against the current dynamic room-type limit', async () => {
  const todayKey = getBangkokDateKey(new Date())
  const tomorrow = dateFromKey(todayKey)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  let roomUpdates = 0
  const reservation = {
    id: 'reservation-current-room-limit',
    status: 'CONFIRMED',
    assignedRoomId: 'room-current-limit',
    checkIn: dateFromKey(todayKey),
    checkOut: tomorrow,
    adults: 2,
    children: 1,
    roomType: { id: 'room-type-capacity', maxOccupancy: 2 },
  }
  const tx = {
    reservation: { findUnique: async () => reservation },
    room: {
      updateMany: async () => {
        roomUpdates += 1
        return { count: 1 }
      },
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    checkInReservation(prisma, reservation.id, actor),
    /Maximum occupancy is 2 guests per room/,
  )
  assert.equal(roomUpdates, 0)
})
