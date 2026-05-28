/* global console */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

async function importTypeScriptModule(path) {
  const source = await readFile(path, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  }).outputText
  const output = transpiled.replaceAll("from './business-rules'", "from './business-rules.mjs'")
  const tempDir = resolve('node_modules/.tmp/business-tests')
  await mkdir(tempDir, { recursive: true })
  const outputPath = resolve(tempDir, basename(path).replace(/\.(ts|tsx)$/, '.mjs'))
  await writeFile(outputPath, output, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

const rules = await importTypeScriptModule(resolve('src/lib/hotel/business-rules.ts'))
const status = await importTypeScriptModule(resolve('src/lib/hotel/status.ts'))
const operations = await importTypeScriptModule(resolve('src/lib/hotel/operations.ts'))

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
assert.equal(pricing.extraGuestFee, 600)
assert.equal(pricing.childFee, 300)
assert.equal(pricing.total, 3900)
assert.equal(pricing.taxInclusive, true)
assert.equal(pricing.isValidOccupancy, false, '3 adults plus 2 children exceeds max occupancy')

const childPricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  ratePerNight: 1500,
  adults: 2,
  childAges: [5, 8],
})
assert.equal(childPricing.childFee, 200, 'children 6-11 sharing bedding are charged per night')
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
      operationalStatus: 'AVAILABLE',
    },
    { checkIn: '2026-05-26', checkOut: '2026-05-27' },
  ),
  { assignable: false, reason: 'non_sellable' },
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
  operations.validateRoomAssignment(reservation, { ...room, number: '216' }).message,
  'Room 216 is non-sellable and cannot be assigned.',
  'room assignment blocks non-sellable rooms',
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

assert.equal(status.getStatusDefinition('room', 'VACANT_DIRTY').label.th, 'รอทำความสะอาด')
assert.equal(status.getStatusDefinition('payment', 'PAID').label.en, 'Paid')
assert.equal(status.getStatusDefinition('reservation', 'NO_SHOW').label.th, 'ไม่มาเข้าพัก')
assert.equal(status.getStatusDefinition('room', 'BLOCKED').label.th, 'ปิดใช้งาน')

console.log('Business rule tests passed')
