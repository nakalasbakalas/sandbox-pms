import { z } from 'zod'

export const PROVIDER_ADAPTER_CONTRACT_VERSION = '1.0'

const PROVIDER_OPERATIONS = [
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
]

const OPERATION_METHODS = Object.freeze({
  READ_RESERVATIONS: 'readReservations',
  READ_GUEST_MESSAGES: 'readGuestMessages',
  DRAFT_GUEST_REPLY: 'draftGuestReply',
  SEND_GUEST_REPLY: 'sendGuestReply',
  READ_RATES: 'readRates',
  UPDATE_RATE: 'updateRate',
  READ_AVAILABILITY: 'readAvailability',
  UPDATE_AVAILABILITY: 'updateAvailability',
  CLOSE_ROOM: 'closeRoom',
  OPEN_ROOM: 'openRoom',
  UPDATE_DESCRIPTION: 'updateDescription',
  UPDATE_PHOTOS: 'updatePhotos',
})

const operationSchema = z.enum(PROVIDER_OPERATIONS)
const healthStatusSchema = z.enum(['ready-dry-run', 'needs-configuration', 'needs-human', 'degraded'])

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoff: z.enum(['none', 'fixed', 'exponential']),
  baseDelayMs: z.number().int().min(0).max(60_000),
  maxDelayMs: z.number().int().min(0).max(300_000),
  retryableStatusCodes: z.array(z.number().int().min(400).max(599)).max(20),
}).strict()

const rateLimitSchema = z.object({
  enforcement: z.enum(['none', 'adapter', 'provider']),
  limit: z.number().int().positive().nullable(),
  windowSeconds: z.number().int().positive().nullable(),
  source: z.enum(['unverified', 'adapter-config', 'provider-contract']),
}).strict()

const descriptorSchema = z.object({
  providerId: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  label: z.string().min(1).max(80),
  reads: z.array(operationSchema).max(PROVIDER_OPERATIONS.length),
  writes: z.array(operationSchema).max(PROVIDER_OPERATIONS.length),
  liveWriteImplemented: z.boolean().default(false),
  providerProof: z.boolean().default(false),
  retryPolicy: retryPolicySchema,
  rateLimit: rateLimitSchema,
}).strict()

export const providerAdapterContractSchema = z.object({
  contractVersion: z.literal(PROVIDER_ADAPTER_CONTRACT_VERSION),
  provider: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
    label: z.string().min(1).max(80),
  }).strict(),
  capabilities: z.object({
    health: z.literal(true),
    reads: z.array(operationSchema),
    dryRunWrites: z.array(operationSchema),
    liveWrites: z.array(operationSchema),
  }).strict(),
  mode: z.object({
    default: z.literal('dry-run'),
    liveWriteRequested: z.boolean(),
    liveWritesEnabled: z.boolean(),
    providerProof: z.boolean(),
  }).strict(),
  health: z.object({
    status: healthStatusSchema,
    configured: z.boolean(),
    authenticated: z.boolean(),
    requiresHuman: z.boolean(),
    message: z.string().max(500),
    checkedAt: z.string().datetime(),
  }).strict(),
  retryPolicy: retryPolicySchema,
  rateLimit: rateLimitSchema,
  evidence: z.object({
    maxArtifacts: z.number().int().min(1).max(20),
    allowedKinds: z.array(z.enum(['before', 'after', 'error', 'trace'])),
    requiresSafeRedaction: z.literal(true),
  }).strict(),
}).strict()

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 1,
  backoff: 'none',
  baseDelayMs: 0,
  maxDelayMs: 0,
  retryableStatusCodes: [],
})

const DEFAULT_RATE_LIMIT = Object.freeze({
  enforcement: 'none',
  limit: null,
  windowSeconds: null,
  source: 'unverified',
})

const SAFE_EVIDENCE_KINDS = new Set(['before', 'after', 'error', 'trace'])
const SAFE_REDACTION_STATUSES = new Set(['SAFE', 'REDACTED'])
const SENSITIVE_KEY = /(password|passcode|secret|token|api.?key|authorization|cookie|session|credential)/i

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

export function sanitizeProviderText(value, maxLength = 500) {
  return text(value)
    .replace(/\b(password|passcode|secret|token|api[_ -]?key|authorization|cookie|session|credential)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
    .slice(0, maxLength)
}

function safeTimestamp(value, now = new Date()) {
  const parsed = value ? new Date(value) : now
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : now.toISOString()
}

function safeEvidenceUrl(value, providerId, kind, index, redactionStatus) {
  const fallback = `mock://ota/${providerId}/${kind}-${index + 1}`
  if (!SAFE_REDACTION_STATUSES.has(redactionStatus)) return `${fallback}-redaction-blocked`
  const raw = text(value, fallback)

  try {
    const parsed = new URL(raw)
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, '[REDACTED]')
    }
    return sanitizeProviderText(parsed.toString(), 1000)
  } catch {
    return fallback
  }
}

export function sanitizeProviderEvidence(evidence, { providerId = 'provider', maxArtifacts = 10, now = new Date() } = {}) {
  const safeProviderId = /^[a-z][a-z0-9-]{1,31}$/.test(providerId) ? providerId : 'provider'
  if (!Array.isArray(evidence)) return []

  return evidence.slice(0, Math.min(Math.max(Number(maxArtifacts) || 10, 1), 20)).map((item, index) => {
    const kind = SAFE_EVIDENCE_KINDS.has(text(item?.kind).toLowerCase()) ? text(item.kind).toLowerCase() : 'trace'
    const requestedStatus = text(item?.redactionStatus, 'UNKNOWN').toUpperCase()
    const redactionStatus = SAFE_REDACTION_STATUSES.has(requestedStatus) ? requestedStatus : 'FAILED'
    return {
      id: sanitizeProviderText(item?.id || `${safeProviderId}-${kind}-${index + 1}`, 160),
      kind,
      storageUrl: safeEvidenceUrl(item?.storageUrl, safeProviderId, kind, index, redactionStatus),
      capturedAt: safeTimestamp(item?.capturedAt, now),
      redactionStatus,
    }
  })
}

function uniqueOperations(operations) {
  return [...new Set(operations)]
}

function parseDescriptor(descriptor) {
  return descriptorSchema.parse({
    ...descriptor,
    reads: uniqueOperations(descriptor?.reads || []),
    writes: uniqueOperations(descriptor?.writes || []),
    liveWriteImplemented: descriptor?.liveWriteImplemented === true,
    providerProof: descriptor?.providerProof === true,
    retryPolicy: descriptor?.retryPolicy || DEFAULT_RETRY_POLICY,
    rateLimit: descriptor?.rateLimit || DEFAULT_RATE_LIMIT,
  })
}

function validateMethods(adapter, descriptor) {
  for (const operation of [...descriptor.reads, ...descriptor.writes]) {
    const method = OPERATION_METHODS[operation]
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`${descriptor.label} adapter declares ${operation} but does not implement ${method}().`)
    }
  }
  if (typeof adapter?.healthCheck !== 'function') {
    throw new TypeError(`${descriptor.label} adapter must implement healthCheck().`)
  }
}

function liveWriteRequested(env = process.env) {
  return text(env?.OTA_LIVE_WRITES_ENABLED).toLowerCase() === 'true'
}

function publicHealth(rawHealth, now = new Date()) {
  const configured = rawHealth?.configured === true || rawHealth?.authenticated === true
  const authenticated = rawHealth?.authenticated === true
  const requiresHuman = rawHealth?.requiresHuman === true
  let status = 'degraded'
  if (!configured) status = 'needs-configuration'
  else if (requiresHuman) status = 'needs-human'
  else if (rawHealth?.ok !== false) status = 'ready-dry-run'

  return {
    status,
    configured,
    authenticated,
    requiresHuman,
    message: sanitizeProviderText(rawHealth?.message || 'Provider adapter health is unavailable.'),
    checkedAt: safeTimestamp(rawHealth?.checkedAt, now),
  }
}

export async function buildProviderAdapterContract(adapter, descriptorInput, { env = process.env, now = new Date() } = {}) {
  const descriptor = parseDescriptor(descriptorInput)
  validateMethods(adapter, descriptor)
  const requested = liveWriteRequested(env)
  const enabled = requested && descriptor.liveWriteImplemented && descriptor.providerProof
  const rawHealth = await adapter.healthCheck()

  return providerAdapterContractSchema.parse({
    contractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    provider: { id: descriptor.providerId, label: descriptor.label },
    capabilities: {
      health: true,
      reads: descriptor.reads,
      dryRunWrites: descriptor.writes,
      liveWrites: enabled ? descriptor.writes : [],
    },
    mode: {
      default: 'dry-run',
      liveWriteRequested: requested,
      liveWritesEnabled: enabled,
      providerProof: descriptor.providerProof,
    },
    health: publicHealth(rawHealth, now),
    retryPolicy: descriptor.retryPolicy,
    rateLimit: descriptor.rateLimit,
    evidence: {
      maxArtifacts: 10,
      allowedKinds: [...SAFE_EVIDENCE_KINDS],
      requiresSafeRedaction: true,
    },
  })
}

export function defineProviderAdapter(adapter, descriptorInput, options = {}) {
  const descriptor = parseDescriptor(descriptorInput)
  validateMethods(adapter, descriptor)
  Object.defineProperty(adapter, 'describeContract', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: (runtimeOptions = {}) => buildProviderAdapterContract(adapter, descriptor, { ...options, ...runtimeOptions }),
  })
  return adapter
}
