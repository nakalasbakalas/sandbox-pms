/* global console, Response */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { buildIcalFeedForChannel, buildIcalFeedUrl, normalizeIcalProvider } from '../server/ical-feed.mjs'
import { approveOpsAlertRecommendation, approveOpsTask, buildOpsNotificationDrafts, buildOpsScanInsights, cancelOpsTask, denyOpsTask, evaluateOpsPermission, evaluateOpsTaskRun, getOpsScanPolicy, getOpsTask, hotelOpsTrendAlertFingerprint, listOpsApprovals, listOpsTasks, listOpsTrendAlerts, normalizeOpsSourceChannel, parseHotelOpsCommand, resolveOpsTrendAlert, runOpsScan, runQueuedOpsTask, setEmergencyStop, submitOpsCommand } from '../server/ops-service.mjs'
import { buildOpsWorkerTaskPayload, executeOpsWorkerTask } from '../server/ops-worker-client.mjs'
import { opsWorkerConfigured, runSignedMockOtaWorkerTask, signOpsWorkerRequest, verifyOpsWorkerRequest } from '../server/ops-worker-auth.mjs'
import { createBookingComAdapter, executeBookingComTask } from '../server/ota-adapters/booking-com.mjs'
import { createUser } from '../server/pms-service.mjs'

function createOpsCommandPrismaFixture() {
  const property = {
    id: 'property-ops-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    email: null,
    reservationAlertEmail: null,
  }
  const tasks = []
  const approvals = []
  const logs = []
  const audits = []
  const notifications = []
  const trendAlerts = []
  let stop = null
  let taskCounter = 0
  let approvalCounter = 0
  let logCounter = 0
  let auditCounter = 0
  let notificationCounter = 0

  const now = () => new Date('2026-06-30T00:00:00.000Z')
  const withTaskRelations = (task) => task ? {
    ...task,
    approvals: approvals.filter((approval) => approval.taskId === task.id),
    logs: logs.filter((log) => log.taskId === task.id),
    notifications: notifications.filter((notification) => notification.taskId === task.id),
  } : null

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where?.id === property.id || where?.code === property.code) return property
        return null
      },
    },
    hotelOpsEmergencyStop: {
      findUnique: async ({ where }) => where?.propertyId === property.id ? stop : null,
      upsert: async ({ create, update }) => {
        stop = { id: 'stop-ops-test', createdAt: now(), updatedAt: now(), ...(stop || create), ...update }
        return stop
      },
    },
    hotelOpsTask: {
      findUnique: async ({ where }) => withTaskRelations(tasks.find((task) => (
        (where?.id && task.id === where.id)
        || (where?.idempotencyKey && task.idempotencyKey === where.idempotencyKey)
      ))),
      findMany: async ({ where = {}, take } = {}) => {
        const results = tasks.filter((task) => (
          (!where.propertyId || task.propertyId === where.propertyId)
          && (!where.status || task.status === where.status)
        ))
        return results.slice(0, take || results.length).map(withTaskRelations)
      },
      create: async ({ data }) => {
        const task = {
          id: `ops-task-${++taskCounter}`,
          createdAt: now(),
          updatedAt: now(),
          proofScreenshots: null,
          executionSummary: null,
          errorCode: null,
          errorMessage: null,
          ...data,
        }
        tasks.push(task)
        return withTaskRelations(task)
      },
      update: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id)
        if (!task) return null
        Object.assign(task, data, { updatedAt: now() })
        return withTaskRelations(task)
      },
      updateMany: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id && (!where?.status || item.status === where.status))
        if (!task) return { count: 0 }
        Object.assign(task, data, { updatedAt: now() })
        return { count: 1 }
      },
    },
    hotelOpsTaskApproval: {
      findMany: async ({ where = {} } = {}) => {
        const propertyId = where.task?.is?.propertyId
        return approvals
          .filter((approval) => {
            const task = tasks.find((item) => item.id === approval.taskId)
            return (!where.status || approval.status === where.status)
              && (!propertyId || task?.propertyId === propertyId)
          })
          .map((approval) => ({
            ...approval,
            task: withTaskRelations(tasks.find((task) => task.id === approval.taskId)),
          }))
      },
      create: async ({ data }) => {
        const approval = {
          id: `ops-approval-${++approvalCounter}`,
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
      update: async ({ where, data }) => {
        const approval = approvals.find((item) => item.id === where?.id)
        if (!approval) return null
        Object.assign(approval, data)
        return approval
      },
    },
    hotelOpsTaskLog: {
      create: async ({ data }) => {
        const log = { id: `ops-log-${++logCounter}`, createdAt: now(), ...data }
        logs.push(log)
        return log
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const audit = { id: `ops-audit-${++auditCounter}`, createdAt: now(), ...data }
        audits.push(audit)
        return audit
      },
    },
    hotelOpsNotification: {
      create: async ({ data }) => {
        const notification = { id: `ops-notification-${++notificationCounter}`, createdAt: now(), ...data }
        notifications.push(notification)
        return notification
      },
    },
    hotelOpsTrendAlert: {
      findUnique: async ({ where }) => trendAlerts.find((alert) => alert.id === where?.id) || null,
      findMany: async ({ where = {}, take } = {}) => {
        const results = trendAlerts.filter((alert) => (
          (!where.propertyId || alert.propertyId === where.propertyId)
          && (!where.status || alert.status === where.status)
        ))
        return results.slice(0, take || results.length)
      },
      update: async ({ where, data }) => {
        const alert = trendAlerts.find((item) => item.id === where?.id)
        if (!alert) return null
        Object.assign(alert, data, { updatedAt: now() })
        return alert
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return { prisma, tasks, approvals, logs, audits, notifications, trendAlerts }
}

async function importTypeScriptModule(path) {
  const source = await readFile(path, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  }).outputText
  const output = transpiled
    .replaceAll("from './business-rules'", "from './business-rules.mjs'")
    .replaceAll("from './guards'", "from './guards.mjs'")
    .replaceAll("from '@/types/auth'", "from './auth.mjs'")
    .replaceAll("from '@/lib/hotel/business-rules'", "from './business-rules.mjs'")
    .replaceAll("from '@/lib/hotel/rooms'", "from './rooms.mjs'")
    .replaceAll("from '@/lib/front-desk-workflow'", "from './front-desk-workflow.mjs'")
    .replaceAll("from '@/lib/auth-mode'", "from './auth-mode.mjs'")
    .replaceAll("from '@/lib/server-auth-client'", "from './server-auth-client.mjs'")
  const tempDir = resolve('node_modules/.tmp/business-tests')
  await mkdir(tempDir, { recursive: true })
  const outputPath = resolve(tempDir, basename(path).replace(/\.(ts|tsx)$/, '.mjs'))
  await writeFile(outputPath, output, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

const rules = await importTypeScriptModule(resolve('src/lib/hotel/business-rules.ts'))
const status = await importTypeScriptModule(resolve('src/lib/hotel/status.ts'))
await importTypeScriptModule(resolve('src/lib/hotel/rooms.ts'))
const operations = await importTypeScriptModule(resolve('src/lib/hotel/operations.ts'))
const workflow = await importTypeScriptModule(resolve('src/lib/front-desk-workflow.ts'))
await importTypeScriptModule(resolve('src/types/auth.ts'))
const assistantGuards = await importTypeScriptModule(resolve('src/lib/assistant/guards.ts'))
const assistantIntents = await importTypeScriptModule(resolve('src/lib/assistant/intents.ts'))
const assistantTools = await importTypeScriptModule(resolve('src/lib/assistant/tools.ts'))
const authMode = await importTypeScriptModule(resolve('src/lib/auth-mode.ts'))
const serverAuthClient = await importTypeScriptModule(resolve('src/lib/server-auth-client.ts'))
const ical = await importTypeScriptModule(resolve('src/lib/ical.ts'))

assert.equal(rules.nightsBetween('2026-05-26', '2026-05-29'), 3, 'counts hotel nights with check-out exclusive')
assert.equal(rules.nightsBetween('2026-05-26', '2026-05-26'), 0, 'rejects zero-night stays')
assert.equal(rules.nightsBetween('2026-05-29', '2026-05-26'), 0, 'rejects negative stay ranges')
assert.equal(rules.getBangkokDateKey('2026-05-26T18:00:00.000Z'), '2026-05-27', 'hotel date keys use Asia/Bangkok')

assert.equal(
  rules.reservationsOverlap('2026-05-26', '2026-05-28', '2026-05-28', '2026-05-30'),
  false,
  'same-day check-out/check-in does not overbook',
)
assert.equal(
  rules.reservationsOverlap('2026-05-26', '2026-05-29', '2026-05-28', '2026-05-30'),
  true,
  'overlapping stay dates are detected',
)

const pricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-29',
  ratePerNight: 1000,
  adults: 3,
  childAges: [4, 8],
})
assert.equal(pricing.nights, 3)
assert.equal(pricing.roomSubtotal, 3000)
assert.equal(pricing.extraGuestFee, 900)
assert.equal(pricing.childFee, 900)
assert.equal(pricing.total, 4800)
assert.equal(pricing.taxInclusive, false)
assert.equal(pricing.isValidOccupancy, false, '3 adults plus 2 children exceeds max occupancy')

const childPricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  ratePerNight: 1500,
  adults: 2,
  childAges: [5, 8],
})
assert.equal(childPricing.childFee, 600, 'children 6-11 sharing bedding are charged per night')
assert.equal(childPricing.extraGuestFee, 0, 'child sharing fee does not double-charge as adult extra guest fee')

const invalidPricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  ratePerNight: -100,
  adults: 0,
  childAges: [-1],
})
assert.equal(invalidPricing.roomSubtotal, 0)
assert.equal(invalidPricing.warnings.includes('At least one adult is required.'), true)
assert.equal(invalidPricing.warnings.includes('Rate per night cannot be negative.'), true)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '201',
      status: 'VACANT_CLEAN',
      operationalStatus: 'AVAILABLE',
    },
    { checkIn: '2026-05-26', checkOut: '2026-05-27' },
  ),
  { assignable: true, reason: 'assignable' },
)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '201',
      status: 'OCCUPIED_CLEAN',
      operationalStatus: 'AVAILABLE',
      reservationId: 'res-1',
      checkIn: '2026-05-26',
      checkOut: '2026-05-29',
    },
    { checkIn: '2026-05-28', checkOut: '2026-05-30' },
  ),
  { assignable: false, reason: 'occupied' },
)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '216',
      status: 'VACANT_CLEAN',
      operationalStatus: 'OUT_OF_SERVICE',
    },
    { checkIn: '2026-05-26', checkOut: '2026-05-27' },
  ),
  { assignable: false, reason: 'out_of_order' },
)

const reservation = {
  id: 'res-1',
  status: 'CONFIRMED',
  guestName: 'Somchai Prasert',
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  assignedRoomId: 'room-201',
  roomNumber: '201',
  totalAmount: 3000,
  paidAmount: 1000,
}

const room = {
  roomId: 'room-201',
  number: '201',
  status: 'VACANT_CLEAN',
  operationalStatus: 'AVAILABLE',
  cleanStatus: 'INSPECTED',
}

assert.equal(operations.validateRoomAssignment(reservation, room).ok, true, 'room assignment allows clean inspected sellable rooms')
assert.equal(
  operations.validateRoomAssignment(reservation, { ...room, number: '216', operationalStatus: 'OUT_OF_SERVICE' }).message,
  'Room 216 is out of order and cannot be assigned.',
  'room assignment blocks out-of-service rooms',
)
assert.equal(
  operations.validateCheckIn(reservation, room, { now: '2026-05-25T18:30:00.000Z' }).ok,
  true,
  'check-in date validation uses the Thailand hotel date',
)

const checkIn = operations.applyCheckInTransition(reservation, room, 'Front desk', '2026-05-26T08:00:00.000Z')
assert.equal(checkIn.reservation.status, 'CHECKED_IN')
assert.equal(checkIn.room.status, 'OCCUPIED_CLEAN')
assert.equal(checkIn.room.reservationId, 'res-1')

assert.equal(
  operations.validateCheckOut({ ...checkIn.reservation, balanceDue: 200 }).message,
  'Collect or override the remaining balance before checkout.',
  'checkout requires settlement or override when a balance remains',
)

const checkOut = operations.applyCheckOutTransition({ ...checkIn.reservation, balanceDue: 0 }, checkIn.room)
assert.equal(checkOut.reservation.status, 'CHECKED_OUT')
assert.equal(checkOut.room.status, 'VACANT_DIRTY')
assert.equal(checkOut.room.cleanStatus, 'DIRTY')
assert.equal(checkOut.room.reservationId, undefined)

const cleaning = operations.transitionHousekeepingStatus(checkOut.room, 'CLEANING')
assert.equal(cleaning.room.cleanStatus, 'CLEANING')
assert.equal(cleaning.room.status, 'VACANT_DIRTY')
const inspected = operations.transitionHousekeepingStatus(cleaning.room, 'INSPECTED')
assert.equal(inspected.room.cleanStatus, 'INSPECTED')
assert.equal(inspected.room.status, 'VACANT_CLEAN')

const paymentSummary = operations.summarizePayments(1000.1 + 0.2, [500.15, 500.15])
assert.equal(paymentSummary.total, 1000.3)
assert.equal(paymentSummary.paid, 1000.3)
assert.equal(paymentSummary.status, 'paid')
assert.equal(operations.validatePaymentAmount(1200, 1000).message, 'Payment cannot exceed the remaining balance.')

const readyArrival = {
  id: 'arrival-ready',
  reservationId: 'res-ready',
  confirmationCode: 'SBX-READY',
  guestName: 'Ready Guest',
  roomNumber: '201',
  assignedRoomId: 'room-201',
  roomType: 'TWIN',
  checkInTime: '14:00',
  arrivalTime: '14:00',
  checkInDate: '2026-05-26',
  checkOutDate: '2026-05-28',
  nights: 2,
  adults: 2,
  children: 0,
  status: 'READY',
  reservationStatus: 'CONFIRMED',
  roomReady: true,
  depositPaid: true,
  documentVerified: true,
  guestNationality: 'Thai',
  guestIdNumber: '123456789',
  source: 'DIRECT',
  bookedRate: 1500,
  totalAmount: 3000,
  paidAmount: 3000,
  balanceDue: 0,
  paymentStatus: 'PAID',
}

const readyRoom = {
  roomId: 'room-201',
  number: '201',
  floor: 2,
  type: 'TWIN',
  status: 'VACANT_CLEAN',
  operationalStatus: 'AVAILABLE',
  isArrivalToday: true,
  isDepartureToday: false,
  isVIP: false,
  hasIssue: false,
  needsAttention: false,
  cleanStatus: 'INSPECTED',
  depositStatus: 'PAID',
}

const expressCheckIn = workflow.buildCheckInGuards(readyArrival, readyRoom, { hotelDateKey: '2026-05-26', role: 'front-desk' })
assert.equal(expressCheckIn.isExpressReady, true, 'prepared arrival is express check-in ready')
assert.equal(workflow.getArrivalPrimaryAction(expressCheckIn, readyArrival).label, 'Express Check-In')

const noRoomArrival = { ...readyArrival, assignedRoomId: undefined, roomNumber: undefined }
const noRoomCheckIn = workflow.buildCheckInGuards(noRoomArrival, undefined, { hotelDateKey: '2026-05-26' })
assert.equal(noRoomCheckIn.blockers.some((item) => item.id === 'no_room_assigned'), true, 'check-in is blocked without assigned room')
assert.equal(workflow.getArrivalPrimaryAction(noRoomCheckIn, noRoomArrival).label, 'Assign Room')

const dirtyCheckIn = workflow.buildCheckInGuards({ ...readyArrival, roomReady: false }, { ...readyRoom, status: 'VACANT_DIRTY', cleanStatus: 'DIRTY' }, { hotelDateKey: '2026-05-26' })
assert.equal(dirtyCheckIn.blockers.some((item) => item.id === 'room_not_ready'), true, 'dirty room blocks check-in')

const occupiedCheckIn = workflow.buildCheckInGuards(readyArrival, { ...readyRoom, status: 'OCCUPIED_CLEAN', currentReservationId: 'other-res' }, { hotelDateKey: '2026-05-26' })
assert.equal(occupiedCheckIn.blockers.some((item) => item.id === 'room_occupied'), true, 'occupied room blocks check-in')

const overCapacityCheckIn = workflow.buildCheckInGuards({ ...readyArrival, adults: 4, children: 1 }, readyRoom, { hotelDateKey: '2026-05-26' })
assert.equal(overCapacityCheckIn.blockers.some((item) => item.id === 'occupancy_exceeds_max'), true, 'over-capacity arrivals are blocked')

const paymentDueArrival = { ...readyArrival, balanceDue: 1000, paidAmount: 2000, paymentStatus: 'PARTIAL' }
const paymentDueCheckIn = workflow.buildCheckInGuards(paymentDueArrival, readyRoom, { hotelDateKey: '2026-05-26' })
assert.equal(paymentDueCheckIn.blockers.some((item) => item.id === 'payment_due'), true, 'payment due blocks express check-in')
assert.equal(workflow.getArrivalPrimaryAction(paymentDueCheckIn, paymentDueArrival).label, 'Collect Payment')

const outOfServiceCheckIn = workflow.buildCheckInGuards({ ...readyArrival, roomNumber: '216', assignedRoomId: 'room-216' }, { ...readyRoom, roomId: 'room-216', number: '216', operationalStatus: 'OUT_OF_SERVICE' }, { hotelDateKey: '2026-05-26' })
assert.equal(outOfServiceCheckIn.blockers.some((item) => item.id === 'room_out_of_order'), true, 'out-of-service rooms are blocked')

const departure = {
  id: 'dep-ready',
  reservationId: 'res-ready',
  confirmationCode: 'SBX-READY',
  guestName: 'Ready Guest',
  roomNumber: '201',
  assignedRoomId: 'room-201',
  roomType: 'TWIN',
  checkOutTime: '12:00',
  checkInDate: '2026-05-26',
  checkOutDate: '2026-05-28',
  nights: 2,
  status: 'IN_HOUSE',
  reservationStatus: 'CHECKED_IN',
  balanceDue: 0,
  paidAmount: 3000,
  folioTotal: 3000,
  folioStatus: 'CLOSED',
  paymentStatus: 'PAID',
  roomStatus: 'CLEAN',
}

const expressCheckOut = workflow.buildCheckOutGuards(departure, { hotelDateKey: '2026-05-28', now: new Date('2026-05-28T03:00:00.000Z') })
assert.equal(expressCheckOut.isExpressReady, true, 'settled departure is express checkout ready before standard checkout time')
assert.equal(workflow.getDeparturePrimaryAction(expressCheckOut, departure).label, 'Express Check-Out')

const balanceDeparture = { ...departure, balanceDue: 750, paymentStatus: 'PARTIAL' }
const balanceCheckout = workflow.buildCheckOutGuards(balanceDeparture, { hotelDateKey: '2026-05-28', now: new Date('2026-05-28T03:00:00.000Z') })
assert.equal(balanceCheckout.blockers.some((item) => item.id === 'unsettled_balance'), true, 'checkout is blocked by outstanding balance')
assert.equal(workflow.getDeparturePrimaryAction(balanceCheckout, balanceDeparture).label, 'Settle Balance')

const duplicateCheckout = workflow.buildCheckOutGuards({ ...departure, status: 'CHECKED_OUT', reservationStatus: 'CHECKED_OUT' }, { hotelDateKey: '2026-05-28' })
assert.equal(duplicateCheckout.blockers.some((item) => item.id === 'already_checked_out'), true, 'duplicate checkout is blocked')

const readinessSummary = workflow.buildRoomReadinessSummary([
  readyRoom,
  { ...readyRoom, roomId: 'room-202', number: '202', cleanStatus: 'DIRTY', status: 'VACANT_DIRTY' },
  { ...readyRoom, roomId: 'room-203', number: '203', status: 'OCCUPIED_CLEAN', currentReservationId: 'res-203' },
  { ...readyRoom, roomId: 'room-216', number: '216', operationalStatus: 'OUT_OF_SERVICE' },
])
assert.equal(readinessSummary.cleanInspected, 1, 'readiness strip counts ready rooms')
assert.equal(readinessSummary.dirty, 1, 'readiness strip counts dirty rooms')
assert.equal(readinessSummary.occupied, 1, 'readiness strip counts occupied rooms')
assert.equal(readinessSummary.outOfOrder, 1, 'readiness strip counts out-of-service rooms')

assert.equal(status.getStatusDefinition('room', 'VACANT_DIRTY').label.th, 'รอทำความสะอาด')
assert.equal(status.getStatusDefinition('payment', 'PAID').label.en, 'Paid')
assert.equal(status.getStatusDefinition('reservation', 'NO_SHOW').label.th, 'ไม่มาเข้าพัก')
assert.equal(status.getStatusDefinition('room', 'BLOCKED').label.th, 'ปิดใช้งาน')

assert.equal(authMode.SERVER_AUTH_ENABLED, false, 'test environment does not enable server auth by default')
assert.equal(authMode.LOCAL_AUTH_FALLBACK_ENABLED, false, 'test environment does not enable local auth fallback by default')

const mappedUser = serverAuthClient.mapServerUser({
  id: 'user-1',
  email: 'frontdesk@property.test',
  username: 'frontdesk@property.test',
  role: 'FRONT_DESK',
  displayName: 'Front Desk',
})
assert.equal(mappedUser.email, 'frontdesk@property.test', 'server auth users are email-based')
assert.equal(mappedUser.role, 'front-desk', 'server auth users map backend roles to UI roles')

const mappedUsernameOnlyUser = serverAuthClient.mapServerUser({
  id: 'user-2',
  email: null,
  username: 'hk1',
  role: 'HOUSEKEEPING',
  displayName: 'Housekeeper 1',
})
assert.equal(mappedUsernameOnlyUser.email, null, 'server auth users can omit email')
assert.equal(mappedUsernameOnlyUser.username, 'hk1', 'server auth users use username as login identifier')
assert.equal(mappedUsernameOnlyUser.role, 'housekeeping', 'username-only server auth users map backend roles')

const createdAudits = []
const usernameOnlyUser = await createUser({
  user: {
    findFirst: async (query) => {
      assert.deepEqual(query.where.OR, [{ username: 'hk2' }], 'username-only user duplicate check does not require email')
      return null
    },
    create: async ({ data }) => ({
      id: 'user-hk2',
      createdAt: new Date('2026-06-30T00:00:00.000Z'),
      ...data,
    }),
  },
  auditLog: {
    create: async ({ data }) => {
      createdAudits.push(data)
      return data
    },
  },
}, {
  username: 'hk2',
  email: '',
  password: 'Temporary1234!',
  displayName: 'Housekeeper 2',
  role: 'housekeeping',
}, { id: 'admin-1', username: 'admin' })
assert.equal(usernameOnlyUser.username, 'hk2', 'admin can create a username-only server user')
assert.equal(usernameOnlyUser.email, null, 'username-only server user stores null email')
assert.equal(usernameOnlyUser.role, 'HOUSEKEEPING', 'username-only server user role normalizes to backend enum')
assert.equal(createdAudits[0]?.action, 'USER_CREATED', 'username-only server user creation is audited')

const nullEmailUserAudits = []
const nullEmailUser = await createUser({
  user: {
    findFirst: async (query) => {
      assert.deepEqual(query.where.OR, [{ username: 'fd3' }], 'null-email user duplicate check does not require email')
      return null
    },
    create: async ({ data }) => ({
      id: 'user-fd3',
      createdAt: new Date('2026-06-30T00:00:00.000Z'),
      ...data,
    }),
  },
  auditLog: {
    create: async ({ data }) => {
      nullEmailUserAudits.push(data)
      return data
    },
  },
}, {
  username: 'fd3',
  email: null,
  password: 'Temporary1234!',
  displayName: 'Front Desk 3',
  role: 'front-desk',
}, { id: 'admin-1', username: 'admin' })
assert.equal(nullEmailUser.username, 'fd3', 'admin UI null-email payload creates a username-only server user')
assert.equal(nullEmailUser.email, null, 'null-email server user stores null email')
assert.equal(nullEmailUser.role, 'FRONT_DESK', 'null-email server user role normalizes to backend enum')
assert.equal(nullEmailUserAudits[0]?.action, 'USER_CREATED', 'null-email server user creation is audited')

const notificationDrafts = buildOpsNotificationDrafts({
  id: 'property-1',
  reservationAlertEmail: 'ops@property.test',
}, {
  type: 'APPROVAL_REQUEST',
  taskId: 'task-1',
  recipientRole: 'OWNER',
  title: 'Approval required',
  summary: 'Rate update needs owner approval.',
  actionPath: '/ops/approvals',
})
assert.equal(notificationDrafts.length, 2, 'Hotel Ops notification abstraction records in-app plus email intent when alert email exists')
assert.equal(notificationDrafts[0].channel, 'IN_APP', 'Hotel Ops notification records in-app delivery')
assert.equal(notificationDrafts[0].status, 'SENT', 'Hotel Ops in-app notification is immediately available')
assert.equal(notificationDrafts[1].channel, 'EMAIL', 'Hotel Ops notification records email channel intent')
assert.equal(notificationDrafts[1].status, 'PENDING_PROVIDER', 'Hotel Ops does not fake email delivery without a provider')
assert.equal(notificationDrafts[1].recipientAddress, 'ops@property.test', 'Hotel Ops email intent targets the property alert email')

const redactedNotificationDrafts = buildOpsNotificationDrafts({
  id: 'property-1',
  reservationAlertEmail: null,
}, {
  type: 'TASK_UPDATE',
  taskId: 'task-secret',
  title: 'password=title-secret',
  summary: 'Worker response token=summary-secret',
  metadata: {
    apiKey: 'metadata-secret',
    nested: {
      password: 'nested-secret',
      note: 'safe note',
    },
  },
})
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('title-secret'), false, 'Hotel Ops notifications redact credential-like title text')
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('summary-secret'), false, 'Hotel Ops notifications redact credential-like summary text')
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('metadata-secret'), false, 'Hotel Ops notifications redact credential-like metadata values')
assert.equal(redactedNotificationDrafts[0].metadata.nested.note, 'safe note', 'Hotel Ops notification metadata keeps safe operational context')

const signedWorkerBody = {
  taskId: 'task-1',
  taskType: 'UPDATE_RATE',
  platform: 'agoda',
  hotelId: 'SANDBOX',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
}
const signedWorkerRequest = signOpsWorkerRequest(signedWorkerBody, {
  secret: 'shared-worker-secret',
  timestamp: 1_000_000,
  nonce: 'business-test-nonce',
})
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body, headers: signedWorkerRequest.headers, secret: 'shared-worker-secret', now: 1_000_000 }).ok,
  true,
  'Hotel Ops signed worker requests verify with shared secret',
)
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body, headers: {}, secret: 'shared-worker-secret', now: 1_000_000 }).statusCode,
  401,
  'Hotel Ops worker rejects unsigned requests',
)
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body.replace('UPDATE_RATE', 'READ_RATES'), headers: signedWorkerRequest.headers, secret: 'shared-worker-secret', now: 1_000_000 }).ok,
  false,
  'Hotel Ops worker rejects tampered signed payloads',
)
const replayedWorkerRequest = verifyOpsWorkerRequest({
  body: signedWorkerRequest.body,
  headers: signedWorkerRequest.headers,
  secret: 'shared-worker-secret',
  now: 1_000_001,
})
assert.equal(replayedWorkerRequest.statusCode, 401, 'Hotel Ops worker rejects replayed signed requests')
assert.equal(replayedWorkerRequest.error.includes('nonce'), true, 'Hotel Ops worker replay rejection names the nonce boundary')
const signedMockWorkerResult = runSignedMockOtaWorkerTask(JSON.parse(signedWorkerRequest.body))
assert.equal(signedMockWorkerResult.status, 'SUCCEEDED', 'Hotel Ops signed mock worker returns structured result')
assert.equal(signedMockWorkerResult.data.dryRun, true, 'Hotel Ops signed mock worker stays in dry-run by default')
assert.throws(
  () => runSignedMockOtaWorkerTask({ taskId: 'task-2', taskType: 'FORBIDDEN', platform: 'agoda' }),
  /not allowed/,
  'Hotel Ops worker rejects disallowed task types',
)
assert.throws(
  () => runSignedMockOtaWorkerTask({ taskId: 'task-3', taskType: 'READ_RATES', platform: 'agoda', password: 'never' }),
  /credential field/,
  'Hotel Ops worker payload rejects credential fields',
)
assert.equal(
  opsWorkerConfigured({ OTA_WORKER_BASE_URL: 'http://localhost:8788', OTA_WORKER_SHARED_SECRET: 'secret' }),
  true,
  'Hotel Ops worker config honors package environment variable names',
)
assert.equal(
  opsWorkerConfigured({ OTA_WORKER_URL: 'http://localhost:8788', OTA_WORKER_SECRET: 'secret' }),
  true,
  'Hotel Ops worker config remains compatible with legacy environment variable names',
)
const manualScanPolicy = getOpsScanPolicy({})
assert.equal(manualScanPolicy.schedule.mode, 'manual', 'Hotel Ops scan policy reports manual mode when no schedule is configured')
assert.equal(manualScanPolicy.schedule.configured, false, 'Hotel Ops scan policy does not fake an automatic schedule')
assert.equal(manualScanPolicy.thresholds.highDemandOccupancy, 0.7, 'Hotel Ops scan policy exposes high-demand occupancy threshold')
assert.equal(manualScanPolicy.thresholds.cancellationSpikeMultiplier, 2, 'Hotel Ops scan policy exposes cancellation spike multiplier')
assert.equal(manualScanPolicy.thresholds.strongRoomOccupancyMin, 0.75, 'Hotel Ops scan policy exposes strong room-type occupancy threshold')
assert.equal(manualScanPolicy.thresholds.weakRoomOccupancyMax, 0.35, 'Hotel Ops scan policy exposes weak room-type occupancy threshold')
const cronScanPolicy = getOpsScanPolicy({ HOTEL_OPS_SCAN_CRON: '*/15 * * * *' })
assert.equal(cronScanPolicy.schedule.mode, 'cron', 'Hotel Ops scan policy reports configured cron schedule')
assert.equal(cronScanPolicy.schedule.cron, '*/15 * * * *', 'Hotel Ops scan policy exposes cron expression without secrets')
const intervalScanPolicy = getOpsScanPolicy({ HOTEL_OPS_SCAN_INTERVAL_MINUTES: '30' })
assert.equal(intervalScanPolicy.schedule.mode, 'interval', 'Hotel Ops scan policy reports configured interval schedule')
assert.equal(intervalScanPolicy.schedule.intervalMinutes, 30, 'Hotel Ops scan policy exposes interval minutes')

const unauthenticatedBookingAdapter = createBookingComAdapter({
  env: {},
  now: '2026-06-30T00:00:00.000Z',
})
const unauthenticatedBookingHealth = await unauthenticatedBookingAdapter.healthCheck()
assert.equal(unauthenticatedBookingHealth.authenticated, false, 'Booking.com adapter reports missing server credentials')
assert.equal(unauthenticatedBookingHealth.requiresHuman, true, 'Booking.com adapter requests human setup when credentials are missing')
assert.equal(JSON.stringify(unauthenticatedBookingHealth).includes('booking-password'), false, 'Booking.com adapter health does not expose credential values')

const bookingAdapter = createBookingComAdapter({
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
const bookingAuth = await bookingAdapter.ensureAuthenticated()
assert.equal(bookingAuth.authenticated, true, 'Booking.com adapter can authenticate in dry-run mode when server credentials exist')
const bookingDryRunRate = await bookingAdapter.updateRate({
  taskId: 'booking-task-1',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  amount: 2200,
  currency: 'THB',
  dryRun: true,
})
assert.equal(bookingDryRunRate.changed, false, 'Booking.com dry-run rate update does not mutate OTA state')
assert.equal(bookingDryRunRate.proofScreenshots.length, 2, 'Booking.com dry-run write records before/after proof placeholders')
assert.equal(bookingDryRunRate.proofScreenshots.every((item) => item.redactionStatus === 'SAFE'), true, 'Booking.com dry-run proof placeholders are marked safe')
assert.equal(JSON.stringify(bookingDryRunRate).includes('booking-password'), false, 'Booking.com dry-run result does not include OTA credentials')
await assert.rejects(
  () => bookingAdapter.updateRate({
    taskId: 'booking-task-2',
    roomType: 'Deluxe Room',
    dateStart: '2026-07-03',
    dateEnd: '2026-07-04',
    amount: 2200,
    currency: 'THB',
    dryRun: false,
  }),
  /real Booking\.com browser writes are not implemented/,
  'Booking.com adapter rejects non-dry-run writes until selectors are verified',
)
const bookingHumanTask = await executeBookingComTask({
  taskId: 'booking-task-3',
  taskType: 'UPDATE_RATE',
  platform: 'booking',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
    BOOKING_FORCE_HUMAN_CHALLENGE: 'CAPTCHA',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingHumanTask.status, 'NEEDS_HUMAN', 'Booking.com adapter returns NEEDS_HUMAN for CAPTCHA instead of bypassing it')
assert.equal(bookingHumanTask.errorCode, 'NEEDS_HUMAN_CAPTCHA', 'Booking.com adapter preserves the human challenge reason')

const bookingDraftReply = await executeBookingComTask({
  taskId: 'booking-task-4',
  taskType: 'DRAFT_GUEST_REPLY',
  platform: 'booking',
  message: 'Late check-in is confirmed.',
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingDraftReply.status, 'SUCCEEDED', 'Booking.com adapter supports draft guest replies in dry-run mode')
assert.equal(bookingDraftReply.proofScreenshots.length, 1, 'Booking.com draft guest reply records trace proof')
assert.equal(JSON.stringify(bookingDraftReply).includes('booking-password'), false, 'Booking.com draft reply result does not expose credentials')

const bookingSendReply = await executeBookingComTask({
  taskId: 'booking-task-5',
  taskType: 'SEND_GUEST_REPLY',
  platform: 'booking',
  message: 'Door code password=guest-secret',
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingSendReply.status, 'SUCCEEDED', 'Booking.com adapter supports approved send guest replies in dry-run mode')
assert.equal(bookingSendReply.proofScreenshots.length, 2, 'Booking.com send guest reply records before/after proof placeholders')
assert.equal(JSON.stringify(bookingSendReply).includes('guest-secret'), false, 'Booking.com send reply dry-run result redacts credential-like message text')

const workerTask = {
  id: 'ops-task-1',
  taskType: 'UPDATE_RATE',
  platform: 'booking',
  hotelId: 'SANDBOX',
  roomType: 'Deluxe Room',
  dateStart: new Date('2026-07-03T00:00:00.000Z'),
  dateEnd: new Date('2026-07-04T00:00:00.000Z'),
  rateAmount: 2200,
  rateCurrency: 'THB',
  availabilityRooms: null,
  availabilityStatus: null,
  rawMessage: 'Change Booking Deluxe Room to 2,200 THB.',
}
const workerPayload = buildOpsWorkerTaskPayload(workerTask)
assert.equal(workerPayload.taskId, 'ops-task-1', 'Hotel Ops executor builds a worker task id')
assert.equal(workerPayload.rate.amount, 2200, 'Hotel Ops executor maps rate amount into worker payload')
assert.equal(JSON.stringify(workerPayload).includes(workerTask.rawMessage), false, 'Hotel Ops executor does not send raw free text to worker')
assert.equal(JSON.stringify(workerPayload).includes('password'), false, 'Hotel Ops executor payload contains no credential fields')

const messageWorkerPayload = buildOpsWorkerTaskPayload({
  ...workerTask,
  id: 'ops-task-message',
  taskType: 'SEND_GUEST_REPLY',
  message: 'Late check-in is confirmed.',
  rawMessage: 'Send guest reply: Late check-in is confirmed.',
})
assert.equal(messageWorkerPayload.message, 'Late check-in is confirmed.', 'Hotel Ops executor carries structured guest reply message text')
assert.equal(JSON.stringify(messageWorkerPayload).includes('Send guest reply:'), false, 'Hotel Ops executor does not send raw guest reply command text')

const localWorkerResult = await executeOpsWorkerTask(workerTask, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
})
assert.equal(localWorkerResult.workerMode, 'local-signed-worker', 'Hotel Ops executor uses local signed worker fallback when no worker URL is configured')
assert.equal(localWorkerResult.status, 'SUCCEEDED', 'Hotel Ops executor local worker returns structured success')
assert.equal(localWorkerResult.proofScreenshots.length, 2, 'Hotel Ops executor stores Booking.com dry-run proof placeholders')
assert.equal(JSON.stringify(localWorkerResult).includes('booking-password'), false, 'Hotel Ops executor never returns OTA credentials')

const localReplyWorkerResult = await executeOpsWorkerTask({
  ...workerTask,
  id: 'ops-task-reply',
  taskType: 'SEND_GUEST_REPLY',
  message: 'Late check-in is confirmed.',
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
})
assert.equal(localReplyWorkerResult.status, 'SUCCEEDED', 'Hotel Ops executor local worker handles Booking.com guest reply dry-run tasks')
assert.equal(localReplyWorkerResult.proofScreenshots.length, 2, 'Hotel Ops executor stores reply before/after proof placeholders')

let remoteWorkerRequestChecked = false
const remoteWorkerResult = await executeOpsWorkerTask({
  ...workerTask,
  id: 'ops-task-remote',
  platform: 'agoda',
}, {
  env: {
    OTA_WORKER_BASE_URL: 'https://worker.example.test/tasks',
    OTA_WORKER_SHARED_SECRET: 'remote-worker-secret',
  },
  fetchImpl: async (url, request) => {
    assert.equal(url, 'https://worker.example.test/tasks', 'Hotel Ops executor posts to configured worker URL')
    const verification = verifyOpsWorkerRequest({
      body: request.body,
      headers: request.headers,
      secret: 'remote-worker-secret',
      now: Number(request.headers['x-ops-worker-timestamp']),
    })
    assert.equal(verification.ok, true, 'Hotel Ops executor signs remote worker requests')
    assert.equal(request.body.includes(workerTask.rawMessage), false, 'Hotel Ops remote worker body omits raw command text')
    remoteWorkerRequestChecked = true
    return new Response(JSON.stringify({
      ok: true,
      data: {
        taskId: 'ops-task-remote',
        status: 'SUCCEEDED',
        summary: 'Remote worker accepted task.',
        proofScreenshots: [],
        data: { dryRun: true },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert.equal(remoteWorkerRequestChecked, true, 'Hotel Ops executor exercised the remote signed worker path')
assert.equal(remoteWorkerResult.workerMode, 'remote-signed-worker', 'Hotel Ops executor labels remote worker results')
assert.equal(remoteWorkerResult.signed, true, 'Hotel Ops executor records signed worker execution')

const fixedOpsDate = new Date('2026-06-30T00:00:00.000Z')
const rateCommand = parseHotelOpsCommand('Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(rateCommand.taskType, 'UPDATE_RATE', 'Hotel Ops parser recognizes rate updates')
assert.equal(rateCommand.platform, 'agoda', 'Hotel Ops parser detects Agoda platform')
assert.equal(rateCommand.riskLevel, 'HIGH', 'Hotel Ops rate updates are high risk')
assert.equal(rateCommand.approvalRequired, true, 'Hotel Ops rate updates require approval')
assert.equal(rateCommand.dateRange.start, '2026-07-03', 'Hotel Ops parser resolves this Friday')
assert.equal(rateCommand.dateRange.end, '2026-07-04', 'Hotel Ops parser resolves Saturday')

const scanCommand = parseHotelOpsCommand('Check bookings for next weekend.', { now: fixedOpsDate })
assert.equal(['READ_RESERVATIONS', 'SCAN_BOOKINGS'].includes(scanCommand.taskType), true, 'Hotel Ops parser maps booking checks to read-only tasks')
assert.equal(scanCommand.riskLevel, 'LOW', 'Hotel Ops booking scans are low risk')
assert.equal(scanCommand.approvalRequired, false, 'Hotel Ops booking scans do not require owner approval')

const readAvailabilityCommand = parseHotelOpsCommand('Check Booking Deluxe Room availability this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(readAvailabilityCommand.taskType, 'READ_AVAILABILITY', 'Hotel Ops parser maps availability checks to read-only tasks')
assert.equal(readAvailabilityCommand.roomType, 'Deluxe Room', 'Hotel Ops availability check keeps the room type')
assert.equal(readAvailabilityCommand.riskLevel, 'LOW', 'Hotel Ops availability checks are low risk')

const availabilityCommand = parseHotelOpsCommand('Set Booking Deluxe Room availability to 3 rooms this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(availabilityCommand.taskType, 'UPDATE_AVAILABILITY', 'Hotel Ops parser maps availability changes to update tasks')
assert.equal(availabilityCommand.platform, 'booking', 'Hotel Ops availability parser detects Booking platform')
assert.equal(availabilityCommand.availability.rooms, 3, 'Hotel Ops availability parser extracts rooms available')
assert.equal(availabilityCommand.availability.status, 'open', 'Hotel Ops availability parser marks positive rooms as open')
assert.equal(availabilityCommand.approvalRequired, true, 'Hotel Ops availability updates require approval')

const ambiguousAvailabilityCommand = parseHotelOpsCommand('Set Booking availability to 3 rooms.', { now: fixedOpsDate })
assert.equal(ambiguousAvailabilityCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser requests clarification for incomplete availability updates')
assert.equal(ambiguousAvailabilityCommand.missingFields.includes('roomType'), true, 'Hotel Ops incomplete availability update asks for room type')
assert.equal(ambiguousAvailabilityCommand.missingFields.includes('dateRange'), true, 'Hotel Ops incomplete availability update asks for dates')

const guestMessagesCommand = parseHotelOpsCommand('Read guest messages from Booking.com.', { now: fixedOpsDate })
assert.equal(guestMessagesCommand.taskType, 'READ_GUEST_MESSAGES', 'Hotel Ops parser maps guest message reads to read-only message tasks')
assert.equal(guestMessagesCommand.riskLevel, 'LOW', 'Hotel Ops guest message reads are low risk')

const draftReplyCommand = parseHotelOpsCommand('Draft Booking guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(draftReplyCommand.taskType, 'DRAFT_GUEST_REPLY', 'Hotel Ops parser maps draft reply commands')
assert.equal(evaluateOpsPermission(draftReplyCommand, { id: 'viewer', role: 'VIEWER' }).allowed, false, 'Hotel Ops viewer role cannot create draft reply tasks')
assert.equal(evaluateOpsPermission(draftReplyCommand, { id: 'contractor', role: 'CONTRACTOR' }).allowed, false, 'Hotel Ops unknown roles default to viewer permissions')

const sendReplyCommand = parseHotelOpsCommand('Send Booking guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(sendReplyCommand.taskType, 'SEND_GUEST_REPLY', 'Hotel Ops parser maps explicit send reply commands')
assert.equal(sendReplyCommand.platform, 'booking', 'Hotel Ops send reply parser requires and keeps the target platform')
assert.equal(sendReplyCommand.approvalRequired, true, 'Hotel Ops send reply tasks require approval')
assert.equal(sendReplyCommand.message, 'Late check-in is confirmed.', 'Hotel Ops parser extracts structured guest reply text')
const sendReplyDecision = evaluateOpsPermission(sendReplyCommand, { id: 'manager', role: 'MANAGER' })
assert.equal(sendReplyDecision.requiredApprovalRole, 'OWNER', 'Hotel Ops send-reply writes require owner approval by default')

const missingPlatformReplyCommand = parseHotelOpsCommand('Send guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(missingPlatformReplyCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser asks for platform before send-reply writes')
assert.equal(missingPlatformReplyCommand.missingFields.includes('platform'), true, 'Hotel Ops send-reply write asks for platform')

const redactedReplyCommand = parseHotelOpsCommand('Send Booking guest reply: password=guest-secret', { now: fixedOpsDate })
assert.equal(redactedReplyCommand.message.includes('guest-secret'), false, 'Hotel Ops parser redacts credential-like text from structured messages')

const forbiddenCommand = parseHotelOpsCommand('Cancel all bookings and refund guests.', { now: fixedOpsDate })
assert.equal(forbiddenCommand.taskType, 'FORBIDDEN', 'Hotel Ops parser blocks destructive booking/refund command')
assert.equal(evaluateOpsPermission(forbiddenCommand, { id: 'owner', role: 'ADMIN' }).allowed, false, 'Hotel Ops forbidden commands cannot execute')
const criticalForbiddenCommands = [
  'Issue a refund for Booking reservation ABC123.',
  'Change the Booking cancellation policy to non-refundable.',
  'Update the Expedia payment policy.',
  'Delete the Agoda listing.',
  'Run arbitrary browser command on Booking.com.',
  'Access an unauthorized OTA account.',
]
for (const forbiddenText of criticalForbiddenCommands) {
  const parsedForbidden = parseHotelOpsCommand(forbiddenText, { now: fixedOpsDate })
  assert.equal(parsedForbidden.taskType, 'FORBIDDEN', `Hotel Ops parser blocks prohibited command: ${forbiddenText}`)
  assert.equal(evaluateOpsPermission(parsedForbidden, { id: 'owner', role: 'ADMIN' }).allowed, false, `Hotel Ops permission guard blocks prohibited command: ${forbiddenText}`)
}

const ambiguousRateCommand = parseHotelOpsCommand('Raise Booking price to 3000.', { now: fixedOpsDate })
assert.equal(ambiguousRateCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser requests clarification for incomplete rate command')
assert.equal(ambiguousRateCommand.missingFields.includes('dateRange'), true, 'Hotel Ops incomplete rate command asks for dates')
assert.equal(ambiguousRateCommand.missingFields.includes('roomType'), true, 'Hotel Ops incomplete rate command asks for room type')

const missingPlatformRateCommand = parseHotelOpsCommand('Set Deluxe Room to 2,200 THB 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(missingPlatformRateCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser asks for platform before rate writes')
assert.equal(missingPlatformRateCommand.missingFields.includes('platform'), true, 'Hotel Ops incomplete rate write asks for platform')

const allRoomsRateCommand = parseHotelOpsCommand('Set all channels all rooms to 2,200 THB 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(allRoomsRateCommand.taskType, 'UPDATE_RATE', 'Hotel Ops parser accepts all-room recommendation tasks')
assert.equal(allRoomsRateCommand.platform, 'all', 'Hotel Ops parser accepts explicit all-channel writes')
assert.equal(allRoomsRateCommand.roomType, 'All Rooms', 'Hotel Ops parser preserves all-room target')

const photoUpdateCommand = parseHotelOpsCommand('Update Booking listing photos.', { now: fixedOpsDate })
assert.equal(photoUpdateCommand.taskType, 'UPDATE_PHOTOS', 'Hotel Ops parser maps photo changes to the critical disabled photo task')
assert.equal(photoUpdateCommand.platform, 'booking', 'Hotel Ops photo parser detects the target platform')
assert.equal(photoUpdateCommand.riskLevel, 'CRITICAL', 'Hotel Ops photo updates are critical risk')
const photoUpdateDecision = evaluateOpsPermission(photoUpdateCommand, { id: 'owner', role: 'ADMIN' })
assert.equal(photoUpdateDecision.allowed, false, 'Hotel Ops permission guard blocks disabled photo changes in the MVP')
assert.equal(photoUpdateDecision.requiredApprovalRole, 'OWNER', 'Hotel Ops disabled photo changes still identify owner approval role')

assert.equal(normalizeOpsSourceChannel('LINE'), 'line', 'Hotel Ops source channel normalization accepts known channels case-insensitively')
assert.throws(
  () => normalizeOpsSourceChannel('browser-extension'),
  /source channel is not allowed/,
  'Hotel Ops source channel normalization rejects unsupported channels before Prisma writes',
)

const managerDecision = evaluateOpsPermission(rateCommand, { id: 'manager', role: 'MANAGER' })
assert.equal(managerDecision.allowed, true, 'Hotel manager can submit high-risk Hotel Ops task')
assert.equal(managerDecision.approvalRequired, true, 'Hotel manager high-risk Hotel Ops task still needs owner approval')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, false, 'staff cannot create high-risk Hotel Ops write task')
assert.equal(evaluateOpsPermission({ ...rateCommand, platform: 'unknown' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops permission guard rejects write tasks without a supported platform')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'owner', role: 'ADMIN' }, { enabled: true }).blockedByEmergencyStop, true, 'Hotel Ops emergency stop blocks write tasks')
assert.equal(evaluateOpsPermission(readAvailabilityCommand, { id: 'viewer', role: 'VIEWER' }).allowed, true, 'Hotel Ops viewer role can still create allowed read-only availability checks')

const opsCommandFixture = createOpsCommandPrismaFixture()
const opsManager = { id: 'manager-ops-test', role: 'MANAGER', name: 'Ops Manager' }
const opsOwner = { id: 'owner-ops-test', role: 'ADMIN', name: 'Owner' }
const queuedScanResult = await submitOpsCommand(
  opsCommandFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web', idempotencyKey: 'ops-command-scan-test' },
  opsManager,
)
assert.equal(queuedScanResult.task.status, 'QUEUED', 'Hotel Ops service queues low-risk scan commands')
assert.equal(opsCommandFixture.tasks.length, 1, 'Hotel Ops service persists one task for a new command')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'COMMAND_RECEIVED'), true, 'Hotel Ops service logs command receipt')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'PARSER_OUTPUT'), true, 'Hotel Ops service logs parser output')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'VALIDATION_PASSED'), true, 'Hotel Ops service logs validation pass decisions')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'TASK_QUEUED'), true, 'Hotel Ops service logs queueing')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_COMMAND_RECEIVED'), true, 'Hotel Ops service audits command receipt')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'SCAN_BOOKINGS'), true, 'Hotel Ops service audits parser output')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_VALIDATION_PASSED'), true, 'Hotel Ops service audits validation pass decisions')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION'), true, 'Hotel Ops service audits permission decisions')
assert.equal(opsCommandFixture.notifications.some((notification) => notification.type === 'TASK_UPDATE'), true, 'Hotel Ops service records queue notifications')

const duplicateScanResult = await submitOpsCommand(
  opsCommandFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web', idempotencyKey: 'ops-command-scan-test' },
  opsManager,
)
assert.equal(duplicateScanResult.duplicate, true, 'Hotel Ops service marks repeated command idempotency keys as duplicate')
assert.equal(duplicateScanResult.task.id, queuedScanResult.task.id, 'Hotel Ops duplicate commands return the existing task')
assert.equal(opsCommandFixture.tasks.length, 1, 'Hotel Ops duplicate command idempotency does not create another task')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'IDEMPOTENT_REPLAY'), true, 'Hotel Ops duplicate command replay is logged')

const approvalFixture = createOpsCommandPrismaFixture()
const pendingRateResult = await submitOpsCommand(
  approvalFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'line' },
  opsManager,
)
assert.equal(pendingRateResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops service holds high-risk rate changes for approval')
assert.equal(approvalFixture.approvals.length, 1, 'Hotel Ops service creates an approval record for high-risk commands')
assert.equal(approvalFixture.approvals[0].requiredRole, 'OWNER', 'Hotel Ops rate updates require owner approval')
assert.equal(approvalFixture.notifications.some((notification) => notification.type === 'APPROVAL_REQUEST'), true, 'Hotel Ops service records approval request notifications')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REQUESTED'), true, 'Hotel Ops service audits approval requests')

approvalFixture.tasks.push({
  ...approvalFixture.tasks[0],
  id: 'foreign-ops-task',
  propertyId: 'property-foreign',
  requesterUserId: 'foreign-manager',
  requesterLabel: 'Foreign Manager',
  idempotencyKey: 'foreign-property-rate-change',
  status: 'PENDING_APPROVAL',
})
approvalFixture.approvals.push({
  ...approvalFixture.approvals[0],
  id: 'foreign-ops-approval',
  taskId: 'foreign-ops-task',
})
const scopedOpsTasks = await listOpsTasks(approvalFixture.prisma)
assert.equal(scopedOpsTasks.some((task) => task.id === 'foreign-ops-task'), false, 'Hotel Ops task history hides tasks from other properties')
const scopedOpsApprovals = await listOpsApprovals(approvalFixture.prisma)
assert.equal(scopedOpsApprovals.some((approval) => approval.taskId === 'foreign-ops-task'), false, 'Hotel Ops approval queue hides approvals from other properties')
await assert.rejects(
  () => getOpsTask(approvalFixture.prisma, 'foreign-ops-task'),
  /Hotel Ops task was not found/,
  'Hotel Ops task detail rejects tasks from other properties',
)
await assert.rejects(
  () => approveOpsTask(approvalFixture.prisma, 'foreign-ops-task', { notes: 'Should not approve cross-property task.' }, opsOwner),
  /Hotel Ops task was not found/,
  'Hotel Ops approval rejects tasks from other properties',
)
await assert.rejects(
  () => approveOpsTask(approvalFixture.prisma, pendingRateResult.task.id, {}, opsOwner),
  /Approval reason is required/,
  'Hotel Ops approval requires an audit reason before queueing write tasks',
)
assert.equal(approvalFixture.approvals[0].status, 'PENDING', 'Hotel Ops reasonless approval leaves the approval pending')
assert.equal(approvalFixture.logs.some((log) => log.action === 'APPROVAL_REJECTED' && log.message.includes('Approval reason is required')), true, 'Hotel Ops service logs reasonless approval attempts')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits reasonless approval attempts')

const approvedRateTask = await approveOpsTask(
  approvalFixture.prisma,
  pendingRateResult.task.id,
  { notes: 'Approved dry-run rate proof.' },
  opsOwner,
)
assert.equal(approvedRateTask.status, 'QUEUED', 'Hotel Ops approval queues the task for signed worker execution')
assert.equal(approvalFixture.approvals[0].status, 'APPROVED', 'Hotel Ops approval records the owner decision')
assert.equal(approvalFixture.approvals[0].notes, 'Approved dry-run rate proof.', 'Hotel Ops approval stores the approval reason')
assert.equal(approvalFixture.logs.some((log) => log.action === 'APPROVAL_GRANTED'), true, 'Hotel Ops service logs approval grants')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_GRANTED' && audit.changes.notes === 'Approved dry-run rate proof.'), true, 'Hotel Ops service audits approval grants with the reason')

const executedRateTask = await runQueuedOpsTask(approvalFixture.prisma, pendingRateResult.task.id, opsOwner)
assert.equal(executedRateTask.status, 'SUCCEEDED', 'Hotel Ops service executes approved mock rate updates successfully')
assert.equal(executedRateTask.proofScreenshots.length > 0, true, 'Hotel Ops service persists worker proof screenshots')
assert.equal(executedRateTask.proofScreenshots.every((proof) => proof.redactionStatus === 'SAFE'), true, 'Hotel Ops persisted worker proof is marked safe')
assert.equal(approvalFixture.logs.some((log) => log.action === 'WORKER_STARTED'), true, 'Hotel Ops service logs worker start')
assert.equal(approvalFixture.logs.some((log) => log.action === 'WORKER_SUCCEEDED'), true, 'Hotel Ops service logs worker success')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_TASK_STARTED'), true, 'Hotel Ops service audits worker start')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofCount > 0), true, 'Hotel Ops service audits persisted worker proof artifacts')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_TASK_SUCCEEDED'), true, 'Hotel Ops service audits worker success')
assert.equal(approvalFixture.notifications.some((notification) => notification.summary.includes('signed mock worker accepted UPDATE_RATE')), true, 'Hotel Ops service records execution result notifications')

const sendReplyApprovalFixture = createOpsCommandPrismaFixture()
const pendingSendReplyResult = await submitOpsCommand(
  sendReplyApprovalFixture.prisma,
  { message: 'Send Booking guest reply: Late check-in is confirmed.', sourceChannel: 'web' },
  opsManager,
)
assert.equal(pendingSendReplyResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops service holds send-reply writes for approval')
assert.equal(sendReplyApprovalFixture.approvals[0].requiredRole, 'OWNER', 'Hotel Ops send-reply approval requires owner role')
await assert.rejects(
  () => approveOpsTask(sendReplyApprovalFixture.prisma, pendingSendReplyResult.task.id, { notes: 'Manager should not approve send reply.' }, opsManager),
  /OWNER approval is required/,
  'Hotel Ops manager cannot approve send-reply writes',
)
await assert.rejects(
  () => denyOpsTask(sendReplyApprovalFixture.prisma, pendingSendReplyResult.task.id, { reason: 'Manager should not deny owner approval.' }, opsManager),
  /OWNER denial is required/,
  'Hotel Ops manager cannot deny owner-required send-reply approvals',
)
assert.equal(sendReplyApprovalFixture.approvals[0].status, 'PENDING', 'Hotel Ops manager-rejected send-reply approval remains pending')
assert.equal(sendReplyApprovalFixture.logs.some((log) => log.action === 'APPROVAL_REJECTED'), true, 'Hotel Ops service logs manager-rejected send-reply approval attempts')
assert.equal(sendReplyApprovalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits manager-rejected send-reply approval attempts')
assert.equal(sendReplyApprovalFixture.logs.some((log) => log.action === 'DENIAL_REJECTED'), true, 'Hotel Ops service logs manager-rejected send-reply denial attempts')
assert.equal(sendReplyApprovalFixture.audits.some((audit) => audit.action === 'OPS_DENIAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits manager-rejected send-reply denial attempts')

const selectorFailureFixture = createOpsCommandPrismaFixture()
const selectorFailureResult = await submitOpsCommand(
  selectorFailureFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday selector failure.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(selectorFailureFixture.prisma, selectorFailureResult.task.id, { notes: 'Approved selector failure smoke.' }, opsOwner)
const failedRateTask = await runQueuedOpsTask(selectorFailureFixture.prisma, selectorFailureResult.task.id, opsOwner)
assert.equal(failedRateTask.status, 'FAILED', 'Hotel Ops service persists failed signed worker results')
assert.equal(failedRateTask.errorCode, 'MOCK_SELECTOR_FAILURE', 'Hotel Ops service preserves worker failure error codes')
assert.equal(failedRateTask.proofScreenshots.some((proof) => proof.kind === 'error'), true, 'Hotel Ops service persists worker error proof screenshots')
assert.equal(selectorFailureFixture.logs.some((log) => log.action === 'WORKER_FAILED'), true, 'Hotel Ops service logs worker failures')
assert.equal(selectorFailureFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofKinds.includes('error')), true, 'Hotel Ops service audits failed-worker proof artifacts')
assert.equal(selectorFailureFixture.audits.some((audit) => audit.action === 'OPS_TASK_FAILED'), true, 'Hotel Ops service audits worker failures')

const humanChallengeFixture = createOpsCommandPrismaFixture()
const humanChallengeResult = await submitOpsCommand(
  humanChallengeFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday captcha.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(humanChallengeFixture.prisma, humanChallengeResult.task.id, { notes: 'Approved human challenge smoke.' }, opsOwner)
const humanChallengeTask = await runQueuedOpsTask(humanChallengeFixture.prisma, humanChallengeResult.task.id, opsOwner)
assert.equal(humanChallengeTask.status, 'NEEDS_HUMAN', 'Hotel Ops service persists human-challenge worker results')
assert.equal(humanChallengeTask.errorCode, 'NEEDS_HUMAN_CHALLENGE', 'Hotel Ops service preserves human-challenge error codes')
assert.equal(humanChallengeTask.proofScreenshots.some((proof) => proof.kind === 'trace'), true, 'Hotel Ops service persists human-challenge trace proof')
assert.equal(humanChallengeFixture.logs.some((log) => log.action === 'WORKER_NEEDS_HUMAN'), true, 'Hotel Ops service logs human-challenge worker results')
assert.equal(humanChallengeFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofKinds.includes('trace')), true, 'Hotel Ops service audits human-challenge proof traces')
assert.equal(humanChallengeFixture.notifications.some((notification) => notification.type === 'NEEDS_HUMAN'), true, 'Hotel Ops service records human-action notifications')

const emergencyFixture = createOpsCommandPrismaFixture()
await assert.rejects(
  () => setEmergencyStop(emergencyFixture.prisma, { enabled: true }, opsOwner),
  /Emergency stop changes require an audit reason/,
  'Hotel Ops emergency stop changes require an audit reason',
)
assert.equal(emergencyFixture.audits.some((audit) => audit.action === 'OPS_EMERGENCY_STOP_ENABLE_REJECTED'), true, 'Hotel Ops service audits reasonless emergency-stop attempts')
assert.equal(emergencyFixture.notifications.length, 0, 'Hotel Ops reasonless emergency-stop attempts do not notify or change operational state')
await setEmergencyStop(emergencyFixture.prisma, { enabled: true, reason: 'Owner paused OTA writes.' }, opsOwner)
assert.equal(emergencyFixture.audits.some((audit) => audit.action === 'OPS_EMERGENCY_STOP_ENABLED'), true, 'Hotel Ops service audits emergency stop activation')
assert.equal(emergencyFixture.notifications.some((notification) => notification.type === 'EMERGENCY_STOP'), true, 'Hotel Ops service records emergency stop notifications')
const stoppedRateResult = await submitOpsCommand(
  emergencyFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
assert.equal(stoppedRateResult.task.status, 'DENIED', 'Hotel Ops service denies write commands while emergency stop is active')
assert.equal(stoppedRateResult.decision.blockedByEmergencyStop, true, 'Hotel Ops service marks emergency-stop-denied command decisions')
assert.equal(emergencyFixture.approvals.length, 0, 'Hotel Ops service does not create approvals while emergency stop blocks writes')

const approvalStopFixture = createOpsCommandPrismaFixture()
const pendingStoppedApproval = await submitOpsCommand(
  approvalStopFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await setEmergencyStop(approvalStopFixture.prisma, { enabled: true, reason: 'Owner paused approval queueing.' }, opsOwner)
await assert.rejects(
  () => approveOpsTask(approvalStopFixture.prisma, pendingStoppedApproval.task.id, { notes: 'Should not queue while stopped.' }, opsOwner),
  /Emergency stop is enabled/,
  'Hotel Ops approval refuses to queue write tasks while emergency stop is active',
)
assert.equal(approvalStopFixture.tasks[0].status, 'PENDING_APPROVAL', 'Hotel Ops emergency-stop-blocked approval leaves the task pending')
assert.equal(approvalStopFixture.approvals[0].status, 'PENDING', 'Hotel Ops emergency-stop-blocked approval leaves the approval pending')
assert.equal(approvalStopFixture.logs.some((log) => log.action === 'APPROVAL_BLOCKED'), true, 'Hotel Ops service logs emergency-stop-blocked approvals')
assert.equal(approvalStopFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_BLOCKED' && audit.changes.blockedByEmergencyStop === true), true, 'Hotel Ops service audits emergency-stop-blocked approvals')

const runStopFixture = createOpsCommandPrismaFixture()
const pendingStoppedRun = await submitOpsCommand(
  runStopFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(runStopFixture.prisma, pendingStoppedRun.task.id, { notes: 'Queue before stop.' }, opsOwner)
await setEmergencyStop(runStopFixture.prisma, { enabled: true, reason: 'Owner paused worker execution.' }, opsOwner)
await assert.rejects(
  () => runQueuedOpsTask(runStopFixture.prisma, pendingStoppedRun.task.id, opsOwner),
  /Emergency stop is enabled/,
  'Hotel Ops runner refuses queued write tasks while emergency stop is active',
)
assert.equal(runStopFixture.tasks[0].status, 'QUEUED', 'Hotel Ops emergency-stop-blocked runner leaves the task queued')
assert.equal(runStopFixture.logs.some((log) => log.action === 'WORKER_START_BLOCKED'), true, 'Hotel Ops service logs emergency-stop-blocked worker starts')
assert.equal(runStopFixture.audits.some((audit) => audit.action === 'OPS_TASK_RUN_BLOCKED' && audit.changes.blockedByEmergencyStop === true), true, 'Hotel Ops service audits emergency-stop-blocked worker starts')

const deniedFixture = createOpsCommandPrismaFixture()
const deniedRateResult = await submitOpsCommand(
  deniedFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await assert.rejects(
  () => denyOpsTask(deniedFixture.prisma, deniedRateResult.task.id, {}, opsOwner),
  /Denial reason is required/,
  'Hotel Ops denial requires an audit reason before closing a task',
)
assert.equal(deniedFixture.tasks[0].status, 'PENDING_APPROVAL', 'Hotel Ops reasonless denial leaves the task pending')
assert.equal(deniedFixture.approvals[0].status, 'PENDING', 'Hotel Ops reasonless denial leaves the approval pending')
assert.equal(deniedFixture.logs.some((log) => log.action === 'DENIAL_REJECTED' && log.message.includes('Denial reason is required')), true, 'Hotel Ops service logs reasonless denial attempts')
assert.equal(deniedFixture.audits.some((audit) => audit.action === 'OPS_DENIAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits reasonless denial attempts')
const deniedRateTask = await denyOpsTask(deniedFixture.prisma, deniedRateResult.task.id, { reason: 'Do not change rates today.' }, opsOwner)
assert.equal(deniedRateTask.status, 'DENIED', 'Hotel Ops service can deny a pending write task')
assert.equal(deniedFixture.approvals[0].status, 'DENIED', 'Hotel Ops denial records the approval decision')
assert.equal(deniedFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_DENIED'), true, 'Hotel Ops service audits denied approvals')
await assert.rejects(
  () => runQueuedOpsTask(deniedFixture.prisma, deniedRateResult.task.id, opsOwner),
  /Only queued Hotel Ops tasks can run/,
  'Hotel Ops service refuses to execute denied tasks',
)

const cancelFixture = createOpsCommandPrismaFixture()
const cancellableScanResult = await submitOpsCommand(
  cancelFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web' },
  opsManager,
)
await assert.rejects(
  () => cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, { reason: 'Front desk should not cancel manager task.' }, { id: 'front-desk-ops-test', role: 'FRONT_DESK', name: 'Front Desk' }),
  /Only the requester, owner, or required approver can cancel/,
  'Hotel Ops service blocks non-requester staff from cancelling another user task',
)
assert.equal(cancelFixture.tasks[0].status, 'QUEUED', 'Hotel Ops unauthorized cancellation leaves the task queued')
assert.equal(cancelFixture.logs.some((log) => log.action === 'TASK_CANCEL_REJECTED'), true, 'Hotel Ops service logs unauthorized cancellation attempts')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCEL_REJECTED'), true, 'Hotel Ops service audits unauthorized cancellation attempts')
await assert.rejects(
  () => cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, {}, opsManager),
  /Cancellation reason is required/,
  'Hotel Ops cancellation requires an audit reason before closing a task',
)
assert.equal(cancelFixture.tasks[0].status, 'QUEUED', 'Hotel Ops reasonless cancellation leaves the task queued')
assert.equal(cancelFixture.logs.some((log) => log.action === 'TASK_CANCEL_REJECTED' && log.message.includes('Cancellation reason is required')), true, 'Hotel Ops service logs reasonless cancellation attempts')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCEL_REJECTED' && audit.changes.reason.includes('Cancellation reason is required')), true, 'Hotel Ops service audits reasonless cancellation attempts')
const cancelledScanTask = await cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, { reason: 'Requester cancelled duplicate scan.' }, opsManager)
assert.equal(cancelledScanTask.status, 'CANCELLED', 'Hotel Ops service lets the requester cancel an open task')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCELLED'), true, 'Hotel Ops service audits requester cancellations')

const forbiddenFixture = createOpsCommandPrismaFixture()
const forbiddenServiceResult = await submitOpsCommand(
  forbiddenFixture.prisma,
  { message: 'Cancel all bookings and refund guests.', sourceChannel: 'web' },
  opsOwner,
)
assert.equal(forbiddenServiceResult.task.status, 'DENIED', 'Hotel Ops service persists forbidden commands as denied attempts')
assert.equal(forbiddenFixture.approvals.length, 0, 'Hotel Ops service does not create approvals for forbidden commands')
assert.equal(forbiddenFixture.logs.some((log) => log.action === 'VALIDATION_FAILED'), true, 'Hotel Ops service logs validation failures for forbidden commands')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'FORBIDDEN'), true, 'Hotel Ops service audits forbidden parser output')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_VALIDATION_FAILED' && audit.changes.valid === false), true, 'Hotel Ops service audits validation failures for forbidden commands')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION' && audit.changes.allowed === false), true, 'Hotel Ops service audits denied forbidden decisions')

const disabledPhotoFixture = createOpsCommandPrismaFixture()
const disabledPhotoResult = await submitOpsCommand(
  disabledPhotoFixture.prisma,
  { message: 'Update Booking listing photos.', sourceChannel: 'web' },
  opsOwner,
)
assert.equal(disabledPhotoResult.task.taskType, 'UPDATE_PHOTOS', 'Hotel Ops service persists disabled photo commands as typed critical tasks')
assert.equal(disabledPhotoResult.task.status, 'DENIED', 'Hotel Ops service denies disabled photo commands instead of queueing them')
assert.equal(disabledPhotoFixture.approvals.length, 0, 'Hotel Ops service does not create approvals for disabled MVP photo changes')
assert.equal(disabledPhotoFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'UPDATE_PHOTOS'), true, 'Hotel Ops service audits disabled photo parser output')
assert.equal(disabledPhotoFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION' && audit.changes.reason.includes('not enabled in the MVP')), true, 'Hotel Ops service audits disabled MVP photo decisions')

const queuedReadTask = {
  taskType: 'READ_RESERVATIONS',
  status: 'QUEUED',
  approvalRequired: false,
  approvals: [],
}
assert.equal(evaluateOpsTaskRun(queuedReadTask, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, true, 'Hotel Ops runner allows queued low-risk tasks for permitted staff')
assert.equal(evaluateOpsTaskRun({ ...queuedReadTask, status: 'DENIED' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops runner rejects denied tasks')
assert.equal(evaluateOpsTaskRun({ ...queuedReadTask, status: 'RUNNING' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops runner rejects already-claimed tasks')

const pendingRateTask = {
  taskType: 'UPDATE_RATE',
  status: 'QUEUED',
  approvalRequired: true,
  permissionDecision: { requiredApprovalRole: 'OWNER' },
  approvals: [{ status: 'PENDING', requiredRole: 'OWNER' }],
}
assert.equal(evaluateOpsTaskRun(pendingRateTask, { id: 'owner', role: 'ADMIN' }).allowed, false, 'Hotel Ops runner refuses queued write tasks without completed approval')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'owner', role: 'ADMIN' }).allowed, true, 'Hotel Ops runner allows owner-approved write tasks')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, false, 'Hotel Ops runner prevents lower-role execution of owner-approved write tasks')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'owner', role: 'ADMIN' }, { enabled: true }).blockedByEmergencyStop, true, 'Hotel Ops runner rechecks emergency stop before write execution')

const makeOpsReservation = (id, createdAt, overrides = {}) => ({
  id,
  status: 'CONFIRMED',
  checkIn: new Date('2026-07-03T00:00:00.000Z'),
  checkOut: new Date('2026-07-05T00:00:00.000Z'),
  createdAt: new Date(createdAt),
  roomType: { name: 'Deluxe Room' },
  ...overrides,
})
const makeOpsRoom = (roomType, index, overrides = {}) => ({
  id: `room-${roomType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
  operationalStatus: 'AVAILABLE',
  roomType: { name: roomType },
  ...overrides,
})
const recentDemandReservations = Array.from({ length: 8 }, (_, index) => makeOpsReservation(
  `recent-demand-${index}`,
  index < 2 ? '2026-06-29T12:00:00.000Z' : '2026-06-10T12:00:00.000Z',
))
const highDemandInsights = buildOpsScanInsights({
  reservations: recentDemandReservations,
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(highDemandInsights.some((alert) => alert.alertType === 'HIGH_DEMAND'), true, 'Hotel Ops scan creates high-demand alert only when occupancy and velocity are elevated')
assert.equal(highDemandInsights.find((alert) => alert.alertType === 'HIGH_DEMAND')?.recommendedAction?.approvalRequired, true, 'Hotel Ops high-demand recommendation remains approval-gated')
const highDemandRecommendation = highDemandInsights.find((alert) => alert.alertType === 'HIGH_DEMAND')?.recommendedAction
const recommendationFixture = createOpsCommandPrismaFixture()
recommendationFixture.trendAlerts.push({
  id: 'trend-alert-high-demand',
  propertyId: 'property-ops-test',
  alertType: 'HIGH_DEMAND',
  severity: 'HIGH',
  title: 'High demand window',
  summary: 'Review a controlled rate increase.',
  platform: 'all',
  roomType: 'Deluxe Room',
  dateStart: new Date('2026-06-30T00:00:00.000Z'),
  dateEnd: new Date('2026-07-07T00:00:00.000Z'),
  metrics: {},
  recommendedAction: highDemandRecommendation,
  status: 'CREATED',
  createdAt: fixedOpsDate,
  updatedAt: fixedOpsDate,
})
recommendationFixture.trendAlerts.push({
  ...recommendationFixture.trendAlerts[0],
  id: 'foreign-trend-alert',
  propertyId: 'property-foreign',
  status: 'CREATED',
})
const scopedTrendAlerts = await listOpsTrendAlerts(recommendationFixture.prisma)
assert.equal(scopedTrendAlerts.some((alert) => alert.id === 'foreign-trend-alert'), false, 'Hotel Ops intelligence list hides alerts from other properties')
await assert.rejects(
  () => approveOpsAlertRecommendation(
    recommendationFixture.prisma,
    'trend-alert-high-demand',
    {},
    opsOwner,
  ),
  /Recommendation approval reason is required/,
  'Hotel Ops recommendation approval requires an audit reason before creating a task',
)
assert.equal(recommendationFixture.tasks.length, 0, 'Hotel Ops reasonless recommendation approval does not create a task')
assert.equal(recommendationFixture.trendAlerts[0].status, 'CREATED', 'Hotel Ops reasonless recommendation approval leaves alert status unchanged')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RECOMMENDATION_REJECTED'), true, 'Hotel Ops service audits reasonless recommendation approval attempts')

const approvedRecommendationResult = await approveOpsAlertRecommendation(
  recommendationFixture.prisma,
  'trend-alert-high-demand',
  { reason: 'Pickup trend reviewed; prepare a rate task for owner approval.' },
  opsOwner,
)
assert.equal(approvedRecommendationResult.task.taskType, 'UPDATE_RATE', 'Hotel Ops recommendation approval creates a typed rate task')
assert.equal(approvedRecommendationResult.task.platform, 'all', 'Hotel Ops recommendation approval preserves all-channel target')
assert.equal(approvedRecommendationResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops recommendation approval creates an approval-gated task instead of executing directly')
assert.equal(recommendationFixture.approvals.length, 1, 'Hotel Ops recommendation approval creates a task approval record')
assert.equal(recommendationFixture.trendAlerts[0].status, 'RECOMMENDATION_APPROVED', 'Hotel Ops recommendation approval updates alert status')
assert.equal(recommendationFixture.logs.some((log) => log.action === 'WORKER_STARTED'), false, 'Hotel Ops recommendation approval does not start the worker directly')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RECOMMENDATION_APPROVED' && audit.changes.reason === 'Pickup trend reviewed; prepare a rate task for owner approval.'), true, 'Hotel Ops recommendation approval is audited with the reason')
await assert.rejects(
  () => resolveOpsTrendAlert(recommendationFixture.prisma, 'trend-alert-high-demand', {}, opsOwner),
  /Resolution reason is required/,
  'Hotel Ops alert resolution requires an audit reason before closing an active alert',
)
assert.equal(recommendationFixture.trendAlerts[0].status, 'RECOMMENDATION_APPROVED', 'Hotel Ops reasonless alert resolution leaves alert status unchanged')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RESOLVE_REJECTED'), true, 'Hotel Ops service audits reasonless alert resolution attempts')
const resolvedRecommendationAlert = await resolveOpsTrendAlert(
  recommendationFixture.prisma,
  'trend-alert-high-demand',
  { reason: 'Recommendation queued; owner will review the generated task.' },
  opsOwner,
)
assert.equal(resolvedRecommendationAlert.status, 'RESOLVED', 'Hotel Ops alert resolution closes the alert when a reason is supplied')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RESOLVED' && audit.changes.reason === 'Recommendation queued; owner will review the generated task.'), true, 'Hotel Ops alert resolution is audited with the reason')

const slowFullWindowInsights = buildOpsScanInsights({
  reservations: Array.from({ length: 8 }, (_, index) => makeOpsReservation(`slow-demand-${index}`, '2026-06-10T12:00:00.000Z')),
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(slowFullWindowInsights.some((alert) => alert.alertType === 'HIGH_DEMAND'), false, 'Hotel Ops scan does not create high-demand alert from occupancy alone')

const lowDemandInsights = buildOpsScanInsights({
  reservations: [makeOpsReservation('low-demand-1', '2026-06-28T12:00:00.000Z')],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(lowDemandInsights.some((alert) => alert.alertType === 'LOW_DEMAND'), true, 'Hotel Ops scan creates low-demand alert inside the 7-day window')

const cancellationInsights = buildOpsScanInsights({
  reservations: recentDemandReservations,
  cancellationLogs: [
    { createdAt: new Date('2026-06-29T20:00:00.000Z'), action: 'CANCELLED' },
    { createdAt: new Date('2026-06-29T21:00:00.000Z'), action: 'NO_SHOW' },
    { createdAt: new Date('2026-06-20T12:00:00.000Z'), action: 'CANCELLED' },
  ],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(cancellationInsights.some((alert) => alert.alertType === 'CANCELLATION_SPIKE'), true, 'Hotel Ops scan creates cancellation spike alert from recent cancellation acceleration')

const weekendInsights = buildOpsScanInsights({
  reservations: [
    makeOpsReservation('weekend-1', '2026-06-29T12:00:00.000Z'),
    makeOpsReservation('weekend-2', '2026-06-29T13:00:00.000Z'),
  ],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(weekendInsights.some((alert) => alert.alertType === 'WEEKEND_SPIKE'), true, 'Hotel Ops scan creates weekend spike alert only when weekend velocity accelerates')

const roomImbalanceInsights = buildOpsScanInsights({
  reservations: [
    ...Array.from({ length: 3 }, (_, index) => makeOpsReservation(`deluxe-imbalance-${index}`, '2026-06-10T12:00:00.000Z', { roomType: { name: 'Deluxe Room' } })),
    makeOpsReservation('standard-imbalance-1', '2026-06-10T12:00:00.000Z', { roomType: { name: 'Standard Room' } }),
  ],
  rooms: [
    ...Array.from({ length: 4 }, (_, index) => makeOpsRoom('Deluxe Room', index)),
    ...Array.from({ length: 4 }, (_, index) => makeOpsRoom('Standard Room', index)),
  ],
  sellableRooms: 8,
  now: fixedOpsDate,
})
const roomImbalanceAlert = roomImbalanceInsights.find((alert) => alert.alertType === 'ROOM_IMBALANCE')
assert.equal(Boolean(roomImbalanceAlert), true, 'Hotel Ops scan creates room-type imbalance alert when one room type is strong and another is weak')
assert.equal(roomImbalanceAlert?.metrics?.strongestRoomType?.roomType, 'Deluxe Room', 'Hotel Ops room imbalance identifies the strongest room type')
assert.equal(roomImbalanceAlert?.metrics?.weakestRoomType?.roomType, 'Standard Room', 'Hotel Ops room imbalance identifies the weakest room type')
assert.equal(roomImbalanceAlert?.recommendedAction, null, 'Hotel Ops room imbalance is alert-only and does not create an automatic OTA mutation recommendation')

const otaImbalanceInsights = buildOpsScanInsights({
  reservations: [
    ...Array.from({ length: 4 }, (_, index) => makeOpsReservation(`ota-booking-${index}`, '2026-06-10T12:00:00.000Z', { source: 'BOOKING_COM' })),
    makeOpsReservation('ota-booking-email', '2026-06-10T12:00:00.000Z', { source: 'EMAIL', sourceEmailEvent: { sourceName: 'Booking.com' } }),
    makeOpsReservation('ota-agoda-1', '2026-06-10T12:00:00.000Z', { source: 'AGODA' }),
    makeOpsReservation('ota-agoda-2', '2026-06-10T12:00:00.000Z', { source: 'AGODA' }),
  ],
  sellableRooms: 20,
  now: fixedOpsDate,
})
const otaImbalanceAlert = otaImbalanceInsights.find((alert) => alert.alertType === 'OTA_IMBALANCE')
assert.equal(Boolean(otaImbalanceAlert), true, 'Hotel Ops scan creates OTA imbalance alert when one supported platform dominates channel mix')
assert.equal(otaImbalanceAlert?.platform, 'booking', 'Hotel Ops OTA imbalance alert identifies the dominant platform')
assert.equal(otaImbalanceAlert?.metrics?.platformCounts?.booking, 5, 'Hotel Ops OTA imbalance counts persisted source and source-email reservations')
assert.equal(otaImbalanceAlert?.recommendedAction, null, 'Hotel Ops OTA imbalance is alert-only and does not create an automatic OTA mutation recommendation')

assert.equal(
  hotelOpsTrendAlertFingerprint({
    alertType: 'LOW_DEMAND',
    platform: 'all',
    roomType: 'All Rooms',
    dateStart: new Date('2026-06-30T00:00:00.000Z'),
    dateEnd: '2026-07-07',
  }),
  hotelOpsTrendAlertFingerprint({
    alertType: 'LOW_DEMAND',
    platform: 'all',
    roomType: 'All Rooms',
    dateStart: '2026-06-30',
    dateEnd: new Date('2026-07-07T00:00:00.000Z'),
  }),
  'Hotel Ops trend alert fingerprint normalizes equivalent date windows',
)
assert.notEqual(
  hotelOpsTrendAlertFingerprint({ alertType: 'LOW_DEMAND', platform: 'all', roomType: 'All Rooms', dateStart: '2026-06-30', dateEnd: '2026-07-07' }),
  hotelOpsTrendAlertFingerprint({ alertType: 'LOW_DEMAND', platform: 'all', roomType: 'All Rooms', dateStart: '2026-06-30', dateEnd: '2026-07-08' }),
  'Hotel Ops trend alert fingerprint changes when the action window changes',
)

const scanAlertRows = []
const scanNotifications = []
const scanAudits = []
const scanProperty = { id: 'property-scan-1', code: 'SANDBOX', email: null, reservationAlertEmail: null }
const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null)
const scanPrisma = {
  property: {
    findUnique: async () => scanProperty,
  },
  reservation: {
    findMany: async () => [],
  },
  room: {
    findMany: async () => Array.from({ length: 10 }, (_, index) => makeOpsRoom('Deluxe Room', index)),
  },
  reservationLog: {
    findMany: async () => [],
  },
  hotelOpsTrendAlert: {
    findFirst: async ({ where }) => scanAlertRows.find((alert) => (
      alert.propertyId === where.propertyId
      && alert.alertType === where.alertType
      && (alert.platform || null) === (where.platform || null)
      && (alert.roomType || null) === (where.roomType || null)
      && dateKey(alert.dateStart) === dateKey(where.dateStart)
      && dateKey(alert.dateEnd) === dateKey(where.dateEnd)
      && where.status.in.includes(alert.status)
    )) || null,
    create: async ({ data }) => {
      const now = new Date(`2026-06-30T00:00:0${scanAlertRows.length}.000Z`)
      const row = {
        id: `scan-alert-${scanAlertRows.length + 1}`,
        status: 'CREATED',
        createdAt: now,
        updatedAt: now,
        ...data,
      }
      scanAlertRows.push(row)
      return row
    },
    update: async ({ where, data }) => {
      const row = scanAlertRows.find((alert) => alert.id === where.id)
      Object.assign(row, data, { updatedAt: new Date('2026-06-30T00:00:10.000Z') })
      return row
    },
  },
  hotelOpsNotification: {
    create: async ({ data }) => {
      const row = { id: `scan-notification-${scanNotifications.length + 1}`, createdAt: new Date('2026-06-30T00:00:00.000Z'), ...data }
      scanNotifications.push(row)
      return row
    },
  },
  auditLog: {
    create: async ({ data }) => {
      scanAudits.push(data)
      return data
    },
  },
}
const firstLowDemandScan = await runOpsScan(scanPrisma, { force: 'low-demand', now: fixedOpsDate }, { id: 'manager', role: 'MANAGER' })
const secondLowDemandScan = await runOpsScan(scanPrisma, { force: 'low-demand', now: fixedOpsDate }, { id: 'manager', role: 'MANAGER' })
assert.equal(scanAlertRows.length, 1, 'Hotel Ops scan reuses an active alert instead of creating duplicates')
assert.equal(firstLowDemandScan[0]?.id, secondLowDemandScan[0]?.id, 'Hotel Ops repeated scan returns the existing active alert')
assert.equal(scanNotifications.filter((notification) => notification.type === 'TREND_ALERT').length, 1, 'Hotel Ops repeated scan does not re-notify for the same active alert')
assert.equal(scanAudits.filter((audit) => audit.action === 'OPS_SCAN_RUN').at(-1)?.changes.updated, 1, 'Hotel Ops repeated scan audits alert refresh count')

const parsedIcal = ical.parseIcalEvents(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:booking-test-001
DTSTART;VALUE=DATE:20260612
DTEND;VALUE=DATE:20260614
SUMMARY:Booking.com iCal booking
DESCRIPTION:Smoke\\nimport
END:VEVENT
END:VCALENDAR`)
assert.equal(parsedIcal.events.length, 1, 'iCal parser imports VEVENT date blocks')
assert.equal(parsedIcal.events[0].uid, 'booking-test-001')
assert.equal(parsedIcal.events[0].checkIn, '2026-06-12')
assert.equal(parsedIcal.events[0].checkOut, '2026-06-14')
assert.equal(parsedIcal.events[0].description, 'Smoke\nimport')

const generatedIcal = ical.generateIcalFeed('Sandbox Hotel Blocks', [{
  uid: 'res,1',
  summary: 'Sandbox Hotel block - Twin; balcony',
  checkIn: '2026-06-12',
  checkOut: '2026-06-14',
  description: 'Unavailable in PMS',
}])
assert.match(generatedIcal, /^BEGIN:VCALENDAR/, 'iCal export starts with calendar envelope')
assert.match(generatedIcal, /DTSTART;VALUE=DATE:20260612/, 'iCal export includes check-in date')
assert.match(generatedIcal, /DTEND;VALUE=DATE:20260614/, 'iCal export includes check-out date')
assert.match(generatedIcal, /UID:res\\,1/, 'iCal export escapes UID text')
assert.match(generatedIcal, /SUMMARY:Sandbox Hotel block - Twin\\; balcony/, 'iCal export escapes summary text')

assert.equal(normalizeIcalProvider('booking-com'), 'BOOKING_COM', 'server iCal provider slugs normalize to enums')
assert.equal(
  buildIcalFeedUrl('https://pms.example.test/', 'token_1234567890123456'),
  'https://pms.example.test/ical/token_1234567890123456.ics',
  'server iCal feed URLs use the public app origin',
)

const fakeIcalPrisma = {
  reservation: {
    findMany: async (query) => {
      assert.deepEqual(query.where.roomTypeId, { in: ['rt-twin'] }, 'server iCal feed honors active room-type mappings')
      return [{
        id: 'res-ical-1',
        confirmationCode: 'SBX-ICAL-1',
        roomType: { code: 'TWIN', name: 'Standard Twin' },
        checkIn: new Date('2026-06-12T00:00:00.000Z'),
        checkOut: new Date('2026-06-14T00:00:00.000Z'),
      }]
    },
  },
}
const serverIcalFeed = await buildIcalFeedForChannel(fakeIcalPrisma, {
  name: 'Booking.com',
  provider: 'BOOKING_COM',
  propertyId: 'property-1',
  mappings: [
    { roomTypeId: 'rt-twin', active: true },
    { roomTypeId: 'rt-double', active: false },
  ],
}, new Date('2026-06-01T00:00:00.000Z'))
assert.match(serverIcalFeed, /X-WR-CALNAME:Booking.com - Sandbox Hotel Blocks/, 'server iCal feed names the channel calendar')
assert.match(serverIcalFeed, /DTSTART;VALUE=DATE:20260612/, 'server iCal feed exports reservation start dates')
assert.match(serverIcalFeed, /DTEND;VALUE=DATE:20260614/, 'server iCal feed exports reservation end dates')
assert.equal(serverIcalFeed.includes('Guest'), false, 'server iCal feed avoids guest PII in event summaries')

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const assistantHotelDateKey = rules.getBangkokDateKey(new Date())
const assistantYesterdayKey = shiftDateKey(assistantHotelDateKey, -1)
const assistantTomorrowKey = shiftDateKey(assistantHotelDateKey, 1)

const assistantRooms = [
  {
    roomId: 'room-301',
    number: '301',
    floor: 3,
    type: 'DOUBLE',
    status: 'VACANT_CLEAN',
    operationalStatus: 'AVAILABLE',
    isArrivalToday: false,
    isDepartureToday: false,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'INSPECTED',
    depositStatus: 'NONE',
  },
  {
    roomId: 'room-302',
    number: '302',
    floor: 3,
    type: 'DOUBLE',
    status: 'VACANT_DIRTY',
    operationalStatus: 'AVAILABLE',
    isArrivalToday: true,
    isDepartureToday: false,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'DIRTY',
    depositStatus: 'NONE',
  },
  {
    roomId: 'room-201',
    number: '201',
    floor: 2,
    type: 'TWIN',
    status: 'OCCUPIED_CLEAN',
    operationalStatus: 'AVAILABLE',
    guestName: 'Departing Guest',
    reservationId: 'res-depart',
    currentReservationId: 'res-depart',
    checkIn: new Date(`${assistantYesterdayKey}T00:00:00.000Z`),
    checkOut: new Date(`${assistantHotelDateKey}T00:00:00.000Z`),
    guestCount: 2,
    isArrivalToday: false,
    isDepartureToday: true,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'CLEAN',
    depositStatus: 'PENDING',
    balanceDue: 800,
  },
]

const assistantReservations = [
  {
    id: 'res-arrival',
    confirmationCode: 'SBX-1023',
    guestName: 'John Miller',
    roomType: 'DOUBLE',
    status: 'CONFIRMED',
    checkIn: assistantHotelDateKey,
    checkOut: assistantTomorrowKey,
    adults: 2,
    children: 0,
    balanceDue: 800,
    totalAmount: 1800,
    paidAmount: 1000,
    documentVerified: false,
    depositPaid: false,
  },
  {
    id: 'res-ready',
    confirmationCode: 'SBX-1024',
    guestName: 'Maria Lopez',
    roomType: 'DOUBLE',
    status: 'CONFIRMED',
    checkIn: assistantHotelDateKey,
    checkOut: assistantTomorrowKey,
    adults: 2,
    children: 0,
    assignedRoomId: 'room-301',
    roomNumber: '301',
    balanceDue: 0,
    totalAmount: 1800,
    paidAmount: 1800,
    documentVerified: true,
    depositPaid: true,
    guestNationality: 'Spain',
    guestIdNumber: 'P123',
  },
  {
    id: 'res-depart',
    confirmationCode: 'SBX-0999',
    guestName: 'Departing Guest',
    roomType: 'TWIN',
    status: 'CHECKED_IN',
    checkIn: assistantYesterdayKey,
    checkOut: assistantHotelDateKey,
    adults: 2,
    children: 0,
    assignedRoomId: 'room-201',
    roomNumber: '201',
    balanceDue: 800,
    totalAmount: 3000,
    paidAmount: 2200,
    documentVerified: true,
  },
]

const frontDeskSnapshot = assistantTools.buildSnapshotFromData({
  hotelDateKey: assistantHotelDateKey,
  rooms: assistantRooms,
  reservations: assistantReservations,
  user: { id: 'front', role: 'front-desk', displayName: 'Front Desk' },
})

assert.equal(assistantIntents.parseFrontDeskIntent('Can I sell a double tonight?').intent, 'CHECK_AVAILABILITY', 'availability intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Who is arriving today?').intent, 'LIST_ARRIVALS', 'arrival list intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Who has not paid yet?').intent, 'PAYMENT_BALANCE', 'payment intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Why can’t I check in reservation SBX-1023?').intent, 'CHECK_IN_ELIGIBILITY', 'check-in eligibility intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Show today’s front desk risks').intent, 'DAILY_RISKS', 'daily risk intent is parsed')

const availabilityAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Can I sell a double tonight?',
  assistantIntents.parseFrontDeskIntent('Can I sell a double tonight?'),
)
assert.equal(availabilityAnswer.records.some((record) => record.label === 'Room 301'), true, 'assistant availability cites available rooms')
assert.equal(availabilityAnswer.actions.some((item) => item.type === 'CREATE_WALK_IN_DRAFT'), true, 'availability offers walk-in workflow action')

const arrivalsAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Who is arriving today?',
  assistantIntents.parseFrontDeskIntent('Who is arriving today?'),
)
assert.equal(arrivalsAnswer.records.length >= 2, true, 'assistant arrivals answer cites arrival reservations')

const blockedCheckInAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Why can’t I check in reservation SBX-1023?',
  assistantIntents.parseFrontDeskIntent('Why can’t I check in reservation SBX-1023?'),
)
assert.equal(blockedCheckInAnswer.warnings.some((warning) => warning.includes('No room assigned')), true, 'assistant explains check-in blocker')
assert.equal(blockedCheckInAnswer.actions.some((item) => item.type === 'ASSIGN_BEST_ROOM'), true, 'assistant offers best-room assignment when safe')

const checkoutAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Can I check out room 201?',
  assistantIntents.parseFrontDeskIntent('Can I check out room 201?'),
)
assert.equal(checkoutAnswer.warnings.some((warning) => warning.includes('Balance')), true, 'assistant explains checkout payment blocker')

const risksAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Show today’s risks',
  assistantIntents.parseFrontDeskIntent('Show today’s risks'),
)
assert.equal(risksAnswer.warnings.length > 0, true, 'assistant daily risk summary surfaces risks')

const housekeepingSnapshot = { ...frontDeskSnapshot, user: { id: 'hk', role: 'housekeeping', displayName: 'Housekeeping' } }
const housekeepingPaymentAnswer = assistantTools.runAssistantTool(
  housekeepingSnapshot,
  'Who has not paid yet?',
  assistantIntents.parseFrontDeskIntent('Who has not paid yet?'),
)
assert.equal(housekeepingPaymentAnswer.directAnswer.includes('cannot view'), true, 'housekeeping cannot see payment details')
assert.equal(assistantGuards.hasAssistantPermission({ role: 'front-desk' }, 'check-in:guest'), true, 'front desk can see check-in actions')
assert.equal(assistantGuards.hasAssistantPermission({ role: 'housekeeping' }, 'process:payment'), false, 'housekeeping cannot process payment actions')

console.log('Business rule tests passed')
