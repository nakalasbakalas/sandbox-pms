import { z } from 'zod'
import { PmsValidationError } from './pms-domain.mjs'

const HOTEL_OPS_TASK_TYPES = [
  'READ_RESERVATIONS',
  'READ_GUEST_MESSAGES',
  'DRAFT_GUEST_REPLY',
  'SEND_GUEST_REPLY',
  'READ_RATES',
  'UPDATE_RATE',
  'READ_AVAILABILITY',
  'UPDATE_AVAILABILITY',
  'CLOSE_ROOM',
  'OPEN_ROOM',
  'UPDATE_DESCRIPTION',
  'UPDATE_PHOTOS',
  'SCAN_BOOKINGS',
  'GENERATE_RECOMMENDATION',
  'NO_OP_CLARIFY',
  'FORBIDDEN',
]

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/
const CREDENTIAL_VALUE_PATTERN = /(?:bearer\s+|basic\s+|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|password|passcode|secret|api[_-]?key|credential|session[_-]?token|access[_-]?token|refresh[_-]?token)/i
const BASIS_POINTS = 10_000

const identifierSchema = z.string().trim().min(1).max(120)
  .regex(SAFE_IDENTIFIER_PATTERN, 'Use a sanitized identifier containing letters, numbers, colon, dot, underscore, or hyphen only.')
  .refine((value) => !CREDENTIAL_VALUE_PATTERN.test(value), 'Credential-shaped identifiers are not allowed.')
const evidenceIdsSchema = z.array(identifierSchema).max(100).default([])
const dateKeySchema = z.string().regex(DATE_KEY_PATTERN, 'Use YYYY-MM-DD.')
const nonnegativeCountSchema = z.number().int().min(0).max(1_000_000)
const basisPointsSchema = z.number().int().min(0).max(BASIS_POINTS)
const moneySatangSchema = z.union([z.string(), z.bigint()]).transform((value, context) => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Use a non-negative base-10 satang integer string.' })
    return z.NEVER
  }
  return text
})

const analysisWindowSchema = z.object({
  startDate: dateKeySchema,
  endDate: dateKeySchema,
}).strict().refine((window) => window.startDate <= window.endDate, {
  message: 'Analysis window start must be on or before its end.',
})

const commonInputFields = {
  propertyId: identifierSchema,
  asOf: z.string().datetime({ offset: true }),
  window: analysisWindowSchema,
  evidenceIds: evidenceIdsSchema,
}

const demandInputSchema = z.object({
  ...commonInputFields,
  sellableRoomNights: nonnegativeCountSchema,
  bookedRoomNights: nonnegativeCountSchema,
  pickupReservations: nonnegativeCountSchema,
  baselinePickupReservations: nonnegativeCountSchema,
}).strict().refine((input) => input.bookedRoomNights <= input.sellableRoomNights, {
  path: ['bookedRoomNights'],
  message: 'Booked room nights cannot exceed sellable room nights.',
})

const cancellationRiskInputSchema = z.object({
  ...commonInputFields,
  activeReservations: nonnegativeCountSchema,
  recentCancellations: nonnegativeCountSchema,
  baselineCancellationRateBasisPoints: basisPointsSchema,
}).strict()

const housekeepingInputSchema = z.object({
  ...commonInputFields,
  openTasks: nonnegativeCountSchema,
  overdueTasks: nonnegativeCountSchema,
  highPriorityTasks: nonnegativeCountSchema,
  blockedRooms: nonnegativeCountSchema,
}).strict()
  .refine((input) => input.overdueTasks <= input.openTasks, {
    path: ['overdueTasks'],
    message: 'Overdue tasks cannot exceed open tasks.',
  })
  .refine((input) => input.highPriorityTasks <= input.openTasks, {
    path: ['highPriorityTasks'],
    message: 'High-priority tasks cannot exceed open tasks.',
  })

const rateOpportunityInputSchema = z.object({
  ...commonInputFields,
  roomTypeId: identifierSchema,
  stayDate: dateKeySchema,
  occupancyBasisPoints: basisPointsSchema,
  pickupChangeBasisPoints: z.number().int().min(-BASIS_POINTS).max(100_000),
  currentRateSatang: moneySatangSchema,
  proposedRateSatang: moneySatangSchema,
}).strict().refine((input) => input.stayDate >= input.window.startDate && input.stayDate <= input.window.endDate, {
  path: ['stayDate'],
  message: 'Stay date must be inside the analysis window.',
})

const analyzerBatchSchema = z.object({
  demand: demandInputSchema.optional(),
  cancellationRisk: cancellationRiskInputSchema.optional(),
  housekeeping: housekeepingInputSchema.optional(),
  rateOpportunity: rateOpportunityInputSchema.optional(),
}).strict().refine((input) => Object.values(input).some(Boolean), {
  message: 'At least one analyzer input is required.',
})

export const opsAnalyzerSchemas = Object.freeze({
  demand: demandInputSchema,
  cancellationRisk: cancellationRiskInputSchema,
  housekeeping: housekeepingInputSchema,
  rateOpportunity: rateOpportunityInputSchema,
  batch: analyzerBatchSchema,
})

export const opsAnalyzerPolicy = Object.freeze({
  mode: 'SUGGEST_ONLY',
  persistence: false,
  providerCalls: false,
  directMutation: false,
  hotelOpsTaskTypes: Object.freeze([...HOTEL_OPS_TASK_TYPES]),
  acceptanceControls: Object.freeze([
    'AUTHENTICATION',
    'PERMISSION',
    'APPROVAL',
    'OPERATIONAL_REASON',
    'AUDIT',
    'IDEMPOTENCY',
    'EMERGENCY_STOP',
  ]),
})

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
  throw new PmsValidationError(`${path}${issue.message}`)
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function ratioPercent(numerator, denominator) {
  if (denominator <= 0) return numerator > 0 ? 100 : 0
  return Math.round((numerator * 100) / denominator)
}

function ratioBasisPoints(numerator, denominator) {
  if (denominator <= 0) return numerator > 0 ? BASIS_POINTS : 0
  return Math.round((numerator * BASIS_POINTS) / denominator)
}

function normalizedEvidenceIds(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function acceptanceFor(taskType, suggestedCommand) {
  return Object.freeze({
    taskType,
    suggestedCommand,
    submitEndpoint: '/api/ops/commands',
    submitMethod: 'POST',
    requiresExplicitAcceptance: true,
    controls: [...opsAnalyzerPolicy.acceptanceControls],
  })
}

function recommendation({ analyzer, ruleId, severity, score, explanation, evidenceIds, taskType, suggestedCommand, metrics }) {
  if (!HOTEL_OPS_TASK_TYPES.includes(taskType)) {
    throw new PmsValidationError(`Analyzer rule ${ruleId} selected an unsupported Hotel Ops task type.`)
  }
  return Object.freeze({
    analyzer,
    ruleId,
    severity,
    score: clamp(Math.round(score), 0, 100),
    explanation,
    evidenceIds: normalizedEvidenceIds(evidenceIds),
    metrics: Object.freeze({ ...metrics }),
    suggestionOnly: true,
    writePerformed: false,
    providerCallPerformed: false,
    acceptance: acceptanceFor(taskType, suggestedCommand),
  })
}

export function analyzeDemand(rawInput) {
  const input = parseInput(demandInputSchema, rawInput)
  const occupancyPercent = ratioPercent(input.bookedRoomNights, input.sellableRoomNights)
  const pickupPercentOfBaseline = ratioPercent(input.pickupReservations, input.baselinePickupReservations)
  const score = Math.round((occupancyPercent * 7 + clamp(pickupPercentOfBaseline, 0, 200) * 1.5) / 10)

  if (occupancyPercent >= 80 && pickupPercentOfBaseline >= 125) {
    return recommendation({
      analyzer: 'DEMAND', ruleId: 'demand.high-occupancy-accelerating-pickup.v1', severity: 'HIGH', score,
      explanation: `Occupancy is ${occupancyPercent}% and pickup is ${pickupPercentOfBaseline}% of baseline; review rates before changing inventory.`,
      evidenceIds: input.evidenceIds, taskType: 'READ_RATES',
      suggestedCommand: `Review rates for ${input.window.startDate} to ${input.window.endDate} because demand is accelerating. Do not make changes without approval.`,
      metrics: { occupancyPercent, pickupPercentOfBaseline },
    })
  }

  if (occupancyPercent <= 35) {
    return recommendation({
      analyzer: 'DEMAND', ruleId: 'demand.low-occupancy.v1', severity: 'MEDIUM', score: 100 - occupancyPercent,
      explanation: `Occupancy is ${occupancyPercent}%; generate a bounded demand recommendation before any rate or availability change.`,
      evidenceIds: input.evidenceIds, taskType: 'GENERATE_RECOMMENDATION',
      suggestedCommand: `Generate a recommendation for low demand from ${input.window.startDate} to ${input.window.endDate}. Do not change rates or availability.`,
      metrics: { occupancyPercent, pickupPercentOfBaseline },
    })
  }

  return recommendation({
    analyzer: 'DEMAND', ruleId: 'demand.monitor.v1', severity: 'LOW', score,
    explanation: `Occupancy is ${occupancyPercent}% and pickup is ${pickupPercentOfBaseline}% of baseline; continue read-only monitoring.`,
    evidenceIds: input.evidenceIds, taskType: 'READ_AVAILABILITY',
    suggestedCommand: `Read availability for ${input.window.startDate} to ${input.window.endDate}.`,
    metrics: { occupancyPercent, pickupPercentOfBaseline },
  })
}

export function analyzeCancellationRisk(rawInput) {
  const input = parseInput(cancellationRiskInputSchema, rawInput)
  const denominator = input.activeReservations + input.recentCancellations
  const recentRateBasisPoints = ratioBasisPoints(input.recentCancellations, denominator)
  const baseline = input.baselineCancellationRateBasisPoints
  const relativePercent = baseline === 0 ? (recentRateBasisPoints > 0 ? 200 : 0) : ratioPercent(recentRateBasisPoints, baseline)
  const severity = recentRateBasisPoints >= 1500 || relativePercent >= 200 ? 'HIGH'
    : recentRateBasisPoints >= 750 || relativePercent >= 150 ? 'MEDIUM' : 'LOW'
  const ruleId = severity === 'HIGH' ? 'cancellation.spike-high.v1'
    : severity === 'MEDIUM' ? 'cancellation.spike-review.v1' : 'cancellation.monitor.v1'
  const score = Math.max(Math.round(recentRateBasisPoints / 100), Math.round(relativePercent / 2))
  return recommendation({
    analyzer: 'CANCELLATION_RISK', ruleId, severity, score,
    explanation: `Recent cancellation rate is ${recentRateBasisPoints} basis points versus ${baseline} basis points baseline; scan booking records before staff action.`,
    evidenceIds: input.evidenceIds, taskType: 'SCAN_BOOKINGS',
    suggestedCommand: `Scan bookings for cancellation risk from ${input.window.startDate} to ${input.window.endDate}. Do not cancel, refund, or change a booking.`,
    metrics: { recentCancellationRateBasisPoints: recentRateBasisPoints, baselineCancellationRateBasisPoints: baseline, relativePercent },
  })
}

export function analyzeHousekeeping(rawInput) {
  const input = parseInput(housekeepingInputSchema, rawInput)
  const overduePercent = ratioPercent(input.overdueTasks, input.openTasks)
  const score = clamp(input.blockedRooms * 25 + input.highPriorityTasks * 10 + overduePercent, 0, 100)
  const severity = input.blockedRooms >= 2 || input.highPriorityTasks >= 3 || overduePercent >= 50 ? 'HIGH'
    : input.blockedRooms > 0 || input.highPriorityTasks > 0 || input.overdueTasks > 0 ? 'MEDIUM' : 'LOW'
  const ruleId = severity === 'HIGH' ? 'housekeeping.blockers-high.v1'
    : severity === 'MEDIUM' ? 'housekeeping.attention.v1' : 'housekeeping.clear.v1'
  return recommendation({
    analyzer: 'HOUSEKEEPING', ruleId, severity, score,
    explanation: `${input.blockedRooms} rooms are blocked, ${input.highPriorityTasks} tasks are high priority, and ${overduePercent}% of open tasks are overdue; staff must review assignments and issues.`,
    evidenceIds: input.evidenceIds, taskType: 'GENERATE_RECOMMENDATION',
    suggestedCommand: `Generate a housekeeping recommendation for ${input.window.startDate} to ${input.window.endDate}. Do not change rooms, reservations, or availability.`,
    metrics: { blockedRooms: input.blockedRooms, highPriorityTasks: input.highPriorityTasks, overduePercent },
  })
}

export function analyzeRateOpportunity(rawInput) {
  const input = parseInput(rateOpportunityInputSchema, rawInput)
  const currentRate = BigInt(input.currentRateSatang)
  const proposedRate = BigInt(input.proposedRateSatang)
  const difference = proposedRate - currentRate
  const differenceBasisPoints = currentRate === 0n
    ? (difference === 0n ? 0 : BASIS_POINTS)
    : Number((difference * BigInt(BASIS_POINTS)) / currentRate)
  const demandSignal = input.occupancyBasisPoints >= 8000 && input.pickupChangeBasisPoints >= 1500
  const lowDemandSignal = input.occupancyBasisPoints <= 3500 && input.pickupChangeBasisPoints <= 0
  const aligned = (demandSignal && difference > 0n) || (lowDemandSignal && difference < 0n)
  const severity = aligned && Math.abs(differenceBasisPoints) >= 1000 ? 'HIGH' : aligned ? 'MEDIUM' : 'LOW'
  const ruleId = demandSignal ? 'rate.high-demand-opportunity.v1'
    : lowDemandSignal ? 'rate.low-demand-opportunity.v1' : 'rate.no-action-signal.v1'
  const score = aligned
    ? Math.round((input.occupancyBasisPoints / 100 + Math.min(Math.abs(input.pickupChangeBasisPoints) / 100, 100)) / 2)
    : 20
  return recommendation({
    analyzer: 'RATE_OPPORTUNITY', ruleId, severity, score,
    explanation: `Occupancy is ${input.occupancyBasisPoints} basis points, pickup change is ${input.pickupChangeBasisPoints} basis points, and the proposed exact-rate change is ${differenceBasisPoints} basis points; any update requires Hotel Ops approval.`,
    evidenceIds: input.evidenceIds, taskType: severity === 'LOW' ? 'READ_RATES' : 'UPDATE_RATE',
    suggestedCommand: severity === 'LOW'
      ? `Read rates for room type ${input.roomTypeId} on ${input.stayDate}.`
      : `Propose setting room type ${input.roomTypeId} to ${input.proposedRateSatang} satang on ${input.stayDate}; require approval before execution.`,
    metrics: {
      occupancyBasisPoints: input.occupancyBasisPoints,
      pickupChangeBasisPoints: input.pickupChangeBasisPoints,
      currentRateSatang: input.currentRateSatang,
      proposedRateSatang: input.proposedRateSatang,
      differenceBasisPoints,
    },
  })
}

export function runDeterministicOpsAnalyzers(rawInput) {
  const input = parseInput(analyzerBatchSchema, rawInput)
  return Object.freeze([
    ...(input.demand ? [analyzeDemand(input.demand)] : []),
    ...(input.cancellationRisk ? [analyzeCancellationRisk(input.cancellationRisk)] : []),
    ...(input.housekeeping ? [analyzeHousekeeping(input.housekeeping)] : []),
    ...(input.rateOpportunity ? [analyzeRateOpportunity(input.rateOpportunity)] : []),
  ])
}
