import assert from 'node:assert/strict'
import test from 'node:test'

import { getLiteChannelDesk } from '../server/lite-service.mjs'
import {
  reconcileManualChannelTasksInTransaction,
  saveManualChannelConnection,
  saveManualChannelRoomMapping,
} from '../server/manual-channel-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

const manager = {
  id: 'manager-mapping-test',
  username: 'manager.mapping',
  name: 'Mapping Manager',
  role: 'MANAGER',
}

function tomorrowKey() {
  const date = dateFromKey(getBangkokDateKey(new Date()))
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

test('active mapping rejects an OTA room and rate-plan target already used by another PMS room type', async () => {
  let transactionOptions
  let upsertCalled = false
  const prisma = {
    manualChannelConnection: {
      findUnique: async () => ({
        id: 'connection-booking',
        propertyId: 'property-1',
        providerCode: 'booking_com',
        enabled: false,
      }),
    },
    roomType: {
      findFirst: async () => ({ id: 'room-type-double', name: 'Double Room' }),
    },
    manualChannelRoomMapping: {
      findFirst: async ({ where }) => {
        assert.equal(where.connectionId, 'connection-booking')
        assert.equal(where.externalRoomTypeId, 'booking-standard')
        assert.equal(where.externalRatePlanId, 'refundable')
        assert.deepEqual(where.roomTypeId, { not: 'room-type-double' })
        return { id: 'mapping-existing', roomTypeId: 'room-type-twin' }
      },
      upsert: async () => {
        upsertCalled = true
        throw new Error('mapping upsert must not run after a target conflict')
      },
    },
    $transaction: async (callback, options) => {
      transactionOptions = options
      return callback(prisma)
    },
  }

  await assert.rejects(
    () => saveManualChannelRoomMapping(prisma, {
      connectionId: 'connection-booking',
      roomTypeId: 'room-type-double',
      externalRoomTypeId: 'booking-standard',
      externalRoomTypeName: 'Standard Room',
      externalRatePlanId: 'refundable',
      active: true,
      reason: 'Verified the mapping in the Booking.com Extranet.',
    }, manager),
    (error) => error?.statusCode === 409 && /already mapped to another PMS room type/i.test(error.message),
  )
  assert.equal(upsertCalled, false)
  assert.equal(transactionOptions.isolationLevel, 'Serializable')
})

test('database uniqueness races are returned as a mapping conflict instead of a raw Prisma error', async () => {
  const uniqueRace = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  const prisma = {
    manualChannelConnection: {
      findUnique: async () => ({
        id: 'connection-trip',
        propertyId: 'property-1',
        providerCode: 'trip_com',
        enabled: false,
      }),
    },
    roomType: {
      findFirst: async () => ({ id: 'room-type-double', name: 'Double Room' }),
    },
    manualChannelRoomMapping: {
      findFirst: async () => null,
      upsert: async () => { throw uniqueRace },
    },
    $transaction: async (callback) => callback(prisma),
  }

  await assert.rejects(
    () => saveManualChannelRoomMapping(prisma, {
      connectionId: 'connection-trip',
      roomTypeId: 'room-type-double',
      externalRoomTypeId: 'trip-standard',
      externalRoomTypeName: 'Standard Room',
      externalRatePlanId: null,
      active: true,
      reason: 'Verified the Trip.com mapping target.',
    }, manager),
    (error) => error?.statusCode === 409
      && /already mapped to another PMS room type/i.test(error.message)
      && error !== uniqueRace,
  )
})

test('connection enabling requires an active mapping for every room type that owns a physical room', async () => {
  let physicalScopeWhere
  let upsertCalled = false
  const prisma = {
    property: {
      findUnique: async () => ({ id: 'property-1' }),
    },
    manualChannelConnection: {
      findUnique: async () => ({ id: 'connection-agoda' }),
      upsert: async () => {
        upsertCalled = true
        throw new Error('connection must not be enabled with incomplete mapping coverage')
      },
    },
    roomType: {
      findMany: async ({ where }) => {
        physicalScopeWhere = where
        return [
          { id: 'room-type-twin', code: 'TWIN', name: 'Twin Room' },
          { id: 'room-type-double', code: 'DOUBLE', name: 'Double Room' },
        ]
      },
    },
    manualChannelRoomMapping: {
      findMany: async () => [{
        id: 'mapping-agoda-twin',
        roomTypeId: 'room-type-twin',
        externalRoomTypeId: 'agoda-twin',
        externalRoomTypeName: 'Twin Room',
        externalRatePlanId: null,
      }],
    },
    $transaction: async (callback) => callback(prisma),
  }

  await assert.rejects(
    () => saveManualChannelConnection(prisma, {
      propertyId: 'property-1',
      providerCode: 'agoda',
      deliveryMode: 'MANUAL',
      extranetUrl: 'https://ycs.agoda.com/',
      enabled: true,
      reason: 'Enable Agoda after mapping review.',
    }, manager),
    (error) => error?.statusCode === 409 && /Double Room/i.test(error.message),
  )
  assert.deepEqual(physicalScopeWhere.rooms, { some: {} })
  assert.equal(upsertCalled, false)
})

test('reconciliation skips and audits unmapped provider-room cells instead of creating unusable tasks', async () => {
  const stayDate = tomorrowKey()
  const createdTasks = []
  const audits = []
  const tx = {
    manualChannelConnection: {
      findMany: async ({ include }) => {
        assert.equal(include.mappings.where.active, true)
        return [{
          id: 'connection-trip',
          propertyId: 'property-1',
          providerCode: 'trip_com',
          deliveryMode: 'MANUAL',
          enabled: true,
          mappings: [{
            id: 'mapping-trip-twin',
            roomTypeId: 'room-type-twin',
            externalRoomTypeId: 'trip-twin',
            externalRoomTypeName: 'Twin Room',
            externalRatePlanId: 'standard',
          }],
        }]
      },
    },
    room: {
      count: async () => 2,
    },
    reservation: {
      findMany: async () => [],
    },
    inventoryHold: {
      findMany: async () => [],
    },
    roomDateInventory: {
      findMany: async () => [],
    },
    manualChannelTask: {
      findMany: async () => [],
      create: async ({ data }) => {
        const task = { id: `task-${createdTasks.length + 1}`, createdAt: new Date(), ...data }
        createdTasks.push(task)
        return task
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
  }

  const result = await reconcileManualChannelTasksInTransaction(tx, {
    propertyId: 'property-1',
    triggerType: 'TEST_MAPPING_GUARD',
    affected: [
      { roomTypeId: 'room-type-twin', date: stayDate },
      { roomTypeId: 'room-type-double', date: stayDate },
    ],
  }, manager)

  assert.equal(createdTasks.length, 1)
  assert.equal(createdTasks[0].roomTypeId, 'room-type-twin')
  assert.equal(result.unmappedCellCount, 1)
  assert.deepEqual(result.unmapped[0], {
    connectionId: 'connection-trip',
    providerCode: 'trip_com',
    roomTypeId: 'room-type-double',
    stayDateKeys: [stayDate],
    cellCount: 1,
    errorCode: 'ACTIVE_MAPPING_REQUIRED',
  })
  assert.equal(
    audits.some((audit) => audit.action === 'MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED'
      && audit.changes.roomTypeId === 'room-type-double'
      && audit.changes.cellCount === 1),
    true,
  )
})

test('Channel Desk task DTO exposes the current external room and rate-plan target', async () => {
  const stayDate = dateFromKey(tomorrowKey())
  const connection = {
    id: 'connection-booking',
    propertyId: 'property-1',
    providerCode: 'booking_com',
    displayName: 'Booking.com',
    deliveryMode: 'MANUAL',
    externalPropertyId: 'hotel-101',
    extranetUrl: 'https://admin.booking.com/',
    enabled: true,
    mappings: [{
      id: 'mapping-booking-twin',
      roomTypeId: 'room-type-twin',
      roomType: { id: 'room-type-twin', name: 'Twin Room' },
      externalRoomTypeId: 'booking-twin-55',
      externalRoomTypeName: 'Superior Twin',
      externalRatePlanId: 'flex-01',
      active: true,
    }],
  }
  const prisma = {
    property: {
      findUnique: async () => ({
        id: 'property-1',
        code: 'SANDBOX',
        name: 'SANDBOX HOTEL',
        timezone: 'Asia/Bangkok',
        currency: 'THB',
        defaultCheckIn: '14:00',
        defaultCheckOut: '12:00',
      }),
    },
    reservation: {},
    bookingEmailSource: {
      findFirst: async () => null,
    },
    bookingEmailEvent: {
      findMany: async () => [],
    },
    manualChannelConnection: {
      findMany: async () => [connection],
    },
    manualChannelTask: {
      findMany: async () => [{
        id: 'task-booking-twin',
        propertyId: 'property-1',
        connectionId: connection.id,
        connection,
        roomTypeId: 'room-type-twin',
        roomType: { id: 'room-type-twin', name: 'Twin Room' },
        stayDate,
        desiredAvailability: 2,
        confirmedAvailability: null,
        status: 'PENDING',
        revision: 1,
        completedAt: null,
        completedBy: null,
        completionNotes: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }],
    },
    bookingEmailPushDelivery: {
      count: async () => 0,
    },
  }

  const desk = await getLiteChannelDesk(prisma)
  assert.equal(desk.tasks[0].externalRoomTypeId, 'booking-twin-55')
  assert.equal(desk.tasks[0].externalRoomTypeName, 'Superior Twin')
  assert.equal(desk.tasks[0].externalRatePlanId, 'flex-01')
})
