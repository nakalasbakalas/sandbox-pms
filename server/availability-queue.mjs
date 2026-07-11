import { createHash } from 'node:crypto'
import { SANDBOX_RULES, PmsValidationError } from './pms-domain.mjs'

export const AVAILABILITY_QUEUE_SOURCE = 'manual_availability_queue_v2'
const QUEUE_SOURCE = AVAILABILITY_QUEUE_SOURCE
const POLICY_VERSION = '2026-07-10'
const PROVIDER_ALIASES = Object.freeze({
  booking: 'booking',
  'booking.com': 'booking',
  booking_com: 'booking',
  agoda: 'agoda',
  trip: 'trip',
  'trip.com': 'trip',
  trip_com: 'trip',
  ctrip: 'trip',
  expedia: 'expedia',
  channex: 'channex',
})
const TASK_PLATFORM_BY_PROVIDER = Object.freeze({
  booking: 'booking',
  agoda: 'agoda',
  trip: 'trip',
  expedia: 'expedia',
  channex: 'all',
})
const MUTABLE_QUEUE_STATUSES = new Set(['PENDING_APPROVAL', 'APPROVED', 'QUEUED'])
const QUEUE_FILTER_STATUSES = new Set([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DENIED',
  'CANCELLED',
  'NEEDS_HUMAN',
])
const APPROVER_ROLES = new Set(['ADMIN', 'MANAGER', 'OWNER', 'HOTEL_MANAGER'])
const ATTESTER_ROLES = new Set(['ADMIN', 'MANAGER', 'OWNER', 'HOTEL_MANAGER'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizedRole(actor) {
  return normalizeText(actor?.role).toUpperCase().replaceAll('-', '_')
}

function actorLabel(actor) {
  return normalizeNullableText(actor?.name || actor?.displayName || actor?.email || actor?.username || actor?.id) || 'Unknown operator'
}

function requireActor(actor) {
  const id = normalizeNullableText(actor?.id)
  if (!id) throw new PmsValidationError('An authenticated operator is required.', 401)
  return {
    id,
    label: actorLabel(actor),
    role: normalizedRole(actor),
  }
}

function requireActorRole(actor, allowedRoles, action) {
  const normalized = requireActor(actor)
  if (!allowedRoles.has(normalized.role)) {
    throw new PmsValidationError(`${action} requires an owner or authorized manager.`, 403)
  }
  return normalized
}

export async function resolveAvailabilityQueueActor(prisma, actorRef) {
  const ref = normalizeNullableText(
    actorRef && typeof actorRef === 'object'
      ? actorRef.id || actorRef.username || actorRef.email
      : actorRef,
  )
  if (!ref) throw new PmsValidationError('An active PMS user reference is required.', 401)

  const lowered = ref.toLowerCase()
  const actor = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { id: ref },
        { username: lowered },
        { email: lowered },
      ],
    },
  })
  if (!actor) throw new PmsValidationError('Active PMS user was not found for this queue action.', 404)

  const name = [actor.firstName, actor.lastName]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ')

  return {
    id: actor.id,
    name: name || actor.username || actor.email || actor.id,
    email: actor.email || undefined,
    username: actor.username || undefined,
    role: actor.role,
  }
}

function parseDateKey(value, label) {
  const key = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new PmsValidationError(`${label} must use YYYY-MM-DD.`)
  }
  const parsed = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError(`${label} must be a real calendar date.`)
  }
  return key
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`)
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function queueMetadata(task) {
  const metadata = safeObject(task?.permissionDecision)
  return metadata.queueSource === QUEUE_SOURCE ? metadata : null
}

export function isManualAvailabilityQueueTask(task) {
  return Boolean(queueMetadata(task))
}

function queueIdempotencyKey(payload, requestedKey) {
  const explicit = normalizeNullableText(requestedKey)
  if (explicit) return `availability-queue:${explicit.slice(0, 120)}`
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  return `availability-queue:${fingerprint}`
}

export function normalizeAvailabilityQueueInput(input = {}) {
  const providerKey = normalizeText(input.provider || input.channel || input.target).toLowerCase()
  const provider = PROVIDER_ALIASES[providerKey]
  if (!provider) {
    throw new PmsValidationError('Provider must be Booking.com, Agoda, Trip.com, Expedia, or Channex.')
  }

  const hotelId = normalizeNullableText(input.hotelId || input.propertyExternalId)
  const roomType = normalizeNullableText(input.roomType || input.roomTypeCode || input.externalRoomTypeId)
  const startDate = parseDateKey(input.startDate || input.dateStart || input.from, 'Start date')
  const endDate = parseDateKey(input.endDate || input.dateEnd || input.to, 'End date')
  if (startDate > endDate) {
    throw new PmsValidationError('End date must be on or after start date.')
  }
  if (!hotelId) throw new PmsValidationError('Provider hotel/property ID is required.')
  if (!roomType) throw new PmsValidationError('Room type or provider room mapping is required.')

  const requestedStatus = normalizeText(input.availabilityStatus || input.status).toLowerCase()
  let rooms = input.availableRooms ?? input.rooms ?? input.availability
  if (rooms === '' || rooms === null || rooms === undefined) rooms = undefined
  if (rooms !== undefined) rooms = Number(rooms)
  if (rooms !== undefined && (!Number.isInteger(rooms) || rooms < 0)) {
    throw new PmsValidationError('Available rooms must be a non-negative whole number.')
  }

  let availabilityStatus
  if (requestedStatus) {
    if (!['open', 'closed'].includes(requestedStatus)) {
      throw new PmsValidationError('Availability status must be open or closed.')
    }
    availabilityStatus = requestedStatus
  } else {
    availabilityStatus = rooms === 0 ? 'closed' : 'open'
  }

  if (availabilityStatus === 'closed') rooms = 0
  if (availabilityStatus === 'open' && rooms === undefined) {
    throw new PmsValidationError('Available rooms is required when opening inventory.')
  }

  const reason = normalizeNullableText(input.reason || input.notes || input.message)
  if (!reason || reason.length < 4) {
    throw new PmsValidationError('A short operational reason is required.')
  }

  const deliveryTarget = provider === 'channex' ? 'CHANNEL_MANAGER' : 'MANUAL_PORTAL'
  const normalized = {
    provider,
    taskPlatform: TASK_PLATFORM_BY_PROVIDER[provider],
    providerLabel: provider === 'booking'
      ? 'Booking.com'
      : provider === 'trip'
        ? 'Trip.com'
        : provider === 'channex'
          ? 'Channex'
          : `${provider[0].toUpperCase()}${provider.slice(1)}`,
    hotelId,
    roomType,
    startDate,
    endDate,
    availableRooms: rooms,
    availabilityStatus,
    reason,
    deliveryTarget,
    autoDispatch: false,
  }

  return {
    ...normalized,
    idempotencyKey: queueIdempotencyKey(normalized, input.idempotencyKey),
  }
}

function formatQueueMessage(input) {
  const action = input.availabilityStatus === 'closed'
    ? 'close inventory'
    : `set ${input.availableRooms} room${input.availableRooms === 1 ? '' : 's'} available`
  return [
    `Manual availability queue: ${action}`,
    `Provider: ${input.providerLabel}`,
    `Hotel: ${input.hotelId}`,
    `Room type: ${input.roomType}`,
    `Dates: ${input.startDate} to ${input.endDate}`,
    `Reason: ${input.reason}`,
  ].join('\n')
}

async function getProperty(prisma) {
  const property = await prisma.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } })
  if (!property) throw new PmsValidationError('Property setup has not been completed yet.', 503)
  return property
}

function queueTaskResponse(task) {
  const metadata = queueMetadata(task) || safeObject(task.permissionDecision)
  return {
    id: task.id,
    status: task.status,
    provider: metadata.provider || task.platform,
    providerLabel: metadata.providerLabel || task.platform,
    deliveryTarget: metadata.deliveryTarget || 'MANUAL_PORTAL',
    autoDispatch: false,
    hotelId: task.hotelId,
    roomType: task.roomType || null,
    startDate: dateKey(task.dateStart),
    endDate: dateKey(task.dateEnd),
    availableRooms: task.availabilityRooms,
    availabilityStatus: task.availabilityStatus,
    reason: task.message || task.rationale,
    requesterUserId: task.requesterUserId,
    requesterLabel: task.requesterLabel || null,
    approvalRequired: task.approvalRequired,
    approvals: Array.isArray(task.approvals) ? task.approvals : [],
    providerReference: metadata.providerReference || null,
    deliveryNotes: metadata.deliveryNotes || null,
    executionSummary: task.executionSummary || null,
    errorMessage: task.errorMessage || null,
    createdAt: task.createdAt?.toISOString?.() || task.createdAt,
    updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
  }
}

async function getQueueTask(tx, taskId) {
  const task = await tx.hotelOpsTask.findUnique({
    where: { id: taskId },
    include: {
      approvals: { orderBy: { requestedAt: 'desc' } },
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
  if (!task || !queueMetadata(task)) {
    throw new PmsValidationError('Availability queue item was not found.', 404)
  }
  return task
}

export async function createAvailabilityQueueItem(prisma, input = {}, actor) {
  const operator = requireActor(actor)
  const normalized = normalizeAvailabilityQueueInput(input)
  const property = await getProperty(prisma)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.hotelOpsTask.findUnique({
      where: { idempotencyKey: normalized.idempotencyKey },
      include: {
        approvals: { orderBy: { requestedAt: 'desc' } },
        logs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (existing) {
      if (!queueMetadata(existing)) {
        throw new PmsValidationError('Idempotency key is already used by another Hotel Ops task.', 409)
      }
      return { duplicate: true, item: queueTaskResponse(existing) }
    }

    const task = await tx.hotelOpsTask.create({
      data: {
        propertyId: property.id,
        requesterUserId: operator.id,
        requesterLabel: operator.label,
        rawMessage: formatQueueMessage(normalized),
        sourceChannel: 'web',
        taskType: 'UPDATE_AVAILABILITY',
        platform: normalized.taskPlatform,
        hotelId: normalized.hotelId,
        roomType: normalized.roomType,
        dateStart: dateFromKey(normalized.startDate),
        dateEnd: dateFromKey(normalized.endDate),
        availabilityRooms: normalized.availableRooms,
        availabilityStatus: normalized.availabilityStatus,
        message: normalized.reason,
        riskLevel: 'HIGH',
        approvalRequired: true,
        confidence: 1,
        missingFields: [],
        rationale: `Manual outbound queue only. ${normalized.providerLabel} is not called automatically.`,
        status: 'PENDING_APPROVAL',
        idempotencyKey: normalized.idempotencyKey,
        permissionDecision: {
          allowed: true,
          approvalRequired: true,
          requiredApprovalRole: 'HOTEL_MANAGER',
          riskLevel: 'HIGH',
          reason: 'Manual availability delivery requires hotel manager or owner approval and provider confirmation.',
          queueSource: QUEUE_SOURCE,
          policyVersion: POLICY_VERSION,
          provider: normalized.provider,
          providerLabel: normalized.providerLabel,
          deliveryTarget: normalized.deliveryTarget,
          autoDispatch: false,
          trueTwoWayRequiresZeroLag: true,
        },
      },
    })

    await tx.hotelOpsTaskApproval.create({
      data: {
        taskId: task.id,
        requiredRole: 'HOTEL_MANAGER',
        status: 'PENDING',
      },
    })
    await tx.hotelOpsTaskLog.create({
      data: {
        taskId: task.id,
        action: 'AVAILABILITY_QUEUED',
        message: `${normalized.providerLabel} availability change queued for manager/owner approval; no external write executed.`,
        actor: operator.label,
        metadata: {
          provider: normalized.provider,
          deliveryTarget: normalized.deliveryTarget,
          autoDispatch: false,
        },
      },
    })
    await tx.auditLog.create({
      data: {
        userId: operator.id,
        action: 'AVAILABILITY_QUEUE_CREATED',
        entityType: 'hotelOpsTask',
        entityId: task.id,
        changes: {
          provider: normalized.provider,
          hotelId: normalized.hotelId,
          roomType: normalized.roomType,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          availableRooms: normalized.availableRooms,
          availabilityStatus: normalized.availabilityStatus,
          autoDispatch: false,
        },
      },
    })

    const created = await getQueueTask(tx, task.id)
    return { duplicate: false, item: queueTaskResponse(created) }
  })
}

export async function listAvailabilityQueue(prisma, filters = {}) {
  const property = await getProperty(prisma)
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 250)
  const status = normalizeNullableText(filters.status)?.toUpperCase()
  if (status && !QUEUE_FILTER_STATUSES.has(status)) {
    throw new PmsValidationError('Availability queue status filter is invalid.')
  }
  const tasks = await prisma.hotelOpsTask.findMany({
    where: {
      propertyId: property.id,
      taskType: 'UPDATE_AVAILABILITY',
      ...(status ? { status } : {}),
    },
    include: {
      approvals: { orderBy: { requestedAt: 'desc' } },
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  })
  return tasks.filter((task) => queueMetadata(task)).map(queueTaskResponse)
}

export async function approveAvailabilityQueueItem(prisma, taskId, input = {}, actor) {
  const operator = requireActorRole(actor, APPROVER_ROLES, 'Availability approval')
  return prisma.$transaction(async (tx) => {
    const task = await getQueueTask(tx, taskId)
    if (task.status === 'APPROVED') return queueTaskResponse(task)
    if (task.status !== 'PENDING_APPROVAL') {
      throw new PmsValidationError(`Availability queue item cannot be approved from ${task.status}.`, 409)
    }

    const emergencyStop = await tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId: task.propertyId } })
    if (emergencyStop?.enabled) {
      throw new PmsValidationError('Emergency stop is enabled for Hotel Ops write tasks.', 409)
    }

    const approval = await tx.hotelOpsTaskApproval.findFirst({
      where: { taskId: task.id, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    })
    if (!approval) throw new PmsValidationError('Pending manager/owner approval record was not found.', 409)

    await tx.hotelOpsTaskApproval.update({
      where: { id: approval.id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedBy: operator.id,
        notes: normalizeNullableText(input.notes || input.reason),
      },
    })
    await tx.hotelOpsTask.update({
      where: { id: task.id },
      data: { status: 'APPROVED' },
    })
    await tx.hotelOpsTaskLog.create({
      data: {
        taskId: task.id,
        action: 'AVAILABILITY_APPROVED',
        message: 'Manual availability change approved. It remains unsent until an operator records external delivery.',
        actor: operator.label,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: operator.id,
        action: 'AVAILABILITY_QUEUE_APPROVED',
        entityType: 'hotelOpsTask',
        entityId: task.id,
        changes: { notes: normalizeNullableText(input.notes || input.reason) },
      },
    })
    return queueTaskResponse(await getQueueTask(tx, task.id))
  })
}

export async function markAvailabilityQueueItemSent(prisma, taskId, input = {}, actor) {
  const operator = requireActorRole(actor, ATTESTER_ROLES, 'External delivery attestation')
  const providerReference = normalizeNullableText(input.providerReference || input.reference)
  const notes = normalizeNullableText(input.notes || input.reason)
  if (!providerReference) {
    throw new PmsValidationError('Provider confirmation/reference is required before marking an item sent.')
  }

  return prisma.$transaction(async (tx) => {
    const task = await getQueueTask(tx, taskId)
    if (task.status === 'SUCCEEDED') return queueTaskResponse(task)
    if (!['APPROVED', 'QUEUED'].includes(task.status)) {
      throw new PmsValidationError(`Availability queue item cannot be marked sent from ${task.status}.`, 409)
    }

    const currentMetadata = queueMetadata(task) || {}
    await tx.hotelOpsTask.update({
      where: { id: task.id },
      data: {
        status: 'SUCCEEDED',
        executionSummary: `Manually delivered to ${currentMetadata.providerLabel || task.platform}; provider reference ${providerReference}.`,
        errorCode: null,
        errorMessage: null,
        permissionDecision: {
          ...currentMetadata,
          providerReference,
          deliveryNotes: notes,
          deliveredAt: new Date().toISOString(),
          deliveredBy: operator.id,
          autoDispatch: false,
        },
      },
    })
    await tx.hotelOpsTaskLog.create({
      data: {
        taskId: task.id,
        action: 'AVAILABILITY_MARKED_SENT',
        message: `External delivery attested with provider reference ${providerReference}.`,
        actor: operator.label,
        metadata: {
          providerReference,
          notes,
          autoDispatch: false,
        },
      },
    })
    await tx.auditLog.create({
      data: {
        userId: operator.id,
        action: 'AVAILABILITY_QUEUE_MARKED_SENT',
        entityType: 'hotelOpsTask',
        entityId: task.id,
        changes: { providerReference, notes },
      },
    })
    return queueTaskResponse(await getQueueTask(tx, task.id))
  })
}

export async function markAvailabilityQueueItemFailed(prisma, taskId, input = {}, actor) {
  const operator = requireActorRole(actor, ATTESTER_ROLES, 'External delivery failure recording')
  const errorMessage = normalizeNullableText(input.errorMessage || input.reason || input.notes)
  if (!errorMessage) throw new PmsValidationError('Failure reason is required.')

  return prisma.$transaction(async (tx) => {
    const task = await getQueueTask(tx, taskId)
    if (!['APPROVED', 'QUEUED'].includes(task.status)) {
      throw new PmsValidationError(`Availability queue item cannot be marked failed from ${task.status}.`, 409)
    }
    await tx.hotelOpsTask.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        errorCode: 'MANUAL_DELIVERY_FAILED',
        errorMessage,
        executionSummary: null,
      },
    })
    await tx.hotelOpsTaskLog.create({
      data: {
        taskId: task.id,
        action: 'AVAILABILITY_DELIVERY_FAILED',
        message: errorMessage,
        actor: operator.label,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: operator.id,
        action: 'AVAILABILITY_QUEUE_FAILED',
        entityType: 'hotelOpsTask',
        entityId: task.id,
        changes: { errorMessage },
      },
    })
    return queueTaskResponse(await getQueueTask(tx, task.id))
  })
}

export async function cancelAvailabilityQueueItem(prisma, taskId, input = {}, actor) {
  const operator = requireActorRole(actor, ATTESTER_ROLES, 'Availability queue cancellation')
  const reason = normalizeNullableText(input.reason || input.notes)
  if (!reason) throw new PmsValidationError('Cancellation reason is required.')

  return prisma.$transaction(async (tx) => {
    const task = await getQueueTask(tx, taskId)
    if (task.status === 'CANCELLED') return queueTaskResponse(task)
    if (!MUTABLE_QUEUE_STATUSES.has(task.status)) {
      throw new PmsValidationError(`Availability queue item cannot be cancelled from ${task.status}.`, 409)
    }
    await tx.hotelOpsTask.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        executionSummary: null,
        errorCode: null,
        errorMessage: null,
      },
    })
    await tx.hotelOpsTaskLog.create({
      data: {
        taskId: task.id,
        action: 'AVAILABILITY_CANCELLED',
        message: reason,
        actor: operator.label,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: operator.id,
        action: 'AVAILABILITY_QUEUE_CANCELLED',
        entityType: 'hotelOpsTask',
        entityId: task.id,
        changes: { reason },
      },
    })
    return queueTaskResponse(await getQueueTask(tx, task.id))
  })
}

export function getChannelSyncV2Policy(env = process.env) {
  const requestedProvider = normalizeText(env.CHANNEL_MANAGER_PROVIDER || 'channex').toLowerCase()
  return {
    version: POLICY_VERSION,
    inbound: {
      mode: 'near_live_email_polling',
      appliesOperationalChangesAutomatically: false,
    },
    outboundAvailability: {
      mode: 'manual_queue',
      autoDispatch: false,
      approvalRequired: true,
      providerReferenceRequiredToComplete: true,
    },
    directApiApplications: [
      { provider: 'agoda', status: 'PREPARING' },
      { provider: 'trip', status: 'PREPARING' },
    ],
    trueTwoWay: {
      zeroLagRequired: true,
      channelOnlyProvider: requestedProvider === 'channex' ? 'channex' : requestedProvider,
      avoidSecondPms: true,
    },
  }
}
