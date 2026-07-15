import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PmsValidationError,
  assertHousekeepingTransition,
  checkedInRoomStatus,
  roomStatusForHousekeeping,
} from '../server/pms-domain.mjs'
import { updateHousekeepingStatus } from '../server/pms-service.mjs'

const actor = {
  id: 'housekeeping-transition-actor',
  name: 'Housekeeping Tester',
  role: 'HOUSEKEEPING',
}

function createFixture(currentStatus = 'VACANT_DIRTY', currentReservation = null, { failCas = false } = {}) {
  const roomType = {
    id: 'room-type-housekeeping',
    name: 'Housekeeping Test Room',
  }
  let room = {
    id: 'room-housekeeping',
    propertyId: 'property-housekeeping',
    roomTypeId: roomType.id,
    number: '101',
    floor: 1,
    operationalStatus: 'AVAILABLE',
    currentStatus,
    currentReservation,
    notes: null,
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    roomType,
  }
  const statusLogs = []
  const audits = []

  const tx = {
    room: {
      findUnique: async () => ({ ...room, roomType }),
      updateMany: async ({ where, data }) => {
        if (
          failCas
          || where.id !== room.id
          || where.updatedAt?.toISOString() !== room.updatedAt.toISOString()
          || where.currentStatus !== room.currentStatus
          || where.currentReservation !== room.currentReservation
          || where.operationalStatus !== room.operationalStatus
        ) {
          return { count: 0 }
        }
        room = { ...room, ...data, updatedAt: new Date(room.updatedAt.getTime() + 1_000) }
        return { count: 1 }
      },
    },
    roomStatusLog: {
      create: async ({ data }) => {
        statusLogs.push(data)
        return data
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
  }

  return {
    prisma: {
      $transaction: async (callback) => callback(tx),
    },
    currentRoom: () => room,
    statusLogs,
    audits,
  }
}

test('backend housekeeping updates enforce dirty -> cleaning -> clean -> inspected', async () => {
  const fixture = createFixture()

  await updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'CLEANING', actor)
  assert.equal(fixture.currentRoom().currentStatus, 'CLEANING')

  await updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'CLEAN', actor)
  assert.equal(fixture.currentRoom().currentStatus, 'VACANT_CLEAN')

  await updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'INSPECTED', actor)
  assert.equal(fixture.currentRoom().currentStatus, 'INSPECTED')
  assert.deepEqual(
    fixture.statusLogs.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus })),
    [
      { fromStatus: 'VACANT_DIRTY', toStatus: 'CLEANING' },
      { fromStatus: 'CLEANING', toStatus: 'VACANT_CLEAN' },
      { fromStatus: 'VACANT_CLEAN', toStatus: 'INSPECTED' },
    ],
  )
  assert.equal(fixture.audits.length, 3)
})

for (const [currentStatus, requestedStatus] of [
  ['VACANT_DIRTY', 'CLEAN'],
  ['CLEANING', 'INSPECTED'],
  ['VACANT_CLEAN', 'CLEANING'],
]) {
  test(`backend housekeeping updates reject ${currentStatus} -> ${requestedStatus}`, async () => {
    const fixture = createFixture(currentStatus)

    await assert.rejects(
      updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', requestedStatus, actor),
      (error) => {
        assert.ok(error instanceof PmsValidationError)
        assert.equal(error.statusCode, 409)
        assert.match(error.message, /DIRTY -> CLEANING -> CLEAN -> INSPECTED/)
        return true
      },
    )
    assert.equal(fixture.currentRoom().currentStatus, currentStatus)
    assert.equal(fixture.statusLogs.length, 0)
    assert.equal(fixture.audits.length, 0)
  })
}

test('dirty reset, maintenance, and idempotent updates remain valid housekeeping actions', () => {
  assert.doesNotThrow(() => assertHousekeepingTransition('INSPECTED', 'DIRTY'))
  assert.doesNotThrow(() => assertHousekeepingTransition('VACANT_CLEAN', 'MAINTENANCE'))
  assert.doesNotThrow(() => assertHousekeepingTransition('CLEANING', 'CLEANING'))
})

test('occupied cleaning preserves occupancy and blocks inspection or maintenance', async () => {
  const fixture = createFixture('OCCUPIED_DIRTY', 'reservation-checked-in')

  await updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'CLEANING', actor)
  assert.equal(fixture.currentRoom().currentStatus, 'CLEANING')
  assert.equal(fixture.currentRoom().currentReservation, 'reservation-checked-in')

  await updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'CLEAN', actor)
  assert.equal(fixture.currentRoom().currentStatus, 'OCCUPIED_CLEAN')
  assert.equal(fixture.currentRoom().currentReservation, 'reservation-checked-in')

  for (const requestedStatus of ['INSPECTED', 'MAINTENANCE']) {
    await assert.rejects(
      updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', requestedStatus, actor),
      (error) => error?.statusCode === 409 && /occupied room/i.test(error.message),
    )
  }
  assert.equal(fixture.currentRoom().currentStatus, 'OCCUPIED_CLEAN')
  assert.equal(fixture.currentRoom().operationalStatus, 'AVAILABLE')
})

test('maintenance requires an operational reason before any room mutation', async () => {
  const fixture = createFixture('VACANT_CLEAN')

  await assert.rejects(
    updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'MAINTENANCE', actor),
    (error) => error?.statusCode === 400 && /operational reason/i.test(error.message),
  )
  assert.equal(fixture.currentRoom().currentStatus, 'VACANT_CLEAN')
  assert.equal(fixture.currentRoom().operationalStatus, 'AVAILABLE')
  assert.equal(fixture.statusLogs.length, 0)
  assert.equal(fixture.audits.length, 0)
})

test('housekeeping rejects a stale room snapshot instead of overwriting a concurrent check-in', async () => {
  const fixture = createFixture('VACANT_CLEAN', null, { failCas: true })

  await assert.rejects(
    updateHousekeepingStatus(fixture.prisma, 'room-housekeeping', 'INSPECTED', actor),
    (error) => error?.statusCode === 409 && /changed state before housekeeping/i.test(error.message),
  )
  assert.equal(fixture.currentRoom().currentStatus, 'VACANT_CLEAN')
  assert.equal(fixture.currentRoom().currentReservation, null)
  assert.equal(fixture.statusLogs.length, 0)
  assert.equal(fixture.audits.length, 0)
})

test('non-housekeeping occupancy mappings retain their existing behavior', () => {
  assert.equal(checkedInRoomStatus('VACANT_DIRTY'), 'OCCUPIED_DIRTY')
  assert.equal(checkedInRoomStatus('INSPECTED'), 'OCCUPIED_CLEAN')
  assert.equal(roomStatusForHousekeeping('OCCUPIED_CLEAN', 'DIRTY'), 'OCCUPIED_DIRTY')
})
