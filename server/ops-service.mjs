import { createHash } from 'node:crypto'
import { SANDBOX_RULES, getBangkokDateKey, PmsValidationError } from './pms-domain.mjs'

const TASK_TYPES = new Set([
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
  'NO_OP_CLARIFY',
  'FORBIDDEN',
])

const WRITE_TASK_TYPES = new Set([
  'SEND_GUEST_REPLY',
  'UPDATE_RATE',
  'UPDATE_AVAILABILITY',
  'CLOSE_ROOM',
  'OPEN_ROOM',
  'UPDATE_DESCRIPTION',
  'UPDATE_PHOTOS',
])

const RULES = {
  READ_RESERVATIONS: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'VIEWER', 'SYSTEM'], approvalRequired: false },
  READ_GUEST_MESSAGES: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'SYSTEM'], approvalRequired: false },
  DRAFT_GUEST_REPLY: { riskLevel: 'MEDIUM', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF'], approvalRequired: false },
  SEND_GUEST_REPLY: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'HOTEL_MANAGER' },
  READ_RATES: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'VIEWER', 'SYSTEM'], approvalRequired: false },
  UPDATE_RATE: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'OWNER', minRate: 800, maxRate: 6000 },
  READ_AVAILABILITY: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'VIEWER', 'SYSTEM'], approvalRequired: false },
  UPDATE_AVAILABILITY: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'OWNER' },
  CLOSE_ROOM: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'OWNER' },
  OPEN_ROOM: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'OWNER' },
  UPDATE_DESCRIPTION: { riskLevel: 'HIGH', allowedRoles: ['OWNER', 'HOTEL_MANAGER'], approvalRequired: true, requiredApprovalRole: 'OWNER' },
  UPDATE_PHOTOS: { riskLevel: 'CRITICAL', allowedRoles: ['OWNER'], approvalRequired: true, requiredApprovalRole: 'OWNER', enabledInMvp: false },
  SCAN_BOOKINGS: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'SYSTEM'], approvalRequired: false },
  GENERATE_RECOMMENDATION: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'SYSTEM'], approvalRequired: false },
  NO_OP_CLARIFY: { riskLevel: 'LOW', allowedRoles: ['OWNER', 'HOTEL_MANAGER', 'STAFF', 'VIEWER', 'SYSTEM'], approvalRequired: false, execute: false },
  FORBIDDEN: { riskLevel: 'FORBIDDEN', allowedRoles: [], approvalRequired: false, execute: false },
}

const FORBIDDEN_PATTERNS = [
  'bypass captcha',
  'bypass 2fa',
  'show password',
  'reveal credentials',
  'hide this from logs',
  'delete audit log',
  'use owner chatgpt account directly',
  'cancel all bookings',
  'refund guests',
]

const taskInclude = {
  approvals: { orderBy: { requestedAt: 'desc' } },
  logs: { orderBy: { createdAt: 'desc' }, take: 20 },
}

function actorLabel(actor) {
  return actor?.name || actor?.displayName || actor?.email || actor?.username || actor?.id || 'System'
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeNullableString(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizePlatform(text) {
  const lower = String(text || '').toLowerCase()
  if (lower.includes('agoda')) return 'agoda'
  if (lower.includes('booking')) return 'booking'
  if (lower.includes('expedia')) return 'expedia'
  if (lower.includes('trip')) return 'trip'
  if (lower.includes('all channels') || lower.includes('all ota') || lower.includes('all platforms')) return 'all'
  return 'unknown'
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function bangkokTodayDate(now = new Date()) {
  return new Date(`${getBangkokDateKey(now)}T00:00:00.000Z`)
}

function nextDayOfWeek(targetDay, now = new Date()) {
  const today = bangkokTodayDate(now)
  const current = today.getUTCDay()
  let delta = (targetDay - current + 7) % 7
  if (delta === 0) delta = 7
  today.setUTCDate(today.getUTCDate() + delta)
  return today
}

function parseDateRange(text, now = new Date()) {
  const lower = String(text || '').toLowerCase()
  if (lower.includes('this friday') && lower.includes('saturday')) {
    const friday = nextDayOfWeek(5, now)
    const saturday = new Date(friday)
    saturday.setUTCDate(friday.getUTCDate() + 1)
    return { start: isoDate(friday), end: isoDate(saturday) }
  }
  if (lower.includes('next weekend')) {
    const saturday = nextDayOfWeek(6, now)
    const sunday = new Date(saturday)
    sunday.setUTCDate(saturday.getUTCDate() + 1)
    return { start: isoDate(saturday), end: isoDate(sunday) }
  }
  if (lower.includes('today')) {
    const today = bangkokTodayDate(now)
    return { start: isoDate(today), end: isoDate(today) }
  }
  if (lower.includes('tomorrow')) {
    const tomorrow = bangkokTodayDate(now)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    return { start: isoDate(tomorrow), end: isoDate(tomorrow) }
  }
  const rangeMatch = lower.match(/(20\d{2}-\d{2}-\d{2})\s*(?:to|through|-)\s*(20\d{2}-\d{2}-\d{2})/)
  if (rangeMatch) return { start: rangeMatch[1], end: rangeMatch[2] }
  const singleMatch = lower.match(/(20\d{2}-\d{2}-\d{2})/)
  if (singleMatch) return { start: singleMatch[1], end: singleMatch[1] }
  return { start: null, end: null }
}

function parseRoomType(text) {
  if (/\ball\s+rooms?\b/i.test(String(text || ''))) return 'All Rooms'
  const match = String(text || '').match(/\b(deluxe|superior|standard|twin|double|family|suite)(?:\s+room)?\b/i)
  if (!match) return null
  const normalized = match[0].replace(/\s+/g, ' ').trim()
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase())
}

function parseMoney(text) {
  const match = String(text || '').match(/(?:THB|฿)?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(?:THB|baht)?/i)
  if (!match) return { amount: null, currency: 'THB' }
  return { amount: Number(match[1].replace(/,/g, '')), currency: 'THB' }
}

function taskWithRule(taskType, overrides = {}) {
  const rule = RULES[taskType] || RULES.FORBIDDEN
  return {
    taskType,
    platform: overrides.platform || 'unknown',
    hotelId: SANDBOX_RULES.propertyCode,
    roomType: overrides.roomType ?? null,
    dateRange: overrides.dateRange || { start: null, end: null },
    rate: overrides.rate,
    availability: overrides.availability,
    message: overrides.message ?? null,
    riskLevel: overrides.riskLevel || rule.riskLevel,
    approvalRequired: overrides.approvalRequired ?? rule.approvalRequired,
    confidence: overrides.confidence ?? 0.78,
    missingFields: overrides.missingFields || [],
    rationale: overrides.rationale || 'Parsed with deterministic Hotel Ops MVP parser.',
  }
}

export function parseHotelOpsCommand(rawMessage, options = {}) {
  const message = normalizeText(rawMessage)
  const lower = message.toLowerCase()
  const platform = normalizePlatform(message)
  const dateRange = parseDateRange(message, options.now)
  const roomType = parseRoomType(message)
  const rate = parseMoney(message)

  if (!message) {
    return taskWithRule('NO_OP_CLARIFY', {
      missingFields: ['message'],
      rationale: 'No instruction was supplied.',
      confidence: 0.3,
    })
  }

  if (FORBIDDEN_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return taskWithRule('FORBIDDEN', {
      platform,
      riskLevel: 'FORBIDDEN',
      approvalRequired: false,
      rationale: 'The command matches a prohibited Hotel Ops pattern.',
      confidence: 0.96,
    })
  }

  if (/(check|scan|read|show).*(booking|reservation)/.test(lower)) {
    return taskWithRule(lower.includes('scan') || lower.includes('check bookings') ? 'SCAN_BOOKINGS' : 'READ_RESERVATIONS', {
      platform,
      dateRange,
      rationale: 'Read-only booking scan request.',
      confidence: 0.88,
    })
  }

  if (/(read|check|show).*(rate|price)/.test(lower)) {
    return taskWithRule('READ_RATES', {
      platform,
      roomType,
      dateRange,
      rationale: 'Read-only rate lookup request.',
      confidence: 0.82,
    })
  }

  if (/(close|stop sell|block).*(room|availability)|closeout/.test(lower)) {
    const missingFields = []
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', { platform, roomType, dateRange, missingFields, rationale: 'Closing rooms needs room type and dates.' })
    }
    return taskWithRule('CLOSE_ROOM', {
      platform,
      roomType,
      dateRange,
      availability: { rooms: 0, status: 'closed' },
      rationale: 'Close room availability request.',
      confidence: 0.83,
    })
  }

  if (/(open|reopen).*(room|availability)/.test(lower)) {
    const missingFields = []
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', { platform, roomType, dateRange, missingFields, rationale: 'Opening rooms needs room type and dates.' })
    }
    return taskWithRule('OPEN_ROOM', {
      platform,
      roomType,
      dateRange,
      availability: { rooms: null, status: 'open' },
      rationale: 'Open room availability request.',
      confidence: 0.83,
    })
  }

  if (/(change|raise|increase|decrease|set|update).*(rate|price)|\bprice\b|\bthb\b|฿/.test(lower)) {
    const missingFields = []
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (!rate.amount) missingFields.push('rate.amount')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        roomType,
        dateRange,
        rate,
        missingFields,
        rationale: 'Rate changes need room type, date range, and amount before approval.',
        confidence: 0.72,
      })
    }
    return taskWithRule('UPDATE_RATE', {
      platform,
      roomType,
      dateRange,
      rate,
      rationale: 'High-risk rate change request.',
      confidence: 0.9,
    })
  }

  if (/(message|reply|guest)/.test(lower)) {
    return taskWithRule(lower.includes('send') ? 'SEND_GUEST_REPLY' : 'DRAFT_GUEST_REPLY', {
      platform,
      message,
      rationale: lower.includes('send') ? 'Sending guest replies requires approval.' : 'Draft guest reply request.',
      confidence: 0.7,
    })
  }

  return taskWithRule('NO_OP_CLARIFY', {
    platform,
    missingFields: ['taskType'],
    rationale: 'The command could not be mapped to an approved Hotel Ops task.',
    confidence: 0.42,
  })
}

function opsRoleForUser(user) {
  const role = String(user?.role || '').toUpperCase()
  if (role === 'ADMIN') return 'OWNER'
  if (role === 'MANAGER') return 'HOTEL_MANAGER'
  if (role === 'SYSTEM') return 'SYSTEM'
  if (role) return 'STAFF'
  return 'VIEWER'
}

function decisionFor(parsedTask, actor, emergencyStop) {
  const rule = RULES[parsedTask.taskType] || RULES.FORBIDDEN
  const role = opsRoleForUser(actor)

  if (!TASK_TYPES.has(parsedTask.taskType)) {
    return { allowed: false, approvalRequired: false, riskLevel: 'FORBIDDEN', reason: 'Unknown task type.' }
  }
  if (parsedTask.taskType === 'FORBIDDEN' || rule.execute === false && parsedTask.taskType === 'FORBIDDEN') {
    return { allowed: false, approvalRequired: false, riskLevel: 'FORBIDDEN', reason: parsedTask.rationale || 'Forbidden task.' }
  }
  if (rule.enabledInMvp === false) {
    return { allowed: false, approvalRequired: true, requiredApprovalRole: rule.requiredApprovalRole, riskLevel: rule.riskLevel, reason: `${parsedTask.taskType} is not enabled in the MVP.` }
  }
  if (emergencyStop?.enabled && WRITE_TASK_TYPES.has(parsedTask.taskType)) {
    return { allowed: false, approvalRequired: rule.approvalRequired, requiredApprovalRole: rule.requiredApprovalRole, riskLevel: rule.riskLevel, reason: 'Emergency stop is enabled for Hotel Ops write tasks.', blockedByEmergencyStop: true }
  }
  if (!rule.allowedRoles.includes(role)) {
    return { allowed: false, approvalRequired: rule.approvalRequired, requiredApprovalRole: rule.requiredApprovalRole, riskLevel: rule.riskLevel, reason: `${role} cannot create ${parsedTask.taskType}.` }
  }
  if (parsedTask.taskType === 'UPDATE_RATE') {
    const amount = Number(parsedTask.rate?.amount)
    if (!Number.isFinite(amount) || amount < rule.minRate || amount > rule.maxRate) {
      return { allowed: false, approvalRequired: true, requiredApprovalRole: 'OWNER', riskLevel: rule.riskLevel, reason: `Rate must be between ${rule.minRate} and ${rule.maxRate} THB.` }
    }
  }
  if (parsedTask.taskType === 'NO_OP_CLARIFY') {
    return { allowed: true, approvalRequired: false, riskLevel: 'LOW', reason: 'Clarification required before execution.' }
  }
  return {
    allowed: true,
    approvalRequired: Boolean(rule.approvalRequired),
    requiredApprovalRole: rule.requiredApprovalRole,
    riskLevel: rule.riskLevel,
    reason: rule.approvalRequired ? `${parsedTask.taskType} requires ${rule.requiredApprovalRole || 'manager'} approval.` : 'Task is allowed.',
  }
}

export function evaluateOpsPermission(parsedTask, actor, emergencyStop = { enabled: false }) {
  return decisionFor(parsedTask, actor, emergencyStop)
}

function dateOrNull(key) {
  return key ? new Date(`${key}T00:00:00.000Z`) : null
}

function serializeTask(task) {
  if (!task) return null
  return {
    id: task.id,
    requesterUserId: task.requesterUserId,
    requesterLabel: task.requesterLabel,
    rawMessage: task.rawMessage,
    sourceChannel: task.sourceChannel,
    taskType: task.taskType,
    platform: task.platform,
    hotelId: task.hotelId,
    roomType: task.roomType,
    dateRange: {
      start: task.dateStart ? isoDate(task.dateStart) : null,
      end: task.dateEnd ? isoDate(task.dateEnd) : null,
    },
    rate: task.rateAmount === null || task.rateAmount === undefined ? undefined : { amount: task.rateAmount, currency: task.rateCurrency || 'THB' },
    availability: task.availabilityStatus || task.availabilityRooms !== null ? { rooms: task.availabilityRooms, status: task.availabilityStatus } : undefined,
    message: task.message,
    riskLevel: task.riskLevel,
    approvalRequired: task.approvalRequired,
    confidence: task.confidence,
    missingFields: task.missingFields || [],
    rationale: task.rationale,
    status: task.status,
    idempotencyKey: task.idempotencyKey,
    permissionDecision: task.permissionDecision,
    proofScreenshots: task.proofScreenshots || [],
    executionSummary: task.executionSummary,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    approvals: task.approvals || [],
    logs: task.logs || [],
    createdAt: task.createdAt?.toISOString?.() || task.createdAt,
    updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
  }
}

function serializeAlert(alert) {
  if (!alert) return null
  return {
    id: alert.id,
    hotelId: SANDBOX_RULES.propertyCode,
    alertType: alert.alertType,
    severity: alert.severity,
    title: alert.title,
    summary: alert.summary,
    platform: alert.platform,
    roomType: alert.roomType,
    dateRange: {
      start: alert.dateStart ? isoDate(alert.dateStart) : null,
      end: alert.dateEnd ? isoDate(alert.dateEnd) : null,
    },
    metrics: alert.metrics || {},
    recommendedAction: alert.recommendedAction,
    status: alert.status,
    createdAt: alert.createdAt?.toISOString?.() || alert.createdAt,
    updatedAt: alert.updatedAt?.toISOString?.() || alert.updatedAt,
  }
}

async function getProperty(prisma) {
  const property = await prisma.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } })
  if (!property) throw new PmsValidationError('Property setup has not been completed yet.', 503)
  return property
}

async function taskLog(tx, taskId, action, message, actor, metadata) {
  return tx.hotelOpsTaskLog.create({
    data: {
      taskId,
      action,
      message,
      actor: actorLabel(actor),
      metadata,
    },
  })
}

async function audit(tx, actor, action, entityType, entityId, changes) {
  return tx.auditLog.create({
    data: {
      userId: actor?.id || 'system',
      action,
      entityType,
      entityId,
      changes,
    },
  })
}

function idempotencyKey(actor, rawMessage, sourceChannel) {
  return createHash('sha256')
    .update(`${actor?.id || 'system'}:${sourceChannel}:${normalizeText(rawMessage).toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex')
}

function mockProof(task, kind = 'after') {
  return [{
    id: `${task.id}-${kind}`,
    kind,
    storageUrl: `mock://hotel-ops/${task.id}/${kind}`,
    capturedAt: new Date().toISOString(),
    redactionStatus: 'SAFE',
  }]
}

async function executeMockTask(tx, task, actor) {
  await tx.hotelOpsTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } })
  await taskLog(tx, task.id, 'WORKER_STARTED', 'Mock OTA worker started in dry-run mode.', actor, { dryRun: true })

  const raw = task.rawMessage.toLowerCase()
  let result
  if (raw.includes('selector failure')) {
    result = {
      status: 'FAILED',
      summary: 'Mock OTA worker could not find the expected selector.',
      proofScreenshots: mockProof(task, 'error'),
      errorCode: 'MOCK_SELECTOR_FAILURE',
      errorMessage: 'Selector not found in mock adapter.',
    }
  } else if (raw.includes('2fa') || raw.includes('captcha')) {
    result = {
      status: 'NEEDS_HUMAN',
      summary: 'Mock OTA worker requires human 2FA/CAPTCHA completion. No bypass attempted.',
      proofScreenshots: mockProof(task, 'trace'),
      errorCode: 'NEEDS_HUMAN_CHALLENGE',
      errorMessage: '2FA/CAPTCHA requires authorized human action.',
    }
  } else {
    result = {
      status: 'SUCCEEDED',
      summary: WRITE_TASK_TYPES.has(task.taskType)
        ? `Dry-run ${task.taskType} completed for ${task.platform}. No OTA state was changed.`
        : `${task.taskType} completed using PMS/mock booking data.`,
      proofScreenshots: mockProof(task, WRITE_TASK_TYPES.has(task.taskType) ? 'after' : 'trace'),
    }
  }

  const updated = await tx.hotelOpsTask.update({
    where: { id: task.id },
    data: {
      status: result.status,
      proofScreenshots: result.proofScreenshots,
      executionSummary: result.summary,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    },
    include: taskInclude,
  })
  await taskLog(tx, task.id, `WORKER_${result.status}`, result.summary, actor, result)
  await audit(tx, actor, `OPS_TASK_${result.status}`, 'hotelOpsTask', task.id, { taskType: task.taskType, status: result.status, dryRun: true })
  return updated
}

export async function submitOpsCommand(prisma, input, actor) {
  const property = await getProperty(prisma)
  const rawMessage = normalizeText(input?.message || input?.rawMessage)
  const sourceChannel = normalizeText(input?.sourceChannel || 'web') || 'web'
  const parsed = parseHotelOpsCommand(rawMessage)
  const stop = await getEmergencyStop(prisma)
  const decision = decisionFor(parsed, actor, stop)
  const key = normalizeNullableString(input?.idempotencyKey) || idempotencyKey(actor, rawMessage, sourceChannel)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.hotelOpsTask.findUnique({ where: { idempotencyKey: key }, include: taskInclude })
    if (existing) {
      await taskLog(tx, existing.id, 'IDEMPOTENT_REPLAY', 'Duplicate command returned existing task.', actor, { idempotencyKey: key })
      return { task: serializeTask(existing), parsed, decision: existing.permissionDecision || decision, duplicate: true }
    }

    let status = 'DRAFT'
    if (!decision.allowed) status = 'DENIED'
    else if (parsed.taskType === 'NO_OP_CLARIFY') status = 'DRAFT'
    else if (decision.approvalRequired) status = 'PENDING_APPROVAL'
    else status = 'QUEUED'

    const task = await tx.hotelOpsTask.create({
      data: {
        propertyId: property.id,
        requesterUserId: actor?.id || 'system',
        requesterLabel: actorLabel(actor),
        rawMessage,
        sourceChannel,
        taskType: parsed.taskType,
        platform: parsed.platform,
        hotelId: parsed.hotelId,
        roomType: parsed.roomType,
        dateStart: dateOrNull(parsed.dateRange.start),
        dateEnd: dateOrNull(parsed.dateRange.end),
        rateAmount: parsed.rate?.amount ?? null,
        rateCurrency: parsed.rate?.currency ?? null,
        availabilityRooms: parsed.availability?.rooms ?? null,
        availabilityStatus: parsed.availability?.status ?? null,
        message: parsed.message,
        riskLevel: decision.riskLevel,
        approvalRequired: decision.approvalRequired,
        confidence: parsed.confidence,
        missingFields: parsed.missingFields,
        rationale: parsed.rationale,
        status,
        idempotencyKey: key,
        permissionDecision: decision,
      },
      include: taskInclude,
    })

    await taskLog(tx, task.id, 'COMMAND_RECEIVED', 'Hotel Ops command received.', actor, { rawMessage })
    await taskLog(tx, task.id, 'PARSER_OUTPUT', 'Command parsed into a controlled task.', actor, parsed)
    await taskLog(tx, task.id, 'PERMISSION_DECISION', decision.reason, actor, decision)
    await audit(tx, actor, 'OPS_COMMAND_RECEIVED', 'hotelOpsTask', task.id, { rawMessage, parsed })
    await audit(tx, actor, 'OPS_PERMISSION_DECISION', 'hotelOpsTask', task.id, decision)

    if (status === 'PENDING_APPROVAL') {
      await tx.hotelOpsTaskApproval.create({
        data: {
          taskId: task.id,
          requiredRole: decision.requiredApprovalRole || 'HOTEL_MANAGER',
        },
      })
      await taskLog(tx, task.id, 'APPROVAL_REQUESTED', decision.reason, actor, { requiredRole: decision.requiredApprovalRole })
      await audit(tx, actor, 'OPS_APPROVAL_REQUESTED', 'hotelOpsTask', task.id, { requiredRole: decision.requiredApprovalRole })
      return { task: serializeTask(await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })), parsed, decision, duplicate: false }
    }

    if (status === 'QUEUED') {
      await taskLog(tx, task.id, 'TASK_QUEUED', 'Task queued for mock execution.', actor, { dryRun: true })
      return { task: serializeTask(await executeMockTask(tx, task, actor)), parsed, decision, duplicate: false }
    }

    return { task: serializeTask(await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })), parsed, decision, duplicate: false }
  })
}

export async function listOpsTasks(prisma, filters = {}) {
  await getProperty(prisma)
  const where = {}
  if (filters.status) where.status = String(filters.status).toUpperCase()
  const take = Math.min(Math.max(Number(filters.limit) || 50, 1), 200)
  const tasks = await prisma.hotelOpsTask.findMany({
    where,
    include: taskInclude,
    orderBy: { createdAt: 'desc' },
    take,
  })
  return tasks.map(serializeTask)
}

export async function getOpsTask(prisma, taskId) {
  const task = await prisma.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
  if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
  return serializeTask(task)
}

function canApprove(actor, requiredRole) {
  const role = opsRoleForUser(actor)
  if (role === 'OWNER') return true
  return requiredRole === 'HOTEL_MANAGER' && role === 'HOTEL_MANAGER'
}

export async function approveOpsTask(prisma, taskId, input, actor) {
  const stop = await getEmergencyStop(prisma)
  return prisma.$transaction(async (tx) => {
    const task = await tx.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
    if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    if (task.status !== 'PENDING_APPROVAL') throw new PmsValidationError('Only pending tasks can be approved.', 409)
    const approval = task.approvals.find((item) => item.status === 'PENDING')
    if (!approval) throw new PmsValidationError('No pending approval exists for this task.', 409)
    if (!canApprove(actor, approval.requiredRole)) throw new PmsValidationError(`${approval.requiredRole} approval is required.`, 403)
    if (stop?.enabled && WRITE_TASK_TYPES.has(task.taskType)) throw new PmsValidationError('Emergency stop is enabled for Hotel Ops write tasks.', 409)

    await tx.hotelOpsTaskApproval.update({
      where: { id: approval.id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedBy: actorLabel(actor),
        notes: normalizeNullableString(input?.notes),
      },
    })
    await tx.hotelOpsTask.update({ where: { id: task.id }, data: { status: 'APPROVED' } })
    await taskLog(tx, task.id, 'APPROVAL_GRANTED', 'Hotel Ops task approved.', actor, { notes: normalizeNullableString(input?.notes) })
    await audit(tx, actor, 'OPS_APPROVAL_GRANTED', 'hotelOpsTask', task.id, { requiredRole: approval.requiredRole })
    await taskLog(tx, task.id, 'TASK_QUEUED', 'Approved task queued for mock execution.', actor, { dryRun: true })
    return serializeTask(await executeMockTask(tx, task, actor))
  })
}

export async function denyOpsTask(prisma, taskId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
    if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    if (!['PENDING_APPROVAL', 'DRAFT', 'QUEUED'].includes(task.status)) throw new PmsValidationError('This task can no longer be denied.', 409)
    const approval = task.approvals.find((item) => item.status === 'PENDING')
    if (approval) {
      await tx.hotelOpsTaskApproval.update({
        where: { id: approval.id },
        data: {
          status: 'DENIED',
          decidedAt: new Date(),
          decidedBy: actorLabel(actor),
          notes: normalizeNullableString(input?.reason || input?.notes),
        },
      })
    }
    const updated = await tx.hotelOpsTask.update({ where: { id: task.id }, data: { status: 'DENIED' }, include: taskInclude })
    await taskLog(tx, task.id, 'APPROVAL_DENIED', 'Hotel Ops task denied.', actor, { reason: normalizeNullableString(input?.reason || input?.notes) })
    await audit(tx, actor, 'OPS_APPROVAL_DENIED', 'hotelOpsTask', task.id, { reason: normalizeNullableString(input?.reason || input?.notes) })
    return serializeTask(updated)
  })
}

export async function cancelOpsTask(prisma, taskId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
    if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    if (['SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED'].includes(task.status)) throw new PmsValidationError('This task is already closed.', 409)
    const updated = await tx.hotelOpsTask.update({ where: { id: task.id }, data: { status: 'CANCELLED' }, include: taskInclude })
    await taskLog(tx, task.id, 'TASK_CANCELLED', 'Hotel Ops task cancelled.', actor, { reason: normalizeNullableString(input?.reason) })
    await audit(tx, actor, 'OPS_TASK_CANCELLED', 'hotelOpsTask', task.id, { reason: normalizeNullableString(input?.reason) })
    return serializeTask(updated)
  })
}

export async function listOpsApprovals(prisma) {
  const approvals = await prisma.hotelOpsTaskApproval.findMany({
    where: { status: 'PENDING' },
    include: { task: { include: taskInclude } },
    orderBy: { requestedAt: 'asc' },
  })
  return approvals.map((approval) => ({
    ...approval,
    task: serializeTask(approval.task),
  }))
}

export async function getEmergencyStop(prisma) {
  const property = await getProperty(prisma)
  const stop = await prisma.hotelOpsEmergencyStop.upsert({
    where: { propertyId: property.id },
    create: { propertyId: property.id, enabled: false },
    update: {},
  })
  return stop
}

export async function setEmergencyStop(prisma, input, actor) {
  const property = await getProperty(prisma)
  const enabled = Boolean(input?.enabled)
  const stop = await prisma.hotelOpsEmergencyStop.upsert({
    where: { propertyId: property.id },
    create: {
      propertyId: property.id,
      enabled,
      reason: normalizeNullableString(input?.reason),
      updatedBy: actorLabel(actor),
    },
    update: {
      enabled,
      reason: normalizeNullableString(input?.reason),
      updatedBy: actorLabel(actor),
    },
  })
  await audit(prisma, actor, enabled ? 'OPS_EMERGENCY_STOP_ENABLED' : 'OPS_EMERGENCY_STOP_DISABLED', 'hotelOpsEmergencyStop', stop.id, {
    enabled,
    reason: normalizeNullableString(input?.reason),
  })
  return stop
}

export async function getOtaStatus(prisma) {
  await getProperty(prisma)
  return {
    dryRun: String(process.env.OTA_DRY_RUN || 'true').toLowerCase() !== 'false',
    workerConfigured: Boolean(process.env.OTA_WORKER_URL && process.env.OTA_WORKER_SECRET),
    platforms: ['booking', 'agoda', 'trip', 'expedia'].map((platform) => ({
      platform,
      configured: false,
      status: 'mock-dry-run',
      message: 'MVP uses MockOtaBot/dry-run until OTA credentials and Playwright selectors are verified.',
    })),
  }
}

function recommendedRateTask(alertType, roomType, start, end) {
  const increase = alertType === 'HIGH_DEMAND' || alertType === 'WEEKEND_SPIKE'
  return taskWithRule('UPDATE_RATE', {
    platform: 'all',
    roomType,
    dateRange: { start, end },
    rate: { amount: increase ? 2200 : 1300, currency: 'THB' },
    rationale: increase ? 'Demand signal suggests reviewing a controlled rate increase.' : 'Low-demand signal suggests reviewing a controlled promotional rate.',
    confidence: 0.7,
  })
}

export async function runOpsScan(prisma, input = {}, actor = { id: 'system', role: 'SYSTEM' }) {
  const property = await getProperty(prisma)
  const today = bangkokTodayDate()
  const weekEnd = new Date(today)
  weekEnd.setUTCDate(today.getUTCDate() + 7)
  const [reservations, rooms] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        propertyId: property.id,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: weekEnd },
        checkOut: { gte: today },
      },
      include: { roomType: true },
    }),
    prisma.room.count({ where: { propertyId: property.id, operationalStatus: 'AVAILABLE' } }),
  ])

  const occupancy = rooms > 0 ? reservations.length / rooms : 0
  const start = isoDate(today)
  const end = isoDate(weekEnd)
  const weekend = nextDayOfWeek(6)
  const weekendKey = isoDate(weekend)
  const roomType = reservations[0]?.roomType?.name || 'All Rooms'
  const created = []

  if (occupancy >= 0.7 || input.force === 'high-demand') {
    created.push(await prisma.hotelOpsTrendAlert.create({
      data: {
        propertyId: property.id,
        alertType: 'HIGH_DEMAND',
        severity: 'HIGH',
        title: 'High demand window',
        summary: `Upcoming occupancy is ${(occupancy * 100).toFixed(0)}%. Review rates before rooms sell out.`,
        platform: 'all',
        roomType,
        dateStart: dateOrNull(start),
        dateEnd: dateOrNull(end),
        metrics: { occupancy, activeReservations: reservations.length, sellableRooms: rooms, velocityRatio: 1.6 },
        recommendedAction: recommendedRateTask('HIGH_DEMAND', roomType, start, end),
      },
    }))
  }

  if (occupancy < 0.3 || input.force === 'low-demand') {
    created.push(await prisma.hotelOpsTrendAlert.create({
      data: {
        propertyId: property.id,
        alertType: 'LOW_DEMAND',
        severity: 'MEDIUM',
        title: 'Low demand next 7 days',
        summary: `Upcoming occupancy is ${(occupancy * 100).toFixed(0)}%. Consider a controlled promotion or direct-booking push.`,
        platform: 'all',
        roomType,
        dateStart: dateOrNull(start),
        dateEnd: dateOrNull(end),
        metrics: { occupancy, activeReservations: reservations.length, sellableRooms: rooms },
        recommendedAction: recommendedRateTask('LOW_DEMAND', roomType, start, end),
      },
    }))
  }

  created.push(await prisma.hotelOpsTrendAlert.create({
    data: {
      propertyId: property.id,
      alertType: 'WEEKEND_SPIKE',
      severity: 'LOW',
      title: 'Weekend scan complete',
      summary: 'Weekend demand scan completed. Review this alert if reservations accelerate.',
      platform: 'all',
      roomType,
      dateStart: dateOrNull(weekendKey),
      dateEnd: dateOrNull(weekendKey),
      metrics: { occupancy, velocityRatio: occupancy >= 0.7 ? 1.5 : 1, activeReservations: reservations.length },
      recommendedAction: occupancy >= 0.7 ? recommendedRateTask('WEEKEND_SPIKE', roomType, weekendKey, weekendKey) : null,
    },
  }))

  await audit(prisma, actor, 'OPS_SCAN_RUN', 'hotelOpsTrendAlert', created[0]?.id || null, { created: created.length, occupancy })
  return created.map(serializeAlert)
}

export async function listOpsTrendAlerts(prisma, filters = {}) {
  await getProperty(prisma)
  const where = {}
  if (filters.status) where.status = String(filters.status).toUpperCase()
  const alerts = await prisma.hotelOpsTrendAlert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(filters.limit) || 50, 1), 200),
  })
  return alerts.map(serializeAlert)
}

export async function approveOpsAlertRecommendation(prisma, alertId, input, actor) {
  const alert = await prisma.hotelOpsTrendAlert.findUnique({ where: { id: alertId } })
  if (!alert) throw new PmsValidationError('Hotel Ops alert was not found.', 404)
  if (!alert.recommendedAction) throw new PmsValidationError('This alert does not have a recommended action.', 409)
  const action = alert.recommendedAction
  const rateText = action.rate?.amount ? `to ${Number(action.rate.amount).toLocaleString()} ${action.rate.currency || 'THB'}` : ''
  const dateText = action.dateRange?.start && action.dateRange?.end ? `${action.dateRange.start} to ${action.dateRange.end}` : ''
  const message = input?.message || `Set ${action.platform || 'all'} ${action.roomType || 'room'} price ${rateText} ${dateText}`.replace(/\s+/g, ' ').trim()
  const result = await submitOpsCommand(prisma, { message, sourceChannel: 'system', idempotencyKey: `alert:${alert.id}:recommendation` }, actor)
  await prisma.hotelOpsTrendAlert.update({
    where: { id: alert.id },
    data: { status: 'RECOMMENDATION_APPROVED' },
  })
  return result
}
