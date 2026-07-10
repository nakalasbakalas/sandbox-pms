/* global console */
import assert from 'node:assert/strict'
import {
  createAvailabilityQueueItem,
  getChannelSyncV2Policy,
  normalizeAvailabilityQueueInput,
} from '../server/availability-queue.mjs'
import {
  createHotelOpsScanScheduler,
  getBookingEmailSyncPolicy,
} from '../server/ops-scheduler.mjs'

function bookingEmailEnv(overrides = {}) {
  return {
    BOOKING_EMAIL_NEAR_LIVE_ENABLED: 'true',
    BOOKING_EMAIL_SYNC_INTERVAL_SECONDS: '120',
    BOOKING_EMAIL_SYNC_BATCH_LIMIT: '25',
    BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@example.com',
    BOOKING_EMAIL_GMAIL_CLIENT_ID: 'client-id',
    BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'client-secret',
    BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: 'refresh-token',
    ...overrides,
  }
}

function createQueuePrismaFixture() {
  const property = { id: 'property-1', code: 'SANDBOX' }
  const tasks = []
  const approvals = []
  const logs = []
  const audits = []
  let taskCounter = 0

  const withRelations = (task) => task ? {
    ...task,
    approvals: approvals.filter((approval) => approval.taskId === task.id),
    logs: logs.filter((log) => log.taskId === task.id),
  } : null

  const prisma = {
    property: {
      findUnique: async ({ where }) => where?.code === property.code ? property : null,
    },
    hotelOpsTask: {
      findUnique: async ({ where }) => withRelations(tasks.find((task) => (
        (where?.id && task.id === where.id)
        || (where?.idempotencyKey && task.idempotencyKey === where.idempotencyKey)
      ))),
      create: async ({ data }) => {
        const task = {
          id: `task-${++taskCounter}`,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          updatedAt: new Date('2026-07-10T00:00:00.000Z'),
          executionSummary: null,
          errorCode: null,
          errorMessage: null,
          ...data,
        }
        tasks.push(task)
        return withRelations(task)
      },
    },
    hotelOpsTaskApproval: {
      create: async ({ data }) => {
        const approval = {
          id: `approval-${approvals.length + 1}`,
          requestedAt: new Date('2026-07-10T00:00:00.000Z'),
          ...data,
        }
        approvals.push(approval)
        return approval
      },
    },
    hotelOpsTaskLog: {
      create: async ({ data }) => {
        const log = {
          id: `log-${logs.length + 1}`,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          ...data,
        }
        logs.push(log)
        return log
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

  return { prisma, tasks, approvals, logs, audits }
}

async function run() {
  const disabled = getBookingEmailSyncPolicy({})
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.disabledReason, 'not_requested')
  assert.equal(disabled.reviewOnly, true)
  assert.equal(disabled.operationalMutationsEnabled, false)

  const enabled = getBookingEmailSyncPolicy(bookingEmailEnv())
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.intervalSeconds, 120)
  assert.equal(enabled.batchLimit, 25)
  assert.equal(enabled.credentialMode, 'refresh_token')

  const bounded = getBookingEmailSyncPolicy(bookingEmailEnv({
    BOOKING_EMAIL_SYNC_INTERVAL_SECONDS: '2',
    BOOKING_EMAIL_SYNC_BATCH_LIMIT: '9999',
  }))
  assert.equal(bounded.intervalSeconds, 30)
  assert.equal(bounded.batchLimit, 250)

  const normalized = normalizeAvailabilityQueueInput({
    provider: 'Trip.com',
    hotelId: 'TRIP-HOTEL-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 2,
    reason: 'New Agoda booking reduces shared inventory.',
  })
  assert.equal(normalized.provider, 'trip')
  assert.equal(normalized.taskPlatform, 'trip')
  assert.equal(normalized.deliveryTarget, 'MANUAL_PORTAL')
  assert.equal(normalized.autoDispatch, false)
  assert.match(normalized.idempotencyKey, /^availability-queue:/)

  const channex = normalizeAvailabilityQueueInput({
    provider: 'channex',
    hotelId: 'PROPERTY-1',
    roomType: 'TWIN',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
    availabilityStatus: 'closed',
    reason: 'Stop sell while reconciling inventory.',
  })
  assert.equal(channex.availableRooms, 0)
  assert.equal(channex.deliveryTarget, 'CHANNEL_MANAGER')
  assert.equal(channex.taskPlatform, 'all')

  assert.throws(() => normalizeAvailabilityQueueInput({
    provider: 'agoda',
    hotelId: 'A1',
    roomType: 'DOUBLE',
    startDate: '2026-07-15',
    endDate: '2026-07-11',
    availableRooms: 1,
    reason: 'Invalid date range.',
  }), /End date/)

  assert.throws(() => normalizeAvailabilityQueueInput({
    provider: 'agoda',
    hotelId: 'A1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availabilityStatus: 'open',
    reason: 'Missing rooms.',
  }), /Available rooms/)

  const fixture = createQueuePrismaFixture()
  const created = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, {
    id: 'admin-1',
    name: 'Admin User',
    role: 'ADMIN',
  })
  assert.equal(created.duplicate, false)
  assert.equal(created.item.status, 'PENDING_APPROVAL')
  assert.equal(created.item.autoDispatch, false)
  assert.equal(fixture.tasks.length, 1)
  assert.equal(fixture.approvals.length, 1)
  assert.equal(fixture.approvals[0].requiredRole, 'OWNER')
  assert.equal(fixture.logs[0].action, 'AVAILABILITY_QUEUED')
  assert.equal(fixture.audits[0].action, 'AVAILABILITY_QUEUE_CREATED')

  const duplicate = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, {
    id: 'admin-1',
    name: 'Admin User',
    role: 'ADMIN',
  })
  assert.equal(duplicate.duplicate, true)
  assert.equal(fixture.tasks.length, 1)

  const intervals = []
  const syncCalls = []
  const scheduler = createHotelOpsScanScheduler({
    env: bookingEmailEnv(),
    prisma: {},
    listBookingSources: async () => [{
      id: 'source-1',
      mailbox: 'booking@example.com',
      enabled: true,
    }],
    syncBooking: async (_db, input, actor) => {
      syncCalls.push({ input, actor })
      return {
        events: [{ id: 'event-1' }, { id: 'event-2' }],
        opsCommandEvents: [{ id: 'event-1', rawText: '/ops read reservations' }],
      }
    },
    processEmailCommands: async () => [{ status: 'accepted' }],
    submitEmailCommand: async () => ({ task: { id: 'ops-1' } }),
    setIntervalFn: (callback, milliseconds) => {
      const handle = { callback, milliseconds, unref() {} }
      intervals.push(handle)
      return handle
    },
    clearIntervalFn: () => {},
    now: () => new Date('2026-07-10T12:00:00.000Z'),
  })

  const start = scheduler.start()
  assert.equal(start.started, true)
  assert.equal(start.status.bookingEmail.started, true)
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].milliseconds, 120_000)

  const syncResult = await scheduler.runBookingEmailOnce('test')
  assert.equal(syncResult.skipped, false)
  assert.equal(syncResult.importedCount, 2)
  assert.equal(syncResult.commandCount, 1)
  assert.equal(syncResult.errorCount, 0)
  assert.equal(syncCalls.length, 1)
  assert.equal(syncCalls[0].input.reviewOnly, true)
  assert.equal(syncCalls[0].input.limit, 25)
  assert.equal(syncCalls[0].actor.name, 'Near-live Booking Email Scheduler')
  assert.equal(scheduler.getStatus().bookingEmail.status, 'SUCCEEDED')

  const policy = getChannelSyncV2Policy({ CHANNEL_MANAGER_PROVIDER: 'channex' })
  assert.equal(policy.outboundAvailability.mode, 'manual_queue')
  assert.equal(policy.outboundAvailability.autoDispatch, false)
  assert.equal(policy.trueTwoWay.zeroLagRequired, true)
  assert.equal(policy.trueTwoWay.channelOnlyProvider, 'channex')
  assert.deepEqual(policy.directApiApplications.map((item) => item.provider), ['agoda', 'trip'])

  scheduler.stop()
  assert.equal(scheduler.getStatus().bookingEmail.started, false)

  console.log('Channel sync v2 tests passed.')
}

await run()
