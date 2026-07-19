import {
  AUTONOMY_PHASE,
  SOURCE_TRUST_RANK,
  parseAgentDecisionCandidate,
  parseAutonomyPolicy,
} from './contracts.mjs'

function policyMatchesCandidate(policy, candidate) {
  return policy.propertyId === candidate.propertyId
    && policy.provider === candidate.provider
    && policy.taskType === candidate.taskType
}

function trustSatisfies(candidate, policy) {
  return SOURCE_TRUST_RANK[candidate.sourceTrust] >= SOURCE_TRUST_RANK[policy.minimumSourceTrust]
}

function dateRangeDays(dateRange) {
  if (!dateRange) return 0
  const start = Date.parse(`${dateRange.start}T00:00:00.000Z`)
  const end = Date.parse(`${dateRange.end}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.POSITIVE_INFINITY
  return Math.floor((end - start) / 86_400_000) + 1
}

function rateChange(candidate) {
  const currentText = candidate.impact.currentRateSatang
  const proposedText = candidate.impact.proposedRateSatang
  if (currentText === null || proposedText === null) return null
  const current = BigInt(currentText)
  const proposed = BigInt(proposedText)
  const absolute = current >= proposed ? current - proposed : proposed - current
  const basisPoints = current === 0n
    ? (absolute === 0n ? 0 : Number.POSITIVE_INFINITY)
    : Number((absolute * 10_000n + current / 2n) / current)
  return { current, proposed, absolute, basisPoints }
}

function minutesSinceMidnight(value) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function insideQuietHours(quietHours, nowInput) {
  if (!quietHours) return false
  const now = nowInput ? new Date(nowInput) : new Date()
  if (!Number.isFinite(now.getTime())) return true
  const bangkokParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: quietHours.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(bangkokParts.find((part) => part.type === 'hour')?.value)
  const minute = Number(bangkokParts.find((part) => part.type === 'minute')?.value)
  const current = hour * 60 + minute
  const start = minutesSinceMidnight(quietHours.start)
  const end = minutesSinceMidnight(quietHours.end)
  if (start === end) return true
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function evaluateShadowAutonomyPolicy(policyInput, candidateInput, context = {}) {
  const policy = parseAutonomyPolicy(policyInput)
  const candidate = parseAgentDecisionCandidate(candidateInput)
  const reasons = []

  if (context.policyEnabled === false) reasons.push('POLICY_DISABLED')
  if (!policyMatchesCandidate(policy, candidate)) reasons.push('POLICY_SCOPE_MISMATCH')
  if (!trustSatisfies(candidate, policy)) reasons.push('SOURCE_TRUST_BELOW_MINIMUM')
  if (candidate.confidenceBasisPoints < policy.minimumConfidenceBasisPoints) reasons.push('CONFIDENCE_BELOW_MINIMUM')
  if (context.emergencyStopEnabled === true) reasons.push('EMERGENCY_STOP_ENABLED')
  if (Number(context.actionsThisHour || 0) >= policy.maximumActionsPerHour) reasons.push('HOURLY_VOLUME_LIMIT')
  if (Number(context.actionsToday || 0) >= policy.maximumActionsPerDay) reasons.push('DAILY_VOLUME_LIMIT')
  if (candidate.impact.roomsAffected > policy.maximumRooms) reasons.push('ROOM_LIMIT')
  if (dateRangeDays(candidate.impact.dateRange) > policy.maximumDateRangeDays) reasons.push('DATE_RANGE_LIMIT')
  if (insideQuietHours(policy.quietHours, context.now)) reasons.push('QUIET_HOURS')

  const change = rateChange(candidate)
  if (change) {
    if (change.basisPoints > policy.maximumRateChangeBasisPoints) reasons.push('RATE_PERCENT_LIMIT')
    if (
      policy.maximumRateChangeSatang !== null
      && change.absolute > BigInt(policy.maximumRateChangeSatang)
    ) reasons.push('RATE_ABSOLUTE_LIMIT')
    if (policy.rateFloorSatang !== null && change.proposed < BigInt(policy.rateFloorSatang)) reasons.push('RATE_FLOOR')
    if (policy.rateCeilingSatang !== null && change.proposed > BigInt(policy.rateCeilingSatang)) reasons.push('RATE_CEILING')
  }
  const availableProof = new Set(candidate.impact.availableProof)
  if (policy.requiredProof.some((proof) => !availableProof.has(proof))) reasons.push('REQUIRED_PROOF_MISSING')

  const allowedForShadowEvaluation = reasons.length === 0 && policy.mode === 'SHADOW'
  const outcome = policy.mode === 'PROHIBITED'
    ? 'PROHIBITED'
    : policy.mode === 'OBSERVE'
    ? 'OBSERVED'
    : allowedForShadowEvaluation
      ? 'SHADOW_CANDIDATE'
      : 'SHADOW_BLOCKED'

  return Object.freeze({
    phase: AUTONOMY_PHASE,
    outcome,
    policyVersion: policy.version,
    requestedMode: policy.mode,
    effectiveMode: policy.mode,
    allowedForShadowEvaluation,
    eligibleForExecution: false,
    writesAllowed: false,
    providerCallsAllowed: false,
    approvalGranted: false,
    reasons: Object.freeze(reasons),
    candidate,
  })
}
