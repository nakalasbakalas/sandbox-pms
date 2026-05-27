/* global Buffer, console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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

  const encoded = Buffer.from(transpiled, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

const rules = await importTypeScriptModule(resolve('src/lib/hotel/business-rules.ts'))
const status = await importTypeScriptModule(resolve('src/lib/hotel/status.ts'))

assert.equal(rules.nightsBetween('2026-05-26', '2026-05-29'), 3, 'counts hotel nights with check-out exclusive')
assert.equal(rules.nightsBetween('2026-05-26', '2026-05-26'), 0, 'rejects zero-night stays')

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

assert.equal(status.getStatusDefinition('room', 'VACANT_DIRTY').label.th, 'รอทำความสะอาด')
assert.equal(status.getStatusDefinition('payment', 'PAID').label.en, 'Paid')
assert.equal(status.getStatusDefinition('reservation', 'NO_SHOW').label.th, 'ไม่มาเข้าพัก')

console.log('Business rule tests passed')
