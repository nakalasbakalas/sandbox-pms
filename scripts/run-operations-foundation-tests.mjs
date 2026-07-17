/* global console, process */
import assert from 'node:assert/strict'
import {
  assignHousekeepingTask,
  createHousekeepingIssue,
  createHousekeepingTask,
  transitionHousekeepingIssue,
  transitionHousekeepingTask,
} from '../server/housekeeping-service.mjs'
import { closeNightAuditBusinessDate } from '../server/night-audit-service.mjs'

const now = new Date('2026-07-16T08:00:00.000Z')
const manager = { propertyId: 'property-1', actor: { id: 'manager-1', role: 'MANAGER' }, role: 'MANAGER' }
const admin = { propertyId: 'property-1', actor: { id: 'admin-1', role: 'ADMIN' }, role: 'ADMIN' }
const housekeeper = { propertyId: 'property-1', actor: { id: 'hk-1', role: 'HOUSEKEEPING' }, role: 'HOUSEKEEPING' }

function housekeepingFixture() {
  const rooms = [{ id: 'room-101', propertyId: 'property-1' }, { id: 'room-201', propertyId: 'property-2' }]
  const memberships = [{ userId: 'hk-1', propertyId: 'property-1', active: true, user: { id: 'hk-1', active: true } }]
  const tasks = []
  const issues = []
  const taskLogs = []
  const issueLogs = []
  const audits = []
  const events = []
  let taskId = 1
  let issueId = 1

  const prisma = {
    room: { findFirst: async ({ where }) => rooms.find((row) => row.id === where.id && row.propertyId === where.propertyId) || null },
    userPropertyMembership: {
      findFirst: async ({ where }) => memberships.find((row) => row.userId === where.userId && row.propertyId === where.propertyId && row.active && row.user.active) || null,
    },
    housekeepingTask: {
      create: async ({ data }) => {
        const { statusHistory, ...fields } = data
        const row = { id: `task-${taskId++}`, completedAt: null, createdAt: now, updatedAt: now, ...fields }
        tasks.push(row)
        if (statusHistory?.create) taskLogs.push({ taskId: row.id, ...statusHistory.create })
        return row
      },
      findFirst: async ({ where }) => tasks.find((row) => row.id === where.id && row.propertyId === where.propertyId && (!where.roomId || row.roomId === where.roomId)) || null,
      update: async ({ where, data }) => {
        const row = tasks.find((item) => item.id === where.id)
        const { statusHistory, ...fields } = data
        Object.assign(row, fields, { updatedAt: now })
        if (statusHistory?.create) taskLogs.push({ taskId: row.id, ...statusHistory.create })
        return row
      },
    },
    housekeepingIssue: {
      create: async ({ data }) => {
        const { statusHistory, ...fields } = data
        const row = { id: `issue-${issueId++}`, status: 'OPEN', resolvedAt: null, createdAt: now, updatedAt: now, ...fields }
        issues.push(row)
        if (statusHistory?.create) issueLogs.push({ issueId: row.id, ...statusHistory.create })
        return row
      },
      findFirst: async ({ where }) => issues.find((row) => row.id === where.id && row.propertyId === where.propertyId) || null,
      update: async ({ where, data }) => {
        const row = issues.find((item) => item.id === where.id)
        const { statusHistory, ...fields } = data
        Object.assign(row, fields, { updatedAt: now })
        if (statusHistory?.create) issueLogs.push({ issueId: row.id, ...statusHistory.create })
        return row
      },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data } },
    domainEvent: { create: async ({ data }) => { const row = { id: BigInt(events.length + 1), createdAt: now, ...data }; events.push(row); return row } },
    $transaction: async (callback) => callback(prisma),
  }
  return { prisma, tasks, issues, taskLogs, issueLogs, audits, events }
}

const housekeeping = housekeepingFixture()
await assert.rejects(
  createHousekeepingTask(housekeeping.prisma, manager, {
    roomId: 'room-201', kind: 'CLEANING', title: 'Wrong property', reason: 'Prepare the room.',
  }),
  /active property/,
)

const task = await createHousekeepingTask(housekeeping.prisma, manager, {
  roomId: 'room-101', kind: 'TURNOVER', priority: 'URGENT', title: 'Arrival turnover',
  scheduledFor: '2026-07-16', reason: 'Prepare room for the arriving guest.',
})
assert.equal(task.status, 'OPEN')
assert.equal(housekeeping.taskLogs.length, 1, 'task creation records initial status history')

const assigned = await assignHousekeepingTask(housekeeping.prisma, manager, {
  taskId: task.id, assignedToUserId: 'hk-1', reason: 'Assign the morning housekeeping shift.',
})
assert.equal(assigned.status, 'ASSIGNED')
assert.equal(assigned.assignedToUserId, 'hk-1')
await assert.rejects(
  transitionHousekeepingTask(housekeeping.prisma, housekeeper, { taskId: task.id, status: 'IN_PROGRESS', reason: '' }),
  /reason/,
)
await transitionHousekeepingTask(housekeeping.prisma, housekeeper, {
  taskId: task.id, status: 'IN_PROGRESS', reason: 'Cleaning has started.',
})
const completed = await transitionHousekeepingTask(housekeeping.prisma, housekeeper, {
  taskId: task.id, status: 'DONE', reason: 'Room cleaned and inspected.',
})
assert.equal(completed.status, 'DONE')
assert.ok(completed.completedAt)

const criticalIssue = await createHousekeepingIssue(housekeeping.prisma, housekeeper, {
  roomId: 'room-101', taskId: task.id, category: 'SAFETY', severity: 'CRITICAL',
  title: 'Exposed cable', description: 'An exposed cable is visible beside the desk.', reason: 'Escalate an immediate safety hazard.',
})
await assert.rejects(
  transitionHousekeepingIssue(housekeeping.prisma, housekeeper, { issueId: criticalIssue.id, status: 'RESOLVED', reason: 'Cable is covered.' }),
  /manager or admin/,
)
const resolvedIssue = await transitionHousekeepingIssue(housekeeping.prisma, manager, {
  issueId: criticalIssue.id, status: 'RESOLVED', reason: 'Maintenance isolated and replaced the cable.',
})
assert.equal(resolvedIssue.status, 'RESOLVED')
assert.ok(housekeeping.audits.length >= 6)
assert.equal(housekeeping.events.length, housekeeping.audits.length, 'each successful housekeeping mutation emits audit and domain-event evidence')

function nightAuditFixture({ unresolvedArrivals = 1, unposted = false, emergencyStop = false } = {}) {
  const runs = []
  const attempts = []
  const audits = []
  const events = []
  let runId = 1
  const prisma = {
    reservation: {
      count: async ({ where }) => {
        if (where.status?.in) return unresolvedArrivals
        if (where.status === 'CHECKED_IN' && where.checkOut) return 0
        if (where.status === 'CHECKED_IN') return unposted ? 1 : 0
        return 0
      },
      findMany: async () => unposted ? [{ id: 'reservation-1', folio: { charges: [] } }] : [],
    },
    folio: { findMany: async () => [{ status: 'OPEN', balance: 123.45, balanceSatang: 12345n }] },
    charge: { findMany: async () => [{ total: 10.01, totalSatang: 1001n }, { total: 0.02, totalSatang: 2n }] },
    payment: { findMany: async () => [{ amount: 5.01, amountSatang: 501n }] },
    housekeepingTask: { count: async () => 0 },
    housekeepingIssue: { count: async () => 0 },
    hotelOpsEmergencyStop: { findUnique: async () => ({ enabled: emergencyStop }) },
    nightAuditRun: {
      findUnique: async ({ where }) => runs.find((row) => row.propertyId === where.propertyId_businessDate.propertyId && row.businessDate.getTime() === where.propertyId_businessDate.businessDate.getTime()) || null,
      create: async ({ data }) => { const row = { id: `night-${runId++}`, startedAt: now, updatedAt: now, ...data }; runs.push(row); return row },
      update: async ({ where, data }) => { const row = runs.find((item) => item.id === where.id); Object.assign(row, data, { updatedAt: now }); return row },
    },
    nightAuditAttempt: {
      findUnique: async ({ where }) => attempts.find((row) => row.propertyId === where.propertyId_idempotencyKey.propertyId && row.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey) || null,
      create: async ({ data }) => { const row = { id: `attempt-${attempts.length + 1}`, createdAt: now, ...data }; attempts.push(row); return row },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data } },
    domainEvent: { create: async ({ data }) => { const row = { id: BigInt(events.length + 1), createdAt: now, ...data }; events.push(row); return row } },
    $transaction: async (callback) => callback(prisma),
  }
  return { prisma, runs, attempts, audits, events }
}

const previousAuthority = process.env.MONEY_READ_AUTHORITY
process.env.MONEY_READ_AUTHORITY = 'satang'
try {
  const audit = nightAuditFixture()
  const blocked = await closeNightAuditBusinessDate(audit.prisma, manager, {
    businessDate: '2026-07-16', idempotencyKey: 'night-audit-attempt-1', reason: 'Close the current hotel business date.',
  })
  assert.equal(blocked.status, 'BLOCKED')
  assert.deepEqual(blocked.blockers.map((item) => item.code), ['UNRESOLVED_ARRIVALS'])
  assert.equal(blocked.snapshot.chargesTotalSatang, '1003', 'night audit totals exact satang values without float summation')
  assert.equal(blocked.snapshot.paymentsTotalSatang, '501')
  assert.equal(blocked.snapshot.balanceTotalSatang, '12345')

  const replay = await closeNightAuditBusinessDate(audit.prisma, manager, {
    businessDate: '2026-07-16', idempotencyKey: 'night-audit-attempt-1', reason: 'Close the current hotel business date.',
  })
  assert.equal(replay.idempotentReplay, true)
  assert.equal(audit.attempts.length, 1)
  assert.equal(audit.audits.length, 1, 'idempotent retry does not duplicate audit evidence')

  const completedAudit = await closeNightAuditBusinessDate(audit.prisma, admin, {
    businessDate: '2026-07-16', idempotencyKey: 'night-audit-attempt-2', reason: 'Close after management review.',
    overrideBlockers: true, overrideReason: 'Admin confirmed the arrival is a valid late arrival.',
  })
  assert.equal(completedAudit.status, 'COMPLETED')
  assert.equal(completedAudit.overrideApplied, true)

  const unsafe = nightAuditFixture({ unresolvedArrivals: 0, unposted: true })
  const unsafeOverride = await closeNightAuditBusinessDate(unsafe.prisma, admin, {
    businessDate: '2026-07-16', idempotencyKey: 'night-audit-unposted-1', reason: 'Attempt business-date close.',
    overrideBlockers: true, overrideReason: 'Review the outstanding nightly charge.',
  })
  assert.equal(unsafeOverride.status, 'BLOCKED')
  assert.deepEqual(unsafeOverride.overrideRejectedBy, ['UNPOSTED_ROOM_CHARGES'])
  assert.equal(unsafe.runs[0].completedAt, null, 'unposted nightly charges cannot be falsely marked complete')
} finally {
  if (previousAuthority === undefined) delete process.env.MONEY_READ_AUTHORITY
  else process.env.MONEY_READ_AUTHORITY = previousAuthority
}

console.log('Operations foundation fixture tests passed.')
