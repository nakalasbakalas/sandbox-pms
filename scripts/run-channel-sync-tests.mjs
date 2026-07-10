/* global console, setImmediate */
import assert from 'node:assert/strict'
import {
  approveAvailabilityQueueItem,
  cancelAvailabilityQueueItem,
  createAvailabilityQueueItem,
  getChannelSyncV2Policy,
  isManualAvailabilityQueueTask,
  listAvailabilityQueue,
  markAvailabilityQueueItemFailed,
  markAvailabilityQueueItemSent,
  normalizeAvailabilityQueueInput,
  resolveAvailabilityQueueActor,
} from '../server/availability-queue.mjs'
import {
  approveOpsTask,
  evaluateOpsTaskRun,
} from '../server/ops-service.mjs'
import {
  createHotelOpsScanScheduler,
  getBookingEmailSyncPolicy,
  isBookingEmailSourceSchedulable,
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
  const now = () => new Date('2026-07-10T00:00:00.000Z')
  const property = {
    id: 'property-1',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    email: null,
    reservationAlertEmail: null,
  }
  const users = [
    { id: 'admin-1', username: 'admin', email: 'admin@example.com', firstName: 'Admin', lastName: 'User', role: 'ADMIN', active: true },
    { id: 'manager-1', username: 'manager', email: 'manager@example.com', firstName: 'Hotel', lastName: 'Manager', role: 'MANAGER', active: true },
    { id: 'front-1', username: 'frontdesk', email: 'front@example.com', firstName: 'Front', lastName: 'Desk', role: 'FRONT_DESK', active: true },
    { id: 'inactive-1', username: 'inactive', email: 'inactive@example.com', firstName: 'Inactive', lastName: 'User', role: 'ADMIN', active: false },
  ]
  const tasks = []
  const approvals = []
  const logs = []
  const audits = []
  let taskCounter = 0
  let approvalCounter = 0
  let logCounter = 0
  let auditCounter = 0

  const withRelations = (task) => task ? {
    ...task,
    approvals: approvals.filter((approval) => approval.taskId === task.id),
    logs: logs.filter((log) => log.taskId === task.id),
    notifications: [],
  } : null

  const taskMatches = (task, where = {}) => {
    if (where.id && task.id !== where.id) return false
    if (where.idempotencyKey && task.idempotencyKey !== where.idempotencyKey) return false
    if (where.propertyId && task.propertyId !== where.propertyId) return false
    if (where.taskType && task.taskType !== where.taskType) return false
    if (where.status && task.status !== where.status) return false
    return true
  }

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where?.id === property.id || where?.code === property.code) return property
        return null
      },
    },
    user: {
      findFirst: async ({ where = {} } = {}) => users.find((user) => {
        if (where.active !== undefined && user.active !== where.active) return false
        const clauses = Array.isArray(where.OR) ? where.OR : []
        if (clauses.length === 0) return true
        return clauses.some((clause) => (
          (clause.id && user.id === clause.id)
          || (clause.username && user.username === clause.username)
          || (clause.email && user.email === clause.email)
        ))
      }) || null,
    },
    hotelOpsEmergencyStop: {
      findUnique: async () => ({ id: 'stop-1', propertyId: property.id, enabled: false }),
    },
    hotelOpsTask: {
      findUnique: async ({ where }) => withRelations(tasks.find((task) => taskMatches(task, where))),
      findMany: async ({ where = {}, take } = {}) => tasks
        .filter((task) => taskMatches(task, where))
        .slice(0, take || tasks.length)
        .map(withRelations),
      create: async ({ data }) => {
        const task = {
          id: 'task-' + (++taskCounter),
          createdAt: now(),
          updatedAt: now(),
          proofScreenshots: null,
          executionSummary: null,
          errorCode: null,
          errorMessage: null,
          ...data,
        }
        tasks.push(task)
        return withRelations(task)
      },
      update: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id)
        if (!task) return null
        Object.assign(task, data, { updatedAt: now() })
        return withRelations(task)
      },
      updateMany: async ({ where, data }) => {
        const task = tasks.find((item) => taskMatches(item, where))
        if (!task) return { count: 0 }
        Object.assign(task, data, { updatedAt: now() })
        return { count: 1 }
      },
    },
    hotelOpsTaskApproval: {
      create: async ({ data }) => {
        const approval = {
          id: 'approval-' + (++approvalCounter),
          status: 'PENDING',
          requestedAt: now(),
          decidedAt: null,
          decidedBy: null,
          notes: null,
          ...data,
        }
        approvals.push(approval)
        return approval
      },
      findFirst: async ({ where = {} } = {}) => approvals.find((approval) => (
        (!where.taskId || approval.taskId === where.taskId)
        && (!where.status || approval.status === where.status)
      )) || null,
      findMany: async ({ where = {} } = {}) => approvals.filter((approval) => (
        (!where.status || approval.status === where.status)
      )),
      update: async ({ where, data }) => {
        const approval = approvals.find((item) => item.id === where?.id)
        if (!approval) return null
        Object.assign(approval, data)
        return approval
      },
    },
    hotelOpsTaskLog: {
      create: async ({ data }) => {
        const log = { id: 'log-' + (++logCounter), createdAt: now(), ...data }
        logs.push(log)
        return log
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const audit = { id: 'audit-' + (++auditCounter), createdAt: now(), ...data }
        audits.push(audit)
        return audit
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return {
    prisma,
    property,
    users,
    tasks,
    approvals,
    logs,
    audits,
    getTask: (taskId) => withRelations(tasks.find((task) => task.id === taskId)),
  }
}

async function run() {
  const disabled = getBookingEmailSyncPolicy({})
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.disabledReason, 'not_requested')
  assert.equal(disabled.reviewOnly, true)
  assert.equal(disabled.operationalMutationsEnabled, false)

  const missingCredentials = getBookingEmailSyncPolicy({
    BOOKING_EMAIL_NEAR_LIVE_ENABLED: 'true',
    BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@example.com',
  })
  assert.equal(missingCredentials.enabled, false)
  assert.equal(missingCredentials.disabledReason, 'gmail_oauth_not_configured')

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

  assert.equal(isBookingEmailSourceSchedulable({ provider: 'gmail', enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'forwarded-mailbox', enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'manual', enabled: true }), false)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'imap', enabled: true }), false)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'gmail', enabled: false }), false)

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
  const admin = await resolveAvailabilityQueueActor(fixture.prisma, 'ADMIN@EXAMPLE.COM')
  const manager = await resolveAvailabilityQueueActor(fixture.prisma, 'manager')
  const frontDesk = await resolveAvailabilityQueueActor(fixture.prisma, { id: 'front-1', role: 'ADMIN', name: 'Forged Admin' })
  assert.equal(admin.role, 'ADMIN')
  assert.equal(admin.name, 'Admin User')
  assert.equal(manager.role, 'MANAGER')
  assert.equal(frontDesk.role, 'FRONT_DESK')
  assert.equal(frontDesk.name, 'Front Desk')
  await assert.rejects(() => resolveAvailabilityQueueActor(fixture.prisma, 'inactive'), /Active PMS user/)
  await assert.rejects(() => resolveAvailabilityQueueActor(fixture.prisma, 'missing-user'), /Active PMS user/)

  const created = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, admin)
  assert.equal(created.duplicate, false)
  assert.equal(created.item.status, 'PENDING_APPROVAL')
  assert.equal(created.item.autoDispatch, false)
  assert.equal(fixture.tasks.length, 1)
  assert.equal(fixture.approvals.length, 1)
  assert.equal(fixture.approvals[0].requiredRole, 'HOTEL_MANAGER')
  assert.equal(fixture.logs[0].action, 'AVAILABILITY_QUEUED')
  assert.equal(fixture.audits[0].action, 'AVAILABILITY_QUEUE_CREATED')
  assert.equal(isManualAvailabilityQueueTask(fixture.getTask(created.item.id)), true)

  const duplicate = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, admin)
  assert.equal(duplicate.duplicate, true)
  assert.equal(fixture.tasks.length, 1)

  const approvedThroughExistingUi = await approveOpsTask(
    fixture.prisma,
    created.item.id,
    { notes: 'Compared with PMS inventory.' },
    manager,
  )
  assert.equal(approvedThroughExistingUi.status, 'APPROVED')
  assert.equal(fixture.getTask(created.item.id).status, 'APPROVED')
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'TASK_QUEUED'), false)
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'AVAILABILITY_APPROVED'), true)

  const workerDecision = evaluateOpsTaskRun(fixture.getTask(created.item.id), admin, { enabled: false })
  assert.equal(workerDecision.allowed, false)
  assert.equal(workerDecision.manualOnly, true)
  assert.match(workerDecision.reason, /provider confirmation reference/i)

  await assert.rejects(
    () => markAvailabilityQueueItemSent(fixture.prisma, created.item.id, {}, manager),
    /Provider confirmation\/reference/,
  )
  const sent = await markAvailabilityQueueItemSent(
    fixture.prisma,
    created.item.id,
    { providerReference: 'AGODA-CONFIRM-1', notes: 'Updated in partner portal.' },
    manager,
  )
  assert.equal(sent.status, 'SUCCEEDED')
  assert.equal(sent.providerReference, 'AGODA-CONFIRM-1')

  const failureItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'trip',
    hotelId: 'TRIP-2',
    roomType: 'TWIN',
    startDate: '2026-07-16',
    endDate: '2026-07-17',
    availableRooms: 0,
    reason: 'Temporary reconciliation stop sell.',
  }, admin)
  const approvedFailureItem = await approveAvailabilityQueueItem(
    fixture.prisma,
    failureItem.item.id,
    { notes: 'Manager approved manual update.' },
    manager,
  )
  assert.equal(approvedFailureItem.status, 'APPROVED')
  const failed = await markAvailabilityQueueItemFailed(
    fixture.prisma,
    failureItem.item.id,
    { errorMessage: 'Provider portal unavailable.' },
    manager,
  )
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.errorMessage, 'Provider portal unavailable.')

  const cancelItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'booking',
    hotelId: 'BOOKING-3',
    roomType: 'DOUBLE',
    startDate: '2026-07-18',
    endDate: '2026-07-19',
    availableRooms: 2,
    reason: 'Prepare provider availability update.',
  }, admin)
  const cancelled = await cancelAvailabilityQueueItem(
    fixture.prisma,
    cancelItem.item.id,
    { reason: 'Superseded by a newer inventory calculation.' },
    manager,
  )
  assert.equal(cancelled.status, 'CANCELLED')

  const restrictedItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'expedia',
    hotelId: 'EXPEDIA-4',
    roomType: 'DOUBLE',
    startDate: '2026-07-20',
    endDate: '2026-07-21',
    availableRooms: 1,
    reason: 'Queue manager-reviewed availability.',
  }, frontDesk)
  await assert.rejects(
    () => approveAvailabilityQueueItem(fixture.prisma, restrictedItem.item.id, { notes: 'Forged approval.' }, frontDesk),
    /owner or authorized manager/,
  )
  await assert.rejects(
    () => listAvailabilityQueue(fixture.prisma, { status: 'NOT_A_STATUS' }),
    /status filter is invalid/,
  )
  const pending = await listAvailabilityQueue(fixture.prisma, { status: 'PENDING_APPROVAL' })
  assert.equal(pending.some((item) => item.id === restrictedItem.item.id), true)

  const intervals = []
  const syncCalls = []
  const scheduler = createHotelOpsScanScheduler({
    env: bookingEmailEnv(),
    prisma: {},
    listBookingSources: async () => [
      { id: 'source-success-1', mailbox: 'booking@example.com', provider: 'gmail', enabled: true },
      { id: 'source-failure', mailbox: 'forwarded@example.com', provider: 'forwarded-mailbox', enabled: true },
      { id: 'source-success-2', mailbox: 'secondary@example.com', provider: 'gmail', enabled: true },
      { id: 'source-manual', mailbox: 'manual@example.com', provider: 'manual', enabled: true },
    ],
    syncBooking: async (_db, input, actor) => {
      syncCalls.push({ input, actor })
      if (input.sourceId === 'source-failure') throw new Error('token=top-secret provider failure')
      if (input.sourceId === 'source-success-1') {
        return {
          events: [{ id: 'event-1' }, { id: 'event-2' }],
          opsCommandEvents: [{ id: 'event-1', rawText: '/ops read reservations' }],
        }
      }
      return { events: [{ id: 'event-3' }], opsCommandEvents: [] }
    },
    processEmailCommands: async () => [{ status: 'accepted' }],
    submitEmailCommand: async () => ({ task: { id: 'ops-1' } }),
    setIntervalFn: (callback, milliseconds) => {
      const handle = { callback, milliseconds, unref() {} }
      intervals.push(handle)
      return handle
    },
    clearIntervalFn: () => {},
    logger: { log() {}, error() {} },
    now: () => new Date('2026-07-10T12:00:00.000Z'),
  })

  const start = scheduler.start()
  assert.equal(start.started, false)
  assert.equal(start.backgroundStarted, true)
  assert.equal(start.bookingEmailStarted, true)
  assert.equal(start.status.bookingEmail.started, true)
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].milliseconds, 120_000)

  const syncResult = await scheduler.runBookingEmailOnce('test')
  assert.equal(syncResult.skipped, false)
  assert.equal(syncResult.importedCount, 3)
  assert.equal(syncResult.commandCount, 1)
  assert.equal(syncResult.errorCount, 1)
  assert.equal(syncResult.skippedSourceCount, 1)
  assert.deepEqual(syncCalls.map((call) => call.input.sourceId), ['source-success-1', 'source-failure', 'source-success-2'])
  assert.equal(syncCalls.every((call) => call.input.reviewOnly === true), true)
  assert.equal(syncCalls.every((call) => call.input.limit === 25), true)
  assert.equal(syncCalls.every((call) => call.actor.name === 'Near-live Booking Email Scheduler'), true)
  assert.equal(scheduler.getStatus().bookingEmail.status, 'PARTIAL')
  assert.equal(scheduler.getStatus().bookingEmail.lastSourceCount, 4)
  assert.equal(scheduler.getStatus().bookingEmail.lastSkippedSourceCount, 1)
  assert.doesNotMatch(scheduler.getStatus().bookingEmail.lastError || '', /top-secret/)
  assert.match(scheduler.getStatus().bookingEmail.lastError || '', /redacted/)

  scheduler.stop()
  assert.equal(scheduler.getStatus().bookingEmail.started, false)

  let releaseSlowSync
  const slowSync = new Promise((resolve) => { releaseSlowSync = resolve })
  const overlapScheduler = createHotelOpsScanScheduler({
    env: bookingEmailEnv(),
    prisma: {},
    listBookingSources: async () => [{ id: 'slow-source', mailbox: 'slow@example.com', provider: 'gmail', enabled: true }],
    syncBooking: async () => {
      await slowSync
      return { events: [], opsCommandEvents: [] }
    },
    processEmailCommands: async () => [],
    submitEmailCommand: async () => ({ task: { id: 'unused' } }),
    logger: { log() {}, error() {} },
  })
  const firstRun = overlapScheduler.runBookingEmailOnce('first')
  await new Promise((resolve) => setImmediate(resolve))
  const overlappingRun = await overlapScheduler.runBookingEmailOnce('second')
  assert.equal(overlappingRun.skipped, true)
  assert.equal(overlappingRun.reason, 'already_running')
  releaseSlowSync()
  await firstRun

  const policy = getChannelSyncV2Policy({ CHANNEL_MANAGER_PROVIDER: 'channex' })
  assert.equal(policy.outboundAvailability.mode, 'manual_queue')
  assert.equal(policy.outboundAvailability.autoDispatch, false)
  assert.equal(policy.trueTwoWay.zeroLagRequired, true)
  assert.equal(policy.trueTwoWay.channelOnlyProvider, 'channex')
  assert.deepEqual(policy.directApiApplications.map((item) => item.provider), ['agoda', 'trip'])

  console.log('Channel sync lite finalization tests passed.')
}

await run()
