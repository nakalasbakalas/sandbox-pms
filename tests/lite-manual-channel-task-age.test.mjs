import assert from 'node:assert/strict'
import test from 'node:test'

import { getLiteChannelDesk, manualChannelTaskAgeMinutes } from '../server/lite-service.mjs'

const NOW = new Date('2030-08-02T12:00:00.000Z')

function task({ id, status, createdAt }) {
  return {
    id,
    connectionId: 'connection-booking',
    connection: {
      id: 'connection-booking',
      providerCode: 'booking_com',
      displayName: 'Booking.com',
      deliveryMode: 'MANUAL',
      enabled: true,
      extranetUrl: 'https://admin.booking.com/',
    },
    roomTypeId: 'room-type-twin',
    roomType: { id: 'room-type-twin', name: 'Twin Room' },
    stayDate: new Date('2030-08-03T00:00:00.000Z'),
    desiredAvailability: 4,
    confirmedAvailability: null,
    targetExternalRoomTypeId: 'booking-twin',
    targetExternalRoomTypeName: 'Twin Room',
    targetExternalRatePlanId: 'flex',
    status,
    revision: 1,
    createdAt,
    completedAt: null,
    completedBy: null,
    completionNotes: null,
    lastErrorCode: status === 'FAILED' ? 'MANUAL_RETRY_REQUIRED' : null,
    lastErrorMessage: status === 'FAILED' ? 'The operator could not confirm the Extranet update.' : null,
  }
}

function prismaWithTasks(tasks) {
  return {
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
    bookingEmailSource: { findFirst: async () => null },
    bookingEmailEvent: {
      findMany: async () => [],
      groupBy: async () => [],
    },
    manualChannelConnection: { findMany: async () => [] },
    roomType: { findMany: async () => [] },
    manualChannelTask: {
      findMany: async () => tasks,
      groupBy: async () => [
        { status: 'PENDING', _count: { _all: tasks.filter((item) => item.status === 'PENDING').length } },
        { status: 'FAILED', _count: { _all: tasks.filter((item) => item.status === 'FAILED').length } },
      ],
    },
    bookingEmailPushDelivery: { count: async () => 0 },
  }
}

test('Channel Desk task DTO exposes creation time and raw age without inventing an overdue SLA', async () => {
  const pendingCreatedAt = new Date('2030-08-02T10:29:30.000Z')
  const failedCreatedAt = new Date('2030-07-31T10:00:00.000Z')
  const desk = await getLiteChannelDesk(prismaWithTasks([
    task({ id: 'task-pending', status: 'PENDING', createdAt: pendingCreatedAt }),
    task({ id: 'task-failed', status: 'FAILED', createdAt: failedCreatedAt }),
  ]), {
    now: NOW,
    credentialStatus: { configured: false, missing: [] },
    pubsubConfig: { enabled: false, missing: [] },
  })

  assert.equal(desk.tasks[0].createdAt, pendingCreatedAt.toISOString())
  assert.equal(desk.tasks[0].ageMinutes, 90)
  assert.equal(desk.tasks[1].createdAt, failedCreatedAt.toISOString())
  assert.equal(desk.tasks[1].ageMinutes, 3_000)
  for (const item of desk.tasks) {
    assert.equal(Object.hasOwn(item, 'overdue'), false)
    assert.equal(Object.hasOwn(item, 'stale'), false)
  }
})

test('manual task age is minute-granular, clamps future clock skew, and rejects invalid timestamps', () => {
  assert.equal(manualChannelTaskAgeMinutes('2030-08-02T11:59:01.000Z', NOW), 0)
  assert.equal(manualChannelTaskAgeMinutes('2030-08-02T12:30:00.000Z', NOW), 0)
  assert.equal(manualChannelTaskAgeMinutes('not-a-date', NOW), null)
  assert.equal(manualChannelTaskAgeMinutes(NOW, 'not-a-date'), null)
})
