/* global console */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { planShadowAction } from '../server/autonomy/action-planner.mjs'
import {
  assertSanitizedAutonomyValue,
  parseAutonomyPolicy,
} from '../server/autonomy/contracts.mjs'
import { evaluateShadowAutonomyPolicy } from '../server/autonomy/policy-engine.mjs'

function policy(overrides = {}) {
  return {
    propertyId: 'property-a',
    provider: 'booking',
    taskType: 'SCAN_BOOKINGS',
    mode: 'SHADOW',
    minimumSourceTrust: 'AUTHENTICATED_OTA_API',
    minimumConfidenceBasisPoints: 8_000,
    maximumRooms: 1,
    maximumDateRangeDays: 7,
    maximumRateChangeBasisPoints: 500,
    maximumRateChangeSatang: '10000',
    rateFloorSatang: '80000',
    rateCeilingSatang: '600000',
    maximumActionsPerHour: 5,
    maximumActionsPerDay: 20,
    requireReadAfterWrite: true,
    requiredProof: [],
    approvalRole: 'OWNER',
    quietHours: null,
    emergencyStopCovered: true,
    version: 1,
    ...overrides,
  }
}

function event(overrides = {}) {
  return {
    propertyId: 'property-a',
    channelId: 'channel-a',
    provider: 'booking',
    providerEventId: 'provider-event-1',
    eventVersion: '1',
    eventType: 'NEW_BOOKING',
    sourceTrust: 'AUTHENTICATED_OTA_API',
    sourceTimestamp: '2026-07-18T10:00:00.000Z',
    receivedTimestamp: '2026-07-18T10:00:01.000Z',
    correlationId: randomUUID(),
    idempotencyKey: 'booking:provider-event-1:1',
    payloadHash: 'a'.repeat(64),
    evidenceIds: ['provider-event-1'],
    ...overrides,
  }
}

const candidate = planShadowAction(event())
assert.equal(candidate.taskType, 'SCAN_BOOKINGS')
assert.equal(candidate.writesPerformed, false)
assert.equal(candidate.providerCallsPerformed, false)

const allowed = evaluateShadowAutonomyPolicy(policy(), candidate)
assert.equal(allowed.outcome, 'SHADOW_CANDIDATE')
assert.equal(allowed.allowedForShadowEvaluation, true)
assert.equal(allowed.eligibleForExecution, false)
assert.equal(allowed.writesAllowed, false)
assert.equal(allowed.providerCallsAllowed, false)

const stopped = evaluateShadowAutonomyPolicy(policy(), candidate, { emergencyStopEnabled: true })
assert.equal(stopped.outcome, 'SHADOW_BLOCKED')
assert.ok(stopped.reasons.includes('EMERGENCY_STOP_ENABLED'))

const disabled = evaluateShadowAutonomyPolicy(policy(), candidate, { policyEnabled: false })
assert.equal(disabled.outcome, 'SHADOW_BLOCKED')
assert.ok(disabled.reasons.includes('POLICY_DISABLED'))

const lowTrust = planShadowAction(event({ sourceTrust: 'STRUCTURED_OTA_EMAIL' }))
const lowTrustDecision = evaluateShadowAutonomyPolicy(policy(), lowTrust)
assert.equal(lowTrustDecision.outcome, 'SHADOW_BLOCKED')
assert.ok(lowTrustDecision.reasons.includes('SOURCE_TRUST_BELOW_MINIMUM'))

const foreignPolicyDecision = evaluateShadowAutonomyPolicy(policy({ propertyId: 'property-b' }), candidate)
assert.ok(foreignPolicyDecision.reasons.includes('POLICY_SCOPE_MISMATCH'))

const volumeBlocked = evaluateShadowAutonomyPolicy(policy(), candidate, { actionsThisHour: 5, actionsToday: 4 })
assert.ok(volumeBlocked.reasons.includes('HOURLY_VOLUME_LIMIT'))

const boundedCandidate = {
  ...candidate,
  impact: {
    roomsAffected: 2,
    dateRange: { start: '2026-07-18', end: '2026-07-30' },
    currentRateSatang: '100000',
    proposedRateSatang: '200000',
    availableProof: [],
  },
}
const boundedDecision = evaluateShadowAutonomyPolicy(
  policy({ requiredProof: ['acknowledgement'], quietHours: { timezone: 'Asia/Bangkok', start: '20:00', end: '06:00' } }),
  boundedCandidate,
  { now: '2026-07-18T15:00:00.000Z' },
)
for (const reason of [
  'ROOM_LIMIT',
  'DATE_RANGE_LIMIT',
  'RATE_PERCENT_LIMIT',
  'RATE_ABSOLUTE_LIMIT',
  'QUIET_HOURS',
  'REQUIRED_PROOF_MISSING',
]) {
  assert.ok(boundedDecision.reasons.includes(reason), `${reason} is enforced`)
}

assert.throws(
  () => parseAutonomyPolicy(policy({ mode: 'AUTO_BOUNDED' })),
  /Only OBSERVE and SHADOW policies/,
)
assert.equal(
  evaluateShadowAutonomyPolicy(policy({ mode: 'PROHIBITED' }), candidate).outcome,
  'PROHIBITED',
)
assert.throws(
  () => assertSanitizedAutonomyValue({ apiToken: 'not-allowed' }),
  /credential-shaped/,
)
assert.throws(
  () => assertSanitizedAutonomyValue({ guestEmail: 'guest@example.test' }),
  /direct-contact/,
)

console.log('Autonomy shadow contracts and deterministic policy checks passed.')
