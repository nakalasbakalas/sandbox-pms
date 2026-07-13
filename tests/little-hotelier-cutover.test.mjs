import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLittleHotelierCutoverTemplate,
  validateLittleHotelierCutoverState,
} from '../scripts/little-hotelier-cutover.mjs'

const NOW = new Date('2026-07-14T07:00:00.000Z')
const SHA256 = 'a'.repeat(64)

function evidenceRef(name) {
  return `evidence://${name}`
}

function exportEvidence(createdAt, name) {
  return {
    createdAt,
    exportRef: evidenceRef(`${name}/export`),
    sha256: SHA256,
  }
}

function providerEvidence(name, preCutoverAt, cutoverAt, observationEndedAt) {
  return {
    preCutoverExport: exportEvidence(preCutoverAt, `${name}/pre-cutover`),
    rollbackSnapshot: exportEvidence(preCutoverAt, `${name}/rollback-snapshot`),
    rollbackProcedureRef: evidenceRef(`${name}/rollback-procedure`),
    rollbackTestEvidenceRef: evidenceRef(`${name}/rollback-test`),
    cutoverAt,
    cutoverEvidenceRef: evidenceRef(`${name}/cutover`),
    observationEndedAt,
    observationEvidenceRef: evidenceRef(`${name}/observation`),
    reconciliationEvidenceRef: evidenceRef(`${name}/reconciliation`),
    reconciliationStatus: 'PASS',
    unresolvedDifferences: 0,
    signOffRef: evidenceRef(`${name}/sign-off`),
    rolledBackAt: null,
    rollbackEvidenceRef: null,
    postRollbackReconciliationRef: null,
    postRollbackStatus: null,
    postRollbackUnresolvedDifferences: null,
  }
}

function completeState() {
  return {
    schemaVersion: 1,
    kind: 'LITTLE_HOTELIER_SEQUENTIAL_CUTOVER',
    mode: 'TRACKING_ONLY',
    providerOrder: ['booking_com', 'agoda', 'trip_com'],
    sequenceOverride: null,
    prerequisites: {
      ownerApprovalRef: evidenceRef('global/owner-approval'),
      changeTicketRef: evidenceRef('global/change-ticket'),
      rollbackRunbookRef: evidenceRef('global/rollback-runbook'),
      staffBriefingRef: evidenceRef('global/staff-briefing'),
      baselineLittleHotelierExport: exportEvidence('2026-06-30T23:00:00.000Z', 'global/little-hotelier-baseline'),
      baselinePmsExport: exportEvidence('2026-06-30T23:00:00.000Z', 'global/pms-baseline'),
    },
    shadow: {
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-08T00:00:00.000Z',
      littleHotelierEndExport: exportEvidence('2026-07-08T00:05:00.000Z', 'shadow/little-hotelier-end'),
      pmsEndExport: exportEvidence('2026-07-08T00:05:00.000Z', 'shadow/pms-end'),
      reconciliationEvidenceRef: evidenceRef('shadow/reconciliation'),
      reconciliationStatus: 'PASS',
      unresolvedDifferences: 0,
      signOffRef: evidenceRef('shadow/sign-off'),
    },
    providers: {
      booking_com: providerEvidence(
        'booking-com',
        '2026-07-08T01:00:00.000Z',
        '2026-07-08T02:00:00.000Z',
        '2026-07-10T02:00:00.000Z',
      ),
      agoda: providerEvidence(
        'agoda',
        '2026-07-10T03:00:00.000Z',
        '2026-07-10T04:00:00.000Z',
        '2026-07-12T04:00:00.000Z',
      ),
      trip_com: providerEvidence(
        'trip-com',
        '2026-07-12T05:00:00.000Z',
        '2026-07-12T06:00:00.000Z',
        '2026-07-14T06:00:00.000Z',
      ),
    },
  }
}

function errorCodes(report) {
  return new Set(report.errors.map((error) => error.code))
}

test('complete gate accepts seven-day shadow and sequential 48-hour provider observations', () => {
  const report = validateLittleHotelierCutoverState(completeState(), { gate: 'complete', now: NOW })

  assert.equal(report.ok, true)
  assert.deepEqual(report.errors, [])
  assert.equal(report.mode, 'TRACKING_ONLY')
  assert.equal(report.schemaVersion, 1)
  assert.match(report.stateSha256, /^[a-f0-9]{64}$/)
})

test('validation report hash binds the evidence report to the exact tracker state', () => {
  const original = completeState()
  const originalReport = validateLittleHotelierCutoverState(original, { gate: 'complete', now: NOW })
  const edited = JSON.parse(JSON.stringify(original))
  edited.shadow.signOffRef = evidenceRef('shadow/different-sign-off')
  const editedReport = validateLittleHotelierCutoverState(edited, { gate: 'complete', now: NOW })

  assert.notEqual(originalReport.stateSha256, editedReport.stateSha256)
})

test('shadow gate fails closed when the seven-day window is even one minute short', () => {
  const state = completeState()
  state.shadow.endedAt = '2026-07-07T23:59:00.000Z'
  const report = validateLittleHotelierCutoverState(state, { gate: 'shadow', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('SHADOW_WINDOW_TOO_SHORT'))
})

test('observe gate fails closed before 48 complete hours have elapsed', () => {
  const state = completeState()
  state.providers.trip_com.observationEndedAt = '2026-07-14T05:59:59.000Z'
  const report = validateLittleHotelierCutoverState(state, { gate: 'observe:trip_com', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('OBSERVATION_WINDOW_TOO_SHORT'))
})

test('observe gate cannot pass without a recorded cutover timestamp', () => {
  const state = completeState()
  state.providers.trip_com = createLittleHotelierCutoverTemplate().providers.trip_com
  const report = validateLittleHotelierCutoverState(state, { gate: 'observe:trip_com', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('CUTOVER_TIMESTAMP_REQUIRED'))
})

test('next OTA cannot begin until the prior OTA observation has ended', () => {
  const state = completeState()
  state.providers.agoda.cutoverAt = '2026-07-10T01:00:00.000Z'
  const report = validateLittleHotelierCutoverState(state, { gate: 'complete', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('PROVIDER_OVERLAP'))
})

test('missing exports, checksums, and evidence references fail the ready gate', () => {
  const state = completeState()
  const booking = state.providers.booking_com
  booking.cutoverAt = null
  booking.cutoverEvidenceRef = null
  booking.observationEndedAt = null
  booking.observationEvidenceRef = null
  booking.reconciliationEvidenceRef = null
  booking.reconciliationStatus = null
  booking.unresolvedDifferences = null
  booking.signOffRef = null
  booking.preCutoverExport.sha256 = ''
  booking.rollbackTestEvidenceRef = ''
  state.providers.agoda = createLittleHotelierCutoverTemplate().providers.agoda
  state.providers.trip_com = createLittleHotelierCutoverTemplate().providers.trip_com

  const report = validateLittleHotelierCutoverState(state, { gate: 'ready:booking_com', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('SHA256_REQUIRED'))
  assert.ok(errorCodes(report).has('EVIDENCE_REF_REQUIRED'))
})

test('owner-recorded sequence override is required before changing the default order', () => {
  const state = completeState()
  const blankProviders = createLittleHotelierCutoverTemplate().providers
  state.providerOrder = ['agoda', 'booking_com', 'trip_com']
  state.sequenceOverride = null
  state.providers = blankProviders
  state.providers.agoda.preCutoverExport = exportEvidence('2026-07-08T01:00:00.000Z', 'agoda/pre-cutover')
  state.providers.agoda.rollbackSnapshot = exportEvidence('2026-07-08T01:00:00.000Z', 'agoda/rollback-snapshot')
  state.providers.agoda.rollbackProcedureRef = evidenceRef('agoda/rollback-procedure')
  state.providers.agoda.rollbackTestEvidenceRef = evidenceRef('agoda/rollback-test')

  const rejected = validateLittleHotelierCutoverState(state, { gate: 'ready:agoda', now: NOW })
  assert.equal(rejected.ok, false)
  assert.ok(errorCodes(rejected).has('OBJECT_REQUIRED'))

  state.sequenceOverride = {
    approvedAt: '2026-07-08T00:30:00.000Z',
    ownerApprovalRef: evidenceRef('global/provider-order-override'),
    reason: 'Owner approved Agoda as the first controlled OTA cutover.',
  }
  const approved = validateLittleHotelierCutoverState(state, { gate: 'ready:agoda', now: NOW })
  assert.equal(approved.ok, true)
})

test('rollback can run immediately but requires restoration and reconciliation evidence', () => {
  const state = completeState()
  state.providers.booking_com.observationEndedAt = null
  state.providers.booking_com.observationEvidenceRef = null
  state.providers.booking_com.reconciliationEvidenceRef = null
  state.providers.booking_com.reconciliationStatus = null
  state.providers.booking_com.unresolvedDifferences = null
  state.providers.booking_com.signOffRef = null
  state.providers.booking_com.rolledBackAt = '2026-07-08T03:00:00.000Z'
  state.providers.booking_com.rollbackEvidenceRef = evidenceRef('booking-com/rollback-execution')
  state.providers.booking_com.postRollbackReconciliationRef = evidenceRef('booking-com/post-rollback-reconciliation')
  state.providers.booking_com.postRollbackStatus = 'PASS'
  state.providers.booking_com.postRollbackUnresolvedDifferences = 0
  state.providers.agoda = createLittleHotelierCutoverTemplate().providers.agoda
  state.providers.trip_com = createLittleHotelierCutoverTemplate().providers.trip_com

  const passed = validateLittleHotelierCutoverState(state, { gate: 'rollback:booking_com', now: NOW })
  assert.equal(passed.ok, true)

  state.providers.booking_com.postRollbackReconciliationRef = null
  const rejected = validateLittleHotelierCutoverState(state, { gate: 'rollback:booking_com', now: NOW })
  assert.equal(rejected.ok, false)
  assert.ok(errorCodes(rejected).has('EVIDENCE_REF_REQUIRED'))
})

test('strict state schema rejects credential or guest-data fields', () => {
  const state = completeState()
  state.providers.booking_com.guestName = 'must-not-be-stored'
  state.prerequisites.apiToken = 'must-not-be-stored'
  const report = validateLittleHotelierCutoverState(state, { gate: 'complete', now: NOW })

  assert.equal(report.ok, false)
  assert.ok(errorCodes(report).has('SENSITIVE_FIELD_FORBIDDEN'))
  assert.ok(errorCodes(report).has('UNKNOWN_FIELD'))
})

test('cutover timestamps require an explicit offset and reject impossible calendar dates', () => {
  const timezoneLess = completeState()
  timezoneLess.shadow.startedAt = '2026-07-01T00:00:00'
  const timezoneLessReport = validateLittleHotelierCutoverState(timezoneLess, { gate: 'complete', now: NOW })
  assert.equal(timezoneLessReport.ok, false)
  assert.ok(errorCodes(timezoneLessReport).has('TIMESTAMP_INVALID'))

  const impossible = completeState()
  impossible.shadow.startedAt = '2026-02-30T00:00:00Z'
  const impossibleReport = validateLittleHotelierCutoverState(impossible, { gate: 'complete', now: NOW })
  assert.equal(impossibleReport.ok, false)
  assert.ok(errorCodes(impossibleReport).has('TIMESTAMP_INVALID'))
})
