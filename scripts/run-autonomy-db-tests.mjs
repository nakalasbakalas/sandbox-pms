/* global console, process */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { assertSafeE2EDatabase, redactDatabaseUrl } from './db-safety.mjs'
import {
  createAutonomyPolicy,
  hashNormalizedAutonomyPayload,
  ingestExternalProviderEvent,
  runShadowAutonomyEvaluation,
} from '../server/autonomy/shadow-service.mjs'

const e2eDatabaseUrl = assertSafeE2EDatabase()
process.env.DATABASE_URL = e2eDatabaseUrl
const { createPrismaClient } = await import('../server/prisma-client.mjs')
const prisma = createPrismaClient()
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const now = new Date()

function context(property, suffixLabel, role = 'ADMIN') {
  return {
    propertyId: property.id,
    propertyCode: property.code,
    role,
    actor: {
      id: `autonomy-admin-${suffixLabel}-${suffix}`,
      role,
      propertyId: property.id,
      propertyCode: property.code,
    },
  }
}

function policyInput(propertyId, overrides = {}) {
  return {
    propertyId,
    provider: 'booking',
    taskType: 'SCAN_BOOKINGS',
    mode: 'SHADOW',
    minimumSourceTrust: 'AUTHENTICATED_OTA_API',
    minimumConfidenceBasisPoints: 8_000,
    maximumRooms: 2,
    maximumDateRangeDays: 14,
    maximumRateChangeBasisPoints: 500,
    maximumRateChangeSatang: '10000',
    rateFloorSatang: '80000',
    rateCeilingSatang: '600000',
    maximumActionsPerHour: 10,
    maximumActionsPerDay: 100,
    requireReadAfterWrite: true,
    requiredProof: [],
    approvalRole: 'OWNER',
    quietHours: null,
    emergencyStopCovered: true,
    version: 1,
    ...overrides,
  }
}

function eventInput(propertyId, channelId, providerEventId, overrides = {}) {
  const normalizedPayload = {
    bookingReferenceId: providerEventId,
    revision: '1',
    occupancy: 2,
  }
  return {
    propertyId,
    channelId,
    provider: 'booking',
    providerEventId,
    eventVersion: '1',
    eventType: 'NEW_BOOKING',
    sourceTrust: 'AUTHENTICATED_OTA_API',
    sourceTimestamp: now.toISOString(),
    receivedTimestamp: new Date(now.getTime() + 1_000).toISOString(),
    correlationId: randomUUID(),
    idempotencyKey: `booking:${providerEventId}:1`,
    payloadHash: hashNormalizedAutonomyPayload(normalizedPayload),
    evidenceIds: [`evidence-${providerEventId}`],
    normalizedPayload,
    syncCursor: {
      value: `opaque-cursor-${providerEventId}`,
      sourceTimestamp: now.toISOString(),
    },
    ...overrides,
  }
}

async function createProperty(label) {
  return prisma.property.create({
    data: {
      code: `AUTO_${label}_${suffix}`.toUpperCase(),
      name: `Autonomy ${label}`,
      taxRate: 0,
      taxRateBasisPoints: 0,
      extraGuestFee: 0,
      extraGuestFeeSatang: 0n,
      childFee: 0,
      childFeeSatang: 0n,
    },
  })
}

console.log(`Autonomy DB target: ${redactDatabaseUrl(e2eDatabaseUrl)}`)

try {
  const [propertyA, propertyB] = await Promise.all([
    createProperty('A'),
    createProperty('B'),
  ])
  const [channelA, channelB] = await Promise.all([
    prisma.channel.create({
      data: {
        propertyId: propertyA.id,
        provider: 'BOOKING_COM',
        name: 'Autonomy Booking A',
        credentialRef: null,
        credentialStatus: { state: 'not_configured', secretStored: false },
      },
    }),
    prisma.channel.create({
      data: {
        propertyId: propertyB.id,
        provider: 'BOOKING_COM',
        name: 'Autonomy Booking B',
        credentialRef: null,
        credentialStatus: { state: 'not_configured', secretStored: false },
      },
    }),
  ])
  const contextA = context(propertyA, 'a')
  const contextB = context(propertyB, 'b')
  const systemContextA = context(propertyA, 'a', 'SYSTEM')
  const systemContextB = context(propertyB, 'b', 'SYSTEM')
  const frontDeskContextA = context(propertyA, 'a', 'FRONT_DESK')
  const forgedSystemContextA = {
    ...frontDeskContextA,
    role: 'SYSTEM',
  }
  const reservationCountBefore = await prisma.reservation.count()
  const paymentCountBefore = await prisma.payment.count()

  const [policyA, policyB] = await Promise.all([
    createAutonomyPolicy(prisma, contextA, {
      channelId: channelA.id,
      enabled: true,
      policy: policyInput(propertyA.id),
      reason: 'Prove property-scoped shadow policy A.',
    }),
    createAutonomyPolicy(prisma, contextB, {
      channelId: channelB.id,
      enabled: true,
      policy: policyInput(propertyB.id),
      reason: 'Prove property-scoped shadow policy B.',
    }),
  ])

  const eventRequest = eventInput(propertyA.id, channelA.id, `booking-a-${suffix}`)
  await assert.rejects(
    ingestExternalProviderEvent(prisma, frontDeskContextA, eventRequest),
    (error) => error?.statusCode === 403,
    'staff cannot assert trusted provider source evidence',
  )
  await assert.rejects(
    ingestExternalProviderEvent(prisma, forgedSystemContextA, eventRequest),
    (error) => error?.statusCode === 403,
    'a declared SYSTEM role cannot override a non-SYSTEM actor role',
  )
  const event = await ingestExternalProviderEvent(prisma, systemContextA, eventRequest)
  const replay = await ingestExternalProviderEvent(prisma, systemContextA, eventRequest)
  assert.equal(replay.id, event.id)
  assert.equal(replay.replayed, true)
  assert.equal(
    await prisma.externalProviderEvent.count({
      where: {
        propertyId: propertyA.id,
        providerEventId: eventRequest.providerEventId,
        eventVersion: '1',
      },
    }),
    1,
    'same provider event/version is stored once',
  )
  await assert.rejects(
    ingestExternalProviderEvent(prisma, systemContextA, {
      ...eventRequest,
      normalizedPayload: { bookingReferenceId: eventRequest.providerEventId, revision: 'changed', occupancy: 2 },
      payloadHash: hashNormalizedAutonomyPayload({
        bookingReferenceId: eventRequest.providerEventId,
        revision: 'changed',
        occupancy: 2,
      }),
    }),
    (error) => error?.statusCode === 409,
    'same event identity with changed normalized content fails closed',
  )
  await assert.rejects(
    ingestExternalProviderEvent(prisma, systemContextB, eventRequest),
    (error) => error?.statusCode === 403,
    'event property cannot be forged through a different authenticated context',
  )
  await assert.rejects(
    ingestExternalProviderEvent(prisma, systemContextA, {
      ...eventInput(propertyA.id, channelA.id, `booking-secret-${suffix}`),
      normalizedPayload: { apiToken: 'credential-shaped-value' },
      payloadHash: hashNormalizedAutonomyPayload({ safe: 'placeholder' }),
    }),
    /credential-shaped/,
    'credential-shaped normalized payloads are rejected before persistence',
  )
  await assert.rejects(
    ingestExternalProviderEvent(prisma, systemContextA, {
      ...eventInput(propertyA.id, channelA.id, `booking-cursor-secret-${suffix}`),
      syncCursor: {
        value: 'Bearer provider-secret-material',
        sourceTimestamp: now.toISOString(),
      },
    }),
    /credential-shaped/,
    'credential-shaped provider cursor values are rejected before persistence',
  )
  await assert.rejects(
    runShadowAutonomyEvaluation(prisma, frontDeskContextA, {
      eventId: event.id,
      policyId: policyA.id,
      reason: 'Staff must not invoke trusted shadow evaluation.',
    }),
    (error) => error?.statusCode === 403,
    'staff cannot invoke trusted shadow evaluation',
  )

  const simultaneous = await Promise.all([
    runShadowAutonomyEvaluation(prisma, systemContextA, {
      eventId: event.id,
      policyId: policyA.id,
      reason: 'Prove concurrent shadow evaluation.',
    }),
    runShadowAutonomyEvaluation(prisma, systemContextA, {
      eventId: event.id,
      policyId: policyA.id,
      reason: 'Prove concurrent shadow evaluation.',
    }),
  ])
  assert.ok(simultaneous.every((result) => result.providerRequestSent === false))
  assert.equal(
    await prisma.autonomyRun.count({ where: { propertyId: propertyA.id, externalEventId: event.id } }),
    1,
    'distributed lock and idempotency retain one shadow run',
  )
  assert.equal(
    await prisma.actionExecution.count({ where: { propertyId: propertyA.id, targetId: event.id } }),
    1,
    'one SHADOW_NOOP action evidence row is recorded',
  )
  const action = await prisma.actionExecution.findFirst({ where: { propertyId: propertyA.id, targetId: event.id } })
  assert.equal(action.mode, 'SHADOW_NOOP')
  assert.equal(action.providerRequestSent, false)

  const disabledPolicy = await createAutonomyPolicy(prisma, contextA, {
    channelId: channelA.id,
    enabled: false,
    policy: policyInput(propertyA.id, { version: 2 }),
    reason: 'Prove disabled autonomy policy fails closed.',
  })
  const disabledEventRequest = eventInput(propertyA.id, channelA.id, `booking-disabled-${suffix}`)
  const disabledEvent = await ingestExternalProviderEvent(prisma, systemContextA, disabledEventRequest)
  const disabledResult = await runShadowAutonomyEvaluation(prisma, systemContextA, {
    eventId: disabledEvent.id,
    policyId: disabledPolicy.id,
    reason: 'Prove disabled policy remains blocked.',
  })
  assert.equal(disabledResult.outcome, 'BLOCKED')
  const disabledDecision = await prisma.agentDecision.findUnique({ where: { id: disabledResult.decisionId } })
  assert.ok(disabledDecision.policyEvaluation.reasons.includes('POLICY_DISABLED'))

  await prisma.hotelOpsEmergencyStop.create({
    data: {
      propertyId: propertyA.id,
      enabled: true,
      reason: 'Prove shadow policy stop coverage.',
      updatedBy: contextA.actor.id,
    },
  })
  const stoppedEventRequest = eventInput(propertyA.id, channelA.id, `booking-stopped-${suffix}`)
  const stoppedEvent = await ingestExternalProviderEvent(prisma, systemContextA, stoppedEventRequest)
  const stopped = await runShadowAutonomyEvaluation(prisma, systemContextA, {
    eventId: stoppedEvent.id,
    policyId: policyA.id,
    reason: 'Prove emergency-stop coverage.',
  })
  assert.equal(stopped.outcome, 'BLOCKED')
  const stoppedAction = await prisma.actionExecution.findUnique({ where: { id: stopped.actionExecutionId } })
  assert.equal(stoppedAction.status, 'BLOCKED')
  assert.equal(stoppedAction.providerRequestSent, false)

  await assert.rejects(
    runShadowAutonomyEvaluation(prisma, systemContextA, {
      eventId: stoppedEvent.id,
      policyId: policyB.id,
      reason: 'Reject a foreign-property policy.',
    }),
    'foreign-property policy cannot be evaluated',
  )

  assert.equal(await prisma.reservation.count(), reservationCountBefore, 'shadow cycle creates no reservation')
  assert.equal(await prisma.payment.count(), paymentCountBefore, 'shadow cycle creates no payment')
  assert.ok(await prisma.auditLog.count({
    where: {
      propertyId: propertyA.id,
      action: { in: ['AUTONOMY_PROVIDER_EVENT_INGESTED', 'AUTONOMY_SHADOW_DECISION_RECORDED'] },
    },
  }))
  assert.ok(await prisma.domainEvent.count({
    where: {
      propertyId: propertyA.id,
      eventType: { in: ['AUTONOMY_PROVIDER_EVENT_INGESTED', 'AUTONOMY_SHADOW_DECISION_RECORDED'] },
    },
  }))
  assert.equal(
    await prisma.externalProviderEvent.count({ where: { propertyId: propertyB.id, id: event.id } }),
    0,
    'canonical event remains isolated to its property',
  )
  const cursor = await prisma.providerSyncCursor.findUnique({
    where: { propertyId_channelId: { propertyId: propertyA.id, channelId: channelA.id } },
  })
  assert.equal(
    cursor.cursorHash,
    createHash('sha256').update(stoppedEventRequest.syncCursor.value, 'utf8').digest('hex'),
  )

  const legacyColumn = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Channel'
      AND column_name = 'credentials'
  `
  assert.equal(legacyColumn.length, 0, 'legacy channel credential JSON column is removed')

  console.log('Autonomy shadow PostgreSQL isolation, idempotency, lock, and no-write gates passed.')
} finally {
  await prisma.$disconnect()
}
