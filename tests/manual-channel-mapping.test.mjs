import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import test from 'node:test'

import { getLiteChannelDesk } from '../server/lite-service.mjs'
import {
  completeManualChannelTask,
  reconcileManualChannelTasksInTransaction,
  reopenManualChannelTask,
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

test('upgrade migration fails closed instead of inferring historical task targets from current mappings', async () => {
  const sql = await readFile(new URL('../prisma/migrations/20260713120000_manual_channel_task_target_snapshot/migration.sql', import.meta.url), 'utf8')
  assert.match(sql, /legacy-unverified:/i)
  assert.doesNotMatch(sql, /FROM\s+"ManualChannelRoomMapping"/i)
})

function tomorrowKey() {
  const date = dateFromKey(getBangkokDateKey(new Date()))
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function nextDateKeyForTest(value) {
  const date = dateFromKey(value)
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

function enablingBaselineFixture({ failTaskCreate = false } = {}) {
  const tasks = []
  const audits = []
  const mapping = {
    id: 'mapping-booking-twin',
    roomTypeId: 'room-type-twin',
    externalRoomTypeId: 'booking-twin',
    externalRoomTypeName: 'Twin Room',
    externalRatePlanId: 'standard',
  }
  let transactionOptions
  const prisma = {
    property: {
      findUnique: async () => ({ id: 'property-1' }),
    },
    manualChannelConnection: {
      findUnique: async () => ({ id: 'connection-booking', enabled: false }),
      upsert: async () => ({
        id: 'connection-booking',
        propertyId: 'property-1',
        providerCode: 'booking_com',
        displayName: 'Booking.com',
        deliveryMode: 'MANUAL',
        externalPropertyId: null,
        extranetUrl: 'https://admin.booking.com/',
        enabled: true,
        mappings: [mapping],
      }),
      findMany: async ({ where }) => {
        assert.equal(where.id, 'connection-booking')
        assert.equal(where.enabled, true)
        return [{
          id: 'connection-booking',
          propertyId: 'property-1',
          providerCode: 'booking_com',
          deliveryMode: 'MANUAL',
          enabled: true,
          mappings: [mapping],
        }]
      },
    },
    roomType: {
      findMany: async () => [{ id: 'room-type-twin', code: 'TWIN', name: 'Twin Room' }],
    },
    manualChannelRoomMapping: {
      findMany: async () => [mapping],
    },
    room: {
      count: async () => 3,
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
        if (failTaskCreate) throw new Error('task staging failed')
        const task = { id: `task-${tasks.length + 1}`, createdAt: new Date(), ...data }
        tasks.push(task)
        return task
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    $transaction: async (callback, options) => {
      transactionOptions = options
      return callback(prisma)
    },
  }
  return { prisma, tasks, audits, transactionOptions: () => transactionOptions }
}

test('disabled-to-enabled transition stages a bounded initial baseline for only that connection', async () => {
  const fixture = enablingBaselineFixture()
  const connection = await saveManualChannelConnection(fixture.prisma, {
    propertyId: 'property-1',
    providerCode: 'booking_com',
    deliveryMode: 'MANUAL',
    extranetUrl: 'https://admin.booking.com/',
    enabled: true,
    initialReconcileDays: 2,
    reason: 'Enable after validating mappings and initial availability.',
  }, manager)

  const today = getBangkokDateKey(new Date())
  assert.equal(connection.enabled, true)
  assert.equal(fixture.tasks.length, 2)
  assert.deepEqual(fixture.tasks.map((task) => getBangkokDateKey(task.stayDate)), [today, nextDateKeyForTest(today)])
  assert.equal(fixture.tasks.every((task) => task.connectionId === 'connection-booking'), true)
  assert.equal(fixture.tasks.every((task) => task.triggerType === 'MANUAL_CHANNEL_CONNECTION_ENABLED'), true)
  assert.equal(
    fixture.audits.some((audit) => audit.action === 'MANUAL_CHANNEL_INITIAL_BASELINE_STAGED'
      && audit.changes.stayDateCount === 2
      && audit.changes.createdCount === 2),
    true,
  )
  assert.equal(fixture.transactionOptions().isolationLevel, 'Serializable')
})

test('connection enable fails when its initial availability baseline cannot be staged', async () => {
  const fixture = enablingBaselineFixture({ failTaskCreate: true })
  await assert.rejects(
    () => saveManualChannelConnection(fixture.prisma, {
      propertyId: 'property-1',
      providerCode: 'booking_com',
      deliveryMode: 'MANUAL',
      extranetUrl: 'https://admin.booking.com/',
      enabled: true,
      initialReconcileDays: 1,
      reason: 'Enable only if the initial availability queue is staged.',
    }, manager),
    /task staging failed/i,
  )
  assert.equal(fixture.audits.some((audit) => audit.action === 'MANUAL_CHANNEL_CONNECTION_SAVED'), false)
})

test('connection enable rejects an initial baseline outside the 1-to-90-day boundary', async () => {
  await assert.rejects(
    () => saveManualChannelConnection({}, {
      propertyId: 'property-1',
      providerCode: 'booking_com',
      deliveryMode: 'MANUAL',
      extranetUrl: 'https://admin.booking.com/',
      enabled: true,
      initialReconcileDays: 91,
      reason: 'Reject an unbounded initial reconciliation range.',
    }, manager),
    (error) => error?.statusCode === 400 && /whole number from 1 to 90/i.test(error.message),
  )
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
  assert.equal(createdTasks[0].targetExternalRoomTypeId, 'trip-twin')
  assert.equal(createdTasks[0].targetExternalRoomTypeName, 'Twin Room')
  assert.equal(createdTasks[0].targetExternalRatePlanId, 'standard')
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

test('Channel Desk task DTO exposes the immutable task target instead of a changed current mapping', async () => {
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
      externalRoomTypeId: 'booking-twin-NEW',
      externalRoomTypeName: 'Renamed Twin',
      externalRatePlanId: 'new-rate',
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
      groupBy: async () => [],
    },
    manualChannelConnection: {
      findMany: async () => [connection],
      upsert: async ({ create }) => ({ id: `bootstrapped-${create.providerCode}`, ...create }),
    },
    roomType: {
      findMany: async () => [{
        id: 'room-type-twin',
        code: 'TWIN',
        name: 'Twin Room',
        _count: { rooms: 2 },
      }],
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
        targetExternalRoomTypeId: 'booking-twin-55',
        targetExternalRoomTypeName: 'Superior Twin',
        targetExternalRatePlanId: 'flex-01',
        status: 'PENDING',
        revision: 1,
        completedAt: null,
        completedBy: null,
        completionNotes: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }],
      groupBy: async () => [{ status: 'PENDING', _count: { _all: 1 } }],
    },
    bookingEmailPushDelivery: {
      count: async () => 0,
    },
    auditLog: {
      create: async ({ data }) => data,
    },
    $transaction: async (callback) => callback(prisma),
  }

  const desk = await getLiteChannelDesk(prisma)
  assert.equal(desk.tasks[0].externalRoomTypeId, 'booking-twin-55')
  assert.equal(desk.tasks[0].externalRoomTypeName, 'Superior Twin')
  assert.equal(desk.tasks[0].externalRatePlanId, 'flex-01')
  assert.deepEqual(desk.roomTypes, [{
    id: 'room-type-twin',
    code: 'TWIN',
    name: 'Twin Room',
    physicalRoomCount: 2,
  }])
})

test('reconciliation supersedes an equal-availability task when its target mapping changed', async () => {
  const stayDate = tomorrowKey()
  const previousTask = {
    id: 'task-old-target',
    connectionId: 'connection-booking',
    roomTypeId: 'room-type-twin',
    stayDate: dateFromKey(stayDate),
    desiredAvailability: 3,
    confirmedAvailability: null,
    targetExternalRoomTypeId: 'booking-old-room',
    targetExternalRoomTypeName: 'Old Twin',
    targetExternalRatePlanId: 'old-rate',
    status: 'PENDING',
    revision: 1,
    activeKey: 'old-active-key',
    createdAt: new Date(),
  }
  const updates = []
  const creates = []
  const tx = {
    manualChannelConnection: {
      findMany: async () => [{
        id: 'connection-booking',
        propertyId: 'property-1',
        providerCode: 'booking_com',
        deliveryMode: 'MANUAL',
        enabled: true,
        mappings: [{
          id: 'mapping-booking-twin',
          roomTypeId: 'room-type-twin',
          externalRoomTypeId: 'booking-new-room',
          externalRoomTypeName: 'New Twin',
          externalRatePlanId: 'new-rate',
        }],
      }],
    },
    room: { count: async () => 3 },
    reservation: { findMany: async () => [] },
    inventoryHold: { findMany: async () => [] },
    roomDateInventory: { findMany: async () => [] },
    manualChannelTask: {
      findMany: async () => [previousTask],
      update: async ({ data }) => {
        updates.push(data)
        return { ...previousTask, ...data }
      },
      create: async ({ data }) => {
        const task = { id: 'task-new-target', createdAt: new Date(), ...data }
        creates.push(task)
        return task
      },
    },
    auditLog: { create: async ({ data }) => data },
  }

  const result = await reconcileManualChannelTasksInTransaction(tx, {
    propertyId: 'property-1',
    triggerType: 'MAPPING_CHANGED_TEST',
    affected: [{ roomTypeId: 'room-type-twin', date: stayDate }],
  }, manager)

  assert.equal(updates[0].status, 'SUPERSEDED')
  assert.equal(updates[0].activeKey, null)
  assert.equal(creates[0].revision, 2)
  assert.equal(creates[0].desiredAvailability, 3)
  assert.equal(creates[0].targetExternalRoomTypeId, 'booking-new-room')
  assert.equal(creates[0].targetExternalRoomTypeName, 'New Twin')
  assert.equal(creates[0].targetExternalRatePlanId, 'new-rate')
  assert.deepEqual(result.retargeted.map((task) => task.id), ['task-old-target'])
  assert.equal(result.coalesced.length, 0)
  assert.equal(result.unchanged.length, 0)
})

test('completion rejects a pending task whose current mapping differs from its immutable target', async () => {
  let updateCalled = false
  const task = {
    id: 'task-stale-target',
    propertyId: 'property-1',
    connectionId: 'connection-agoda',
    roomTypeId: 'room-type-twin',
    stayDate: dateFromKey(tomorrowKey()),
    desiredAvailability: 2,
    targetExternalRoomTypeId: 'agoda-old-room',
    targetExternalRoomTypeName: 'Old Twin',
    targetExternalRatePlanId: null,
    status: 'PENDING',
    revision: 4,
    activeKey: 'active-task-key',
    connection: {
      providerCode: 'agoda',
      deliveryMode: 'MANUAL',
      enabled: true,
      extranetUrl: 'https://ycs.agoda.com/',
    },
    roomType: { id: 'room-type-twin', name: 'Twin Room' },
  }
  const prisma = {
    manualChannelTask: {
      findUnique: async () => task,
      updateMany: async () => {
        updateCalled = true
        return { count: 1 }
      },
    },
    manualChannelRoomMapping: {
      findFirst: async () => ({
        externalRoomTypeId: 'agoda-new-room',
        externalRoomTypeName: 'New Twin',
        externalRatePlanId: null,
      }),
    },
    $transaction: async (callback) => callback(prisma),
  }

  await assert.rejects(
    () => completeManualChannelTask(prisma, task.id, {
      revision: 4,
      confirmedAvailability: 2,
      notes: 'Entered and verified in Agoda.',
    }, manager),
    (error) => error?.statusCode === 409 && /earlier OTA room or rate-plan mapping/i.test(error.message),
  )
  assert.equal(updateCalled, false)
})

test('manager retry safely supersedes the current failed revision and snapshots the current mapping', async () => {
  const stayDate = tomorrowKey()
  const activeKey = createHash('sha256')
    .update(`connection-trip\u0000room-type-twin\u0000${stayDate}`)
    .digest('hex')
  const task = {
    id: 'task-failed',
    propertyId: 'property-1',
    connectionId: 'connection-trip',
    roomTypeId: 'room-type-twin',
    stayDate: dateFromKey(stayDate),
    desiredAvailability: 1,
    targetExternalRoomTypeId: 'trip-old-room',
    targetExternalRoomTypeName: 'Old Twin',
    targetExternalRatePlanId: 'old-rate',
    status: 'FAILED',
    revision: 3,
    activeKey,
    sourceProviderCode: 'trip_com',
    sourceReservationId: 'reservation-1',
    sourceBookingEmailEventId: 'event-1',
    connection: {
      providerCode: 'trip_com',
      deliveryMode: 'MANUAL',
      enabled: true,
      extranetUrl: 'https://ebooking.trip.com/',
    },
  }
  const updates = []
  const creates = []
  const audits = []
  const prisma = {
    room: {
      count: async () => 3,
    },
    reservation: {
      findMany: async () => [{
        checkIn: dateFromKey(stayDate),
        checkOut: new Date(dateFromKey(stayDate).getTime() + 86_400_000),
      }],
    },
    inventoryHold: {
      findMany: async () => [],
    },
    roomDateInventory: {
      findMany: async () => [],
    },
    manualChannelTask: {
      findUnique: async ({ where }) => (where.id === task.id || where.activeKey === activeKey ? task : null),
      findFirst: async () => ({ id: task.id, revision: task.revision }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, task.id)
        assert.equal(where.activeKey, activeKey)
        updates.push(data)
        return { count: 1 }
      },
      create: async ({ data }) => {
        const created = { id: 'task-retry', ...data }
        creates.push(created)
        return created
      },
    },
    manualChannelRoomMapping: {
      findFirst: async () => ({
        externalRoomTypeId: 'trip-current-room',
        externalRoomTypeName: 'Current Twin',
        externalRatePlanId: 'current-rate',
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  const retried = await reopenManualChannelTask(prisma, task.id, {
    reason: 'Retry after confirming the Trip.com Extranet is available.',
  }, manager)

  assert.deepEqual(updates[0], { status: 'SUPERSEDED', activeKey: null })
  assert.equal(retried.id, 'task-retry')
  assert.equal(creates[0].revision, 4)
  assert.equal(creates[0].status, 'PENDING')
  assert.equal(creates[0].activeKey, activeKey)
  assert.equal(creates[0].triggerType, 'MANUAL_RETRY')
  assert.equal(creates[0].supersedesTaskId, task.id)
  assert.equal(creates[0].desiredAvailability, 2)
  assert.equal(creates[0].targetExternalRoomTypeId, 'trip-current-room')
  assert.equal(creates[0].targetExternalRoomTypeName, 'Current Twin')
  assert.equal(creates[0].targetExternalRatePlanId, 'current-rate')
  assert.equal(audits.at(-1).action, 'MANUAL_CHANNEL_TASK_RETRIED')
  assert.equal(audits.at(-1).changes.previousStatus, 'FAILED')
  assert.equal(audits.at(-1).changes.previousDesiredAvailability, 1)
  assert.equal(audits.at(-1).changes.desiredAvailability, 2)
})
