import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const TASK_CREATE_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING'])
const TASK_ASSIGN_ROLES = new Set(['ADMIN', 'MANAGER'])
const TASK_WORK_ROLES = new Set(['ADMIN', 'MANAGER', 'HOUSEKEEPING'])
const ISSUE_CREATE_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING'])
const ISSUE_WORK_ROLES = new Set(['ADMIN', 'MANAGER', 'HOUSEKEEPING'])
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const idSchema = z.string().trim().min(1).max(200)
const reasonSchema = z.string().trim().min(3).max(1_000)
const optionalTextSchema = z.string().trim().max(2_000).nullable().optional()
const dateSchema = z.string().regex(DATE_KEY).nullable().optional()

const createTaskSchema = z.object({
  roomId: idSchema,
  kind: z.enum(['TURNOVER', 'CLEANING', 'INSPECTION', 'DEEP_CLEAN', 'LINEN', 'MAINTENANCE_FOLLOW_UP', 'OTHER']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  title: z.string().trim().min(1).max(160),
  description: optionalTextSchema,
  scheduledFor: dateSchema,
  assignedToUserId: idSchema.nullable().optional(),
  reason: reasonSchema,
}).strict()

const assignTaskSchema = z.object({
  taskId: idSchema,
  assignedToUserId: idSchema.nullable(),
  reason: reasonSchema,
}).strict()

const transitionTaskSchema = z.object({
  taskId: idSchema,
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']),
  reason: reasonSchema,
}).strict()

const listTasksSchema = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
  roomId: idSchema.optional(),
  assignedToUserId: idSchema.optional(),
  scheduledFor: z.string().regex(DATE_KEY).optional(),
  limit: z.number().int().min(1).max(250).default(100),
}).strict()

const createIssueSchema = z.object({
  roomId: idSchema,
  taskId: idSchema.nullable().optional(),
  category: z.enum(['HOUSEKEEPING', 'MAINTENANCE', 'SAFETY', 'DAMAGE', 'SUPPLY', 'OTHER']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(3).max(2_000),
  assignedToUserId: idSchema.nullable().optional(),
  reason: reasonSchema,
}).strict()

const transitionIssueSchema = z.object({
  issueId: idSchema,
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  reason: reasonSchema,
}).strict()

const listIssuesSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  roomId: idSchema.optional(),
  limit: z.number().int().min(1).max(250).default(100),
}).strict()

export const housekeepingServiceSchemas = Object.freeze({
  createTask: createTaskSchema,
  assignTask: assignTaskSchema,
  transitionTask: transitionTaskSchema,
  listTasks: listTasksSchema,
  createIssue: createIssueSchema,
  transitionIssue: transitionIssueSchema,
  listIssues: listIssuesSchema,
})

const TASK_TRANSITIONS = Object.freeze({
  OPEN: new Set(['ASSIGNED', 'IN_PROGRESS', 'CANCELLED']),
  ASSIGNED: new Set(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED']),
  IN_PROGRESS: new Set(['ASSIGNED', 'BLOCKED', 'DONE', 'CANCELLED']),
  BLOCKED: new Set(['ASSIGNED', 'IN_PROGRESS', 'CANCELLED']),
  DONE: new Set(),
  CANCELLED: new Set(),
})

const ISSUE_TRANSITIONS = Object.freeze({
  OPEN: new Set(['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  ACKNOWLEDGED: new Set(['IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  IN_PROGRESS: new Set(['RESOLVED']),
  RESOLVED: new Set(['IN_PROGRESS', 'CLOSED']),
  CLOSED: new Set(),
})

function parse(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
    throw new PmsValidationError(`${path}${issue.message}`)
  }
  return result.data
}

function dateFromKey(value) {
  if (value === null || value === undefined) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PmsValidationError('scheduledFor must be a real YYYY-MM-DD date.')
  }
  return date
}

function contextFor(context, allowedRoles) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  const role = String(context?.role || context?.actor?.role || '').trim().toUpperCase()
  if (!propertyId || !actorId || !role) throw new PmsValidationError('Authenticated property context is required.', 403)
  if (allowedRoles && !allowedRoles.has(role)) throw new PmsValidationError('You do not have permission for this housekeeping action.', 403)
  return { propertyId, actorId, role }
}

async function requireRoom(tx, propertyId, roomId) {
  const room = await tx.room.findFirst({ where: { id: roomId, propertyId } })
  if (!room) throw new PmsValidationError('Room was not found for the active property.', 404)
  return room
}

async function requireAssignee(tx, propertyId, userId) {
  if (!userId) return null
  const membership = await tx.userPropertyMembership.findFirst({
    where: { userId, propertyId, active: true, user: { active: true } },
    include: { user: true },
  })
  if (!membership) throw new PmsValidationError('Assignee is not an active user for the active property.', 404)
  return membership
}

async function audit(tx, actorId, action, entityType, entityId, changes) {
  return tx.auditLog.create({ data: { userId: actorId, action, entityType, entityId, changes } })
}

function publicTask(task) {
  return {
    ...task,
    scheduledFor: task.scheduledFor ? task.scheduledFor.toISOString().slice(0, 10) : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt?.toISOString?.() || task.createdAt,
    updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
  }
}

function publicIssue(issue) {
  return {
    ...issue,
    resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
    createdAt: issue.createdAt?.toISOString?.() || issue.createdAt,
    updatedAt: issue.updatedAt?.toISOString?.() || issue.updatedAt,
  }
}

export async function listHousekeepingTasks(prisma, context, input = {}) {
  const { propertyId } = contextFor(context)
  const parsed = parse(listTasksSchema, input)
  const where = { propertyId }
  if (parsed.status) where.status = parsed.status
  if (parsed.roomId) where.roomId = parsed.roomId
  if (parsed.assignedToUserId) where.assignedToUserId = parsed.assignedToUserId
  if (parsed.scheduledFor) where.scheduledFor = dateFromKey(parsed.scheduledFor)
  const rows = await prisma.housekeepingTask.findMany({
    where,
    include: { room: { select: { id: true, number: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } } },
    orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }, { createdAt: 'desc' }],
    take: parsed.limit,
  })
  return rows.map(publicTask)
}

export async function createHousekeepingTask(prisma, context, input) {
  const resolved = contextFor(context, TASK_CREATE_ROLES)
  const parsed = parse(createTaskSchema, input)
  return prisma.$transaction(async (tx) => {
    await requireRoom(tx, resolved.propertyId, parsed.roomId)
    if (parsed.assignedToUserId) await requireAssignee(tx, resolved.propertyId, parsed.assignedToUserId)
    const status = parsed.assignedToUserId ? 'ASSIGNED' : 'OPEN'
    const task = await tx.housekeepingTask.create({ data: {
      propertyId: resolved.propertyId,
      roomId: parsed.roomId,
      kind: parsed.kind,
      status,
      priority: parsed.priority,
      title: parsed.title,
      description: parsed.description || null,
      scheduledFor: dateFromKey(parsed.scheduledFor),
      assignedToUserId: parsed.assignedToUserId || null,
      createdBy: resolved.actorId,
      statusHistory: { create: { fromStatus: null, toStatus: status, changedBy: resolved.actorId, reason: parsed.reason } },
    } })
    await audit(tx, resolved.actorId, 'HOUSEKEEPING_TASK_CREATED', 'housekeepingTask', task.id, {
      propertyId: resolved.propertyId, roomId: task.roomId, status, priority: task.priority, reason: parsed.reason,
    })
    await recordDomainEvent(tx, { propertyId: resolved.propertyId, eventType: 'HOUSEKEEPING_TASK_CREATED', aggregateType: 'housekeepingTask', aggregateId: task.id, actorUserId: resolved.actorId, metadata: { roomId: task.roomId, status } })
    return publicTask(task)
  })
}

export async function assignHousekeepingTask(prisma, context, input) {
  const resolved = contextFor(context, TASK_ASSIGN_ROLES)
  const parsed = parse(assignTaskSchema, input)
  return prisma.$transaction(async (tx) => {
    const task = await tx.housekeepingTask.findFirst({ where: { id: parsed.taskId, propertyId: resolved.propertyId } })
    if (!task) throw new PmsValidationError('Housekeeping task was not found.', 404)
    if (['DONE', 'CANCELLED'].includes(task.status)) throw new PmsValidationError('Completed or cancelled tasks cannot be reassigned.', 409)
    if (parsed.assignedToUserId) await requireAssignee(tx, resolved.propertyId, parsed.assignedToUserId)
    const nextStatus = parsed.assignedToUserId ? (task.status === 'OPEN' ? 'ASSIGNED' : task.status) : (task.status === 'ASSIGNED' ? 'OPEN' : task.status)
    const data = { assignedToUserId: parsed.assignedToUserId, status: nextStatus }
    if (nextStatus !== task.status) data.statusHistory = { create: { fromStatus: task.status, toStatus: nextStatus, changedBy: resolved.actorId, reason: parsed.reason } }
    const updated = await tx.housekeepingTask.update({ where: { id: task.id }, data })
    await audit(tx, resolved.actorId, 'HOUSEKEEPING_TASK_ASSIGNED', 'housekeepingTask', task.id, { propertyId: resolved.propertyId, assignedToUserId: parsed.assignedToUserId, reason: parsed.reason })
    await recordDomainEvent(tx, { propertyId: resolved.propertyId, eventType: 'HOUSEKEEPING_TASK_ASSIGNED', aggregateType: 'housekeepingTask', aggregateId: task.id, actorUserId: resolved.actorId, metadata: { status: nextStatus, assigned: Boolean(parsed.assignedToUserId) } })
    return publicTask(updated)
  })
}

export async function transitionHousekeepingTask(prisma, context, input) {
  const resolved = contextFor(context, TASK_WORK_ROLES)
  const parsed = parse(transitionTaskSchema, input)
  return prisma.$transaction(async (tx) => {
    const task = await tx.housekeepingTask.findFirst({ where: { id: parsed.taskId, propertyId: resolved.propertyId } })
    if (!task) throw new PmsValidationError('Housekeeping task was not found.', 404)
    if (task.status === parsed.status) return publicTask(task)
    if (!TASK_TRANSITIONS[task.status]?.has(parsed.status)) throw new PmsValidationError(`Task cannot move from ${task.status} to ${parsed.status}.`, 409)
    if (parsed.status === 'ASSIGNED' && !task.assignedToUserId) throw new PmsValidationError('Assign a staff member before moving a task to ASSIGNED.', 409)
    const completedAt = parsed.status === 'DONE' ? new Date() : null
    const updated = await tx.housekeepingTask.update({ where: { id: task.id }, data: {
      status: parsed.status,
      completedAt,
      statusHistory: { create: { fromStatus: task.status, toStatus: parsed.status, changedBy: resolved.actorId, reason: parsed.reason } },
    } })
    await audit(tx, resolved.actorId, 'HOUSEKEEPING_TASK_STATUS_CHANGED', 'housekeepingTask', task.id, { propertyId: resolved.propertyId, fromStatus: task.status, toStatus: parsed.status, reason: parsed.reason })
    await recordDomainEvent(tx, { propertyId: resolved.propertyId, eventType: 'HOUSEKEEPING_TASK_STATUS_CHANGED', aggregateType: 'housekeepingTask', aggregateId: task.id, actorUserId: resolved.actorId, metadata: { fromStatus: task.status, toStatus: parsed.status } })
    return publicTask(updated)
  })
}

export async function listHousekeepingIssues(prisma, context, input = {}) {
  const { propertyId } = contextFor(context)
  const parsed = parse(listIssuesSchema, input)
  const where = { propertyId }
  if (parsed.status) where.status = parsed.status
  if (parsed.severity) where.severity = parsed.severity
  if (parsed.roomId) where.roomId = parsed.roomId
  const rows = await prisma.housekeepingIssue.findMany({ where, orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }], take: parsed.limit })
  return rows.map(publicIssue)
}

export async function createHousekeepingIssue(prisma, context, input) {
  const resolved = contextFor(context, ISSUE_CREATE_ROLES)
  const parsed = parse(createIssueSchema, input)
  return prisma.$transaction(async (tx) => {
    await requireRoom(tx, resolved.propertyId, parsed.roomId)
    if (parsed.assignedToUserId) await requireAssignee(tx, resolved.propertyId, parsed.assignedToUserId)
    if (parsed.taskId) {
      const task = await tx.housekeepingTask.findFirst({ where: { id: parsed.taskId, propertyId: resolved.propertyId, roomId: parsed.roomId } })
      if (!task) throw new PmsValidationError('Linked task was not found for this room and property.', 404)
    }
    const issue = await tx.housekeepingIssue.create({ data: {
      propertyId: resolved.propertyId, roomId: parsed.roomId, taskId: parsed.taskId || null,
      category: parsed.category, severity: parsed.severity, title: parsed.title, description: parsed.description,
      assignedToUserId: parsed.assignedToUserId || null, reportedBy: resolved.actorId,
      statusHistory: { create: { fromStatus: null, toStatus: 'OPEN', changedBy: resolved.actorId, reason: parsed.reason } },
    } })
    await audit(tx, resolved.actorId, 'HOUSEKEEPING_ISSUE_CREATED', 'housekeepingIssue', issue.id, { propertyId: resolved.propertyId, roomId: issue.roomId, severity: issue.severity, reason: parsed.reason })
    await recordDomainEvent(tx, { propertyId: resolved.propertyId, eventType: 'HOUSEKEEPING_ISSUE_CREATED', aggregateType: 'housekeepingIssue', aggregateId: issue.id, actorUserId: resolved.actorId, metadata: { roomId: issue.roomId, severity: issue.severity } })
    return publicIssue(issue)
  })
}

export async function transitionHousekeepingIssue(prisma, context, input) {
  const resolved = contextFor(context, ISSUE_WORK_ROLES)
  const parsed = parse(transitionIssueSchema, input)
  return prisma.$transaction(async (tx) => {
    const issue = await tx.housekeepingIssue.findFirst({ where: { id: parsed.issueId, propertyId: resolved.propertyId } })
    if (!issue) throw new PmsValidationError('Housekeeping issue was not found.', 404)
    if (issue.status === parsed.status) return publicIssue(issue)
    if (!ISSUE_TRANSITIONS[issue.status]?.has(parsed.status)) throw new PmsValidationError(`Issue cannot move from ${issue.status} to ${parsed.status}.`, 409)
    if (issue.severity === 'CRITICAL' && ['RESOLVED', 'CLOSED'].includes(parsed.status) && !['ADMIN', 'MANAGER'].includes(resolved.role)) {
      throw new PmsValidationError('Critical issue resolution requires manager or admin approval.', 403)
    }
    const resolvedAt = parsed.status === 'RESOLVED' || parsed.status === 'CLOSED' ? new Date() : null
    const updated = await tx.housekeepingIssue.update({ where: { id: issue.id }, data: {
      status: parsed.status,
      resolvedAt,
      statusHistory: { create: { fromStatus: issue.status, toStatus: parsed.status, changedBy: resolved.actorId, reason: parsed.reason } },
    } })
    await audit(tx, resolved.actorId, 'HOUSEKEEPING_ISSUE_STATUS_CHANGED', 'housekeepingIssue', issue.id, { propertyId: resolved.propertyId, fromStatus: issue.status, toStatus: parsed.status, severity: issue.severity, reason: parsed.reason })
    await recordDomainEvent(tx, { propertyId: resolved.propertyId, eventType: 'HOUSEKEEPING_ISSUE_STATUS_CHANGED', aggregateType: 'housekeepingIssue', aggregateId: issue.id, actorUserId: resolved.actorId, metadata: { fromStatus: issue.status, toStatus: parsed.status, severity: issue.severity } })
    return publicIssue(updated)
  })
}
