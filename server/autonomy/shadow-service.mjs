import { createHash } from 'node:crypto'
import { z } from 'zod'
import { recordDomainEvent } from '../domain-events.mjs'
import { PmsValidationError } from '../pms-domain.mjs'
import { planShadowAction } from './action-planner.mjs'
import {
  AUTONOMY_PHASE,
  assertSanitizedAutonomyValue,
  parseAutonomyPolicy,
  parseExternalEventEnvelope,
} from './contracts.mjs'
import { withAutonomyDistributedLock } from './distributed-lock.mjs'
import { evaluateShadowAutonomyPolicy } from './policy-engine.mjs'

const identifierSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const reasonSchema = z.string().trim().min(3).max(1_000)
const cursorSchema = z.object({
  value: z.string().min(1).max(2_000),
  sourceTimestamp: z.string().datetime({ offset: true }),
}).strict()
const ingestionSchema = z.object({
  propertyId: identifierSchema,
  channelId: identifierSchema.nullable().default(null),
  provider: z.string(),
  providerEventId: identifierSchema,
  eventVersion: z.string(),
  eventType: z.string(),
  sourceTrust: z.string(),
  sourceTimestamp: z.string(),
  receivedTimestamp: z.string(),
  correlationId: z.string(),
  idempotencyKey: identifierSchema,
  payloadHash: z.string(),
  evidenceIds: z.array(identifierSchema).max(50),
  normalizedPayload: z.record(z.string(), z.unknown()),
  syncCursor: cursorSchema.nullable().default(null),
}).strict()
const createPolicySchema = z.object({
  policy: z.record(z.string(), z.unknown()),
  channelId: identifierSchema.nullable().default(null),
  enabled: z.boolean().default(false),
  rollbackMethod: z.string().trim().min(3).max(500).nullable().default(null),
  reason: reasonSchema,
}).strict()
const evaluateSchema = z.object({
  eventId: identifierSchema,
  policyId: identifierSchema,
  reason: reasonSchema,
}).strict()

function parse(schema, value, label) {
  const result = schema.safeParse(value ?? {})
  if (result.success) return result.data
  const issue = result.error.issues[0]
  throw new PmsValidationError(`${label}.${issue.path.join('.') || 'input'}: ${issue.message}`, 400)
}

function requiredContext(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  const contextRole = String(context?.role || '').trim().toUpperCase()
  const actorRole = String(context?.actor?.role || '').trim().toUpperCase()
  const role = contextRole || actorRole
  if (!propertyId || !actorId || !role) throw new PmsValidationError('Authenticated property context is required.', 403)
  return { propertyId, actorId, role, contextRole, actorRole }
}

function requirePolicyRole(resolved) {
  if (!['ADMIN', 'MANAGER'].includes(resolved.role)) {
    throw new PmsValidationError('Manager or administrator authority is required to configure autonomy policy.', 403)
  }
}

function requireTrustedIngressRole(resolved) {
  if (resolved.contextRole !== 'SYSTEM' || resolved.actorRole !== 'SYSTEM') {
    throw new PmsValidationError('Trusted provider ingestion and shadow evaluation require SYSTEM authority.', 403)
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PmsValidationError('Normalized autonomy payload contains a non-finite number.', 400)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new PmsValidationError('Normalized autonomy payload contains an unsupported value.', 400)
}

export function hashNormalizedAutonomyPayload(value) {
  assertSanitizedAutonomyValue(value, 'Normalized autonomy payload')
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function hashOpaqueCursor(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function eventEnvelopeFrom(input) {
  return parseExternalEventEnvelope({
    propertyId: input.propertyId,
    channelId: input.channelId,
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventVersion: input.eventVersion,
    eventType: input.eventType,
    sourceTrust: input.sourceTrust,
    sourceTimestamp: input.sourceTimestamp,
    receivedTimestamp: input.receivedTimestamp,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    evidenceIds: input.evidenceIds,
  })
}

function publicExternalEvent(event, replayed = false) {
  return {
    id: event.id,
    propertyId: event.propertyId,
    channelId: event.channelId || null,
    provider: event.provider,
    providerEventId: event.providerEventId,
    eventVersion: event.eventVersion,
    eventType: event.eventType,
    sourceTrust: event.sourceTrust,
    status: event.status,
    correlationId: event.correlationId,
    payloadHash: event.payloadHash,
    sourceTimestamp: event.sourceTimestamp instanceof Date ? event.sourceTimestamp.toISOString() : event.sourceTimestamp,
    receivedAt: event.receivedAt instanceof Date ? event.receivedAt.toISOString() : event.receivedAt,
    replayed,
  }
}

const PROVIDER_BY_CHANNEL_TYPE = Object.freeze({
  BOOKING_COM: 'booking',
  AGODA: 'agoda',
  EXPEDIA: 'expedia',
  AIRBNB: 'airbnb',
  ICAL: 'internal',
})

async function requireScopedChannel(tx, propertyId, channelId, provider = null) {
  if (!channelId) return null
  const channel = await tx.channel.findFirst({
    where: { id: channelId, propertyId },
    select: { id: true, provider: true },
  })
  if (!channel) throw new PmsValidationError('Channel was not found for the active property.', 404)
  if (provider && PROVIDER_BY_CHANNEL_TYPE[channel.provider] !== provider) {
    throw new PmsValidationError('Channel provider does not match the normalized provider event.', 409)
  }
  return channel
}

async function auditAndEmit(tx, resolved, action, eventType, aggregateType, aggregateId, changes) {
  const safeChanges = assertSanitizedAutonomyValue(changes, 'Autonomy audit evidence')
  await tx.auditLog.create({
    data: {
      propertyId: resolved.propertyId,
      userId: resolved.actorId,
      action,
      entityType: aggregateType,
      entityId: aggregateId,
      changes: safeChanges,
    },
  })
  await recordDomainEvent(tx, {
    propertyId: resolved.propertyId,
    eventType,
    aggregateType,
    aggregateId,
    actorUserId: resolved.actorId,
    metadata: safeChanges,
  })
}

async function updateCursor(tx, resolved, event, syncCursor) {
  if (!syncCursor || !event.channelId) return
  await tx.providerSyncCursor.upsert({
    where: {
      propertyId_channelId: {
        propertyId: resolved.propertyId,
        channelId: event.channelId,
      },
    },
    create: {
      propertyId: resolved.propertyId,
      channelId: event.channelId,
      provider: event.provider,
      cursor: syncCursor.value,
      cursorHash: hashOpaqueCursor(syncCursor.value),
      lastSourceTimestamp: new Date(syncCursor.sourceTimestamp),
      lastSuccessfulSyncAt: new Date(),
      lastAttemptAt: new Date(),
      consecutiveFailureCount: 0,
      lastErrorCode: null,
      lastErrorSummary: null,
      updatedBy: resolved.actorId,
    },
    update: {
      provider: event.provider,
      cursor: syncCursor.value,
      cursorHash: hashOpaqueCursor(syncCursor.value),
      lastSourceTimestamp: new Date(syncCursor.sourceTimestamp),
      lastSuccessfulSyncAt: new Date(),
      lastAttemptAt: new Date(),
      consecutiveFailureCount: 0,
      lastErrorCode: null,
      lastErrorSummary: null,
      updatedBy: resolved.actorId,
    },
  })
}

async function replayExistingEvent(tx, resolved, input, event) {
  if (event.payloadHash !== input.payloadHash || event.idempotencyKey !== input.idempotencyKey) {
    throw new PmsValidationError('Provider event identity was reused with different normalized content.', 409)
  }
  await updateCursor(tx, resolved, event, input.syncCursor)
  await auditAndEmit(
    tx,
    resolved,
    'AUTONOMY_PROVIDER_EVENT_REPLAYED',
    'AUTONOMY_PROVIDER_EVENT_REPLAYED',
    'externalProviderEvent',
    event.id,
    {
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventVersion: event.eventVersion,
      correlationId: event.correlationId,
      replayed: true,
      providerWrite: false,
    },
  )
  return publicExternalEvent(event, true)
}

async function ingestTransaction(tx, resolved, input) {
  await requireScopedChannel(tx, resolved.propertyId, input.channelId, input.provider)
  const existing = await tx.externalProviderEvent.findUnique({
    where: {
      propertyId_provider_providerEventId_eventVersion: {
        propertyId: resolved.propertyId,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventVersion: input.eventVersion,
      },
    },
  })
  if (existing) return replayExistingEvent(tx, resolved, input, existing)

  const event = await tx.externalProviderEvent.create({
    data: {
      propertyId: resolved.propertyId,
      channelId: input.channelId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventVersion: input.eventVersion,
      eventType: input.eventType,
      sourceTrust: input.sourceTrust,
      status: 'NORMALIZED',
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      payloadHash: input.payloadHash,
      normalizedPayload: input.normalizedPayload,
      sanitizedEvidence: { ids: input.evidenceIds },
      sourceTimestamp: new Date(input.sourceTimestamp),
      receivedAt: new Date(input.receivedTimestamp),
      retryCount: 0,
    },
  })
  await updateCursor(tx, resolved, event, input.syncCursor)
  await auditAndEmit(
    tx,
    resolved,
    'AUTONOMY_PROVIDER_EVENT_INGESTED',
    'AUTONOMY_PROVIDER_EVENT_INGESTED',
    'externalProviderEvent',
    event.id,
    {
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventVersion: event.eventVersion,
      eventType: event.eventType,
      sourceTrust: event.sourceTrust,
      correlationId: event.correlationId,
      providerWrite: false,
    },
  )
  return publicExternalEvent(event)
}

export async function ingestExternalProviderEvent(prisma, context, rawInput) {
  const resolved = requiredContext(context)
  requireTrustedIngressRole(resolved)
  const input = parse(ingestionSchema, rawInput, 'event')
  if (input.propertyId !== resolved.propertyId) throw new PmsValidationError('Provider event property does not match the authenticated property.', 403)

  const envelope = eventEnvelopeFrom(input)
  assertSanitizedAutonomyValue(input.normalizedPayload, 'Normalized autonomy payload')
  if (input.syncCursor) assertSanitizedAutonomyValue(input.syncCursor.value, 'Provider sync cursor')
  const computedHash = hashNormalizedAutonomyPayload(input.normalizedPayload)
  if (computedHash !== envelope.payloadHash) throw new PmsValidationError('Normalized autonomy payload hash does not match.', 409)

  try {
    return await prisma.$transaction((tx) => ingestTransaction(tx, resolved, { ...input, ...envelope }), {
      isolationLevel: 'Serializable',
    })
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    return prisma.$transaction(async (tx) => {
      const existing = await tx.externalProviderEvent.findUnique({
        where: {
          propertyId_provider_providerEventId_eventVersion: {
            propertyId: resolved.propertyId,
            provider: envelope.provider,
            providerEventId: envelope.providerEventId,
            eventVersion: envelope.eventVersion,
          },
        },
      })
      if (!existing) throw new PmsValidationError('Provider event idempotency conflict.', 409)
      return replayExistingEvent(tx, resolved, { ...input, ...envelope }, existing)
    })
  }
}

function limitsFor(policy) {
  return {
    maximumRooms: policy.maximumRooms,
    maximumDateRangeDays: policy.maximumDateRangeDays,
    maximumRateChangeBasisPoints: policy.maximumRateChangeBasisPoints,
    maximumRateChangeSatang: policy.maximumRateChangeSatang,
    rateFloorSatang: policy.rateFloorSatang,
    rateCeilingSatang: policy.rateCeilingSatang,
    maximumActionsPerHour: policy.maximumActionsPerHour,
    maximumActionsPerDay: policy.maximumActionsPerDay,
    requireReadAfterWrite: policy.requireReadAfterWrite,
  }
}

export async function createAutonomyPolicy(prisma, context, rawInput) {
  const resolved = requiredContext(context)
  requirePolicyRole(resolved)
  const input = parse(createPolicySchema, rawInput, 'policy')
  const policy = parseAutonomyPolicy(input.policy)
  if (policy.propertyId !== resolved.propertyId) throw new PmsValidationError('Autonomy policy property does not match the authenticated property.', 403)

  return prisma.$transaction(async (tx) => {
    await requireScopedChannel(tx, resolved.propertyId, input.channelId, policy.provider)
    const created = await tx.autonomyPolicy.create({
      data: {
        propertyId: resolved.propertyId,
        channelId: input.channelId,
        provider: policy.provider,
        taskType: policy.taskType,
        mode: policy.mode,
        enabled: input.enabled,
        minimumSourceTrust: policy.minimumSourceTrust,
        minimumConfidenceBasisPoints: policy.minimumConfidenceBasisPoints,
        limits: limitsFor(policy),
        requiredProof: policy.requiredProof,
        rollbackMethod: input.rollbackMethod,
        approvalRole: policy.approvalRole === 'OWNER' ? 'ADMIN'
          : policy.approvalRole === 'HOTEL_MANAGER' ? 'MANAGER' : null,
        quietHours: policy.quietHours,
        emergencyStopCovered: true,
        version: policy.version,
        createdBy: resolved.actorId,
        reason: input.reason,
      },
    })
    await auditAndEmit(
      tx,
      resolved,
      'AUTONOMY_POLICY_CREATED',
      'AUTONOMY_POLICY_CREATED',
      'autonomyPolicy',
      created.id,
      {
        provider: created.provider,
        taskType: created.taskType,
        mode: created.mode,
        enabled: created.enabled,
        version: created.version,
        reason: input.reason,
        providerWrite: false,
      },
    )
    return {
      id: created.id,
      propertyId: created.propertyId,
      channelId: created.channelId,
      provider: created.provider,
      taskType: created.taskType,
      mode: created.mode,
      enabled: created.enabled,
      version: created.version,
    }
  }).catch((error) => {
    if (error?.code === 'P2002') throw new PmsValidationError('This autonomy policy version already exists.', 409)
    throw error
  })
}

function policyContract(record) {
  const limits = record.limits && typeof record.limits === 'object' ? record.limits : {}
  return {
    propertyId: record.propertyId,
    provider: record.provider,
    taskType: record.taskType,
    mode: record.mode,
    minimumSourceTrust: record.minimumSourceTrust,
    minimumConfidenceBasisPoints: record.minimumConfidenceBasisPoints,
    maximumRooms: limits.maximumRooms,
    maximumDateRangeDays: limits.maximumDateRangeDays,
    maximumRateChangeBasisPoints: limits.maximumRateChangeBasisPoints,
    maximumRateChangeSatang: limits.maximumRateChangeSatang ?? null,
    rateFloorSatang: limits.rateFloorSatang ?? null,
    rateCeilingSatang: limits.rateCeilingSatang ?? null,
    maximumActionsPerHour: limits.maximumActionsPerHour,
    maximumActionsPerDay: limits.maximumActionsPerDay,
    requireReadAfterWrite: limits.requireReadAfterWrite,
    requiredProof: Array.isArray(record.requiredProof) ? record.requiredProof : [],
    approvalRole: record.approvalRole === 'ADMIN' ? 'OWNER'
      : record.approvalRole === 'MANAGER' ? 'HOTEL_MANAGER' : null,
    quietHours: record.quietHours ?? null,
    emergencyStopCovered: true,
    version: record.version,
  }
}

function evidenceIdsFrom(event) {
  const ids = event.sanitizedEvidence && typeof event.sanitizedEvidence === 'object'
    ? event.sanitizedEvidence.ids
    : []
  return Array.isArray(ids) ? ids.filter((value) => typeof value === 'string').slice(0, 50) : []
}

function outcomeForRecord(outcome) {
  if (outcome === 'OBSERVED') return 'OBSERVED'
  if (outcome === 'SHADOW_CANDIDATE') return 'SHADOW_ELIGIBLE'
  return 'BLOCKED'
}

async function existingShadowEvaluation(tx, propertyId, idempotencyKey) {
  const run = await tx.autonomyRun.findUnique({
    where: { propertyId_idempotencyKey: { propertyId, idempotencyKey } },
    include: {
      decisions: { orderBy: { createdAt: 'asc' }, take: 1 },
      actions: { orderBy: { createdAt: 'asc' }, take: 1 },
    },
  })
  if (!run?.decisions?.[0] || !run?.actions?.[0]) return null
  return {
    runId: run.id,
    decisionId: run.decisions[0].id,
    actionExecutionId: run.actions[0].id,
    outcome: run.decisions[0].outcome,
    mode: run.mode,
    providerRequestSent: run.actions[0].providerRequestSent,
    replayed: true,
  }
}

async function evaluateInsideTransaction(tx, resolved, input) {
  const event = await tx.externalProviderEvent.findFirst({
    where: { id: input.eventId, propertyId: resolved.propertyId },
  })
  if (!event) throw new PmsValidationError('External provider event was not found for the active property.', 404)
  const policyRecord = await tx.autonomyPolicy.findFirst({
    where: { id: input.policyId, propertyId: resolved.propertyId },
  })
  if (!policyRecord) throw new PmsValidationError('Autonomy policy was not found for the active property.', 404)

  const runKey = `shadow-run:${event.id}:${policyRecord.id}:v${policyRecord.version}`
  const prior = await existingShadowEvaluation(tx, resolved.propertyId, runKey)
  if (prior) return prior

  const candidate = {
    ...planShadowAction({
      propertyId: event.propertyId,
      channelId: event.channelId,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventVersion: event.eventVersion,
      eventType: event.eventType,
      sourceTrust: event.sourceTrust,
      sourceTimestamp: event.sourceTimestamp.toISOString(),
      receivedTimestamp: event.receivedAt.toISOString(),
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      payloadHash: event.payloadHash,
      evidenceIds: evidenceIdsFrom(event),
    }),
    externalEventId: event.id,
  }
  const now = new Date()
  const rollingHourStart = new Date(now.getTime() - 60 * 60 * 1000)
  const rollingDayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [actionsThisHour, actionsToday, emergencyStop] = await Promise.all([
    tx.actionExecution.count({ where: { propertyId: resolved.propertyId, createdAt: { gte: rollingHourStart } } }),
    tx.actionExecution.count({ where: { propertyId: resolved.propertyId, createdAt: { gte: rollingDayStart } } }),
    tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId: resolved.propertyId } }),
  ])
  const policyDecision = evaluateShadowAutonomyPolicy(policyContract(policyRecord), candidate, {
    policyEnabled: policyRecord.enabled,
    emergencyStopEnabled: emergencyStop?.enabled === true,
    actionsThisHour,
    actionsToday,
    now: now.toISOString(),
  })
  const outcome = outcomeForRecord(policyDecision.outcome)
  const run = await tx.autonomyRun.create({
    data: {
      propertyId: resolved.propertyId,
      policyId: policyRecord.id,
      externalEventId: event.id,
      runType: 'EXTERNAL_EVENT_SHADOW_EVALUATION',
      triggerType: 'CANONICAL_PROVIDER_EVENT',
      mode: policyRecord.mode,
      status: 'COMPLETED',
      correlationId: event.correlationId,
      idempotencyKey: runKey,
      triggeredBy: resolved.actorId,
      managementSummary: {
        phase: AUTONOMY_PHASE,
        outcome: policyDecision.outcome,
        providerWrite: false,
        writesPerformed: false,
      },
      startedAt: now,
      completedAt: now,
    },
  })
  const policyEvidence = Object.fromEntries(
    Object.entries(policyDecision).filter(([key]) => key !== 'candidate'),
  )
  const decision = await tx.agentDecision.create({
    data: {
      propertyId: resolved.propertyId,
      runId: run.id,
      policyId: policyRecord.id,
      externalEventId: event.id,
      agentType: 'DETERMINISTIC_SHADOW_SUPERVISOR',
      decisionType: candidate.taskType,
      outcome,
      confidenceBasisPoints: candidate.confidenceBasisPoints,
      rationale: candidate.explanation,
      proposedAction: candidate,
      policyEvaluation: policyEvidence,
      correlationId: event.correlationId,
      idempotencyKey: `shadow-decision:${event.id}:${policyRecord.id}:v${policyRecord.version}`,
    },
  })
  const action = await tx.actionExecution.create({
    data: {
      propertyId: resolved.propertyId,
      runId: run.id,
      decisionId: decision.id,
      provider: event.provider,
      actionType: candidate.taskType,
      targetType: 'externalProviderEvent',
      targetId: event.id,
      mode: 'SHADOW_NOOP',
      status: outcome === 'BLOCKED' ? 'BLOCKED' : 'RECORDED',
      candidatePayload: candidate,
      result: {
        phase: AUTONOMY_PHASE,
        outcome: policyDecision.outcome,
        reason: input.reason,
        providerRequestSent: false,
      },
      providerRequestSent: false,
      retryCount: 0,
      correlationId: event.correlationId,
      idempotencyKey: `shadow-action:${event.id}:${policyRecord.id}:v${policyRecord.version}`,
    },
  })
  await tx.externalProviderEvent.update({
    where: { id: event.id },
    data: { status: 'SHADOW_EVALUATED' },
  })
  await auditAndEmit(
    tx,
    resolved,
    'AUTONOMY_SHADOW_DECISION_RECORDED',
    'AUTONOMY_SHADOW_DECISION_RECORDED',
    'agentDecision',
    decision.id,
    {
      externalEventId: event.id,
      policyId: policyRecord.id,
      runId: run.id,
      outcome,
      mode: policyRecord.mode,
      correlationId: event.correlationId,
      reason: input.reason,
      providerWrite: false,
      providerRequestSent: false,
      writesPerformed: false,
    },
  )
  return {
    runId: run.id,
    decisionId: decision.id,
    actionExecutionId: action.id,
    outcome,
    mode: policyRecord.mode,
    providerRequestSent: false,
    replayed: false,
  }
}

export async function runShadowAutonomyEvaluation(prisma, context, rawInput) {
  const resolved = requiredContext(context)
  requireTrustedIngressRole(resolved)
  const input = parse(evaluateSchema, rawInput, 'evaluation')
  const locked = await withAutonomyDistributedLock(
    prisma,
    {
      propertyId: resolved.propertyId,
      job: 'shadow-evaluation',
      source: input.eventId,
    },
    (tx) => evaluateInsideTransaction(tx, resolved, input),
  )
  if (!locked.acquired) {
    return {
      skipped: true,
      reason: locked.reason,
      providerRequestSent: false,
    }
  }
  return locked.value
}
