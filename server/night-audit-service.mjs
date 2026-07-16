import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { readMoneySatang, satangToApiString } from './money.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const CLOSE_ROLES = new Set(['ADMIN', 'MANAGER', 'SYSTEM'])
const NON_OVERRIDABLE_BLOCKERS = new Set(['EMERGENCY_STOP', 'UNPOSTED_ROOM_CHARGES'])

const closeSchema = z.object({
  businessDate: z.string().regex(DATE_KEY, 'Use an ISO business date in YYYY-MM-DD format.'),
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(3).max(1_000),
  overrideBlockers: z.boolean().default(false),
  overrideReason: z.string().trim().min(3).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.overrideBlockers && !value.overrideReason) {
    context.addIssue({ code: 'custom', path: ['overrideReason'], message: 'An operational override reason is required.' })
  }
})

const listSchema = z.object({
  startDate: z.string().regex(DATE_KEY).optional(),
  endDate: z.string().regex(DATE_KEY).optional(),
  status: z.enum(['RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED']).optional(),
  limit: z.number().int().min(1).max(100).default(30),
}).strict()

export const nightAuditServiceSchemas = Object.freeze({ closeBusinessDate: closeSchema, listRuns: listSchema })

function parse(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
    throw new PmsValidationError(`${path}${issue.message}`)
  }
  return result.data
}

function contextFor(context, requireClose = false) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  const role = String(context?.role || context?.actor?.role || '').trim().toUpperCase()
  if (!propertyId || !actorId || !role) throw new PmsValidationError('Authenticated property context is required.', 403)
  if (requireClose && !CLOSE_ROLES.has(role)) throw new PmsValidationError('Night audit close requires manager, admin, or system permission.', 403)
  return { propertyId, actorId, role }
}

function dateFromKey(key, label = 'Business date') {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError(`${label} is not a real calendar date.`)
  }
  return date
}

function addUtcDays(date, count) {
  return new Date(date.getTime() + (count * 86_400_000))
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function outcomeFromRun(run, extra = {}) {
  return {
    runId: run.id,
    businessDate: dateKey(run.businessDate),
    status: run.status,
    postingMode: 'VERIFY_EXISTING_CHARGES_ONLY',
    blockers: Array.isArray(run.blockers) ? run.blockers : [],
    overrideApplied: Boolean(run.overrideReason),
    snapshot: {
      unresolvedArrivals: run.unresolvedArrivals,
      unresolvedDepartures: run.unresolvedDepartures,
      inHouseReservations: run.inHouseReservations,
      openFolios: run.openFolios,
      housekeepingBlockers: run.housekeepingBlockers,
      unpostedRoomCharges: run.unpostedRoomCharges,
      chargesTotalSatang: satangToApiString(run.chargesTotalSatang),
      paymentsTotalSatang: satangToApiString(run.paymentsTotalSatang),
      balanceTotalSatang: satangToApiString(run.balanceTotalSatang),
    },
    completedAt: run.completedAt?.toISOString?.() || run.completedAt || null,
    ...extra,
  }
}

async function buildSnapshot(tx, propertyId, businessDate) {
  const nextDate = addUtcDays(businessDate, 1)
  const [
    unresolvedArrivals,
    unresolvedDepartures,
    inHouseReservations,
    folios,
    charges,
    payments,
    housekeepingBlockers,
    criticalIssues,
    emergencyStop,
    occupiedStays,
  ] = await Promise.all([
    tx.reservation.count({ where: { propertyId, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { lte: businessDate } } }),
    tx.reservation.count({ where: { propertyId, status: 'CHECKED_IN', checkOut: { lte: businessDate } } }),
    tx.reservation.count({ where: { propertyId, status: 'CHECKED_IN' } }),
    tx.folio.findMany({ where: { reservation: { propertyId } }, select: { status: true, balance: true, balanceSatang: true } }),
    tx.charge.findMany({ where: { folio: { reservation: { propertyId } }, date: businessDate, void: false }, select: { total: true, totalSatang: true } }),
    tx.payment.findMany({ where: { folio: { reservation: { propertyId } }, createdAt: { gte: businessDate, lt: nextDate } }, select: { amount: true, amountSatang: true } }),
    tx.housekeepingTask.count({ where: { propertyId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'] }, OR: [{ status: 'BLOCKED' }, { priority: 'URGENT', scheduledFor: { lte: businessDate } }] } }),
    tx.housekeepingIssue.count({ where: { propertyId, severity: 'CRITICAL', status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] } } }),
    tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId } }),
    tx.reservation.findMany({
      where: { propertyId, status: 'CHECKED_IN', checkIn: { lte: businessDate }, checkOut: { gt: businessDate } },
      select: { id: true, folio: { select: { charges: { where: { category: 'ROOM', date: businessDate, void: false }, select: { id: true } } } } },
    }),
  ])

  const unpostedRoomCharges = occupiedStays.filter((reservation) => !reservation.folio?.charges?.length).length
  const openFolios = folios.filter((folio) => folio.status === 'OPEN').length
  const chargesTotalSatang = charges.reduce((sum, charge) => sum + readMoneySatang(charge, 'total'), 0n)
  const paymentsTotalSatang = payments.reduce((sum, payment) => sum + readMoneySatang(payment, 'amount'), 0n)
  const balanceTotalSatang = folios.reduce((sum, folio) => sum + readMoneySatang(folio, 'balance'), 0n)
  const blockers = []
  if (emergencyStop?.enabled) blockers.push({ code: 'EMERGENCY_STOP', count: 1, overridable: false })
  if (unpostedRoomCharges) blockers.push({ code: 'UNPOSTED_ROOM_CHARGES', count: unpostedRoomCharges, overridable: false })
  if (unresolvedArrivals) blockers.push({ code: 'UNRESOLVED_ARRIVALS', count: unresolvedArrivals, overridable: true })
  if (unresolvedDepartures) blockers.push({ code: 'UNRESOLVED_DEPARTURES', count: unresolvedDepartures, overridable: true })
  if (housekeepingBlockers) blockers.push({ code: 'HOUSEKEEPING_BLOCKERS', count: housekeepingBlockers, overridable: true })
  if (criticalIssues) blockers.push({ code: 'CRITICAL_HOUSEKEEPING_ISSUES', count: criticalIssues, overridable: true })

  return {
    unresolvedArrivals, unresolvedDepartures, inHouseReservations, openFolios, housekeepingBlockers,
    unpostedRoomCharges, chargesTotalSatang, paymentsTotalSatang, balanceTotalSatang, blockers,
  }
}

function persistedSnapshot(snapshot) {
  return {
    unresolvedArrivals: snapshot.unresolvedArrivals,
    unresolvedDepartures: snapshot.unresolvedDepartures,
    inHouseReservations: snapshot.inHouseReservations,
    openFolios: snapshot.openFolios,
    housekeepingBlockers: snapshot.housekeepingBlockers,
    unpostedRoomCharges: snapshot.unpostedRoomCharges,
    chargesTotalSatang: snapshot.chargesTotalSatang,
    paymentsTotalSatang: snapshot.paymentsTotalSatang,
    balanceTotalSatang: snapshot.balanceTotalSatang,
    blockers: snapshot.blockers,
  }
}

async function recordAudit(tx, resolved, run, parsed, status, blockerCodes, overrideApplied) {
  await tx.auditLog.create({ data: {
    userId: resolved.actorId,
    action: status === 'COMPLETED' ? 'NIGHT_AUDIT_COMPLETED' : 'NIGHT_AUDIT_BLOCKED',
    entityType: 'nightAuditRun',
    entityId: run.id,
    changes: {
      propertyId: resolved.propertyId,
      businessDate: parsed.businessDate,
      reason: parsed.reason,
      blockerCodes,
      overrideApplied,
      overrideReason: overrideApplied ? parsed.overrideReason : null,
      postingMode: 'VERIFY_EXISTING_CHARGES_ONLY',
    },
  } })
  await recordDomainEvent(tx, {
    propertyId: resolved.propertyId,
    eventType: status === 'COMPLETED' ? 'NIGHT_AUDIT_COMPLETED' : 'NIGHT_AUDIT_BLOCKED',
    aggregateType: 'nightAuditRun',
    aggregateId: run.id,
    actorUserId: resolved.actorId,
    metadata: { businessDate: parsed.businessDate, status, blockerCodes, overrideApplied },
  })
}

export async function closeNightAuditBusinessDate(prisma, context, input) {
  const resolved = contextFor(context, true)
  const parsed = parse(closeSchema, input)
  const businessDate = dateFromKey(parsed.businessDate)

  const replay = await prisma.nightAuditAttempt.findUnique({ where: { propertyId_idempotencyKey: { propertyId: resolved.propertyId, idempotencyKey: parsed.idempotencyKey } } })
  if (replay) return { ...replay.outcome, idempotentReplay: true }

  try {
    return await prisma.$transaction(async (tx) => {
      const repeated = await tx.nightAuditAttempt.findUnique({ where: { propertyId_idempotencyKey: { propertyId: resolved.propertyId, idempotencyKey: parsed.idempotencyKey } } })
      if (repeated) return { ...repeated.outcome, idempotentReplay: true }

      const existing = await tx.nightAuditRun.findUnique({ where: { propertyId_businessDate: { propertyId: resolved.propertyId, businessDate } } })
      if (existing?.status === 'COMPLETED') return outcomeFromRun(existing, { idempotentReplay: true, businessDateAlreadyClosed: true })

      const snapshot = await buildSnapshot(tx, resolved.propertyId, businessDate)
      if (parsed.overrideBlockers && snapshot.blockers.length === 0) throw new PmsValidationError('No blockers exist to override.', 409)
      const nonOverridable = snapshot.blockers.filter((blocker) => NON_OVERRIDABLE_BLOCKERS.has(blocker.code))
      const overrideApplied = parsed.overrideBlockers && resolved.role === 'ADMIN' && nonOverridable.length === 0
      if (parsed.overrideBlockers && resolved.role !== 'ADMIN') throw new PmsValidationError('Only an admin can override operational night-audit blockers.', 403)
      const status = snapshot.blockers.length === 0 || overrideApplied ? 'COMPLETED' : 'BLOCKED'
      const now = new Date()
      const data = {
        ...persistedSnapshot(snapshot), status, initiatedBy: resolved.actorId, reason: parsed.reason,
        overrideReason: overrideApplied ? parsed.overrideReason : null,
        completedAt: status === 'COMPLETED' ? now : null,
      }
      const run = existing
        ? await tx.nightAuditRun.update({ where: { id: existing.id }, data })
        : await tx.nightAuditRun.create({ data: { propertyId: resolved.propertyId, businessDate, ...data } })
      const outcome = outcomeFromRun(run, { idempotentReplay: false, overrideRejectedBy: nonOverridable.map((item) => item.code) })
      await tx.nightAuditAttempt.create({ data: {
        propertyId: resolved.propertyId, runId: run.id, idempotencyKey: parsed.idempotencyKey,
        status, initiatedBy: resolved.actorId, reason: parsed.reason,
        overrideReason: overrideApplied ? parsed.overrideReason : null, outcome,
      } })
      await recordAudit(tx, resolved, run, parsed, status, snapshot.blockers.map((item) => item.code), overrideApplied)
      return outcome
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 })
  } catch (error) {
    if (error?.code === 'P2002') {
      const duplicate = await prisma.nightAuditAttempt.findUnique({ where: { propertyId_idempotencyKey: { propertyId: resolved.propertyId, idempotencyKey: parsed.idempotencyKey } } })
      if (duplicate) return { ...duplicate.outcome, idempotentReplay: true }
    }
    throw error
  }
}

export async function listNightAuditRuns(prisma, context, input = {}) {
  const { propertyId } = contextFor(context)
  const parsed = parse(listSchema, input)
  if (parsed.startDate && parsed.endDate && parsed.startDate > parsed.endDate) throw new PmsValidationError('startDate must be on or before endDate.')
  const where = { propertyId }
  if (parsed.status) where.status = parsed.status
  if (parsed.startDate || parsed.endDate) {
    where.businessDate = {}
    if (parsed.startDate) where.businessDate.gte = dateFromKey(parsed.startDate, 'Start date')
    if (parsed.endDate) where.businessDate.lte = dateFromKey(parsed.endDate, 'End date')
  }
  const runs = await prisma.nightAuditRun.findMany({ where, orderBy: { businessDate: 'desc' }, take: parsed.limit })
  return runs.map((run) => outcomeFromRun(run))
}

export const nightAuditPolicy = Object.freeze({
  postingMode: 'VERIFY_EXISTING_CHARGES_ONLY',
  closeRoles: [...CLOSE_ROLES],
  nonOverridableBlockers: [...NON_OVERRIDABLE_BLOCKERS],
})
