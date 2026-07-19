/* global console, process, setTimeout */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { assertSafeE2EDatabase, redactDatabaseUrl } from './db-safety.mjs'
import { requirePermission } from '../server/rbac.mjs'
import { resolveRequestContext } from '../server/request-context.mjs'
import { listDomainEvents, recordDomainEvent } from '../server/domain-events.mjs'
import {
  createCharge,
  createPayment,
  createReservation,
  assignRoom,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  getBookingEmailEvent,
  listGuests,
  updateReservationGuest,
  updateHousekeepingStatus,
  updateReservation,
} from '../server/pms-service.mjs'
import {
  createHousekeepingTask,
  listHousekeepingTasks,
  transitionHousekeepingTask,
} from '../server/housekeeping-service.mjs'
import { closeNightAuditBusinessDate, listNightAuditRuns } from '../server/night-audit-service.mjs'
import { createPublicHold, createPublicQuote } from '../server/direct-booking-service.mjs'
import {
  configureIcalFeedChannel,
  deactivateIcalFeedChannel,
  listIcalFeedChannels,
} from '../server/ical-feed.mjs'
import {
  createChannelMapping,
  deleteChannelMapping,
  listChannelMappings,
  updateChannelMapping,
} from '../server/channel-mapping-service.mjs'

const e2eDatabaseUrl = assertSafeE2EDatabase()
process.env.DATABASE_URL = e2eDatabaseUrl
process.env.MONEY_READ_AUTHORITY = 'legacy_float'

const { createPrismaClient } = await import('../server/prisma-client.mjs')
const prisma = createPrismaClient()
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const codeA = `GATE_A_${runId}`.toUpperCase()
const codeB = `GATE_B_${runId}`.toUpperCase()
const actorPasswordHash = `acceptance-only-${runId}`
const date = (key) => new Date(`${key}T00:00:00.000Z`)

function actorFrom(context) {
  return { ...context.actor, propertyId: context.propertyId, propertyCode: context.propertyCode }
}

async function createPropertyFixture(code, suffix) {
  const property = await prisma.property.create({
    data: {
      code,
      name: `Release Gate ${suffix}`,
      taxRate: 0,
      taxRateBasisPoints: 0,
      extraGuestFee: 200,
      extraGuestFeeSatang: 20_000n,
      childFee: 100,
      childFeeSatang: 10_000n,
    },
  })
  const roomType = await prisma.roomType.create({
    data: {
      propertyId: property.id,
      code: 'GATE_ROOM',
      name: `Gate Room ${suffix}`,
      baseRate: 1_000,
      baseRateSatang: 100_000n,
      maxOccupancy: 2,
      standardOcc: 2,
    },
  })
  const room = await prisma.room.create({
    data: {
      propertyId: property.id,
      roomTypeId: roomType.id,
      number: suffix === 'A' ? 'G-A-1' : 'G-B-1',
      floor: 1,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  return { property, roomType, room }
}

async function createReservationFixture(fixture, suffix, totalSatang = 10_000n) {
  const guest = await prisma.guest.create({
    data: {
      propertyId: fixture.property.id,
      firstName: 'Gate',
      lastName: `Guest ${suffix}`,
      email: `gate-${suffix.toLowerCase()}-${runId}@example.test`,
    },
  })
  const reservation = await prisma.reservation.create({
    data: {
      confirmationCode: `GATE-${suffix}-${runId}`,
      propertyId: fixture.property.id,
      guestId: guest.id,
      roomTypeId: fixture.roomType.id,
      checkIn: date('2030-02-01'),
      checkOut: date('2030-02-03'),
      status: 'CONFIRMED',
      adults: 2,
      children: 0,
      childAges: [],
      ratePerNight: Number(totalSatang / 2n) / 100,
      ratePerNightSatang: totalSatang / 2n,
      totalAmount: Number(totalSatang) / 100,
      totalAmountSatang: totalSatang,
      depositAmount: 0,
      depositAmountSatang: 0n,
      source: 'DIRECT',
    },
  })
  const folio = await prisma.folio.create({
    data: {
      reservationId: reservation.id,
      subtotal: Number(totalSatang) / 100,
      subtotalSatang: totalSatang,
      tax: 0,
      taxSatang: 0n,
      total: Number(totalSatang) / 100,
      totalSatang,
      paid: 0,
      paidSatang: 0n,
      balance: Number(totalSatang) / 100,
      balanceSatang: totalSatang,
    },
  })
  await prisma.charge.create({
    data: {
      propertyId: fixture.property.id,
      folioId: folio.id,
      idempotencyKey: `fixture-room-charge:${runId}:${suffix}`,
      intentFingerprint: `fixture-room-charge-fingerprint:${runId}:${suffix}`,
      date: reservation.checkIn,
      description: 'Release gate room charge',
      category: 'ROOM',
      amount: Number(totalSatang / 2n) / 100,
      amountSatang: totalSatang / 2n,
      quantity: 2,
      total: Number(totalSatang) / 100,
      totalSatang,
      createdBy: 'Release acceptance gate',
    },
  })
  return { guest, reservation, folio }
}

async function exactMoneyReconciliation() {
  const checks = [
    ['Property', 'extraGuestFee', 'extraGuestFeeSatang'],
    ['Property', 'childFee', 'childFeeSatang'],
    ['RoomType', 'baseRate', 'baseRateSatang'],
    ['Reservation', 'ratePerNight', 'ratePerNightSatang'],
    ['Reservation', 'totalAmount', 'totalAmountSatang'],
    ['Reservation', 'depositAmount', 'depositAmountSatang'],
    ['Folio', 'subtotal', 'subtotalSatang'],
    ['Folio', 'tax', 'taxSatang'],
    ['Folio', 'total', 'totalSatang'],
    ['Folio', 'paid', 'paidSatang'],
    ['Folio', 'balance', 'balanceSatang'],
    ['Charge', 'amount', 'amountSatang'],
    ['Charge', 'total', 'totalSatang'],
    ['Payment', 'amount', 'amountSatang'],
  ]

  for (const [table, legacy, exact] of checks) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE "${exact}" IS NULL) AS "missing",
        COUNT(*) FILTER (
          WHERE "${exact}" IS NOT NULL
            AND "${exact}" <> ROUND(("${legacy}"::text)::numeric * 100)::bigint
        ) AS "rowVariance",
        COALESCE(SUM("${exact}"), 0)::text AS "exactTotal",
        COALESCE(SUM(ROUND(("${legacy}"::text)::numeric * 100)::bigint), 0)::text AS "legacyTotal"
      FROM "${table}"
    `)
    const result = rows[0]
    assert.equal(result.missing, 0n, `${table}.${exact} has no unresolved NULL shadows`)
    assert.equal(result.rowVariance, 0n, `${table}.${exact} has zero row-level variance`)
    assert.equal(result.exactTotal, result.legacyTotal, `${table}.${exact} has zero aggregate variance`)
  }
}

console.log(`Release-foundation DB gate target: ${redactDatabaseUrl(e2eDatabaseUrl)}`)

try {
  const [fixtureA, fixtureB] = await Promise.all([
    createPropertyFixture(codeA, 'A'),
    createPropertyFixture(codeB, 'B'),
  ])
  const user = await prisma.user.create({
    data: {
      username: `release-gate-${runId}`,
      email: `release-gate-${runId}@example.test`,
      passwordHash: actorPasswordHash,
      firstName: 'Release',
      lastName: 'Gate',
      role: 'ADMIN',
    },
  })
  await prisma.userPropertyMembership.createMany({
    data: [
      { userId: user.id, propertyId: fixtureA.property.id, role: 'FRONT_DESK', active: true },
      { userId: user.id, propertyId: fixtureB.property.id, role: 'HOUSEKEEPING', active: true },
    ],
  })
  const managerUser = await prisma.user.create({
    data: {
      username: `release-manager-${runId}`,
      email: `release-manager-${runId}@example.test`,
      passwordHash: actorPasswordHash,
      firstName: 'Release',
      lastName: 'Manager',
      role: 'MANAGER',
      propertyMemberships: {
        create: { propertyId: fixtureA.property.id, role: 'MANAGER', active: true },
      },
    },
  })
  await prisma.userPropertyMembership.create({
    data: { userId: managerUser.id, propertyId: fixtureB.property.id, role: 'MANAGER', active: true },
  })

  const contextA = await resolveRequestContext(prisma, user, { requestId: `request-${runId}`, headers: {} }, { propertyCode: codeA })
  const contextB = await resolveRequestContext(prisma, user, { requestId: `request-${runId}-b`, headers: {} }, { propertyCode: codeB })
  const managerContextA = await resolveRequestContext(prisma, managerUser, { requestId: `request-${runId}-manager`, headers: {} }, { propertyCode: codeA })
  const managerContextB = await resolveRequestContext(prisma, managerUser, { requestId: `request-${runId}-manager-b`, headers: {} }, { propertyCode: codeB })
  assert.equal(contextA.role, 'FRONT_DESK', 'membership role overrides the global ADMIN compatibility role')
  assert.throws(() => requirePermission(contextA.actor, 'manage:users'), /permission/, 'effective membership role prevents global-role privilege escalation')
  assert.equal(contextB.role, 'HOUSEKEEPING')

  const channelAContext = { ...managerContextA, idempotencyKey: `ical-a:${randomUUID()}` }
  const channelBContext = { ...managerContextB, idempotencyKey: `ical-b:${randomUUID()}` }
  const channelA = await configureIcalFeedChannel(prisma, channelAContext, {
    provider: 'booking-com',
    exportFileName: `gate-a-${runId}.ics`,
    reason: 'Create the guarded first-property iCal fixture.',
  }, 'https://pms.example.test')
  const channelB = await configureIcalFeedChannel(prisma, channelBContext, {
    provider: 'agoda',
    exportFileName: `gate-b-${runId}.ics`,
    reason: 'Create the guarded second-property iCal fixture.',
  }, 'https://pms.example.test')
  const listedChannelsA = await listIcalFeedChannels(prisma, managerContextA, 'https://pms.example.test')
  const listedChannelsB = await listIcalFeedChannels(prisma, managerContextB, 'https://pms.example.test')
  assert.deepEqual(listedChannelsA.map((channel) => channel.id), [channelA.id], 'iCal list is isolated to property A')
  assert.deepEqual(listedChannelsB.map((channel) => channel.id), [channelB.id], 'iCal list is isolated to property B')
  const storedChannelA = await prisma.channel.findUnique({ where: { id: channelA.id } })
  assert.equal(JSON.stringify(storedChannelA.config).includes('importUrl'), false, 'Channel.config stores no raw provider import URL')
  assert.equal(listedChannelsA[0].exportFeedUrl, undefined, 'normal iCal reads do not replay an issued export bearer')
  const channelAIssueAttempt = await prisma.channelMutationAttempt.findUnique({
    where: {
      propertyId_idempotencyKey: {
        propertyId: fixtureA.property.id,
        idempotencyKey: channelAContext.idempotencyKey,
      },
    },
  })
  assert.ok(channelAIssueAttempt, 'token issue is claimed in the global channel mutation ledger')
  assert.equal(JSON.stringify(channelAIssueAttempt.result).includes('/ical/'), false, 'the mutation ledger stores no raw export bearer URL')
  const concurrentExpediaContext = { ...managerContextA, idempotencyKey: `ical-expedia:${randomUUID()}` }
  const concurrentChannelResults = await Promise.all([
    configureIcalFeedChannel(prisma, concurrentExpediaContext, {
      provider: 'expedia',
      exportFileName: `concurrent-${runId}.ics`,
      reason: 'Prove serialized first-time channel setup.',
    }, 'https://pms.example.test'),
    configureIcalFeedChannel(prisma, concurrentExpediaContext, {
      provider: 'expedia',
      exportFileName: `concurrent-${runId}.ics`,
      reason: 'Prove serialized first-time channel setup.',
    }, 'https://pms.example.test'),
  ])
  assert.equal(new Set(concurrentChannelResults.map((channel) => channel.id)).size, 1, 'concurrent first-time channel setup returns one channel')
  assert.equal(
    await prisma.channel.count({ where: { propertyId: fixtureA.property.id, provider: 'EXPEDIA' } }),
    1,
    'the provider advisory lock prevents duplicate property/provider channels',
  )
  assert.equal(
    concurrentChannelResults.filter((channel) => channel.idempotentReplay === true).length,
    1,
    'one concurrent duplicate issuance replays the deterministic token operation',
  )

  let releaseProviderLock
  let signalProviderLockAcquired
  const providerLockAcquired = new Promise((resolve) => { signalProviderLockAcquired = resolve })
  const holdProviderLock = new Promise((resolve) => { releaseProviderLock = resolve })
  const providerLockBlocker = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `ical-channel:${fixtureA.property.id}:BOOKING_COM`,
    )
    signalProviderLockAcquired()
    await holdProviderLock
  })
  await providerLockAcquired
  const racedConfigure = configureIcalFeedChannel(
    prisma,
    { ...managerContextA, idempotencyKey: `ical-race:${randomUUID()}` },
    {
      provider: 'booking-com',
      exportFileName: `race-${runId}.ics`,
      rotateToken: true,
      reason: 'Rotate the feed before the queued disable operation.',
    },
    'https://pms.example.test',
  )
  await new Promise((resolve) => setTimeout(resolve, 25))
  const racedDisable = deactivateIcalFeedChannel(
    prisma,
    { ...managerContextA, idempotencyKey: `ical-disable-race:${randomUUID()}` },
    'booking-com',
    'https://pms.example.test',
    { reason: 'Disable the feed after the queued rotation operation.' },
  )
  await new Promise((resolve) => setTimeout(resolve, 25))
  releaseProviderLock()
  await providerLockBlocker
  await Promise.all([racedConfigure, racedDisable])
  assert.equal(
    (await prisma.channel.findUnique({ where: { id: channelA.id } })).active,
    false,
    'configure and disable share one provider lock, so the later disable remains authoritative',
  )

  const mappingAContext = { ...managerContextA, idempotencyKey: `mapping-a:${randomUUID()}` }
  const mappingAInput = {
    channelId: channelA.id,
    externalRoomTypeId: `EXT-A-${runId}`,
    externalRoomTypeName: 'External Gate A',
    roomTypeId: fixtureA.roomType.id,
    roomIds: [fixtureA.room.id],
    active: true,
    reason: 'Create the guarded first-property channel mapping.',
  }
  await assert.rejects(
    createChannelMapping(prisma, channelAContext, mappingAInput),
    (error) => error?.statusCode === 409,
    'a token-issuance key cannot be reused for a mapping mutation',
  )
  const mappingA = await createChannelMapping(prisma, mappingAContext, mappingAInput)
  const mappingAAuditCount = await prisma.auditLog.count({ where: { propertyId: fixtureA.property.id, entityId: mappingA.id } })
  assert.deepEqual(await createChannelMapping(prisma, mappingAContext, mappingAInput), mappingA, 'mapping create retries return the original row')
  assert.equal(
    await prisma.auditLog.count({ where: { propertyId: fixtureA.property.id, entityId: mappingA.id } }),
    mappingAAuditCount,
    'mapping create retries do not duplicate audit evidence',
  )
  const mappingB = await createChannelMapping(prisma, { ...managerContextB, idempotencyKey: `mapping-b:${randomUUID()}` }, {
    channelId: channelB.id,
    externalRoomTypeId: `EXT-B-${runId}`,
    externalRoomTypeName: 'External Gate B',
    roomTypeId: fixtureB.roomType.id,
    roomIds: [fixtureB.room.id],
    active: true,
    reason: 'Create the guarded second-property channel mapping.',
  })
  assert.deepEqual((await listChannelMappings(prisma, managerContextA)).map((mapping) => mapping.id), [mappingA.id])
  assert.deepEqual((await listChannelMappings(prisma, managerContextB)).map((mapping) => mapping.id), [mappingB.id])
  await assert.rejects(
    updateChannelMapping(prisma, { ...managerContextB, idempotencyKey: `mapping-forged-update:${randomUUID()}` }, mappingA.id, {
      active: false,
      reason: 'Attempt to update another property mapping.',
    }),
    (error) => error?.statusCode === 404,
    'a forged foreign mapping update is rejected',
  )
  await assert.rejects(
    deleteChannelMapping(prisma, { ...managerContextB, idempotencyKey: `mapping-forged-delete:${randomUUID()}` }, mappingA.id, {
      reason: 'Attempt to delete another property mapping.',
    }),
    (error) => error?.statusCode === 404,
    'a forged foreign mapping deletion is rejected',
  )
  const channelAudit = await prisma.auditLog.findMany({
    where: { entityId: { in: [channelA.id, mappingA.id] } },
  })
  assert.ok(channelAudit.length >= 2)
  assert.ok(channelAudit.every((row) => row.propertyId === fixtureA.property.id), 'channel audit evidence is owned by property A')
  assert.equal(JSON.stringify(channelAudit).includes('importUrl'), false, 'channel audit evidence excludes private URL fields')
  const channelEvents = await prisma.domainEvent.findMany({
    where: { aggregateId: { in: [channelA.id, mappingA.id] } },
  })
  assert.ok(channelEvents.length >= 2)
  assert.ok(channelEvents.every((event) => event.propertyId === fixtureA.property.id), 'channel domain events are owned by property A')
  assert.ok(channelEvents.every((event) => event.metadata?.providerWrite === false), 'channel evidence never claims a provider write')

  const noMembershipProperty = await prisma.property.create({
    data: {
      code: `GATE_N_${runId}`,
      name: 'No membership gate',
      taxRateBasisPoints: 0,
      extraGuestFeeSatang: 20_000n,
      childFeeSatang: 10_000n,
    },
  })
  await assert.rejects(
    resolveRequestContext(prisma, user, { requestId: `request-${runId}-none`, headers: {} }, { propertyCode: noMembershipProperty.code }),
    (error) => error?.statusCode === 403,
    'missing property membership is rejected',
  )

  const reservationA = await createReservationFixture(fixtureA, 'A')
  const reservationB = await createReservationFixture(fixtureB, 'B')
  const actorA = actorFrom(contextA)
  const actorB = actorFrom(contextB)
  const sourceEventB = await prisma.bookingEmailEvent.create({
    data: {
      propertyId: fixtureB.property.id,
      sender: `foreign-source-${runId}@example.test`,
      receivedAt: new Date(),
      subject: `Foreign property source ${runId}`,
      rawText: 'Property-isolation fixture. No guest data.',
    },
  })

  const guestsA = await listGuests(prisma, actorA)
  assert.ok(guestsA.some((guest) => guest.id === reservationA.guest.id))
  assert.equal(guestsA.some((guest) => guest.id === reservationB.guest.id), false, 'guest PII is property scoped')
  await assert.rejects(
    updateReservation(prisma, reservationB.reservation.id, {}, actorA),
    (error) => error?.statusCode === 404,
    'forged reservation id from another property is rejected',
  )
  await assert.rejects(
    updateHousekeepingStatus(prisma, fixtureB.room.id, 'CLEAN', actorA, 'Forged room test'),
    (error) => error?.statusCode === 404,
    'forged room id from another property is rejected',
  )
  await assert.rejects(
    createPayment(prisma, { folioId: reservationB.folio.id, amountSatang: '100', method: 'CASH', idempotencyKey: `foreign-${runId}` }, actorA),
    (error) => error?.statusCode === 404,
    'forged folio id from another property is rejected',
  )
  await assert.rejects(
    createPayment(prisma, { folioId: reservationA.folio.id, amountSatang: '100', method: 'CASH' }, actorA),
    (error) => error?.statusCode === 400 && /idempotency key is required/.test(error.message),
    'payment writes require an explicit idempotency key',
  )
  await assert.rejects(
    createPayment(prisma, {
      folioId: reservationA.folio.id,
      amountSatang: '100',
      method: 'CASH',
      idempotencyKey: `foreign-source-payment-${runId}`,
      sourceEmailEventId: sourceEventB.id,
    }, actorA),
    (error) => error?.statusCode === 404 && /active property/.test(error.message),
    'payments cannot link booking-email evidence from another property',
  )
  await assert.rejects(
    createCharge(prisma, {
      folioId: reservationA.folio.id,
      amountSatang: '100',
      quantity: 1,
      category: 'OTHER',
      description: 'Foreign source-link rejection fixture',
      idempotencyKey: `foreign-source-charge-${runId}`,
      sourceEmailEventId: sourceEventB.id,
    }, actorA),
    (error) => error?.statusCode === 404 && /active property/.test(error.message),
    'charges cannot link booking-email evidence from another property',
  )
  await assert.rejects(
    updateReservation(prisma, reservationA.reservation.id, { sourceEmailEventId: sourceEventB.id }, actorA),
    (error) => error?.statusCode === 404 && /active property/.test(error.message),
    'reservation updates cannot link booking-email evidence from another property',
  )
  await assert.rejects(
    createReservation(prisma, {
      guest: { firstName: 'Foreign', lastName: 'Source' },
      roomTypeCode: fixtureA.roomType.code,
      checkIn: '2033-01-01',
      checkOut: '2033-01-02',
      adults: 1,
      children: 0,
      ratePerNight: 1_000,
      sourceEmailEventId: sourceEventB.id,
    }, actorA),
    (error) => error?.statusCode === 404 && /active property/.test(error.message),
    'reservation creation cannot link booking-email evidence from another property',
  )

  const auditCountBeforeRejectedPatch = await prisma.auditLog.count({ where: { entityId: reservationA.reservation.id } })
  const historyCountBeforeRejectedPatch = await prisma.reservationLog.count({ where: { reservationId: reservationA.reservation.id } })
  const credentialMarker = `must-not-persist-${runId}`
  await assert.rejects(
    updateReservation(prisma, reservationA.reservation.id, { password: credentialMarker }, actorA),
    (error) => error?.statusCode === 400
      && error.message === 'Reservation update contains unsupported fields.'
      && !error.message.includes(credentialMarker),
    'reservation PATCH rejects unknown credential-shaped fields with a redacted error',
  )
  assert.equal(
    await prisma.auditLog.count({ where: { entityId: reservationA.reservation.id } }),
    auditCountBeforeRejectedPatch,
    'rejected reservation fields create no audit row containing raw input',
  )
  assert.equal(
    await prisma.reservationLog.count({ where: { reservationId: reservationA.reservation.id } }),
    historyCountBeforeRejectedPatch,
    'rejected reservation fields create no history row containing raw input',
  )
  await assert.rejects(
    getBookingEmailEvent(prisma, `foreign-event-${runId}`, actorA),
    (error) => error?.statusCode === 404,
    'unknown or foreign booking-email identifier does not return data',
  )

  const concurrentPayments = await Promise.allSettled([
    createPayment(prisma, {
      folioId: reservationA.folio.id,
      amountSatang: '6000',
      method: 'CASH',
      idempotencyKey: `concurrent-a-${runId}`,
    }, actorA),
    createPayment(prisma, {
      folioId: reservationA.folio.id,
      amountSatang: '6000',
      method: 'CASH',
      idempotencyKey: `concurrent-b-${runId}`,
    }, actorA),
  ])
  assert.equal(concurrentPayments.filter((result) => result.status === 'fulfilled').length, 1, 'only one concurrent overpayment attempt succeeds')
  assert.equal(concurrentPayments.filter((result) => result.status === 'rejected').length, 1)
  const refreshedFolioA = await prisma.folio.findUnique({ where: { id: reservationA.folio.id } })
  assert.equal(refreshedFolioA.paidSatang, 6_000n)
  assert.equal(refreshedFolioA.balanceSatang, 4_000n)

  const boardMutationReservation = await createReservationFixture(fixtureA, 'BOARD-MUTATION')
  const boardAssignmentKey = `board-assign-replay-${runId}`
  const boardAuditBefore = await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } })
  const boardHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: boardMutationReservation.reservation.id } })
  const boardEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: boardMutationReservation.reservation.id } })
  const boardAssignmentExpectedUpdatedAt = boardMutationReservation.reservation.updatedAt.toISOString()
  const assignedBoardReservation = await assignRoom(
    prisma,
    boardMutationReservation.reservation.id,
    fixtureA.room.id,
    actorA,
    { idempotencyKey: boardAssignmentKey, expectedUpdatedAt: boardAssignmentExpectedUpdatedAt },
  )
  const replayedBoardAssignment = await assignRoom(
    prisma,
    boardMutationReservation.reservation.id,
    fixtureA.room.id,
    actorA,
    { idempotencyKey: boardAssignmentKey, expectedUpdatedAt: boardAssignmentExpectedUpdatedAt },
  )
  assert.equal(replayedBoardAssignment.id, assignedBoardReservation.id, 'same room-assignment intent returns the current authoritative reservation')
  const storedBoardAssignmentAttempt = await prisma.reservationMutationAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId: fixtureA.property.id, idempotencyKey: boardAssignmentKey } },
  })
  assert.ok(storedBoardAssignmentAttempt?.resultFingerprint, 'room-assignment attempts retain a non-sensitive immutable result fingerprint')
  assert.equal(await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } }), boardAuditBefore + 1, 'room-assignment replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: boardMutationReservation.reservation.id } }), boardHistoryBefore + 1, 'room-assignment replay does not duplicate reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: boardMutationReservation.reservation.id } }), boardEventsBefore + 1, 'room-assignment replay does not duplicate domain events')
  const sameRoomAssignment = await assignRoom(
    prisma,
    boardMutationReservation.reservation.id,
    fixtureA.room.id,
    actorA,
    {
      idempotencyKey: `board-assign-same-room-${runId}`,
      expectedUpdatedAt: assignedBoardReservation.updatedAt.toISOString(),
    },
  )
  assert.equal(sameRoomAssignment.assignedRoomId, fixtureA.room.id, 'same-room assignment returns the authoritative reservation')
  assert.equal(await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } }), boardAuditBefore + 1, 'same-room assignment does not create duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: boardMutationReservation.reservation.id } }), boardHistoryBefore + 1, 'same-room assignment does not create duplicate reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: boardMutationReservation.reservation.id } }), boardEventsBefore + 1, 'same-room assignment does not create duplicate domain events')
  await assert.rejects(
    assignRoom(prisma, boardMutationReservation.reservation.id, `missing-room-${runId}`, actorA, {
      idempotencyKey: boardAssignmentKey,
      expectedUpdatedAt: boardAssignmentExpectedUpdatedAt,
    }),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'room-assignment idempotency keys cannot be reused for a different target',
  )

  const staleAssignmentReservation = await createReservationFixture(fixtureA, 'BOARD-ASSIGN-STALE')
  const staleAssignmentRoom = await prisma.room.create({
    data: {
      propertyId: fixtureA.property.id,
      roomTypeId: fixtureA.roomType.id,
      number: `G-A-ASSIGN-STALE-${runId}`,
      floor: 2,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  const staleAssignmentExpectedUpdatedAt = staleAssignmentReservation.reservation.updatedAt.toISOString()
  const supersedingAssignmentReservation = await prisma.reservation.update({
    where: { id: staleAssignmentReservation.reservation.id },
    data: {
      notes: `Superseding room-assignment edit ${runId}`,
      updatedAt: new Date(staleAssignmentReservation.reservation.updatedAt.getTime() + 1_000),
    },
  })
  const staleAssignmentKey = `board-assign-stale-${runId}`
  const staleAssignmentAuditBefore = await prisma.auditLog.count({ where: { entityId: staleAssignmentReservation.reservation.id } })
  const staleAssignmentHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: staleAssignmentReservation.reservation.id } })
  const staleAssignmentEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: staleAssignmentReservation.reservation.id } })
  await assert.rejects(
    assignRoom(
      prisma,
      staleAssignmentReservation.reservation.id,
      staleAssignmentRoom.id,
      actorA,
      {
        idempotencyKey: staleAssignmentKey,
        expectedUpdatedAt: staleAssignmentExpectedUpdatedAt,
      },
    ),
    (error) => error?.statusCode === 409 && /changed after the booking board loaded it/.test(error.message),
    'stale room assignment is rejected before changing reservation inventory or evidence',
  )
  const staleAssignmentAfter = await prisma.reservation.findUnique({ where: { id: staleAssignmentReservation.reservation.id } })
  assert.equal(staleAssignmentAfter.assignedRoomId, null, 'stale room assignment preserves the authoritative unassigned state')
  assert.equal(staleAssignmentAfter.updatedAt.toISOString(), supersedingAssignmentReservation.updatedAt.toISOString(), 'stale room assignment preserves the later reservation version')
  assert.equal(await prisma.auditLog.count({ where: { entityId: staleAssignmentReservation.reservation.id } }), staleAssignmentAuditBefore, 'stale room assignment creates no audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: staleAssignmentReservation.reservation.id } }), staleAssignmentHistoryBefore, 'stale room assignment creates no reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: staleAssignmentReservation.reservation.id } }), staleAssignmentEventsBefore, 'stale room assignment creates no domain event')
  assert.equal(
    await prisma.reservationMutationAttempt.count({ where: { propertyId: fixtureA.property.id, idempotencyKey: staleAssignmentKey } }),
    0,
    'failed stale room assignment rolls back its idempotency claim',
  )

  const boardResizeKey = `board-resize-replay-${runId}`
  const boardResizeAuditBefore = await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } })
  const resizedBoardReservation = await updateReservation(
    prisma,
    boardMutationReservation.reservation.id,
    { checkIn: '2030-02-03', checkOut: '2030-02-05' },
    actorA,
    { idempotencyKey: boardResizeKey },
  )
  const replayedBoardResize = await updateReservation(
    prisma,
    boardMutationReservation.reservation.id,
    { checkOut: '2030-02-05', checkIn: '2030-02-03' },
    actorA,
    { idempotencyKey: boardResizeKey },
  )
  assert.equal(replayedBoardResize.id, resizedBoardReservation.id, 'same stay-resize intent replays the current authoritative reservation')
  const storedBoardResizeAttempt = await prisma.reservationMutationAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId: fixtureA.property.id, idempotencyKey: boardResizeKey } },
  })
  assert.ok(storedBoardResizeAttempt?.resultFingerprint, 'stay-resize attempts retain a non-sensitive immutable result fingerprint')
  assert.equal(await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } }), boardResizeAuditBefore + 1, 'stay-resize replay does not duplicate audit evidence')
  await assert.rejects(
    updateReservation(prisma, boardMutationReservation.reservation.id, { checkIn: '2030-02-04', checkOut: '2030-02-06' }, actorA, { idempotencyKey: boardResizeKey }),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'stay-resize idempotency keys cannot be reused for a different date range',
  )
  await assert.rejects(
    assignRoom(
      prisma,
      boardMutationReservation.reservation.id,
      fixtureA.room.id,
      actorA,
      { idempotencyKey: boardAssignmentKey, expectedUpdatedAt: boardAssignmentExpectedUpdatedAt },
    ),
    (error) => error?.statusCode === 409 && /superseded by a later change/.test(error.message),
    'a replay after a later reservation mutation never returns the later state as the original assignment result',
  )

  const supersedingBoardMutation = await updateReservation(
    prisma,
    boardMutationReservation.reservation.id,
    { notes: `Superseding board edit ${runId}`, expectedUpdatedAt: resizedBoardReservation.updatedAt.toISOString() },
    actorA,
    { idempotencyKey: `board-superseding-edit-${runId}` },
  )
  await assert.rejects(
    updateReservation(
      prisma,
      boardMutationReservation.reservation.id,
      { checkOut: '2030-02-05', checkIn: '2030-02-03' },
      actorA,
      { idempotencyKey: boardResizeKey },
    ),
    (error) => error?.statusCode === 409 && /superseded by a later change/.test(error.message),
    'a stay-resize replay after a later edit never returns the later state as the original result',
  )
  await assert.rejects(
    updateReservation(
      prisma,
      boardMutationReservation.reservation.id,
      {
        checkIn: '2030-02-04',
        checkOut: '2030-02-06',
        expectedUpdatedAt: resizedBoardReservation.updatedAt.toISOString(),
      },
      actorA,
      { idempotencyKey: `board-stale-edit-${runId}` },
    ),
    (error) => error?.statusCode === 409 && /changed after the booking board loaded it/.test(error.message),
    'a stale booking-board version cannot overwrite a later reservation edit',
  )
  const afterRejectedStaleEdit = await prisma.reservation.findUnique({ where: { id: boardMutationReservation.reservation.id } })
  assert.equal(afterRejectedStaleEdit.updatedAt.toISOString(), supersedingBoardMutation.updatedAt.toISOString(), 'stale rejection preserves the later authoritative reservation version')
  assert.equal(afterRejectedStaleEdit.checkIn.toISOString().slice(0, 10), '2030-02-03')
  assert.equal(afterRejectedStaleEdit.checkOut.toISOString().slice(0, 10), '2030-02-05')
  assert.equal(
    await prisma.reservationMutationAttempt.count({
      where: { propertyId: fixtureA.property.id, idempotencyKey: `board-stale-edit-${runId}` },
    }),
    0,
    'a rejected stale attempt rolls back its idempotency claim',
  )

  const commandReservation = await createReservationFixture(fixtureA, 'COMMAND-DRAWER')
  const futureNoShowReservation = await createReservationFixture(fixtureA, 'FUTURE-NO-SHOW')
  const commandAuditBefore = await prisma.auditLog.count({ where: { entityId: commandReservation.reservation.id } })
  const commandHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: commandReservation.reservation.id } })
  const commandEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: commandReservation.reservation.id } })
  const cancelKey = `command-cancel-${runId}`
  const cancelledCommandReservation = await cancelReservation(
    prisma,
    commandReservation.reservation.id,
    actorA,
    'CANCELLED',
    'Guest requested cancellation through the authoritative board workflow.',
    { idempotencyKey: cancelKey },
  )
  const replayedCommandCancellation = await cancelReservation(
    prisma,
    commandReservation.reservation.id,
    actorA,
    'CANCELLED',
    'Guest requested cancellation through the authoritative board workflow.',
    { idempotencyKey: cancelKey },
  )
  assert.equal(replayedCommandCancellation.id, cancelledCommandReservation.id, 'same cancellation intent replays the authoritative reservation')
  assert.equal(await prisma.auditLog.count({ where: { entityId: commandReservation.reservation.id } }), commandAuditBefore + 1, 'cancellation replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: commandReservation.reservation.id } }), commandHistoryBefore + 1, 'cancellation replay does not duplicate reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: commandReservation.reservation.id } }), commandEventsBefore + 1, 'cancellation replay does not duplicate domain events')
  await assert.rejects(
    cancelReservation(
      prisma,
      commandReservation.reservation.id,
      actorA,
      'CANCELLED',
      'A changed cancellation reason must not reuse the completed command.',
      { idempotencyKey: cancelKey },
    ),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'cancellation idempotency keys cannot be reused for a changed intent',
  )
  await assert.rejects(
    cancelReservation(
      prisma,
      commandReservation.reservation.id,
      actorA,
      'CANCELLED',
      'A stale board command must be rejected before changing status.',
      {
        idempotencyKey: `command-cancel-stale-${runId}`,
        expectedUpdatedAt: commandReservation.reservation.updatedAt.toISOString(),
      },
    ),
    (error) => error?.statusCode === 409 && /changed after the booking board loaded it/.test(error.message),
    'stale cancellation commands cannot overwrite the authoritative reservation',
  )
  await assert.rejects(
    cancelReservation(prisma, futureNoShowReservation.reservation.id, actorA, 'NO_SHOW', 'Future no-show fixture.', {
      idempotencyKey: `command-future-no-show-${runId}`,
    }),
    (error) => error?.statusCode === 400 && /future arrival/.test(error.message),
    'future arrivals cannot be marked as no-shows',
  )
  await assert.rejects(
    cancelReservation(prisma, reservationB.reservation.id, actorA, 'CANCELLED', 'Forged property cancellation.', {
      idempotencyKey: `command-foreign-cancel-${runId}`,
    }),
    (error) => error?.statusCode === 404,
    'forged reservation cancellation is property scoped',
  )
  await assert.rejects(
    cancelReservation(prisma, futureNoShowReservation.reservation.id, actorA, 'NO_SHOW', undefined, {
      idempotencyKey: `command-missing-reason-${runId}`,
    }),
    (error) => error?.statusCode === 400 && /reason is required/.test(error.message),
    'cancellation and no-show commands require an operational reason',
  )

  const guestCommandReservation = await createReservationFixture(fixtureA, 'GUEST-COMMAND')
  const guestAuditBefore = await prisma.auditLog.count({ where: { entityId: guestCommandReservation.reservation.id } })
  const guestHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: guestCommandReservation.reservation.id } })
  const guestEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: guestCommandReservation.reservation.id } })
  const guestUpdateKey = `command-guest-update-${runId}`
  const guestUpdateInput = {
    email: null,
    phone: '+66 81 555 0101',
    vipStatus: true,
    expectedGuestUpdatedAt: guestCommandReservation.guest.updatedAt.toISOString(),
  }
  const updatedGuestReservation = await updateReservationGuest(prisma, guestCommandReservation.reservation.id, guestUpdateInput, actorA, { idempotencyKey: guestUpdateKey })
  const replayedGuestReservation = await updateReservationGuest(prisma, guestCommandReservation.reservation.id, guestUpdateInput, actorA, { idempotencyKey: guestUpdateKey })
  assert.equal(replayedGuestReservation.id, updatedGuestReservation.id, 'same guest command replays the authoritative reservation')
  const persistedGuest = await prisma.guest.findUnique({ where: { id: guestCommandReservation.guest.id } })
  assert.equal(persistedGuest.email, null, 'guest commands can explicitly clear a stored email')
  assert.equal(persistedGuest.phone, '+66 81 555 0101')
  assert.equal(persistedGuest.vipStatus, true)
  assert.equal(await prisma.auditLog.count({ where: { entityId: guestCommandReservation.reservation.id } }), guestAuditBefore + 1, 'guest command replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: guestCommandReservation.reservation.id } }), guestHistoryBefore + 1, 'guest command replay does not duplicate reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: guestCommandReservation.reservation.id } }), guestEventsBefore + 1, 'guest command replay does not duplicate domain events')
  await assert.rejects(
    updateReservationGuest(
      prisma,
      guestCommandReservation.reservation.id,
      { ...guestUpdateInput, phone: '+66 81 555 0102' },
      actorA,
      { idempotencyKey: guestUpdateKey },
    ),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'guest command idempotency keys cannot be reused for a changed intent',
  )
  await assert.rejects(
    updateReservationGuest(
      prisma,
      guestCommandReservation.reservation.id,
      { phone: '+66 81 555 0103', expectedGuestUpdatedAt: guestCommandReservation.guest.updatedAt.toISOString() },
      actorA,
      { idempotencyKey: `command-guest-stale-${runId}` },
    ),
    (error) => error?.statusCode === 409 && /guest changed after the booking board loaded it/.test(error.message),
    'stale guest commands cannot overwrite newer contact details',
  )
  await assert.rejects(
    updateReservationGuest(prisma, reservationB.reservation.id, { phone: '+66 81 555 0199' }, actorA, {
      idempotencyKey: `command-foreign-guest-${runId}`,
    }),
    (error) => error?.statusCode === 404,
    'forged reservation guest updates are property scoped',
  )

  // Lifecycle commands are intentionally tested against PostgreSQL rather than mocks: they
  // exercise the serializable transaction, transaction-scoped advisory locks, and the durable
  // reservation-mutation idempotency record used by the front-desk handoff.
  const lifecycleActorA = actorFrom(managerContextA)
  const lifecycleReservation = await createReservationFixture(fixtureA, 'LIFECYCLE')
  const assignedLifecycleReservation = await assignRoom(
    prisma,
    lifecycleReservation.reservation.id,
    fixtureA.room.id,
    lifecycleActorA,
    { idempotencyKey: `lifecycle-assign-${runId}` },
  )
  const lifecycleCheckInInput = {
    idempotencyKey: `lifecycle-check-in-${runId}`,
    expectedUpdatedAt: assignedLifecycleReservation.updatedAt.toISOString(),
    allowDateOverride: true,
    overrideReason: 'Release-gate future-date fixture.',
    recordIdentityLater: true,
    recordIdentityLaterReason: 'Release-gate identity fixture.',
    allowPayLater: true,
    payLaterReason: 'Release-gate balance fixture.',
  }
  await assert.rejects(
    checkInReservation(prisma, reservationB.reservation.id, lifecycleActorA, {
      ...lifecycleCheckInInput,
      idempotencyKey: `lifecycle-forged-property-${runId}`,
    }),
    (error) => error?.statusCode === 404,
    'forged lifecycle reservation identifiers are rejected for the active property',
  )
  await assert.rejects(
    checkInReservation(prisma, lifecycleReservation.reservation.id, lifecycleActorA, {
      ...lifecycleCheckInInput,
      idempotencyKey: undefined,
    }),
    (error) => error?.statusCode === 400 && /idempotency key is required/.test(error.message),
    'check-in requires a lifecycle idempotency key',
  )
  const lifecycleCheckInAuditBefore = await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } })
  const lifecycleCheckInHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } })
  const lifecycleCheckInRoomHistoryBefore = await prisma.roomStatusLog.count({ where: { roomId: fixtureA.room.id } })
  const lifecycleCheckInEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } })
  const checkedInLifecycleReservation = await checkInReservation(
    prisma,
    lifecycleReservation.reservation.id,
    lifecycleActorA,
    lifecycleCheckInInput,
  )
  const replayedLifecycleCheckIn = await checkInReservation(
    prisma,
    lifecycleReservation.reservation.id,
    lifecycleActorA,
    lifecycleCheckInInput,
  )
  assert.equal(replayedLifecycleCheckIn.id, checkedInLifecycleReservation.id, 'same check-in lifecycle command replays the authoritative reservation')
  assert.equal(replayedLifecycleCheckIn.status, 'CHECKED_IN')
  assert.equal(await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } }), lifecycleCheckInAuditBefore + 1, 'check-in replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } }), lifecycleCheckInHistoryBefore + 1, 'check-in replay does not duplicate reservation history')
  assert.equal(await prisma.roomStatusLog.count({ where: { roomId: fixtureA.room.id } }), lifecycleCheckInRoomHistoryBefore + 1, 'check-in replay does not duplicate room history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } }), lifecycleCheckInEventsBefore + 1, 'check-in replay does not duplicate domain events')
  assert.equal(
    await prisma.reservationMutationAttempt.count({
      where: { propertyId: fixtureA.property.id, idempotencyKey: lifecycleCheckInInput.idempotencyKey, operation: 'CHECK_IN_RESERVATION' },
    }),
    1,
    'check-in retry retains one property-scoped lifecycle attempt',
  )
  const lifecycleKeyCollisionReservation = await createReservationFixture(fixtureA, 'LIFECYCLE-KEY-COLLISION')
  await assert.rejects(
    checkInReservation(
      prisma,
      lifecycleKeyCollisionReservation.reservation.id,
      lifecycleActorA,
      {
        ...lifecycleCheckInInput,
        expectedUpdatedAt: lifecycleKeyCollisionReservation.reservation.updatedAt.toISOString(),
      },
    ),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'a lifecycle idempotency key cannot authorize a different reservation within the same property',
  )
  assert.equal(
    await prisma.reservationMutationAttempt.count({
      where: { propertyId: fixtureA.property.id, idempotencyKey: lifecycleCheckInInput.idempotencyKey },
    }),
    1,
    'same-property lifecycle key collision leaves the original attempt authoritative',
  )

  const lifecycleActorB = actorFrom(managerContextB)
  const crossPropertyLifecycleReservation = await createReservationFixture(fixtureB, 'LIFECYCLE-CROSS-PROPERTY')
  const crossPropertyLifecycleRoom = await prisma.room.create({
    data: {
      propertyId: fixtureB.property.id,
      roomTypeId: fixtureB.roomType.id,
      number: `G-B-LIFECYCLE-${runId}`,
      floor: 3,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  const assignedCrossPropertyLifecycleReservation = await assignRoom(
    prisma,
    crossPropertyLifecycleReservation.reservation.id,
    crossPropertyLifecycleRoom.id,
    lifecycleActorB,
    {
      idempotencyKey: `lifecycle-cross-property-assign-${runId}`,
      expectedUpdatedAt: crossPropertyLifecycleReservation.reservation.updatedAt.toISOString(),
    },
  )
  const checkedInCrossPropertyLifecycleReservation = await checkInReservation(
    prisma,
    crossPropertyLifecycleReservation.reservation.id,
    lifecycleActorB,
    {
      ...lifecycleCheckInInput,
      expectedUpdatedAt: assignedCrossPropertyLifecycleReservation.updatedAt.toISOString(),
    },
  )
  assert.equal(checkedInCrossPropertyLifecycleReservation.status, 'CHECKED_IN')
  assert.equal(
    await prisma.reservationMutationAttempt.count({
      where: { idempotencyKey: lifecycleCheckInInput.idempotencyKey, operation: 'CHECK_IN_RESERVATION' },
    }),
    2,
    'the same lifecycle retry key is independently scoped once per property',
  )
  const checkedOutCrossPropertyLifecycleReservation = await checkOutReservation(
    prisma,
    crossPropertyLifecycleReservation.reservation.id,
    lifecycleActorB,
    {
      idempotencyKey: `lifecycle-cross-property-check-out-${runId}`,
      expectedUpdatedAt: checkedInCrossPropertyLifecycleReservation.updatedAt.toISOString(),
      allowUnpaidOverride: true,
      overrideReason: 'Release-gate cross-property cleanup.',
    },
  )
  assert.equal(checkedOutCrossPropertyLifecycleReservation.status, 'CHECKED_OUT')
  await prisma.reservation.update({
    where: { id: crossPropertyLifecycleReservation.reservation.id },
    data: { assignedRoomId: null },
  })
  await prisma.room.delete({ where: { id: crossPropertyLifecycleRoom.id } })

  await assert.rejects(
    checkOutReservation(prisma, lifecycleReservation.reservation.id, lifecycleActorA, {
      expectedUpdatedAt: checkedInLifecycleReservation.updatedAt.toISOString(),
      allowUnpaidOverride: true,
      overrideReason: 'Release-gate missing-key fixture.',
    }),
    (error) => error?.statusCode === 400 && /idempotency key is required/.test(error.message),
    'check-out requires a lifecycle idempotency key',
  )

  const lifecycleCheckOutInput = {
    idempotencyKey: `lifecycle-check-out-${runId}`,
    expectedUpdatedAt: checkedInLifecycleReservation.updatedAt.toISOString(),
    allowUnpaidOverride: true,
    overrideReason: 'Release-gate unpaid checkout fixture.',
  }
  const lifecycleCheckOutAuditBefore = await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } })
  const lifecycleCheckOutHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } })
  const lifecycleCheckOutRoomHistoryBefore = await prisma.roomStatusLog.count({ where: { roomId: fixtureA.room.id } })
  const lifecycleCheckOutEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } })
  const checkedOutLifecycleReservation = await checkOutReservation(
    prisma,
    lifecycleReservation.reservation.id,
    lifecycleActorA,
    lifecycleCheckOutInput,
  )
  const replayedLifecycleCheckOut = await checkOutReservation(
    prisma,
    lifecycleReservation.reservation.id,
    lifecycleActorA,
    lifecycleCheckOutInput,
  )
  assert.equal(replayedLifecycleCheckOut.id, checkedOutLifecycleReservation.id, 'same check-out lifecycle command replays the authoritative reservation')
  assert.equal(replayedLifecycleCheckOut.status, 'CHECKED_OUT')
  assert.equal(await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } }), lifecycleCheckOutAuditBefore + 1, 'check-out replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } }), lifecycleCheckOutHistoryBefore + 1, 'check-out replay does not duplicate reservation history')
  assert.equal(await prisma.roomStatusLog.count({ where: { roomId: fixtureA.room.id } }), lifecycleCheckOutRoomHistoryBefore + 1, 'check-out replay does not duplicate housekeeping handoff history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } }), lifecycleCheckOutEventsBefore + 1, 'check-out replay does not duplicate domain events')
  const supersededLifecycleAuditCount = await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } })
  const supersededLifecycleHistoryCount = await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } })
  const supersededLifecycleEventCount = await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } })
  await assert.rejects(
    checkInReservation(
      prisma,
      lifecycleReservation.reservation.id,
      lifecycleActorA,
      lifecycleCheckInInput,
    ),
    (error) => error?.statusCode === 409 && /superseded by a later change/.test(error.message),
    'a check-in replay after later check-out never returns the later state as the original result',
  )
  assert.equal(await prisma.auditLog.count({ where: { entityId: lifecycleReservation.reservation.id } }), supersededLifecycleAuditCount, 'superseded lifecycle replay creates no audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: lifecycleReservation.reservation.id } }), supersededLifecycleHistoryCount, 'superseded lifecycle replay creates no history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: lifecycleReservation.reservation.id } }), supersededLifecycleEventCount, 'superseded lifecycle replay creates no event')

  const staleLifecycleReservation = await createReservationFixture(fixtureA, 'LIFECYCLE-STALE')
  const staleLifecycleRoom = await prisma.room.create({
    data: {
      propertyId: fixtureA.property.id,
      roomTypeId: fixtureA.roomType.id,
      number: `G-A-LIFECYCLE-STALE-${runId}`,
      floor: 2,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  const assignedStaleLifecycleReservation = await assignRoom(
    prisma,
    staleLifecycleReservation.reservation.id,
    staleLifecycleRoom.id,
    lifecycleActorA,
    { idempotencyKey: `lifecycle-stale-assign-${runId}` },
  )
  const staleLifecycleExpectedUpdatedAt = assignedStaleLifecycleReservation.updatedAt.toISOString()
  const supersedingLifecycleReservation = await prisma.reservation.update({
    where: { id: staleLifecycleReservation.reservation.id },
    data: {
      notes: `Superseding lifecycle edit ${runId}`,
      updatedAt: new Date(assignedStaleLifecycleReservation.updatedAt.getTime() + 1_000),
    },
  })
  const staleLifecycleCheckInKey = `lifecycle-stale-check-in-${runId}`
  const staleLifecycleAuditBefore = await prisma.auditLog.count({ where: { entityId: staleLifecycleReservation.reservation.id } })
  const staleLifecycleHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: staleLifecycleReservation.reservation.id } })
  const staleLifecycleRoomHistoryBefore = await prisma.roomStatusLog.count({ where: { roomId: staleLifecycleRoom.id } })
  const staleLifecycleEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: staleLifecycleReservation.reservation.id } })
  await assert.rejects(
    checkInReservation(prisma, staleLifecycleReservation.reservation.id, lifecycleActorA, {
      ...lifecycleCheckInInput,
      idempotencyKey: staleLifecycleCheckInKey,
      expectedUpdatedAt: staleLifecycleExpectedUpdatedAt,
    }),
    (error) => error?.statusCode === 409 && /changed after the front desk loaded it/.test(error.message),
    'stale check-in is rejected before changing reservation, room, or folio state',
  )
  const staleLifecycleAfter = await prisma.reservation.findUnique({ where: { id: staleLifecycleReservation.reservation.id } })
  assert.equal(staleLifecycleAfter.status, 'CONFIRMED', 'stale lifecycle command preserves the later authoritative reservation status')
  assert.equal(staleLifecycleAfter.updatedAt.toISOString(), supersedingLifecycleReservation.updatedAt.toISOString(), 'stale lifecycle command preserves the later authoritative reservation version')
  assert.equal(await prisma.auditLog.count({ where: { entityId: staleLifecycleReservation.reservation.id } }), staleLifecycleAuditBefore, 'stale check-in creates no audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: staleLifecycleReservation.reservation.id } }), staleLifecycleHistoryBefore, 'stale check-in creates no reservation history')
  assert.equal(await prisma.roomStatusLog.count({ where: { roomId: staleLifecycleRoom.id } }), staleLifecycleRoomHistoryBefore, 'stale check-in creates no room history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: staleLifecycleReservation.reservation.id } }), staleLifecycleEventsBefore, 'stale check-in creates no domain event')
  assert.equal(
    await prisma.reservationMutationAttempt.count({ where: { propertyId: fixtureA.property.id, idempotencyKey: staleLifecycleCheckInKey } }),
    0,
    'failed stale check-in rolls back its lifecycle idempotency claim',
  )

  const concurrentLifecycleReservation = await createReservationFixture(fixtureA, 'LIFECYCLE-CONCURRENT')
  const concurrentLifecycleRoom = await prisma.room.create({
    data: {
      propertyId: fixtureA.property.id,
      roomTypeId: fixtureA.roomType.id,
      number: `G-A-LIFECYCLE-${runId}`,
      floor: 3,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  const assignedConcurrentLifecycleReservation = await assignRoom(
    prisma,
    concurrentLifecycleReservation.reservation.id,
    concurrentLifecycleRoom.id,
    lifecycleActorA,
    { idempotencyKey: `lifecycle-concurrent-assign-${runId}` },
  )
  const concurrentLifecycleOptions = {
    allowDateOverride: true,
    overrideReason: 'Release-gate concurrent future-date fixture.',
    recordIdentityLater: true,
    recordIdentityLaterReason: 'Release-gate concurrent identity fixture.',
    allowPayLater: true,
    payLaterReason: 'Release-gate concurrent balance fixture.',
    expectedUpdatedAt: assignedConcurrentLifecycleReservation.updatedAt.toISOString(),
  }
  const concurrentLifecycleAuditBefore = await prisma.auditLog.count({ where: { entityId: concurrentLifecycleReservation.reservation.id } })
  const concurrentLifecycleHistoryBefore = await prisma.reservationLog.count({ where: { reservationId: concurrentLifecycleReservation.reservation.id } })
  const concurrentLifecycleRoomHistoryBefore = await prisma.roomStatusLog.count({ where: { roomId: concurrentLifecycleRoom.id } })
  const concurrentLifecycleEventsBefore = await prisma.domainEvent.count({ where: { aggregateId: concurrentLifecycleReservation.reservation.id } })
  const concurrentLifecycleResults = await Promise.allSettled([
    checkInReservation(prisma, concurrentLifecycleReservation.reservation.id, lifecycleActorA, {
      ...concurrentLifecycleOptions,
      idempotencyKey: `lifecycle-concurrent-a-${runId}`,
    }),
    checkInReservation(prisma, concurrentLifecycleReservation.reservation.id, lifecycleActorA, {
      ...concurrentLifecycleOptions,
      idempotencyKey: `lifecycle-concurrent-b-${runId}`,
    }),
  ])
  assert.equal(concurrentLifecycleResults.filter((result) => result.status === 'fulfilled').length, 1, 'only one concurrent check-in lifecycle command succeeds')
  assert.equal(concurrentLifecycleResults.filter((result) => result.status === 'rejected').length, 1, 'a simultaneous lifecycle command receives a truthful conflict')
  const rejectedConcurrentLifecycleResult = concurrentLifecycleResults.find((result) => result.status === 'rejected')
  assert.ok([400, 409].includes(rejectedConcurrentLifecycleResult.reason?.statusCode), 'concurrent lifecycle loser is rejected after serialized state validation or an inventory conflict')
  const concurrentLifecycleAfter = await prisma.reservation.findUnique({ where: { id: concurrentLifecycleReservation.reservation.id } })
  assert.equal(concurrentLifecycleAfter.status, 'CHECKED_IN', 'one serialized lifecycle command owns the final checked-in state')
  assert.equal(await prisma.auditLog.count({ where: { entityId: concurrentLifecycleReservation.reservation.id } }), concurrentLifecycleAuditBefore + 1, 'concurrent lifecycle commands produce one audit record')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: concurrentLifecycleReservation.reservation.id } }), concurrentLifecycleHistoryBefore + 1, 'concurrent lifecycle commands produce one reservation history record')
  assert.equal(await prisma.roomStatusLog.count({ where: { roomId: concurrentLifecycleRoom.id } }), concurrentLifecycleRoomHistoryBefore + 1, 'concurrent lifecycle commands produce one room history record')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: concurrentLifecycleReservation.reservation.id } }), concurrentLifecycleEventsBefore + 1, 'concurrent lifecycle commands produce one domain event')
  await prisma.room.deleteMany({
    where: { id: { in: [staleAssignmentRoom.id, staleLifecycleRoom.id, concurrentLifecycleRoom.id] } },
  })

  const finalRoom = await prisma.room.create({
    data: {
      propertyId: fixtureB.property.id,
      roomTypeId: fixtureB.roomType.id,
      number: `G-B-FINAL-${runId}`,
      floor: 2,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
    },
  })
  const [finalReservationOne, finalReservationTwo] = await Promise.all([
    createReservationFixture(fixtureB, 'FINAL-A'),
    createReservationFixture(fixtureB, 'FINAL-B'),
  ])
  const simultaneousAssignments = await Promise.allSettled([
    assignRoom(prisma, finalReservationOne.reservation.id, finalRoom.id, actorB, { idempotencyKey: `board-final-a-${runId}` }),
    assignRoom(prisma, finalReservationTwo.reservation.id, finalRoom.id, actorB, { idempotencyKey: `board-final-b-${runId}` }),
  ])
  assert.equal(simultaneousAssignments.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one concurrent final-room assignment succeeds')
  assert.equal(simultaneousAssignments.filter((result) => result.status === 'rejected').length, 1, 'one concurrent final-room assignment is rejected')
  const rejectedFinalAssignment = simultaneousAssignments.find((result) => result.status === 'rejected')
  assert.equal(rejectedFinalAssignment.reason?.statusCode, 409, 'the rejected final-room assignment is a truthful conflict')
  const finalReservations = await prisma.reservation.findMany({
    where: { id: { in: [finalReservationOne.reservation.id, finalReservationTwo.reservation.id] } },
    select: { id: true, assignedRoomId: true },
  })
  assert.equal(finalReservations.filter((reservation) => reservation.assignedRoomId === finalRoom.id).length, 1, 'only one reservation keeps the final room assignment')
  const finalInventory = await prisma.roomDateInventory.findMany({
    where: { roomId: finalRoom.id },
    select: { reservationId: true, date: true },
    orderBy: { date: 'asc' },
  })
  assert.deepEqual(finalInventory.map((row) => row.date.toISOString().slice(0, 10)), ['2030-02-01', '2030-02-02'])
  assert.equal(new Set(finalInventory.map((row) => row.reservationId)).size, 1, 'final-room inventory belongs to the one successful reservation only')

  const sharedIdempotencyKey = `shared-property-${runId}`
  await createPayment(prisma, {
    folioId: reservationA.folio.id,
    amountSatang: '100',
    method: 'CASH',
    idempotencyKey: sharedIdempotencyKey,
  }, actorA)
  await createPayment(prisma, {
    folioId: reservationB.folio.id,
    amountSatang: '100',
    method: 'CASH',
    idempotencyKey: sharedIdempotencyKey,
  }, actorB)
  assert.equal(await prisma.payment.count({ where: { idempotencyKey: sharedIdempotencyKey } }), 2, 'payment idempotency is composite property scoped')

  const chargeReservationA = await createReservationFixture(fixtureA, 'CHARGE-A')
  const chargeReservationB = await createReservationFixture(fixtureB, 'CHARGE-B')
  const chargeInput = {
    folioId: chargeReservationA.folio.id,
    amountSatang: '250',
    quantity: 2,
    category: 'MINIBAR',
    description: 'Charge idempotency fixture',
    idempotencyKey: `charge-replay-${runId}`,
  }
  await assert.rejects(
    createCharge(prisma, { ...chargeInput, idempotencyKey: undefined }, actorA),
    (error) => error?.statusCode === 400 && /idempotency key is required/.test(error.message),
    'every charge write requires an explicit idempotency key',
  )
  await assert.rejects(
    createCharge(prisma, {
      ...chargeInput,
      amountSatang: '9007199254740992',
      quantity: 1,
      idempotencyKey: `charge-oversized-amount-${runId}`,
    }, actorA),
    (error) => error?.statusCode === 400 && /too large|supported exact-money range/.test(error.message),
    'charge amounts above the exact compatibility range fail before reaching PostgreSQL',
  )
  await assert.rejects(
    createCharge(prisma, {
      ...chargeInput,
      amountSatang: '9007199254740991',
      quantity: 2,
      idempotencyKey: `charge-oversized-total-${runId}`,
    }, actorA),
    (error) => error?.statusCode === 400 && /total exceeds/.test(error.message),
    'charge unit amount times quantity cannot overflow the exact compatibility range',
  )
  await assert.rejects(
    createCharge(prisma, {
      ...chargeInput,
      amountSatang: '1',
      quantity: 2_147_483_648,
      idempotencyKey: `charge-oversized-quantity-${runId}`,
    }, actorA),
    (error) => error?.statusCode === 400 && /supported exact-money range/.test(error.message),
    'charge quantity cannot exceed the PostgreSQL integer range',
  )
  const firstCharge = await createCharge(prisma, chargeInput, actorA)
  const replayedCharge = await createCharge(prisma, chargeInput, actorA)
  assert.equal(replayedCharge.idempotentReplay, true, 'same charge intent replays the original result')
  assert.equal(replayedCharge.charge.id, firstCharge.charge.id)
  assert.equal(await prisma.charge.count({ where: { propertyId: fixtureA.property.id, idempotencyKey: chargeInput.idempotencyKey } }), 1)
  assert.equal(await prisma.auditLog.count({ where: { entityType: 'charge', entityId: firstCharge.charge.id } }), 1, 'charge replay does not duplicate audit evidence')
  await assert.rejects(
    createCharge(prisma, { ...chargeInput, amountSatang: '251' }, actorA),
    (error) => error?.statusCode === 409 && /different charge/.test(error.message),
    'reusing a charge idempotency key for a different fingerprint is rejected',
  )

  const concurrentChargeKey = `charge-concurrent-${runId}`
  const concurrentChargeInput = {
    folioId: chargeReservationA.folio.id,
    amountSatang: '125',
    quantity: 1,
    category: 'LAUNDRY',
    description: 'Concurrent charge fixture',
    idempotencyKey: concurrentChargeKey,
  }
  const concurrentCharges = await Promise.all([
    createCharge(prisma, concurrentChargeInput, actorA),
    createCharge(prisma, concurrentChargeInput, actorA),
  ])
  assert.equal(new Set(concurrentCharges.map((result) => result.charge.id)).size, 1, 'concurrent retries return one append-only charge')
  assert.equal(concurrentCharges.filter((result) => result.idempotentReplay).length, 1, 'one concurrent result is an idempotent replay')
  assert.equal(await prisma.charge.count({ where: { propertyId: fixtureA.property.id, idempotencyKey: concurrentChargeKey } }), 1)

  const crossPropertyChargeKey = `charge-property-scope-${runId}`
  await createCharge(prisma, {
    ...chargeInput,
    folioId: chargeReservationA.folio.id,
    idempotencyKey: crossPropertyChargeKey,
  }, actorA)
  await createCharge(prisma, {
    ...chargeInput,
    folioId: chargeReservationB.folio.id,
    idempotencyKey: crossPropertyChargeKey,
  }, actorB)
  assert.equal(await prisma.charge.count({ where: { idempotencyKey: crossPropertyChargeKey } }), 2, 'charge idempotency keys are property scoped')

  const housekeepingTask = await createHousekeepingTask(prisma, contextA, {
    roomId: fixtureA.room.id,
    kind: 'CLEANING',
    priority: 'HIGH',
    title: `Reload-safe housekeeping ${runId}`,
    reason: 'Prove persistent housekeeping workflow.',
  })
  await transitionHousekeepingTask(prisma, managerContextA, {
    taskId: housekeepingTask.id,
    status: 'IN_PROGRESS',
    reason: 'Begin guarded persistence test.',
  })
  const persistedTasks = await listHousekeepingTasks(prisma, contextA, { limit: 25 })
  assert.equal(persistedTasks.find((task) => task.id === housekeepingTask.id)?.status, 'IN_PROGRESS')
  await assert.rejects(
    createHousekeepingTask(prisma, contextA, {
      roomId: fixtureB.room.id,
      kind: 'CLEANING',
      title: 'Foreign room must fail',
      reason: 'Prove property isolation.',
    }),
    (error) => error?.statusCode === 404,
  )

  const nightAuditInput = {
    businessDate: '2029-01-01',
    idempotencyKey: `night-audit-${runId}`,
    reason: 'Prove idempotent business-date persistence.',
  }
  const nightAudit = await closeNightAuditBusinessDate(prisma, managerContextA, nightAuditInput)
  const nightAuditReplay = await closeNightAuditBusinessDate(prisma, managerContextA, nightAuditInput)
  assert.equal(nightAudit.status, 'COMPLETED')
  assert.equal(nightAuditReplay.idempotentReplay, true)
  assert.equal(await prisma.nightAuditAttempt.count({ where: { propertyId: fixtureA.property.id, idempotencyKey: nightAuditInput.idempotencyKey } }), 1)
  assert.ok((await listNightAuditRuns(prisma, managerContextA, { limit: 10 })).some((run) => run.runId === nightAudit.runId))

  await prisma.$transaction(async (tx) => {
    await recordDomainEvent(tx, { propertyId: fixtureA.property.id, eventType: 'RELEASE_GATE_A', aggregateType: 'releaseGate', aggregateId: `a-${runId}` })
    await recordDomainEvent(tx, { propertyId: fixtureB.property.id, eventType: 'RELEASE_GATE_B', aggregateType: 'releaseGate', aggregateId: `b-${runId}` })
  })
  const eventsA = await listDomainEvents(prisma, { propertyId: fixtureA.property.id, after: 0n, limit: 250 })
  assert.ok(eventsA.some((event) => event.aggregateId === `a-${runId}`))
  assert.equal(eventsA.some((event) => event.aggregateId === `b-${runId}`), false, 'event catch-up is property filtered')
  assert.ok(eventsA.every((event) => typeof event.id === 'string'), 'event sequence ids are API-safe strings')

  const directEnv = {
    DIRECT_BOOKING_ENABLED: 'true',
    DIRECT_BOOKING_TOKEN_SECRET: `release-gate-secret-${runId}-012345678901234567890123456789`,
  }
  const quote = await createPublicQuote(prisma, {
    propertyCode: codeA,
    roomTypeCode: fixtureA.roomType.code,
    checkIn: '2032-01-01',
    checkOut: '2032-01-02',
    adults: 2,
    children: 0,
  }, { env: directEnv, now: date('2031-12-01'), idempotencyKey: `quote-${runId}-000000` })
  const holdResults = await Promise.allSettled([
    createPublicHold(prisma, { propertyCode: codeA, quoteId: quote.quoteId }, {
      env: directEnv,
      now: date('2031-12-01'),
      idempotencyKey: `hold-a-${runId}-000000`,
    }),
    createPublicHold(prisma, { propertyCode: codeA, quoteId: quote.quoteId }, {
      env: directEnv,
      now: date('2031-12-01'),
      idempotencyKey: `hold-b-${runId}-000000`,
    }),
  ])
  const holdFailures = holdResults
    .filter((result) => result.status === 'rejected')
    .map((result) => `${result.reason?.code || 'ERROR'}:${result.reason?.statusCode || 'unknown'}:${result.reason?.message || String(result.reason)}`)
  assert.equal(
    holdResults.filter((result) => result.status === 'fulfilled').length,
    1,
    `PostgreSQL advisory lock allows one simultaneous last-room hold; failures=${holdFailures.join(' | ')}`,
  )
  assert.equal(holdResults.filter((result) => result.status === 'rejected').length, 1)

  const auditRows = await prisma.auditLog.findMany({
    where: {
      entityId: { in: [housekeepingTask.id, nightAudit.runId] },
    },
  })
  assert.ok(auditRows.length >= 2)
  assert.ok(auditRows.every((audit) => audit.propertyId === fixtureA.property.id), 'new audit evidence has first-class property scope')

  await exactMoneyReconciliation()
  console.log('Release-foundation guarded PostgreSQL acceptance gates passed.')
} finally {
  await prisma.$disconnect()
}
