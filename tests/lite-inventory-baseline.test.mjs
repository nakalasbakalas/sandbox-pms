import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyLiteInventoryBaseline,
  assertLiteStagingInventoryBoundary,
  LITE_INVENTORY_TRANSACTION_OPTIONS,
  LITE_ROOM_BASELINE,
  liteInventorySummary,
} from '../server/lite-inventory-baseline.mjs'

function stagingEnv(databaseName = 'sandbox_pms_lite_staging') {
  return {
    PMS_DEPLOYMENT_TIER: 'staging',
    PMS_UI_VARIANT: 'lite',
    SEED_MODE: 'prod-safe',
    DATABASE_URL: `postgresql://lite:secret@localhost:5432/${databaseName}`,
  }
}

function createPrismaFixture(initialRooms = []) {
  const rooms = initialRooms.map((room) => ({ ...room }))
  const roomTypes = new Map()
  const calls = { roomCreates: [], roomTypeUpserts: [] }
  const tx = {
    property: {
      findUnique: async () => ({ id: 'property-1', code: 'SANDBOX' }),
    },
    roomType: {
      upsert: async ({ create }) => {
        calls.roomTypeUpserts.push(create)
        const roomType = { id: `room-type-${create.code.toLowerCase()}`, ...create }
        roomTypes.set(create.code, roomType)
        return roomType
      },
    },
    room: {
      findMany: async ({ select }) => rooms.map((room) => {
        const projected = {
          id: room.id,
          number: room.number,
          floor: room.floor,
          roomType: { code: room.roomTypeCode },
        }
        if (!select.id) delete projected.id
        if (!select.floor) delete projected.floor
        return projected
      }),
      create: async ({ data }) => {
        calls.roomCreates.push(data)
        const roomType = [...roomTypes.values()].find(({ id }) => id === data.roomTypeId)
        rooms.push({
          id: `room-${data.number}`,
          number: data.number,
          floor: data.floor,
          roomTypeCode: roomType.code,
          operationalStatus: data.operationalStatus,
          currentStatus: data.currentStatus,
        })
      },
    },
  }
  return {
    prisma: { $transaction: async (callback) => callback(tx) },
    rooms,
    calls,
  }
}

test('Lite inventory definition is exactly 15 DOUBLE and 15 TWIN rooms with unique numbers', () => {
  assert.deepEqual(LITE_INVENTORY_TRANSACTION_OPTIONS, {
    maxWait: 10_000,
    timeout: 60_000,
  })
  const summary = liteInventorySummary()
  assert.deepEqual(summary, {
    rooms: 30,
    roomTypes: 2,
    byRoomType: { TWIN: 15, DOUBLE: 15 },
  })
  assert.equal(new Set(LITE_ROOM_BASELINE.map(({ number }) => number)).size, 30)
  assert.ok(LITE_ROOM_BASELINE.every(({ number, floor }) => Number(number[0]) === floor))
  assert.deepEqual(
    LITE_ROOM_BASELINE.filter(({ roomTypeCode }) => roomTypeCode === 'DOUBLE').map(({ number }) => number),
    ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '301', '302', '303', '304'],
  )
  assert.deepEqual(
    LITE_ROOM_BASELINE.filter(({ roomTypeCode }) => roomTypeCode === 'TWIN').map(({ number }) => number),
    ['212', '213', '214', '215', '216', '217', '218', '219', '312', '313', '314', '315', '316', '317', '318'],
  )
})

test('Lite staging boundary accepts only the disposable Lite staging database', () => {
  assert.doesNotThrow(() => assertLiteStagingInventoryBoundary(stagingEnv()))
  assert.throws(
    () => assertLiteStagingInventoryBoundary(stagingEnv('sandbox_hotel_pms')),
    /database name must be sandbox_pms_lite_staging/,
  )
  assert.throws(
    () => assertLiteStagingInventoryBoundary({ ...stagingEnv(), PMS_DEPLOYMENT_TIER: 'production' }),
    /PMS_DEPLOYMENT_TIER must be staging/,
  )
})

test('applying the baseline creates 30 linked rooms and is idempotent', async () => {
  const fixture = createPrismaFixture()
  const first = await applyLiteInventoryBaseline(fixture.prisma)
  assert.equal(first.createdRooms, 30)
  assert.equal(first.existingRooms, 0)
  assert.deepEqual(first.byRoomType, { TWIN: 15, DOUBLE: 15 })
  assert.equal(fixture.calls.roomCreates.length, 30)
  assert.ok(fixture.calls.roomCreates.every(({ operationalStatus }) => operationalStatus === 'AVAILABLE'))
  assert.ok(fixture.calls.roomCreates.every(({ currentStatus }) => currentStatus === 'VACANT_CLEAN'))

  const second = await applyLiteInventoryBaseline(fixture.prisma)
  assert.equal(second.createdRooms, 0)
  assert.equal(second.existingRooms, 30)
  assert.equal(fixture.calls.roomCreates.length, 30)
})

test('baseline refuses unexpected rooms without deleting or overwriting inventory', async () => {
  const fixture = createPrismaFixture([{
    id: 'room-999',
    number: '999',
    floor: 9,
    roomTypeCode: 'DOUBLE',
    operationalStatus: 'OUT_OF_ORDER',
    currentStatus: 'VACANT_DIRTY',
  }])

  await assert.rejects(
    applyLiteInventoryBaseline(fixture.prisma),
    /outside the 30-room Lite baseline; no rooms were deleted/,
  )
  assert.equal(fixture.calls.roomTypeUpserts.length, 0)
  assert.equal(fixture.calls.roomCreates.length, 0)
  assert.equal(fixture.rooms[0].operationalStatus, 'OUT_OF_ORDER')
  assert.equal(fixture.rooms[0].currentStatus, 'VACANT_DIRTY')
})
