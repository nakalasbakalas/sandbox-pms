import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completeManualChannelTask,
  reconcileManualChannelTasksInTransaction,
  reopenManualChannelTask,
} from '../server/manual-channel-service.mjs'

const manager = {
  id: 'manager-channel-lifecycle',
  username: 'manager.channel',
  name: 'Channel Manager',
  role: 'MANAGER',
}

const frontDesk = {
  id: 'front-desk-channel-lifecycle',
  username: 'front.channel',
  name: 'Front Desk Operator',
  role: 'FRONT_DESK',
}

function createLifecycleFixture() {
  const connection = {
    id: 'connection-booking',
    propertyId: 'property-1',
    providerCode: 'booking_com',
    displayName: 'Booking.com',
    deliveryMode: 'MANUAL',
    extranetUrl: 'https://admin.booking.com/',
    enabled: true,
  }
  const roomType = { id: 'room-type-double', name: 'Double Room' }
  const mapping = {
    id: 'mapping-booking-double',
    connectionId: connection.id,
    roomTypeId: roomType.id,
    externalRoomTypeId: 'booking-double',
    externalRoomTypeName: 'Superior Double',
    externalRatePlanId: 'standard-flex',
    active: true,
  }
  const tasks = []
  const audits = []
  let taskCounter = 0

  const decorate = (task) => task ? { ...task, connection, roomType } : null
  const matches = (task, where = {}) => {
    if (where.id && task.id !== where.id) return false
    if (where.activeKey && task.activeKey !== where.activeKey) return false
    if (where.status && task.status !== where.status) return false
    if (where.revision && task.revision !== where.revision) return false
    if (where.connectionId?.in && !where.connectionId.in.includes(task.connectionId)) return false
    if (where.roomTypeId?.in && !where.roomTypeId.in.includes(task.roomTypeId)) return false
    if (where.stayDate?.in) {
      const key = new Date(task.stayDate).toISOString().slice(0, 10)
      if (!where.stayDate.in.some((date) => new Date(date).toISOString().slice(0, 10) === key)) return false
    }
    return true
  }

  const prisma = {
    manualChannelConnection: {
      findMany: async () => [{ ...connection, mappings: [mapping] }],
    },
    room: {
      count: async () => 3,
    },
    reservation: {
      findMany: async () => [{
        checkIn: new Date('2030-08-10T00:00:00.000Z'),
        checkOut: new Date('2030-08-11T00:00:00.000Z'),
      }],
    },
    inventoryHold: {
      findMany: async () => [],
    },
    roomDateInventory: {
      findMany: async () => [],
    },
    manualChannelRoomMapping: {
      findFirst: async ({ where }) => (
        where.connectionId === mapping.connectionId
        && where.roomTypeId === mapping.roomTypeId
        && where.active === true
          ? mapping
          : null
      ),
    },
    manualChannelTask: {
      findMany: async ({ where = {} }) => tasks
        .filter((task) => matches(task, where))
        .sort((left, right) => right.createdAt - left.createdAt || right.revision - left.revision)
        .map(decorate),
      findFirst: async ({ where = {} }) => decorate(tasks
        .filter((task) => matches(task, where))
        .sort((left, right) => right.revision - left.revision || right.createdAt - left.createdAt)[0]),
      findUnique: async ({ where }) => decorate(tasks.find((task) => matches(task, where))),
      create: async ({ data }) => {
        const task = {
          id: `manual-task-${++taskCounter}`,
          createdAt: new Date(`2030-08-01T00:00:0${taskCounter}.000Z`),
          updatedAt: new Date(`2030-08-01T00:00:0${taskCounter}.000Z`),
          completedAt: null,
          completedBy: null,
          completionNotes: null,
          confirmedAvailability: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          ...data,
        }
        tasks.push(task)
        return decorate(task)
      },
      update: async ({ where, data }) => {
        const task = tasks.find((candidate) => matches(candidate, where))
        if (!task) return null
        Object.assign(task, data, { updatedAt: new Date('2030-08-01T00:10:00.000Z') })
        return decorate(task)
      },
      updateMany: async ({ where, data }) => {
        const task = tasks.find((candidate) => matches(candidate, where))
        if (!task) return { count: 0 }
        Object.assign(task, data, { updatedAt: new Date('2030-08-01T00:10:00.000Z') })
        return { count: 1 }
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return { prisma, tasks, audits, connection, roomType, mapping }
}

test('manual channel tasks coalesce, complete with operator evidence, and reopen as an audited revision', async () => {
  const fixture = createLifecycleFixture()
  const input = {
    propertyId: 'property-1',
    triggerType: 'RESERVATION_CREATED',
    affected: [{ roomTypeId: fixture.roomType.id, date: '2030-08-10' }],
    now: new Date('2030-08-01T00:00:00.000Z'),
  }

  const created = await reconcileManualChannelTasksInTransaction(fixture.prisma, input, manager)
  assert.equal(created.created.length, 1)
  assert.equal(created.created[0].desiredAvailability, 2)
  assert.equal(created.created[0].revision, 1)
  assert.equal(created.created[0].status, 'PENDING')
  assert.equal(fixture.tasks.length, 1)

  const coalesced = await reconcileManualChannelTasksInTransaction(fixture.prisma, input, manager)
  assert.equal(coalesced.created.length, 0)
  assert.equal(coalesced.coalesced.length, 1)
  assert.equal(coalesced.coalesced[0].id, created.created[0].id)
  assert.equal(fixture.tasks.length, 1, 'same desired inventory does not create duplicate operator work')
  assert.equal(
    fixture.audits.some((audit) => audit.action === 'MANUAL_CHANNEL_TASK_COALESCED'
      && audit.userId === manager.id
      && audit.changes.desiredAvailability === 2),
    true,
  )

  const completed = await completeManualChannelTask(fixture.prisma, created.created[0].id, {
    revision: 1,
    confirmedAvailability: 2,
    completionNotes: 'Booking.com Extranet saved and reloaded at 2 rooms.',
  }, frontDesk)
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.activeKey, null)
  assert.equal(completed.confirmedAvailability, 2)
  assert.equal(completed.completedBy, frontDesk.name)
  assert.equal(completed.completionNotes, 'Booking.com Extranet saved and reloaded at 2 rooms.')
  assert.equal(completed.completedAt instanceof Date, true)
  const completionAudit = fixture.audits.find((audit) => audit.action === 'MANUAL_CHANNEL_TASK_COMPLETED')
  assert.equal(completionAudit.userId, frontDesk.id)
  assert.equal(completionAudit.entityId, completed.id)
  assert.equal(completionAudit.changes.externalRoomTypeId, fixture.mapping.externalRoomTypeId)
  assert.equal(completionAudit.changes.confirmedAvailability, 2)
  assert.equal(completionAudit.changes.notes, completed.completionNotes)

  const unchanged = await reconcileManualChannelTasksInTransaction(fixture.prisma, input, manager)
  assert.equal(unchanged.created.length, 0)
  assert.equal(unchanged.unchanged.length, 1)
  assert.equal(unchanged.unchanged[0].id, completed.id)

  const reopened = await reopenManualChannelTask(fixture.prisma, completed.id, {
    reason: 'Recheck after an Extranet discrepancy was reported.',
  }, manager)
  assert.equal(reopened.status, 'PENDING')
  assert.equal(reopened.revision, 2)
  assert.equal(reopened.supersedesTaskId, completed.id)
  assert.equal(reopened.desiredAvailability, 2)
  assert.notEqual(reopened.activeKey, null)
  assert.equal(fixture.tasks.length, 2)
  const reopenAudit = fixture.audits.find((audit) => audit.action === 'MANUAL_CHANNEL_TASK_REOPENED')
  assert.equal(reopenAudit.userId, manager.id)
  assert.equal(reopenAudit.entityId, reopened.id)
  assert.equal(reopenAudit.changes.previousTaskId, completed.id)
  assert.equal(reopenAudit.changes.revision, 2)
  assert.equal(reopenAudit.changes.reason, 'Recheck after an Extranet discrepancy was reported.')
})
