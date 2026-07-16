import assert from 'node:assert/strict'
import test from 'node:test'

import { assignRoom, checkInReservation, createWalkInCheckIn } from '../server/pms-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

const actor = { id: 'room-integrity-manager', name: 'Room Integrity Manager', role: 'MANAGER' }

function futureAssignmentFixture({ overlappingReservation = null } = {}) {
  const reservation = {
    id: 'reservation-future',
    propertyId: 'property-room-integrity',
    roomTypeId: 'room-type-double',
    assignedRoomId: null,
    checkIn: dateFromKey('2030-09-10'),
    checkOut: dateFromKey('2030-09-12'),
    status: 'CONFIRMED',
    updatedAt: new Date('2030-08-01T00:00:00.000Z'),
  }
  const room = {
    id: 'room-201',
    propertyId: 'property-room-integrity',
    roomTypeId: 'room-type-double',
    number: '201',
    operationalStatus: 'AVAILABLE',
    currentStatus: 'OCCUPIED_CLEAN',
    currentReservation: 'reservation-current-occupant',
    roomType: { id: 'room-type-double', code: 'DOUBLE', name: 'Double Room' },
  }
  const reservedDates = []
  const tx = {
    property: {
      findUnique: async () => ({ id: 'property-room-integrity', code: 'SANDBOX' }),
    },
    room: {
      findUnique: async () => room,
    },
    reservation: {
      findUnique: async () => reservation,
      findFirst: async () => overlappingReservation,
      update: async ({ data }) => ({ ...reservation, ...data, assignedRoom: room }),
    },
    roomDateInventory: {
      findFirst: async () => null,
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ where }) => {
        reservedDates.push(getBangkokDateKey(where.roomId_date.date))
        return {}
      },
    },
    reservationLog: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  }
  return {
    reservation,
    reservedDates,
    prisma: { async $transaction(callback) { return callback(tx) } },
  }
}

test('future reservation can be assigned to a currently occupied room when stay dates do not overlap', async () => {
  const fixture = futureAssignmentFixture()

  const assigned = await assignRoom(fixture.prisma, fixture.reservation.id, 'room-201', actor)

  assert.equal(assigned.assignedRoomId, 'room-201')
  assert.deepEqual(fixture.reservedDates, ['2030-09-10', '2030-09-11'])
})

test('future room assignment still rejects an overlapping active reservation', async () => {
  const fixture = futureAssignmentFixture({ overlappingReservation: { id: 'reservation-overlap' } })

  await assert.rejects(
    assignRoom(fixture.prisma, fixture.reservation.id, 'room-201', actor),
    /already has a reservation for the selected dates/i,
  )
  assert.deepEqual(fixture.reservedDates, [])
})

test('actual check-in still rejects an occupied assigned room even without a date overlap row', async () => {
  const hotelDate = getBangkokDateKey(new Date())
  const checkOut = dateFromKey(hotelDate)
  checkOut.setUTCDate(checkOut.getUTCDate() + 1)
  const reservation = {
    id: 'reservation-arriving',
    propertyId: 'property-room-integrity',
    roomTypeId: 'room-type-double',
    assignedRoomId: 'room-201',
    checkIn: dateFromKey(hotelDate),
    checkOut,
    status: 'CONFIRMED',
    adults: 1,
    children: 0,
    guest: { nationality: 'TH', idNumber: 'TEST-ID' },
    roomType: { id: 'room-type-double', maxOccupancy: 2 },
    folio: { id: 'folio-arriving', balanceSatang: 0 },
  }
  let overlapQueryCalled = false
  const tx = {
    reservation: {
      findUnique: async () => reservation,
      findFirst: async () => {
        overlapQueryCalled = true
        return null
      },
    },
    room: {
      findUnique: async () => ({
        id: 'room-201',
        roomTypeId: 'room-type-double',
        number: '201',
        operationalStatus: 'AVAILABLE',
        currentStatus: 'OCCUPIED_CLEAN',
        currentReservation: 'reservation-current-occupant',
        roomType: { id: 'room-type-double', code: 'DOUBLE', name: 'Double Room' },
      }),
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    checkInReservation(prisma, reservation.id, actor),
    /occupied and cannot be assigned/i,
  )
  assert.equal(overlapQueryCalled, false, 'current occupancy is rejected before stay-date conflict checks')
})

test('atomic walk-in check-in still rejects an explicitly selected occupied room before room or folio mutation', async () => {
  const hotelDate = getBangkokDateKey(new Date())
  const checkOut = dateFromKey(hotelDate)
  checkOut.setUTCDate(checkOut.getUTCDate() + 1)
  let inventoryWrites = 0
  let folioWrites = 0
  const occupiedRoom = {
    id: 'room-201',
    roomTypeId: 'room-type-double',
    number: '201',
    operationalStatus: 'AVAILABLE',
    currentStatus: 'OCCUPIED_CLEAN',
    currentReservation: 'reservation-current-occupant',
    roomType: { id: 'room-type-double', code: 'DOUBLE', name: 'Double Room' },
  }
  const tx = {
    property: {
      findUnique: async () => ({
        id: 'property-room-integrity',
        code: 'SANDBOX',
        extraGuestFeeSatang: 0,
        childFeeSatang: 0,
      }),
    },
    roomType: {
      findFirst: async () => ({
        id: 'room-type-double',
        code: 'DOUBLE',
        name: 'Double Room',
        standardOcc: 2,
        maxOccupancy: 2,
      }),
    },
    room: {
      count: async () => 1,
      findUnique: async () => occupiedRoom,
    },
    guest: { create: async ({ data }) => ({ id: 'guest-walk-in', ...data }) },
    reservation: {
      count: async () => 0,
      create: async ({ data }) => ({ id: 'reservation-walk-in', ...data }),
      findFirst: async () => null,
    },
    inventoryHold: { findMany: async () => [] },
    roomDateInventory: {
      findMany: async () => [],
      findFirst: async () => null,
      deleteMany: async () => {
        inventoryWrites += 1
        return { count: 0 }
      },
      upsert: async () => {
        inventoryWrites += 1
        return {}
      },
    },
    folio: {
      create: async () => {
        folioWrites += 1
        return { id: 'folio-walk-in' }
      },
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    createWalkInCheckIn(prisma, {
      checkIn: hotelDate,
      checkOut: getBangkokDateKey(checkOut),
      roomTypeCode: 'DOUBLE',
      assignedRoomId: occupiedRoom.id,
      adults: 1,
      children: 0,
      childAges: [],
      ratePerNightSatang: 100_000,
      guest: {
        firstName: 'Walk',
        lastName: 'In',
        nationality: 'TH',
        idNumber: 'TEST-ID',
      },
    }, actor),
    /occupied and cannot be assigned/i,
  )
  assert.equal(inventoryWrites, 0)
  assert.equal(folioWrites, 0)
})
