/* global console, process */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const DEFAULT_PROVIDER_ORDER = Object.freeze(['booking_com', 'agoda', 'trip_com'])
export const MINIMUM_SHADOW_HOURS = 7 * 24
export const MINIMUM_OBSERVATION_HOURS = 48

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'kind',
  'mode',
  'providerOrder',
  'sequenceOverride',
  'prerequisites',
  'shadow',
  'providers',
]
const EXPORT_KEYS = ['createdAt', 'exportRef', 'sha256']
const PREREQUISITE_KEYS = [
  'ownerApprovalRef',
  'changeTicketRef',
  'rollbackRunbookRef',
  'staffBriefingRef',
  'baselineLittleHotelierExport',
  'baselinePmsExport',
]
const SHADOW_KEYS = [
  'startedAt',
  'endedAt',
  'littleHotelierEndExport',
  'pmsEndExport',
  'reconciliationEvidenceRef',
  'reconciliationStatus',
  'unresolvedDifferences',
  'signOffRef',
]
const PROVIDER_KEYS = [
  'preCutoverExport',
  'rollbackSnapshot',
  'rollbackProcedureRef',
  'rollbackTestEvidenceRef',
  'cutoverAt',
  'cutoverEvidenceRef',
  'observationEndedAt',
  'observationEvidenceRef',
  'reconciliationEvidenceRef',
  'reconciliationStatus',
  'unresolvedDifferences',
  'signOffRef',
  'rolledBackAt',
  'rollbackEvidenceRef',
  'postRollbackReconciliationRef',
  'postRollbackStatus',
  'postRollbackUnresolvedDifferences',
]
const SEQUENCE_OVERRIDE_KEYS = ['approvedAt', 'ownerApprovalRef', 'reason']
const FORBIDDEN_KEY_FRAGMENTS = [
  'password',
  'passphrase',
  'secret',
  'token',
  'credential',
  'authorization',
  'cookie',
  'guest',
  'email',
  'phone',
  'address',
  'cardnumber',
  'reservationid',
]

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!isRecord(value)) return value === undefined ? null : value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]),
  )
}

export function littleHotelierCutoverStateSha256(state) {
  const canonical = JSON.stringify(canonicalizeJson(state)) ?? 'null'
  return createHash('sha256').update(canonical).digest('hex')
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function assertOnlyKeys(value, allowedKeys, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'OBJECT_REQUIRED', path, 'A JSON object is required.')
    return false
  }
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, 'UNKNOWN_FIELD', `${path}.${key}`, 'Unknown fields are not allowed in cutover state.')
    }
  }
  return true
}

function scanForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${path}[${index}]`, errors))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      addError(
        errors,
        'SENSITIVE_FIELD_FORBIDDEN',
        `${path}.${key}`,
        'Credentials and guest data are forbidden in cutover tracker state.',
      )
    }
    scanForbiddenKeys(child, `${path}.${key}`, errors)
  }
}

function requireEvidenceRef(value, path, errors) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(value)) {
    addError(
      errors,
      'EVIDENCE_REF_REQUIRED',
      path,
      'A non-sensitive opaque evidence reference is required; inline evidence and URL query strings are not allowed.',
    )
    return false
  }
  return true
}

function parseRequiredDate(value, path, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    addError(errors, 'TIMESTAMP_REQUIRED', path, 'An ISO-8601 timestamp is required.')
    return null
  }
  const normalized = value.trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/)
  const parts = match ? match.slice(1, 7).map(Number) : []
  const milliseconds = match?.[7] ? Number(match[7].padEnd(3, '0')) : 0
  const offset = match?.[8] || ''
  const offsetValid = offset === 'Z'
    || (/^[+-](\d{2}):(\d{2})$/.test(offset)
      && Number(offset.slice(1, 3)) <= 23
      && Number(offset.slice(4, 6)) <= 59)
  const localRoundTrip = match
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], milliseconds))
    : null
  const componentsValid = Boolean(localRoundTrip)
    && localRoundTrip.getUTCFullYear() === parts[0]
    && localRoundTrip.getUTCMonth() === parts[1] - 1
    && localRoundTrip.getUTCDate() === parts[2]
    && localRoundTrip.getUTCHours() === parts[3]
    && localRoundTrip.getUTCMinutes() === parts[4]
    && localRoundTrip.getUTCSeconds() === parts[5]
  const date = new Date(normalized)
  if (!match || !offsetValid || !componentsValid || !Number.isFinite(date.getTime())) {
    addError(errors, 'TIMESTAMP_INVALID', path, 'A real ISO-8601 timestamp with Z or an explicit UTC offset is required.')
    return null
  }
  return date
}

function parseOptionalDate(value, path, errors) {
  if (value === null || value === undefined || value === '') return null
  return parseRequiredDate(value, path, errors)
}

function requirePastOrPresent(date, now, path, errors) {
  if (date && date.getTime() > now.getTime()) {
    addError(errors, 'TIMESTAMP_IN_FUTURE', path, 'Completed cutover evidence cannot be dated in the future.')
  }
}

function validateExportEvidence(value, path, errors, now) {
  if (!assertOnlyKeys(value, EXPORT_KEYS, path, errors)) return null
  const createdAt = parseRequiredDate(value.createdAt, `${path}.createdAt`, errors)
  requirePastOrPresent(createdAt, now, `${path}.createdAt`, errors)
  requireEvidenceRef(value.exportRef, `${path}.exportRef`, errors)
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    addError(errors, 'SHA256_REQUIRED', `${path}.sha256`, 'A 64-character SHA-256 checksum is required.')
  }
  return createdAt
}

function validatePassingReconciliation(value, unresolvedDifferences, path, errors) {
  if (value !== 'PASS') {
    addError(errors, 'RECONCILIATION_NOT_PASSING', `${path}.reconciliationStatus`, 'Reconciliation status must be PASS.')
  }
  if (unresolvedDifferences !== 0) {
    addError(errors, 'UNRESOLVED_DIFFERENCES', `${path}.unresolvedDifferences`, 'Unresolved differences must be exactly zero.')
  }
}

function hasAnyDeclaredAction(provider) {
  return [
    provider?.cutoverAt,
    provider?.cutoverEvidenceRef,
    provider?.observationEndedAt,
    provider?.observationEvidenceRef,
    provider?.reconciliationEvidenceRef,
    provider?.reconciliationStatus,
    provider?.signOffRef,
    provider?.rolledBackAt,
    provider?.rollbackEvidenceRef,
    provider?.postRollbackReconciliationRef,
    provider?.postRollbackStatus,
  ].some((value) => value !== null && value !== undefined && value !== '')
}

function validateProviderPreparation(provider, path, errors, now, cutoverAt = null) {
  const preCutoverAt = validateExportEvidence(provider.preCutoverExport, `${path}.preCutoverExport`, errors, now)
  const rollbackSnapshotAt = validateExportEvidence(provider.rollbackSnapshot, `${path}.rollbackSnapshot`, errors, now)
  requireEvidenceRef(provider.rollbackProcedureRef, `${path}.rollbackProcedureRef`, errors)
  requireEvidenceRef(provider.rollbackTestEvidenceRef, `${path}.rollbackTestEvidenceRef`, errors)
  if (cutoverAt && preCutoverAt && preCutoverAt > cutoverAt) {
    addError(errors, 'EXPORT_AFTER_CUTOVER', `${path}.preCutoverExport.createdAt`, 'The pre-cutover export must be captured no later than cutover.')
  }
  if (cutoverAt && rollbackSnapshotAt && rollbackSnapshotAt > cutoverAt) {
    addError(errors, 'ROLLBACK_SNAPSHOT_AFTER_CUTOVER', `${path}.rollbackSnapshot.createdAt`, 'The rollback snapshot must be captured no later than cutover.')
  }
}

function validateObservation(provider, path, errors, now, cutoverAt) {
  const observationEndedAt = parseRequiredDate(provider.observationEndedAt, `${path}.observationEndedAt`, errors)
  requirePastOrPresent(observationEndedAt, now, `${path}.observationEndedAt`, errors)
  if (cutoverAt && observationEndedAt) {
    const elapsedHours = (observationEndedAt - cutoverAt) / 3_600_000
    if (elapsedHours < MINIMUM_OBSERVATION_HOURS) {
      addError(
        errors,
        'OBSERVATION_WINDOW_TOO_SHORT',
        `${path}.observationEndedAt`,
        `Each provider requires at least ${MINIMUM_OBSERVATION_HOURS} hours of observation after cutover.`,
      )
    }
  }
  requireEvidenceRef(provider.observationEvidenceRef, `${path}.observationEvidenceRef`, errors)
  requireEvidenceRef(provider.reconciliationEvidenceRef, `${path}.reconciliationEvidenceRef`, errors)
  requireEvidenceRef(provider.signOffRef, `${path}.signOffRef`, errors)
  validatePassingReconciliation(provider.reconciliationStatus, provider.unresolvedDifferences, path, errors)
  return observationEndedAt
}

function validateRollback(provider, path, errors, now, cutoverAt) {
  const rolledBackAt = parseRequiredDate(provider.rolledBackAt, `${path}.rolledBackAt`, errors)
  requirePastOrPresent(rolledBackAt, now, `${path}.rolledBackAt`, errors)
  if (cutoverAt && rolledBackAt && rolledBackAt < cutoverAt) {
    addError(errors, 'ROLLBACK_BEFORE_CUTOVER', `${path}.rolledBackAt`, 'Rollback cannot precede provider cutover.')
  }
  requireEvidenceRef(provider.rollbackEvidenceRef, `${path}.rollbackEvidenceRef`, errors)
  requireEvidenceRef(provider.postRollbackReconciliationRef, `${path}.postRollbackReconciliationRef`, errors)
  if (provider.postRollbackStatus !== 'PASS') {
    addError(errors, 'POST_ROLLBACK_NOT_PASSING', `${path}.postRollbackStatus`, 'Post-rollback reconciliation status must be PASS.')
  }
  if (provider.postRollbackUnresolvedDifferences !== 0) {
    addError(errors, 'POST_ROLLBACK_DIFFERENCES', `${path}.postRollbackUnresolvedDifferences`, 'Post-rollback unresolved differences must be exactly zero.')
  }
  return rolledBackAt
}

function parseGate(gate, errors) {
  if (gate === 'shadow' || gate === 'complete') return { action: gate, provider: null }
  const match = /^(ready|observe|rollback):(booking_com|agoda|trip_com)$/.exec(String(gate || ''))
  if (!match) {
    addError(
      errors,
      'GATE_INVALID',
      'gate',
      'Gate must be shadow, complete, ready:<provider>, observe:<provider>, or rollback:<provider>.',
    )
    return { action: null, provider: null }
  }
  return { action: match[1], provider: match[2] }
}

export function createLittleHotelierCutoverTemplate() {
  const blankExport = () => ({ createdAt: '', exportRef: '', sha256: '' })
  const blankProvider = () => ({
    preCutoverExport: blankExport(),
    rollbackSnapshot: blankExport(),
    rollbackProcedureRef: '',
    rollbackTestEvidenceRef: '',
    cutoverAt: null,
    cutoverEvidenceRef: null,
    observationEndedAt: null,
    observationEvidenceRef: null,
    reconciliationEvidenceRef: null,
    reconciliationStatus: null,
    unresolvedDifferences: null,
    signOffRef: null,
    rolledBackAt: null,
    rollbackEvidenceRef: null,
    postRollbackReconciliationRef: null,
    postRollbackStatus: null,
    postRollbackUnresolvedDifferences: null,
  })
  return {
    schemaVersion: 1,
    kind: 'LITTLE_HOTELIER_SEQUENTIAL_CUTOVER',
    mode: 'TRACKING_ONLY',
    providerOrder: [...DEFAULT_PROVIDER_ORDER],
    sequenceOverride: null,
    prerequisites: {
      ownerApprovalRef: '',
      changeTicketRef: '',
      rollbackRunbookRef: '',
      staffBriefingRef: '',
      baselineLittleHotelierExport: blankExport(),
      baselinePmsExport: blankExport(),
    },
    shadow: {
      startedAt: '',
      endedAt: '',
      littleHotelierEndExport: blankExport(),
      pmsEndExport: blankExport(),
      reconciliationEvidenceRef: '',
      reconciliationStatus: null,
      unresolvedDifferences: null,
      signOffRef: '',
    },
    providers: Object.fromEntries(DEFAULT_PROVIDER_ORDER.map((provider) => [provider, blankProvider()])),
  }
}

export function validateLittleHotelierCutoverState(state, { gate, now = new Date() } = {}) {
  const errors = []
  const checkedAt = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(checkedAt.getTime())) {
    addError(errors, 'CHECK_TIME_INVALID', 'now', 'Validation time must be a valid timestamp.')
  }
  const parsedGate = parseGate(gate, errors)

  if (!assertOnlyKeys(state, TOP_LEVEL_KEYS, 'state', errors)) {
    return { ok: false, gate: String(gate || ''), checkedAt: null, errors }
  }
  scanForbiddenKeys(state, 'state', errors)
  if (state.schemaVersion !== 1) addError(errors, 'SCHEMA_VERSION_INVALID', 'state.schemaVersion', 'schemaVersion must be 1.')
  if (state.kind !== 'LITTLE_HOTELIER_SEQUENTIAL_CUTOVER') addError(errors, 'KIND_INVALID', 'state.kind', 'Cutover state kind is invalid.')
  if (state.mode !== 'TRACKING_ONLY') addError(errors, 'MODE_INVALID', 'state.mode', 'mode must be TRACKING_ONLY; this validator does not perform live cutovers.')

  const providerOrder = Array.isArray(state.providerOrder) ? state.providerOrder : []
  if (
    providerOrder.length !== DEFAULT_PROVIDER_ORDER.length
    || new Set(providerOrder).size !== DEFAULT_PROVIDER_ORDER.length
    || DEFAULT_PROVIDER_ORDER.some((provider) => !providerOrder.includes(provider))
  ) {
    addError(errors, 'PROVIDER_ORDER_INVALID', 'state.providerOrder', 'Provider order must contain Booking.com, Agoda, and Trip.com exactly once.')
  }
  const usesDefaultOrder = providerOrder.every((provider, index) => provider === DEFAULT_PROVIDER_ORDER[index])
  if (!usesDefaultOrder) {
    if (assertOnlyKeys(state.sequenceOverride, SEQUENCE_OVERRIDE_KEYS, 'state.sequenceOverride', errors)) {
      const approvedAt = parseRequiredDate(state.sequenceOverride.approvedAt, 'state.sequenceOverride.approvedAt', errors)
      requirePastOrPresent(approvedAt, checkedAt, 'state.sequenceOverride.approvedAt', errors)
      requireEvidenceRef(state.sequenceOverride.ownerApprovalRef, 'state.sequenceOverride.ownerApprovalRef', errors)
      if (typeof state.sequenceOverride.reason !== 'string' || state.sequenceOverride.reason.trim().length < 10) {
        addError(errors, 'SEQUENCE_OVERRIDE_REASON_REQUIRED', 'state.sequenceOverride.reason', 'A recorded operational reason of at least 10 characters is required.')
      }
    }
  } else if (state.sequenceOverride !== null) {
    addError(errors, 'UNNEEDED_SEQUENCE_OVERRIDE', 'state.sequenceOverride', 'sequenceOverride must be null when the default provider order is used.')
  }

  let shadowStartedAt = null
  let shadowEndedAt = null
  if (assertOnlyKeys(state.prerequisites, PREREQUISITE_KEYS, 'state.prerequisites', errors)) {
    requireEvidenceRef(state.prerequisites.ownerApprovalRef, 'state.prerequisites.ownerApprovalRef', errors)
    requireEvidenceRef(state.prerequisites.changeTicketRef, 'state.prerequisites.changeTicketRef', errors)
    requireEvidenceRef(state.prerequisites.rollbackRunbookRef, 'state.prerequisites.rollbackRunbookRef', errors)
    requireEvidenceRef(state.prerequisites.staffBriefingRef, 'state.prerequisites.staffBriefingRef', errors)
    validateExportEvidence(state.prerequisites.baselineLittleHotelierExport, 'state.prerequisites.baselineLittleHotelierExport', errors, checkedAt)
    validateExportEvidence(state.prerequisites.baselinePmsExport, 'state.prerequisites.baselinePmsExport', errors, checkedAt)
  }

  if (assertOnlyKeys(state.shadow, SHADOW_KEYS, 'state.shadow', errors)) {
    shadowStartedAt = parseRequiredDate(state.shadow.startedAt, 'state.shadow.startedAt', errors)
    shadowEndedAt = parseRequiredDate(state.shadow.endedAt, 'state.shadow.endedAt', errors)
    requirePastOrPresent(shadowEndedAt, checkedAt, 'state.shadow.endedAt', errors)
    if (shadowStartedAt && shadowEndedAt) {
      const shadowHours = (shadowEndedAt - shadowStartedAt) / 3_600_000
      if (shadowHours < MINIMUM_SHADOW_HOURS) {
        addError(
          errors,
          'SHADOW_WINDOW_TOO_SHORT',
          'state.shadow.endedAt',
          `Shadow operation must run for at least ${MINIMUM_SHADOW_HOURS} hours.`,
        )
      }
    }
    const littleHotelierEndAt = validateExportEvidence(state.shadow.littleHotelierEndExport, 'state.shadow.littleHotelierEndExport', errors, checkedAt)
    const pmsEndAt = validateExportEvidence(state.shadow.pmsEndExport, 'state.shadow.pmsEndExport', errors, checkedAt)
    if (shadowEndedAt && littleHotelierEndAt && littleHotelierEndAt < shadowEndedAt) {
      addError(errors, 'SHADOW_END_EXPORT_TOO_EARLY', 'state.shadow.littleHotelierEndExport.createdAt', 'The end export must be captured at or after the shadow window ends.')
    }
    if (shadowEndedAt && pmsEndAt && pmsEndAt < shadowEndedAt) {
      addError(errors, 'SHADOW_END_EXPORT_TOO_EARLY', 'state.shadow.pmsEndExport.createdAt', 'The end export must be captured at or after the shadow window ends.')
    }
    requireEvidenceRef(state.shadow.reconciliationEvidenceRef, 'state.shadow.reconciliationEvidenceRef', errors)
    requireEvidenceRef(state.shadow.signOffRef, 'state.shadow.signOffRef', errors)
    validatePassingReconciliation(state.shadow.reconciliationStatus, state.shadow.unresolvedDifferences, 'state.shadow', errors)
  }

  if (state.prerequisites && shadowStartedAt) {
    for (const name of ['baselineLittleHotelierExport', 'baselinePmsExport']) {
      const date = parseOptionalDate(state.prerequisites[name]?.createdAt, `state.prerequisites.${name}.createdAt`, [])
      if (date && date > shadowStartedAt) {
        addError(errors, 'BASELINE_EXPORT_TOO_LATE', `state.prerequisites.${name}.createdAt`, 'Baseline exports must be captured no later than shadow start.')
      }
    }
  }

  const providers = state.providers
  if (assertOnlyKeys(providers, DEFAULT_PROVIDER_ORDER, 'state.providers', errors)) {
    for (const providerName of DEFAULT_PROVIDER_ORDER) {
      assertOnlyKeys(providers[providerName], PROVIDER_KEYS, `state.providers.${providerName}`, errors)
    }
  }

  const providerFacts = new Map()
  for (const providerName of providerOrder.filter((provider) => DEFAULT_PROVIDER_ORDER.includes(provider))) {
    const provider = providers?.[providerName]
    const path = `state.providers.${providerName}`
    if (!isRecord(provider)) continue
    const cutoverAt = parseOptionalDate(provider.cutoverAt, `${path}.cutoverAt`, errors)
    const observationEndedAt = parseOptionalDate(provider.observationEndedAt, `${path}.observationEndedAt`, errors)
    const rolledBackAt = parseOptionalDate(provider.rolledBackAt, `${path}.rolledBackAt`, errors)
    providerFacts.set(providerName, { cutoverAt, observationEndedAt, rolledBackAt })

    if (!cutoverAt && hasAnyDeclaredAction(provider)) {
      addError(errors, 'CUTOVER_TIMESTAMP_REQUIRED', `${path}.cutoverAt`, 'Provider action evidence cannot be recorded without a cutover timestamp.')
    }
    if (cutoverAt) {
      requirePastOrPresent(cutoverAt, checkedAt, `${path}.cutoverAt`, errors)
      if (shadowEndedAt && cutoverAt < shadowEndedAt) {
        addError(errors, 'CUTOVER_BEFORE_SHADOW_END', `${path}.cutoverAt`, 'Provider cutover cannot precede completion of the seven-day shadow window.')
      }
      validateProviderPreparation(provider, path, errors, checkedAt, cutoverAt)
      requireEvidenceRef(provider.cutoverEvidenceRef, `${path}.cutoverEvidenceRef`, errors)
    }
    if (observationEndedAt || provider.observationEvidenceRef || provider.reconciliationEvidenceRef || provider.reconciliationStatus || provider.signOffRef) {
      validateObservation(provider, path, errors, checkedAt, cutoverAt)
    }
    if (rolledBackAt || provider.rollbackEvidenceRef || provider.postRollbackReconciliationRef || provider.postRollbackStatus) {
      validateRollback(provider, path, errors, checkedAt, cutoverAt)
    }
  }

  for (let index = 1; index < providerOrder.length; index += 1) {
    const providerName = providerOrder[index]
    const previousName = providerOrder[index - 1]
    const current = providerFacts.get(providerName)
    const previous = providerFacts.get(previousName)
    if (!current?.cutoverAt) continue
    if (!previous?.observationEndedAt) {
      addError(errors, 'PROVIDER_OVERLAP', `state.providers.${providerName}.cutoverAt`, `The ${previousName} 48-hour observation must finish before ${providerName} cutover.`)
    } else if (current.cutoverAt < previous.observationEndedAt) {
      addError(errors, 'PROVIDER_OVERLAP', `state.providers.${providerName}.cutoverAt`, `The ${providerName} cutover overlaps the prior provider observation window.`)
    }
    if (previous?.rolledBackAt) {
      addError(errors, 'CUTOVER_AFTER_ROLLBACK', `state.providers.${providerName}.cutoverAt`, 'A rolled-back provider stops the sequence; begin a new versioned tracker after remediation.')
    }
  }

  const activeProviders = [...providerFacts.entries()].filter(([, facts]) => facts.cutoverAt && !facts.observationEndedAt && !facts.rolledBackAt)
  if (activeProviders.length > 1) {
    addError(errors, 'MULTIPLE_ACTIVE_PROVIDERS', 'state.providers', 'Only one OTA may be in cutover observation at a time.')
  }

  if (parsedGate.action === 'ready' && parsedGate.provider) {
    const index = providerOrder.indexOf(parsedGate.provider)
    const target = providers?.[parsedGate.provider]
    const targetPath = `state.providers.${parsedGate.provider}`
    if (target?.cutoverAt) {
      addError(errors, 'CUTOVER_ALREADY_RECORDED', `${targetPath}.cutoverAt`, 'Use the observe gate after cutover has been recorded.')
    }
    if (isRecord(target)) validateProviderPreparation(target, targetPath, errors, checkedAt)
    for (const priorName of providerOrder.slice(0, Math.max(index, 0))) {
      const prior = providerFacts.get(priorName)
      if (!prior?.observationEndedAt || prior?.rolledBackAt) {
        addError(errors, 'PRIOR_PROVIDER_NOT_OBSERVED', targetPath, `The ${priorName} provider must pass its 48-hour observation before this cutover.`)
      }
    }
    if (activeProviders.length > 0) {
      addError(errors, 'PROVIDER_ALREADY_ACTIVE', targetPath, 'Another provider is already in its observation window.')
    }
  }

  if (parsedGate.action === 'observe' && parsedGate.provider) {
    const provider = providers?.[parsedGate.provider]
    const facts = providerFacts.get(parsedGate.provider)
    if (!facts?.cutoverAt) {
      addError(errors, 'CUTOVER_TIMESTAMP_REQUIRED', `state.providers.${parsedGate.provider}.cutoverAt`, 'Observation cannot pass without a recorded cutover timestamp.')
    }
    if (isRecord(provider)) validateObservation(provider, `state.providers.${parsedGate.provider}`, errors, checkedAt, facts?.cutoverAt)
    if (facts?.rolledBackAt) {
      addError(errors, 'PROVIDER_ROLLED_BACK', `state.providers.${parsedGate.provider}.rolledBackAt`, 'A rolled-back provider cannot pass observation.')
    }
  }

  if (parsedGate.action === 'rollback' && parsedGate.provider) {
    const provider = providers?.[parsedGate.provider]
    const facts = providerFacts.get(parsedGate.provider)
    if (!facts?.cutoverAt) {
      addError(errors, 'CUTOVER_TIMESTAMP_REQUIRED', `state.providers.${parsedGate.provider}.cutoverAt`, 'Rollback cannot pass without a recorded cutover timestamp.')
    }
    if (isRecord(provider)) validateRollback(provider, `state.providers.${parsedGate.provider}`, errors, checkedAt, facts?.cutoverAt)
    const laterProviders = providerOrder.slice(providerOrder.indexOf(parsedGate.provider) + 1)
    if (laterProviders.some((providerName) => providerFacts.get(providerName)?.cutoverAt)) {
      addError(errors, 'ROLLBACK_AFTER_LATER_CUTOVER', `state.providers.${parsedGate.provider}.rolledBackAt`, 'Rollback validation fails if a later provider has already begun cutover.')
    }
  }

  if (parsedGate.action === 'complete') {
    for (const providerName of providerOrder) {
      const provider = providers?.[providerName]
      const facts = providerFacts.get(providerName)
      if (!facts?.cutoverAt) {
        addError(errors, 'CUTOVER_TIMESTAMP_REQUIRED', `state.providers.${providerName}.cutoverAt`, 'Completion requires a recorded cutover timestamp for every provider.')
      }
      if (isRecord(provider)) validateObservation(provider, `state.providers.${providerName}`, errors, checkedAt, facts?.cutoverAt)
      if (facts?.rolledBackAt) {
        addError(errors, 'SEQUENCE_CONTAINS_ROLLBACK', `state.providers.${providerName}.rolledBackAt`, 'A sequence containing a rollback cannot be declared complete.')
      }
    }
  }

  return {
    ok: errors.length === 0,
    gate: String(gate || ''),
    checkedAt: Number.isFinite(checkedAt.getTime()) ? checkedAt.toISOString() : null,
    schemaVersion: isRecord(state) && Number.isInteger(state.schemaVersion) ? state.schemaVersion : null,
    stateSha256: littleHotelierCutoverStateSha256(state),
    mode: 'TRACKING_ONLY',
    providerOrder,
    errors,
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/little-hotelier-cutover.mjs --template',
    '  node scripts/little-hotelier-cutover.mjs --state <private-state.json> --gate <gate> [--at <ISO-8601>]',
    '',
    'Gates: shadow, ready:<provider>, observe:<provider>, rollback:<provider>, complete',
  ].join('\n')
}

function parseCliArgs(argv) {
  const parsed = { template: false, statePath: null, gate: null, at: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--template') parsed.template = true
    else if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--state') parsed.statePath = argv[++index]
    else if (argument === '--gate') parsed.gate = argv[++index]
    else if (argument === '--at') parsed.at = argv[++index]
    else throw new Error('Unknown command argument.')
  }
  return parsed
}

async function main() {
  let args
  try {
    args = parseCliArgs(process.argv.slice(2))
  } catch {
    console.error(usage())
    process.exitCode = 2
    return
  }
  if (args.help) {
    console.log(usage())
    return
  }
  if (args.template) {
    if (args.statePath || args.gate || args.at) {
      console.error(usage())
      process.exitCode = 2
      return
    }
    console.log(JSON.stringify(createLittleHotelierCutoverTemplate(), null, 2))
    return
  }
  if (!args.statePath || !args.gate) {
    console.error(usage())
    process.exitCode = 2
    return
  }
  let state
  try {
    state = JSON.parse((await readFile(args.statePath, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    console.error(JSON.stringify({ ok: false, code: 'STATE_FILE_INVALID', message: 'State file is missing or is not valid JSON.' }))
    process.exitCode = 2
    return
  }
  const report = validateLittleHotelierCutoverState(state, {
    gate: args.gate,
    now: args.at ? new Date(args.at) : new Date(),
  })
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) await main()
