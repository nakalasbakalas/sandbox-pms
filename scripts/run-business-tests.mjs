/* global console */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { buildIcalFeedForChannel, buildIcalFeedUrl, normalizeIcalProvider } from '../server/ical-feed.mjs'
import { buildOpsNotificationDrafts, evaluateOpsPermission, parseHotelOpsCommand } from '../server/ops-service.mjs'
import { opsWorkerConfigured, runSignedMockOtaWorkerTask, signOpsWorkerRequest, verifyOpsWorkerRequest } from '../server/ops-worker-auth.mjs'
import { createUser } from '../server/pms-service.mjs'

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

const forbiddenCommand = parseHotelOpsCommand('Cancel all bookings and refund guests.', { now: fixedOpsDate })
assert.equal(forbiddenCommand.taskType, 'FORBIDDEN', 'Hotel Ops parser blocks destructive booking/refund command')
assert.equal(evaluateOpsPermission(forbiddenCommand, { id: 'owner', role: 'ADMIN' }).allowed, false, 'Hotel Ops forbidden commands cannot execute')

const ambiguousRateCommand = parseHotelOpsCommand('Raise Booking price to 3000.', { now: fixedOpsDate })
assert.equal(ambiguousRateCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser requests clarification for incomplete rate command')
assert.equal(ambiguousRateCommand.missingFields.includes('dateRange'), true, 'Hotel Ops incomplete rate command asks for dates')
assert.equal(ambiguousRateCommand.missingFields.includes('roomType'), true, 'Hotel Ops incomplete rate command asks for room type')

const allRoomsRateCommand = parseHotelOpsCommand('Set all rooms to 2,200 THB 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(allRoomsRateCommand.taskType, 'UPDATE_RATE', 'Hotel Ops parser accepts all-room recommendation tasks')
assert.equal(allRoomsRateCommand.roomType, 'All Rooms', 'Hotel Ops parser preserves all-room target')

const managerDecision = evaluateOpsPermission(rateCommand, { id: 'manager', role: 'MANAGER' })
assert.equal(managerDecision.allowed, true, 'Hotel manager can submit high-risk Hotel Ops task')
assert.equal(managerDecision.approvalRequired, true, 'Hotel manager high-risk Hotel Ops task still needs owner approval')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, false, 'staff cannot create high-risk Hotel Ops write task')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'owner', role: 'ADMIN' }, { enabled: true }).blockedByEmergencyStop, true, 'Hotel Ops emergency stop blocks write tasks')

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
