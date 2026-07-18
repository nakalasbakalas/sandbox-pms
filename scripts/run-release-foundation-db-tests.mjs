/* global console, process */
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
  getBookingEmailEvent,
  listGuests,
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

  const contextA = await resolveRequestContext(prisma, user, { requestId: `request-${runId}`, headers: {} }, { propertyCode: codeA })
  const contextB = await resolveRequestContext(prisma, user, { requestId: `request-${runId}-b`, headers: {} }, { propertyCode: codeB })
  const managerContextA = await resolveRequestContext(prisma, managerUser, { requestId: `request-${runId}-manager`, headers: {} }, { propertyCode: codeA })
  assert.equal(contextA.role, 'FRONT_DESK', 'membership role overrides the global ADMIN compatibility role')
  assert.throws(() => requirePermission(contextA.actor, 'manage:users'), /permission/, 'effective membership role prevents global-role privilege escalation')
  assert.equal(contextB.role, 'HOUSEKEEPING')

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
  const assignedBoardReservation = await assignRoom(
    prisma,
    boardMutationReservation.reservation.id,
    fixtureA.room.id,
    actorA,
    { idempotencyKey: boardAssignmentKey },
  )
  const replayedBoardAssignment = await assignRoom(
    prisma,
    boardMutationReservation.reservation.id,
    fixtureA.room.id,
    actorA,
    { idempotencyKey: boardAssignmentKey },
  )
  assert.equal(replayedBoardAssignment.id, assignedBoardReservation.id, 'same room-assignment intent returns the current authoritative reservation')
  const storedBoardAssignmentAttempt = await prisma.reservationMutationAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId: fixtureA.property.id, idempotencyKey: boardAssignmentKey } },
  })
  assert.ok(storedBoardAssignmentAttempt?.resultFingerprint, 'room-assignment attempts retain a non-sensitive immutable result fingerprint')
  assert.equal(await prisma.auditLog.count({ where: { entityId: boardMutationReservation.reservation.id } }), boardAuditBefore + 1, 'room-assignment replay does not duplicate audit evidence')
  assert.equal(await prisma.reservationLog.count({ where: { reservationId: boardMutationReservation.reservation.id } }), boardHistoryBefore + 1, 'room-assignment replay does not duplicate reservation history')
  assert.equal(await prisma.domainEvent.count({ where: { aggregateId: boardMutationReservation.reservation.id } }), boardEventsBefore + 1, 'room-assignment replay does not duplicate domain events')
  await assert.rejects(
    assignRoom(prisma, boardMutationReservation.reservation.id, `missing-room-${runId}`, actorA, { idempotencyKey: boardAssignmentKey }),
    (error) => error?.statusCode === 409 && /different command/.test(error.message),
    'room-assignment idempotency keys cannot be reused for a different target',
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
      { idempotencyKey: boardAssignmentKey },
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
