import { z } from 'zod'
import { PmsValidationError } from '../pms-domain.mjs'

export const AUTONOMY_PHASE = 'SHADOW_FOUNDATION'

export const AUTONOMY_PROVIDERS = Object.freeze([
  'booking',
  'agoda',
  'trip',
  'expedia',
  'airbnb',
  'channex',
  'gmail',
  'website',
  'internal',
])

export const AUTONOMY_MODES = Object.freeze([
  'OBSERVE',
  'SHADOW',
  'AUTO_INTERNAL',
  'AUTO_BOUNDED',
  'APPROVAL_REQUIRED',
  'PROHIBITED',
])

export const PHASE_ONE_AUTONOMY_MODES = Object.freeze(['OBSERVE', 'SHADOW', 'PROHIBITED'])

export const SOURCE_TRUST_LEVELS = Object.freeze([
  'AI_INTERPRETATION',
  'STAFF_COMMAND',
  'FREE_TEXT_GUEST_EMAIL',
  'VALIDATED_PROVIDER_ATTACHMENT',
  'STRUCTURED_OTA_EMAIL',
  'PROVIDER_ACKNOWLEDGEMENT',
  'AUTHENTICATED_OTA_API',
  'AUTHENTICATED_CHANNEL_WEBHOOK',
  'SIGNED_OTA_WEBHOOK',
])

export const SOURCE_TRUST_RANK = Object.freeze(Object.fromEntries(
  SOURCE_TRUST_LEVELS.map((value, index) => [value, index]),
))

export const AUTONOMY_TASK_TYPES = Object.freeze([
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
  'CREATE_HOUSEKEEPING_TASK',
  'CREATE_OPERATIONAL_ALERT',
  'CLASSIFY_GUEST_MESSAGE',
  'REPORT_ACCOUNT_HEALTH',
  'RECONCILE_PROVIDER_STATE',
])

export const EXTERNAL_EVENT_TYPES = Object.freeze([
  'NEW_BOOKING',
  'MODIFICATION',
  'CANCELLATION',
  'PAYMENT_NOTICE',
  'GUEST_MESSAGE',
  'RATE',
  'AVAILABILITY',
  'RESTRICTION',
  'PROVIDER_HEALTH',
  'UNKNOWN',
])

const identifierSchema = z.string().trim().min(1).max(160).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  'Use an opaque identifier without whitespace or contact information.',
)
const satangSchema = z.string().regex(/^\d+$/, 'Use a non-negative base-10 satang integer string.')
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const providerSchema = z.enum(AUTONOMY_PROVIDERS)
const autonomyModeSchema = z.enum(AUTONOMY_MODES)
const sourceTrustSchema = z.enum(SOURCE_TRUST_LEVELS)
const taskTypeSchema = z.enum(AUTONOMY_TASK_TYPES)
const proofSchema = z.enum(['acknowledgement', 'read_back', 'reconciliation'])

const quietHoursSchema = z.object({
  timezone: z.literal('Asia/Bangkok'),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).strict()

export const autonomyPolicySchema = z.object({
  propertyId: identifierSchema,
  provider: providerSchema,
  taskType: taskTypeSchema,
  mode: autonomyModeSchema.default('OBSERVE'),
  minimumSourceTrust: sourceTrustSchema,
  minimumConfidenceBasisPoints: z.number().int().min(0).max(10_000),
  maximumRooms: z.number().int().min(0).max(10_000),
  maximumDateRangeDays: z.number().int().min(0).max(730),
  maximumRateChangeBasisPoints: z.number().int().min(0).max(100_000),
  maximumRateChangeSatang: satangSchema.nullable().default(null),
  rateFloorSatang: satangSchema.nullable().default(null),
  rateCeilingSatang: satangSchema.nullable().default(null),
  maximumActionsPerHour: z.number().int().min(0).max(100_000),
  maximumActionsPerDay: z.number().int().min(0).max(1_000_000),
  requireReadAfterWrite: z.boolean(),
  requiredProof: z.array(proofSchema).max(3),
  approvalRole: z.enum(['OWNER', 'HOTEL_MANAGER']).nullable(),
  quietHours: quietHoursSchema.nullable().default(null),
  emergencyStopCovered: z.literal(true),
  version: z.number().int().positive(),
}).strict().superRefine((policy, context) => {
  if (!PHASE_ONE_AUTONOMY_MODES.includes(policy.mode)) {
    context.addIssue({
      code: 'custom',
      path: ['mode'],
      message: 'Only OBSERVE and SHADOW policies are accepted in the shadow-foundation phase.',
    })
  }
  if (
    policy.rateFloorSatang !== null
    && policy.rateCeilingSatang !== null
    && BigInt(policy.rateFloorSatang) > BigInt(policy.rateCeilingSatang)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['rateCeilingSatang'],
      message: 'Rate ceiling must be greater than or equal to the rate floor.',
    })
  }
})

export const externalEventEnvelopeSchema = z.object({
  propertyId: identifierSchema,
  channelId: identifierSchema.nullable().default(null),
  provider: providerSchema,
  providerEventId: identifierSchema,
  eventVersion: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/),
  eventType: z.enum(EXTERNAL_EVENT_TYPES),
  sourceTrust: sourceTrustSchema,
  sourceTimestamp: z.string().datetime({ offset: true }),
  receivedTimestamp: z.string().datetime({ offset: true }),
  correlationId: z.string().uuid(),
  idempotencyKey: identifierSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceIds: z.array(identifierSchema).max(50),
}).strict()

export const agentDecisionCandidateSchema = z.object({
  propertyId: identifierSchema,
  provider: providerSchema,
  correlationId: z.string().uuid(),
  externalEventId: identifierSchema.nullable(),
  taskType: taskTypeSchema,
  proposedMode: z.literal('SHADOW'),
  sourceTrust: sourceTrustSchema,
  confidenceBasisPoints: z.number().int().min(0).max(10_000),
  evidenceIds: z.array(identifierSchema).max(50),
  explanation: z.string().trim().min(1).max(1_000),
  proposedCommand: z.record(z.string(), z.unknown()),
  impact: z.object({
    roomsAffected: z.number().int().min(0).max(10_000),
    dateRange: z.object({
      start: dateKeySchema,
      end: dateKeySchema,
    }).strict().nullable(),
    currentRateSatang: satangSchema.nullable(),
    proposedRateSatang: satangSchema.nullable(),
    availableProof: z.array(proofSchema).max(3),
  }).strict(),
  writesPerformed: z.literal(false),
  providerCallsPerformed: z.literal(false),
  approvalRequired: z.boolean(),
}).strict()

const CREDENTIAL_KEY_PATTERN = /(password|passcode|secret|token|api.?key|authorization|cookie|session|credential)/i
const CREDENTIAL_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/i,
  /\bya29\.[A-Za-z0-9._-]+\b/i,
]
const CONTACT_VALUE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
]

function looksLikePhoneNumber(value) {
  return /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 10
}

function unsafeField(value, path = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = unsafeField(value[index], [...path, String(index)])
      if (result) return result
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEY_PATTERN.test(key)) return [...path, key].join('.')
      const result = unsafeField(child, [...path, key])
      if (result) return result
    }
    return null
  }
  if (typeof value !== 'string') return null
  if (
    [...CREDENTIAL_VALUE_PATTERNS, ...CONTACT_VALUE_PATTERNS].some((pattern) => pattern.test(value))
    || looksLikePhoneNumber(value)
  ) {
    return path.join('.') || '(value)'
  }
  return null
}

export function assertSanitizedAutonomyValue(value, label = 'Autonomy payload') {
  const path = unsafeField(value)
  if (path) throw new PmsValidationError(`${label} contains credential-shaped or direct-contact data at ${path}.`, 400)
  return value
}

export function parseAutonomyPolicy(value) {
  const parsed = autonomyPolicySchema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new PmsValidationError(`${issue.path.join('.') || 'policy'}: ${issue.message}`, 400)
}

export function parseExternalEventEnvelope(value) {
  const parsed = externalEventEnvelopeSchema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new PmsValidationError(`${issue.path.join('.') || 'event'}: ${issue.message}`, 400)
}

export function parseAgentDecisionCandidate(value) {
  const parsed = agentDecisionCandidateSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new PmsValidationError(`${issue.path.join('.') || 'decision'}: ${issue.message}`, 400)
  }
  assertSanitizedAutonomyValue(parsed.data.explanation, 'Decision explanation')
  assertSanitizedAutonomyValue(parsed.data.proposedCommand, 'Proposed command')
  return parsed.data
}
