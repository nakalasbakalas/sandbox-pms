/* global console */
import assert from 'node:assert/strict'
import {
  analyzeCancellationRisk,
  analyzeDemand,
  analyzeHousekeeping,
  analyzeRateOpportunity,
  opsAnalyzerPolicy,
  runDeterministicOpsAnalyzers,
} from '../server/ops-analyzers.mjs'

const common = Object.freeze({
  propertyId: 'property-SANDBOX',
  asOf: '2026-07-16T08:00:00.000+07:00',
  window: Object.freeze({ startDate: '2026-07-16', endDate: '2026-07-23' }),
  evidenceIds: Object.freeze(['snapshot:002', 'snapshot:001', 'snapshot:002']),
})

const demandInput = Object.freeze({
  ...common,
  sellableRoomNights: 100,
  bookedRoomNights: 86,
  pickupReservations: 15,
  baselinePickupReservations: 10,
})
const cancellationInput = Object.freeze({
  ...common,
  activeReservations: 17,
  recentCancellations: 3,
  baselineCancellationRateBasisPoints: 500,
})
const housekeepingInput = Object.freeze({
  ...common,
  openTasks: 10,
  overdueTasks: 5,
  highPriorityTasks: 3,
  blockedRooms: 2,
})
const rateInput = Object.freeze({
  ...common,
  roomTypeId: 'room-type:deluxe',
  stayDate: '2026-07-18',
  occupancyBasisPoints: 8500,
  pickupChangeBasisPoints: 2000,
  currentRateSatang: '200000',
  proposedRateSatang: '230000',
})

assert.equal(opsAnalyzerPolicy.mode, 'SUGGEST_ONLY')
assert.equal(opsAnalyzerPolicy.persistence, false)
assert.equal(opsAnalyzerPolicy.providerCalls, false)
assert.equal(opsAnalyzerPolicy.directMutation, false)

const firstRun = runDeterministicOpsAnalyzers({
  demand: demandInput,
  cancellationRisk: cancellationInput,
  housekeeping: housekeepingInput,
  rateOpportunity: rateInput,
})
const secondRun = runDeterministicOpsAnalyzers({
  demand: demandInput,
  cancellationRisk: cancellationInput,
  housekeeping: housekeepingInput,
  rateOpportunity: rateInput,
})
assert.deepEqual(firstRun, secondRun, 'identical sanitized inputs produce byte-stable recommendation values')
assert.equal(JSON.stringify(firstRun), JSON.stringify(secondRun), 'serialized outputs are deterministic')
assert.equal(firstRun.length, 4)

for (const result of firstRun) {
  assert.equal(result.suggestionOnly, true)
  assert.equal(result.writePerformed, false)
  assert.equal(result.providerCallPerformed, false)
  assert.ok(result.ruleId.endsWith('.v1'), 'every recommendation identifies a versioned deterministic rule')
  assert.ok(result.explanation.length > 20, 'every recommendation is explainable')
  assert.ok(opsAnalyzerPolicy.hotelOpsTaskTypes.includes(result.acceptance.taskType), 'only the existing Hotel Ops taxonomy is recommended')
  assert.equal(result.acceptance.submitEndpoint, '/api/ops/commands')
  assert.equal(result.acceptance.requiresExplicitAcceptance, true)
  assert.deepEqual(result.evidenceIds, ['snapshot:001', 'snapshot:002'], 'evidence contains sorted identifiers only')
  for (const control of ['PERMISSION', 'APPROVAL', 'OPERATIONAL_REASON', 'AUDIT', 'IDEMPOTENCY', 'EMERGENCY_STOP']) {
    assert.ok(result.acceptance.controls.includes(control), `acceptance retains ${control}`)
  }
}

assert.equal(analyzeDemand(demandInput).ruleId, 'demand.high-occupancy-accelerating-pickup.v1')
assert.equal(analyzeDemand(demandInput).acceptance.taskType, 'READ_RATES')
assert.equal(analyzeCancellationRisk(cancellationInput).severity, 'HIGH')
assert.equal(analyzeCancellationRisk(cancellationInput).acceptance.taskType, 'SCAN_BOOKINGS')
assert.equal(analyzeHousekeeping(housekeepingInput).ruleId, 'housekeeping.blockers-high.v1')
assert.equal(analyzeRateOpportunity(rateInput).acceptance.taskType, 'UPDATE_RATE')
assert.equal(analyzeRateOpportunity(rateInput).metrics.currentRateSatang, '200000', 'money stays exact as base-10 satang strings')

assert.deepEqual(demandInput, {
  ...common,
  sellableRoomNights: 100,
  bookedRoomNights: 86,
  pickupReservations: 15,
  baselinePickupReservations: 10,
}, 'analyzers never mutate caller input')

assert.throws(
  () => analyzeDemand({ ...demandInput, guestName: 'Sensitive Guest' }),
  /Unrecognized key.*guestName/,
  'PII-shaped unknown fields are rejected rather than retained as evidence',
)
assert.throws(
  () => analyzeDemand({ ...demandInput, password: 'do-not-store' }),
  /Unrecognized key.*password/,
  'credential-shaped fields are rejected',
)
assert.throws(
  () => analyzeDemand({ ...demandInput, evidenceIds: ['sk-secretvalue123'] }),
  /Credential-shaped identifiers are not allowed/,
  'credential-shaped evidence values are rejected',
)
assert.throws(
  () => runDeterministicOpsAnalyzers({ demand: demandInput, execute: () => undefined }),
  /Unrecognized key.*execute/,
  'mutation or execution functions cannot enter the analyzer boundary',
)
assert.throws(
  () => analyzeRateOpportunity({ ...rateInput, providerWrite: () => undefined }),
  /Unrecognized key.*providerWrite/,
  'provider mutation callbacks are rejected',
)
assert.throws(
  () => runDeterministicOpsAnalyzers({}),
  /At least one analyzer input is required/,
)

console.log('Deterministic Hotel Ops analyzer tests passed')
