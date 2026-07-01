import { createHash } from 'node:crypto'
import { SANDBOX_RULES, getBangkokDateKey, PmsValidationError } from './pms-domain.mjs'
import { opsWorkerBaseUrl, opsWorkerConfigured, opsWorkerSecret } from './ops-worker-auth.mjs'
import { executeOpsWorkerTask } from './ops-worker-client.mjs'
import { bookingComCredentialsConfigured } from './ota-adapters/booking-com.mjs'

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

const ACTIVE_TREND_ALERT_STATUSES = ['CREATED', 'ACKNOWLEDGED', 'RECOMMENDATION_APPROVED']
const OPS_SOURCE_CHANNELS = new Set(['web', 'line', 'whatsapp', 'telegram', 'email', 'system'])

const OPS_SCAN_POLICY = Object.freeze({
  timezone: 'Asia/Bangkok',
  horizonDays: 7,
  bookingVelocityWindowHours: 24,
  bookingVelocityBaselineDays: 28,
  highDemandOccupancy: 0.7,
  highDemandVelocityRatio: 1.5,
  lowDemandOccupancy: 0.3,
  cancellationRecentHours: 24,
  cancellationBaselineDays: 14,
  cancellationSpikeMultiplier: 2,
  weekendVelocityRatio: 1.5,
  otaImbalanceMinimumReservations: 4,
  otaImbalanceDominanceRatio: 0.65,
  highDemandRecommendedRate: 2200,
  lowDemandRecommendedRate: 1300,
  currency: 'THB',
})

const RESERVATION_SOURCE_PLATFORM = Object.freeze({
  BOOKING_COM: 'booking',
  AGODA: 'agoda',
  EXPEDIA: 'expedia',
})

const PLATFORM_LABELS = Object.freeze({
  booking: 'Booking.com',
  agoda: 'Agoda',
  expedia: 'Expedia',
  trip: 'Trip.com',
  unknown: 'Unknown OTA',
})

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
  notifications: { orderBy: { createdAt: 'desc' }, take: 10 },
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

function redactedSensitiveText(value) {
  return String(value || '')
    .replace(/\b(password|passcode|secret|token|api[_ -]?key|credential|session)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
}

function sensitiveKey(key) {
  return /(password|passcode|secret|token|api[_-]?key|credential|session)/i.test(String(key || ''))
}

function sanitizeOpsMetadata(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactedSensitiveText(value)
  if (typeof value !== 'object') return value
  if (depth > 6) return '[REDACTED_DEPTH]'
  if (Array.isArray(value)) return value.map((item) => sanitizeOpsMetadata(item, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey(key) ? '[REDACTED]' : sanitizeOpsMetadata(child, depth + 1),
  ]))
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

function dateValue(value) {
  return value instanceof Date ? value : new Date(value)
}

function dateKeyOrEmpty(value) {
  if (!value) return ''
  const date = dateValue(value)
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : isoDate(date)
}

function bangkokTodayDate(now = new Date()) {
  return new Date(`${getBangkokDateKey(now)}T00:00:00.000Z`)
}

function addUtcDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds)
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

function parseAvailabilityRooms(text) {
  const source = String(text || '').toLowerCase()
  const match = source.match(/(?:availability|inventory)\s*(?:to|at|=)?\s*(\d+)/)
    || source.match(/(\d+)\s+(?:rooms?|units?)\s+(?:available|open|left)/)
    || source.match(/(?:set|update|change|adjust)\s+.*?(?:to|at)\s*(\d+)\s+(?:rooms?|units?)/)
  if (!match) return null
  const rooms = Number(match[1])
  return Number.isInteger(rooms) && rooms >= 0 ? rooms : null
}

function parseMessagePayload(text) {
  const source = String(text || '').trim()
  const explicit = source.match(/\b(?:reply|message|description|listing)\s*[:=-]\s*(.+)$/i)?.[1]
    || source.match(/\b(?:say|saying)\s+["'](.+?)["']/i)?.[1]
    || source.match(/["'](.+?)["']/)?.[1]
  return normalizeNullableString(explicit)
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

function writeTaskNeedsPlatform(platform) {
  return !platform || platform === 'unknown'
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

  if (/(read|check|show|scan).*(availability|inventory|rooms?\s+available|open\s+rooms?)/.test(lower)) {
    const missingFields = []
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        roomType,
        dateRange,
        missingFields,
        rationale: 'Availability lookups need room type and dates.',
        confidence: 0.68,
      })
    }
    return taskWithRule('READ_AVAILABILITY', {
      platform,
      roomType,
      dateRange,
      rationale: 'Read-only availability lookup request.',
      confidence: 0.84,
    })
  }

  if (/(read|check|show|scan).*(guest\s+)?messages?/.test(lower)) {
    return taskWithRule('READ_GUEST_MESSAGES', {
      platform,
      dateRange,
      rationale: 'Read-only guest message lookup request.',
      confidence: 0.82,
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

  if (/(set|update|change|adjust).*(availability|inventory|rooms?\s+available)/.test(lower)) {
    const availabilityRooms = parseAvailabilityRooms(message)
    const missingFields = []
    if (writeTaskNeedsPlatform(platform)) missingFields.push('platform')
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (availabilityRooms === null) missingFields.push('availability.rooms')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        roomType,
        dateRange,
        availability: availabilityRooms === null ? undefined : { rooms: availabilityRooms, status: availabilityRooms === 0 ? 'closed' : 'open' },
        missingFields,
        rationale: 'Availability changes need platform, room type, dates, and rooms available before approval.',
        confidence: 0.7,
      })
    }
    return taskWithRule('UPDATE_AVAILABILITY', {
      platform,
      roomType,
      dateRange,
      availability: { rooms: availabilityRooms, status: availabilityRooms === 0 ? 'closed' : 'open' },
      rationale: 'High-risk availability change request.',
      confidence: 0.86,
    })
  }

  if (/(close|stop sell|block).*(room|availability)|closeout/.test(lower)) {
    const missingFields = []
    if (writeTaskNeedsPlatform(platform)) missingFields.push('platform')
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', { platform, roomType, dateRange, missingFields, rationale: 'Closing rooms needs platform, room type, and dates.' })
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
    if (writeTaskNeedsPlatform(platform)) missingFields.push('platform')
    if (!roomType) missingFields.push('roomType')
    if (!dateRange.start || !dateRange.end) missingFields.push('dateRange')
    if (missingFields.length > 0) {
      return taskWithRule('NO_OP_CLARIFY', { platform, roomType, dateRange, missingFields, rationale: 'Opening rooms needs platform, room type, and dates.' })
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
    if (writeTaskNeedsPlatform(platform)) missingFields.push('platform')
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
        rationale: 'Rate changes need platform, room type, date range, and amount before approval.',
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

  if (/(update|change|rewrite).*(description|listing)/.test(lower)) {
    const description = parseMessagePayload(message)
    if (writeTaskNeedsPlatform(platform)) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        missingFields: ['platform'],
        rationale: 'Listing description updates need a target OTA platform before owner review.',
        confidence: 0.62,
      })
    }
    if (!description) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        missingFields: ['message'],
        rationale: 'Listing description updates need the new approved text before owner review.',
        confidence: 0.62,
      })
    }
    return taskWithRule('UPDATE_DESCRIPTION', {
      platform,
      message: redactedSensitiveText(description),
      rationale: 'Listing description updates require owner approval and dry-run proof.',
      confidence: 0.72,
    })
  }

  if (/(message|reply|guest)/.test(lower)) {
    const replyMessage = parseMessagePayload(message)
    const wantsSend = /\bsend\b/.test(lower)
    if (wantsSend && writeTaskNeedsPlatform(platform)) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        message: replyMessage ? redactedSensitiveText(replyMessage) : null,
        missingFields: ['platform'],
        rationale: 'Sending guest replies needs a target OTA platform before approval.',
        confidence: 0.58,
      })
    }
    if (wantsSend && !replyMessage) {
      return taskWithRule('NO_OP_CLARIFY', {
        platform,
        missingFields: ['message'],
        rationale: 'Sending a guest reply needs the exact approved message text.',
        confidence: 0.58,
      })
    }
    return taskWithRule(wantsSend ? 'SEND_GUEST_REPLY' : 'DRAFT_GUEST_REPLY', {
      platform,
      message: redactedSensitiveText(replyMessage || message),
      rationale: wantsSend ? 'Sending guest replies requires approval.' : 'Draft guest reply request.',
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
  if (WRITE_TASK_TYPES.has(parsedTask.taskType) && writeTaskNeedsPlatform(parsedTask.platform)) {
    return { allowed: false, approvalRequired: rule.approvalRequired, requiredApprovalRole: rule.requiredApprovalRole, riskLevel: rule.riskLevel, reason: `${parsedTask.taskType} requires a supported OTA platform before approval.` }
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

function alertDateOrNull(value) {
  const key = dateKeyOrEmpty(value)
  return key ? dateOrNull(key) : null
}

export function hotelOpsTrendAlertFingerprint(alert = {}) {
  return [
    normalizeText(alert.alertType).toUpperCase(),
    normalizeNullableString(alert.platform) || '',
    normalizeNullableString(alert.roomType) || '',
    dateKeyOrEmpty(alert.dateStart || alert.dateRange?.start),
    dateKeyOrEmpty(alert.dateEnd || alert.dateRange?.end),
  ].join('|')
}

function serializeTask(task) {
  if (!task) return null
  const hasAvailability = (task.availabilityStatus !== null && task.availabilityStatus !== undefined)
    || (task.availabilityRooms !== null && task.availabilityRooms !== undefined)
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
    availability: hasAvailability ? { rooms: task.availabilityRooms, status: task.availabilityStatus } : undefined,
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
    notifications: (task.notifications || []).map(serializeNotification),
    createdAt: task.createdAt?.toISOString?.() || task.createdAt,
    updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
  }
}

function serializeNotification(notification) {
  if (!notification) return null
  return {
    id: notification.id,
    propertyId: notification.propertyId,
    taskId: notification.taskId,
    trendAlertId: notification.trendAlertId,
    type: notification.type,
    channel: notification.channel,
    status: notification.status,
    recipientRole: notification.recipientRole,
    recipientUserId: notification.recipientUserId,
    recipientAddress: notification.recipientAddress,
    title: notification.title,
    summary: notification.summary,
    actionUrl: notification.actionUrl,
    metadata: notification.metadata,
    sentAt: notification.sentAt?.toISOString?.() || notification.sentAt,
    createdAt: notification.createdAt?.toISOString?.() || notification.createdAt,
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

function appActionUrl(path) {
  const normalizedPath = String(path || '/ops/tasks').startsWith('/') ? String(path || '/ops/tasks') : `/${path}`
  const base = normalizeNullableString(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL)
  return base ? `${base.replace(/\/+$/, '')}${normalizedPath}` : normalizedPath
}

function notificationEmailAddress(property) {
  return normalizeNullableString(property?.reservationAlertEmail || property?.email)
}

export function buildOpsNotificationDrafts(property, input = {}) {
  const actionUrl = appActionUrl(input.actionPath || '/ops/tasks')
  const title = redactedSensitiveText(normalizeText(input.title))
  const summary = redactedSensitiveText(normalizeText(input.summary))
  if (!title || !summary) throw new PmsValidationError('Notification title and summary are required.')

  const shared = {
    propertyId: property.id,
    taskId: normalizeNullableString(input.taskId),
    trendAlertId: normalizeNullableString(input.trendAlertId),
    type: input.type || 'TASK_UPDATE',
    recipientRole: input.recipientRole || null,
    recipientUserId: normalizeNullableString(input.recipientUserId),
    title,
    summary,
    actionUrl,
    metadata: input.metadata ? sanitizeOpsMetadata(input.metadata) : undefined,
  }

  const drafts = [{
    ...shared,
    channel: 'IN_APP',
    status: 'SENT',
    sentAt: new Date(),
  }]

  const emailAddress = input.includeEmail === false ? null : notificationEmailAddress(property)
  if (emailAddress) {
    drafts.push({
      ...shared,
      channel: 'EMAIL',
      status: 'PENDING_PROVIDER',
      recipientAddress: emailAddress,
      sentAt: null,
    })
  }

  return drafts
}

async function recordOpsNotifications(tx, propertyId, input, actor) {
  const property = await tx.property.findUnique({ where: { id: propertyId } })
  if (!property) return []
  const created = []
  for (const draft of buildOpsNotificationDrafts(property, input)) {
    created.push(await tx.hotelOpsNotification.create({ data: draft }))
  }
  if (input.taskId) {
    await taskLog(tx, input.taskId, 'NOTIFICATION_RECORDED', input.title, actor, {
      type: input.type,
      channels: created.map((notification) => ({ channel: notification.channel, status: notification.status })),
    })
  }
  await audit(tx, actor, 'OPS_NOTIFICATION_RECORDED', input.taskId ? 'hotelOpsTask' : input.trendAlertId ? 'hotelOpsTrendAlert' : 'hotelOpsNotification', input.taskId || input.trendAlertId || created[0]?.id, {
    type: input.type,
    channels: created.map((notification) => ({ channel: notification.channel, status: notification.status })),
  })
  return created
}

async function taskLog(tx, taskId, action, message, actor, metadata) {
  return tx.hotelOpsTaskLog.create({
    data: {
      taskId,
      action,
      message: redactedSensitiveText(message),
      actor: actorLabel(actor),
      metadata: sanitizeOpsMetadata(metadata),
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
      changes: sanitizeOpsMetadata(changes),
    },
  })
}

function idempotencyKey(actor, rawMessage, sourceChannel) {
  return createHash('sha256')
    .update(`${actor?.id || 'system'}:${sourceChannel}:${normalizeText(rawMessage).toLowerCase().replace(/\s+/g, ' ')}`)
    .digest('hex')
}

export function normalizeOpsSourceChannel(value) {
  const channel = normalizeText(value || 'web').toLowerCase()
  if (!OPS_SOURCE_CHANNELS.has(channel)) {
    throw new PmsValidationError('Hotel Ops source channel is not allowed.', 400)
  }
  return channel
}

function workerFailureProof(task, kind = 'error') {
  return [{
    id: `${task.id}-${kind}`,
    kind,
    storageUrl: `mock://hotel-ops/${task.id}/${kind}`,
    capturedAt: new Date().toISOString(),
    redactionStatus: 'SAFE',
  }]
}

async function queueOpsTask(tx, task, actor, message = 'Task queued for signed worker execution.') {
  const queued = task.status === 'QUEUED'
    ? await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })
    : await tx.hotelOpsTask.update({ where: { id: task.id }, data: { status: 'QUEUED' }, include: taskInclude })
  await taskLog(tx, task.id, 'TASK_QUEUED', message, actor, { dryRun: true, signed: true })
  await audit(tx, actor, 'OPS_TASK_QUEUED', 'hotelOpsTask', task.id, { taskType: task.taskType, status: 'QUEUED', dryRun: true, signed: true })
  await recordOpsNotifications(tx, task.propertyId, {
    type: 'TASK_UPDATE',
    taskId: task.id,
    recipientUserId: task.requesterUserId === 'system' ? null : task.requesterUserId,
    title: 'Hotel Ops task queued',
    summary: `${task.taskType.replace(/_/g, ' ')} is queued for signed worker execution.`,
    actionPath: '/ops/tasks',
    metadata: { status: 'QUEUED', taskType: task.taskType, platform: task.platform, dryRun: true, signed: true },
  }, actor)
  return queued
}

async function recordBlockedOpsTaskAction(tx, task, logAction, auditAction, message, actor, metadata = {}, statusCode = 409) {
  await taskLog(tx, task.id, logAction, message, actor, {
    taskType: task.taskType,
    status: task.status,
    ...metadata,
  })
  await audit(tx, actor, auditAction, 'hotelOpsTask', task.id, {
    taskType: task.taskType,
    status: task.status,
    reason: message,
    ...metadata,
  })
  return { blocked: true, statusCode, reason: message }
}

function requiredApprovalRoleForTask(task) {
  return task?.permissionDecision?.requiredApprovalRole
    || task?.approvals?.find((approval) => approval.status === 'APPROVED')?.requiredRole
    || task?.approvals?.find((approval) => approval.status === 'PENDING')?.requiredRole
    || 'HOTEL_MANAGER'
}

export function evaluateOpsTaskRun(task, actor, emergencyStop = { enabled: false }) {
  if (!task) return { allowed: false, statusCode: 404, reason: 'Hotel Ops task was not found.' }
  if (!['QUEUED', 'APPROVED'].includes(task.status)) {
    return { allowed: false, statusCode: 409, reason: `Only queued Hotel Ops tasks can run. Current status is ${task.status}.` }
  }

  const rule = RULES[task.taskType] || null
  if (!rule || rule.execute === false || task.taskType === 'FORBIDDEN') {
    return { allowed: false, statusCode: 409, reason: `${task.taskType} cannot be sent to the OTA worker.` }
  }

  if (emergencyStop?.enabled && WRITE_TASK_TYPES.has(task.taskType)) {
    return { allowed: false, statusCode: 409, reason: 'Emergency stop is enabled for Hotel Ops write tasks.', blockedByEmergencyStop: true }
  }

  const role = opsRoleForUser(actor)
  if (task.approvalRequired) {
    const approved = task.approvals?.some((approval) => approval.status === 'APPROVED')
    if (!approved) return { allowed: false, statusCode: 409, reason: 'Task approval must be granted before execution.' }
    const requiredRole = requiredApprovalRoleForTask(task)
    if (role !== 'SYSTEM' && !canApprove(actor, requiredRole)) {
      return { allowed: false, statusCode: 403, reason: `${requiredRole} must run this approved Hotel Ops task.` }
    }
  } else if (!rule.allowedRoles.includes(role)) {
    return { allowed: false, statusCode: 403, reason: `${role} cannot run ${task.taskType}.` }
  }

  return { allowed: true, statusCode: 200, reason: 'Task is queued and ready for signed worker execution.' }
}

async function prepareOpsTaskRun(prisma, taskId, actor) {
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
    if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    const stop = await tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId: task.propertyId } })
    const decision = evaluateOpsTaskRun(task, actor, stop || { enabled: false })
    if (!decision.allowed) {
      return recordBlockedOpsTaskAction(
        tx,
        task,
        decision.blockedByEmergencyStop ? 'WORKER_START_BLOCKED' : 'TASK_RUN_REJECTED',
        decision.blockedByEmergencyStop ? 'OPS_TASK_RUN_BLOCKED' : 'OPS_TASK_RUN_REJECTED',
        decision.reason,
        actor,
        { decision, blockedByEmergencyStop: Boolean(decision.blockedByEmergencyStop) },
        decision.statusCode,
      )
    }

    const claimed = await tx.hotelOpsTask.updateMany({
      where: {
        id: task.id,
        status: task.status,
      },
      data: { status: 'RUNNING' },
    })
    if (claimed.count !== 1) {
      const current = await tx.hotelOpsTask.findUnique({ where: { id: task.id } })
      throw new PmsValidationError(`Only queued Hotel Ops tasks can run. Current status is ${current?.status || 'UNKNOWN'}.`, 409)
    }

    const running = await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })
    await taskLog(tx, task.id, 'WORKER_STARTED', 'Signed OTA worker execution started in dry-run mode.', actor, {
      dryRun: true,
      signed: true,
      workerConfigured: opsWorkerConfigured(),
    })
    await audit(tx, actor, 'OPS_TASK_STARTED', 'hotelOpsTask', task.id, { taskType: task.taskType, status: 'RUNNING', dryRun: true, signed: true })
    return running
  })
  if (result?.blocked) throw new PmsValidationError(result.reason, result.statusCode)
  return result
}

async function finalizeOpsTaskRun(prisma, task, actor, result) {
  const status = ['SUCCEEDED', 'FAILED', 'NEEDS_HUMAN'].includes(result.status) ? result.status : 'FAILED'
  const proofScreenshots = Array.isArray(result.proofScreenshots) ? result.proofScreenshots : workerFailureProof(task, status === 'NEEDS_HUMAN' ? 'trace' : 'error')
  return prisma.$transaction(async (tx) => {
    const current = await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })
    if (!current) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    if (current.status !== 'RUNNING') {
      await taskLog(tx, task.id, 'WORKER_RESULT_IGNORED', 'Worker result arrived after the task left RUNNING state.', actor, {
        currentStatus: current.status,
        workerStatus: status,
      })
      return current
    }

    const updated = await tx.hotelOpsTask.update({
      where: { id: task.id },
      data: {
        status,
        proofScreenshots,
        executionSummary: result.summary,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
      include: taskInclude,
    })
    await taskLog(tx, task.id, `WORKER_${status}`, result.summary, actor, {
      status,
      summary: result.summary,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      workerMode: result.workerMode,
      signed: result.signed,
      data: result.data,
      proofScreenshots,
    })
    if (proofScreenshots.length > 0) {
      await audit(tx, actor, 'OPS_PROOF_STORED', 'hotelOpsTask', task.id, {
        taskType: task.taskType,
        status,
        proofCount: proofScreenshots.length,
        proofKinds: proofScreenshots.map((proof) => proof.kind),
        redactionStatuses: proofScreenshots.map((proof) => proof.redactionStatus),
      })
    }
    await audit(tx, actor, `OPS_TASK_${status}`, 'hotelOpsTask', task.id, { taskType: task.taskType, status, dryRun: true, workerMode: result.workerMode, signed: result.signed })
    await recordOpsNotifications(tx, task.propertyId, {
      type: status === 'NEEDS_HUMAN' ? 'NEEDS_HUMAN' : 'TASK_UPDATE',
      taskId: task.id,
      recipientUserId: task.requesterUserId === 'system' ? null : task.requesterUserId,
      recipientRole: status === 'NEEDS_HUMAN' ? 'HOTEL_MANAGER' : null,
      title: status === 'NEEDS_HUMAN' ? 'Hotel Ops needs human action' : `Hotel Ops task ${status.toLowerCase().replace(/_/g, ' ')}`,
      summary: result.summary,
      actionPath: '/ops/tasks',
      metadata: {
        status,
        taskType: task.taskType,
        platform: task.platform,
        errorCode: result.errorCode,
        workerMode: result.workerMode,
        signed: result.signed,
      },
    }, actor)
    return updated
  })
}

export async function runQueuedOpsTask(prisma, taskId, actor) {
  const task = await prepareOpsTaskRun(prisma, taskId, actor)

  let result
  try {
    result = await executeOpsWorkerTask(task, { dryRun: true })
  } catch (error) {
    result = {
      status: 'FAILED',
      summary: error instanceof Error ? error.message : 'Signed OTA worker execution failed.',
      proofScreenshots: workerFailureProof(task, 'error'),
      errorCode: error?.statusCode ? `WORKER_HTTP_${error.statusCode}` : 'WORKER_EXECUTION_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      workerMode: 'worker-error',
      signed: true,
    }
  }

  return serializeTask(await finalizeOpsTaskRun(prisma, task, actor, result))
}

export async function submitOpsCommand(prisma, input, actor) {
  const property = await getProperty(prisma)
  const rawMessage = normalizeText(input?.message || input?.rawMessage)
  const persistedRawMessage = redactedSensitiveText(rawMessage)
  const sourceChannel = normalizeOpsSourceChannel(input?.sourceChannel || 'web')
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
        rawMessage: persistedRawMessage,
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
        message: parsed.message ? redactedSensitiveText(parsed.message) : parsed.message,
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

    await taskLog(tx, task.id, 'COMMAND_RECEIVED', 'Hotel Ops command received.', actor, { rawMessage: persistedRawMessage })
    await taskLog(tx, task.id, 'PARSER_OUTPUT', 'Command parsed into a controlled task.', actor, parsed)
    await taskLog(tx, task.id, 'PERMISSION_DECISION', decision.reason, actor, decision)
    await audit(tx, actor, 'OPS_COMMAND_RECEIVED', 'hotelOpsTask', task.id, { rawMessage: persistedRawMessage, parsed })
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
      await recordOpsNotifications(tx, property.id, {
        type: 'APPROVAL_REQUEST',
        taskId: task.id,
        recipientRole: decision.requiredApprovalRole || 'HOTEL_MANAGER',
        title: 'Hotel Ops approval required',
        summary: `${parsed.taskType.replace(/_/g, ' ')} for ${parsed.platform} requires approval before execution.`,
        actionPath: '/ops/approvals',
        metadata: {
          taskType: parsed.taskType,
          riskLevel: decision.riskLevel,
          platform: parsed.platform,
          requiredRole: decision.requiredApprovalRole || 'HOTEL_MANAGER',
        },
      }, actor)
      return { task: serializeTask(await tx.hotelOpsTask.findUnique({ where: { id: task.id }, include: taskInclude })), parsed, decision, duplicate: false }
    }

    if (status === 'QUEUED') {
      return { task: serializeTask(await queueOpsTask(tx, task, actor)), parsed, decision, duplicate: false }
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
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.hotelOpsTask.findUnique({ where: { id: taskId }, include: taskInclude })
    if (!task) throw new PmsValidationError('Hotel Ops task was not found.', 404)
    if (task.status !== 'PENDING_APPROVAL') {
      return recordBlockedOpsTaskAction(
        tx,
        task,
        'APPROVAL_REJECTED',
        'OPS_APPROVAL_REJECTED',
        'Only pending tasks can be approved.',
        actor,
        { attemptedStatus: task.status },
      )
    }
    const approval = task.approvals.find((item) => item.status === 'PENDING')
    if (!approval) {
      return recordBlockedOpsTaskAction(
        tx,
        task,
        'APPROVAL_REJECTED',
        'OPS_APPROVAL_REJECTED',
        'No pending approval exists for this task.',
        actor,
      )
    }
    if (!canApprove(actor, approval.requiredRole)) {
      return recordBlockedOpsTaskAction(
        tx,
        task,
        'APPROVAL_REJECTED',
        'OPS_APPROVAL_REJECTED',
        `${approval.requiredRole} approval is required.`,
        actor,
        { requiredRole: approval.requiredRole },
        403,
      )
    }
    const stop = await tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId: task.propertyId } })
    if (stop?.enabled && WRITE_TASK_TYPES.has(task.taskType)) {
      return recordBlockedOpsTaskAction(
        tx,
        task,
        'APPROVAL_BLOCKED',
        'OPS_APPROVAL_BLOCKED',
        'Emergency stop is enabled for Hotel Ops write tasks.',
        actor,
        { requiredRole: approval.requiredRole, blockedByEmergencyStop: true },
      )
    }

    await tx.hotelOpsTaskApproval.update({
      where: { id: approval.id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedBy: actorLabel(actor),
        notes: normalizeNullableString(input?.notes),
      },
    })
    await taskLog(tx, task.id, 'APPROVAL_GRANTED', 'Hotel Ops task approved.', actor, { notes: normalizeNullableString(input?.notes) })
    await audit(tx, actor, 'OPS_APPROVAL_GRANTED', 'hotelOpsTask', task.id, { requiredRole: approval.requiredRole })
    return serializeTask(await queueOpsTask(tx, task, actor, 'Approved task queued for signed worker execution.'))
  })
  if (result?.blocked) throw new PmsValidationError(result.reason, result.statusCode)
  return result
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
    await recordOpsNotifications(tx, task.propertyId, {
      type: 'TASK_UPDATE',
      taskId: task.id,
      recipientUserId: task.requesterUserId === 'system' ? null : task.requesterUserId,
      title: 'Hotel Ops task denied',
      summary: normalizeNullableString(input?.reason || input?.notes) || 'The Hotel Ops task was denied before execution.',
      actionPath: '/ops/tasks',
      metadata: { status: 'DENIED', taskType: task.taskType },
    }, actor)
    return serializeTask(await tx.hotelOpsTask.findUnique({ where: { id: updated.id }, include: taskInclude }))
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
    await recordOpsNotifications(tx, task.propertyId, {
      type: 'TASK_UPDATE',
      taskId: task.id,
      recipientUserId: task.requesterUserId === 'system' ? null : task.requesterUserId,
      title: 'Hotel Ops task cancelled',
      summary: normalizeNullableString(input?.reason) || 'The Hotel Ops task was cancelled before completion.',
      actionPath: '/ops/tasks',
      metadata: { status: 'CANCELLED', taskType: task.taskType },
    }, actor)
    return serializeTask(await tx.hotelOpsTask.findUnique({ where: { id: updated.id }, include: taskInclude }))
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

export async function listOpsNotifications(prisma, filters = {}) {
  const property = await getProperty(prisma)
  const where = { propertyId: property.id }
  if (filters.status) where.status = String(filters.status).toUpperCase()
  if (filters.channel) where.channel = String(filters.channel).toUpperCase()
  const notifications = await prisma.hotelOpsNotification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(filters.limit) || 50, 1), 200),
  })
  return notifications.map(serializeNotification)
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
  await recordOpsNotifications(prisma, property.id, {
    type: 'EMERGENCY_STOP',
    recipientRole: 'OWNER',
    title: enabled ? 'Hotel Ops emergency stop enabled' : 'Hotel Ops emergency stop disabled',
    summary: normalizeNullableString(input?.reason) || (enabled ? 'Write tasks are blocked until emergency stop is disabled.' : 'Write tasks can be reviewed and queued again.'),
    actionPath: '/ops/settings',
    metadata: { enabled },
  }, actor)
  return stop
}

export async function getOtaStatus(prisma) {
  await getProperty(prisma)
  const workerBaseUrlConfigured = Boolean(opsWorkerBaseUrl())
  const workerSecretConfigured = Boolean(opsWorkerSecret())
  const signedWorkerConfigured = opsWorkerConfigured()
  const bookingConfigured = bookingComCredentialsConfigured()
  return {
    dryRun: String(process.env.OTA_DRY_RUN || 'true').toLowerCase() !== 'false',
    workerConfigured: signedWorkerConfigured,
    workerBaseUrlConfigured,
    workerSecretConfigured,
    scanPolicy: getOpsScanPolicy(),
    platforms: [
      {
        platform: 'booking',
        configured: bookingConfigured,
        status: bookingConfigured ? 'adapter-dry-run-ready' : 'credentials-needed',
        message: bookingConfigured
          ? 'Booking.com adapter skeleton is available for signed dry-run tasks. Real browser writes remain disabled until selectors are verified.'
          : 'Booking.com adapter skeleton is installed, but server-side Booking.com credentials are not configured.',
      },
      ...['agoda', 'trip', 'expedia'].map((platform) => ({
        platform,
        configured: false,
        status: signedWorkerConfigured ? 'signed-mock-ready' : 'mock-dry-run',
        message: signedWorkerConfigured
          ? 'Signed worker boundary is configured; this platform still uses MockOtaBot until its adapter is implemented.'
          : 'MVP uses MockOtaBot/dry-run until OTA credentials and Playwright selectors are verified.',
      })),
    ],
  }
}

export function getOpsScanPolicy(env = process.env) {
  const cron = normalizeNullableString(env.HOTEL_OPS_SCAN_CRON || env.OPS_SCAN_CRON)
  const intervalMinutes = Number(env.HOTEL_OPS_SCAN_INTERVAL_MINUTES || env.OPS_SCAN_INTERVAL_MINUTES)
  const hasInterval = Number.isFinite(intervalMinutes) && intervalMinutes > 0
  const schedule = {
    configured: Boolean(cron || hasInterval),
    mode: cron ? 'cron' : hasInterval ? 'interval' : 'manual',
    cron: cron || null,
    intervalMinutes: hasInterval ? intervalMinutes : null,
    timezone: OPS_SCAN_POLICY.timezone,
    message: cron
      ? `Scheduled by cron expression ${cron}.`
      : hasInterval
        ? `Scheduled every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'}.`
        : 'No automatic scan schedule is configured; scans run manually or by an external job calling /api/ops/scan/run.',
  }

  return {
    schedule,
    thresholds: {
      horizonDays: OPS_SCAN_POLICY.horizonDays,
      highDemandOccupancy: OPS_SCAN_POLICY.highDemandOccupancy,
      highDemandVelocityRatio: OPS_SCAN_POLICY.highDemandVelocityRatio,
      lowDemandOccupancy: OPS_SCAN_POLICY.lowDemandOccupancy,
      bookingVelocityWindowHours: OPS_SCAN_POLICY.bookingVelocityWindowHours,
      bookingVelocityBaselineDays: OPS_SCAN_POLICY.bookingVelocityBaselineDays,
      cancellationRecentHours: OPS_SCAN_POLICY.cancellationRecentHours,
      cancellationBaselineDays: OPS_SCAN_POLICY.cancellationBaselineDays,
      cancellationSpikeMultiplier: OPS_SCAN_POLICY.cancellationSpikeMultiplier,
      weekendVelocityRatio: OPS_SCAN_POLICY.weekendVelocityRatio,
      otaImbalanceMinimumReservations: OPS_SCAN_POLICY.otaImbalanceMinimumReservations,
      otaImbalanceDominanceRatio: OPS_SCAN_POLICY.otaImbalanceDominanceRatio,
      highDemandRecommendedRate: OPS_SCAN_POLICY.highDemandRecommendedRate,
      lowDemandRecommendedRate: OPS_SCAN_POLICY.lowDemandRecommendedRate,
      currency: OPS_SCAN_POLICY.currency,
    },
  }
}

function recommendedRateTask(alertType, roomType, start, end) {
  const increase = alertType === 'HIGH_DEMAND' || alertType === 'WEEKEND_SPIKE'
  return taskWithRule('UPDATE_RATE', {
    platform: 'all',
    roomType,
    dateRange: { start, end },
    rate: { amount: increase ? OPS_SCAN_POLICY.highDemandRecommendedRate : OPS_SCAN_POLICY.lowDemandRecommendedRate, currency: OPS_SCAN_POLICY.currency },
    rationale: increase ? 'Demand signal suggests reviewing a controlled rate increase.' : 'Low-demand signal suggests reviewing a controlled promotional rate.',
    confidence: 0.7,
  })
}

function reservationOverlaps(reservation, start, end) {
  const checkIn = dateValue(reservation.checkIn)
  const checkOut = dateValue(reservation.checkOut)
  return checkIn <= end && checkOut >= start
}

function reservationRoomTypeName(reservation) {
  return reservation?.roomType?.name || reservation?.roomTypeName || null
}

function dominantRoomType(reservations) {
  const counts = new Map()
  for (const reservation of reservations) {
    const roomType = reservationRoomTypeName(reservation)
    if (roomType) counts.set(roomType, (counts.get(roomType) || 0) + 1)
  }
  if (counts.size !== 1) return 'All Rooms'
  return counts.keys().next().value || 'All Rooms'
}

function supportedOtaPlatform(value) {
  const platform = normalizePlatform(value)
  return platform && !['all', 'unknown'].includes(platform) ? platform : null
}

function reservationOtaPlatform(reservation) {
  const source = String(reservation?.source || '').trim().toUpperCase()
  if (RESERVATION_SOURCE_PLATFORM[source]) return RESERVATION_SOURCE_PLATFORM[source]

  const explicitPlatform = supportedOtaPlatform([
    reservation?.platform,
    reservation?.channelProvider,
    reservation?.channel?.provider,
    reservation?.channel?.name,
  ].filter(Boolean).join(' '))
  if (explicitPlatform) return explicitPlatform

  return supportedOtaPlatform([
    reservation?.source,
    reservation?.sourceName,
    reservation?.sender,
    reservation?.sourceEmailEvent?.sourceName,
    reservation?.sourceEmailEvent?.sender,
    reservation?.sourceEmailEvent?.sourceMailbox,
    reservation?.channelRef,
  ].filter(Boolean).join(' '))
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || String(platform || 'OTA')
}

function otaPlatformDistribution(reservations) {
  const counts = new Map()
  for (const reservation of reservations) {
    const platform = reservationOtaPlatform(reservation)
    if (!platform) continue
    counts.set(platform, (counts.get(platform) || 0) + 1)
  }
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)
  const platforms = Array.from(counts.entries())
    .map(([platform, count]) => ({
      platform,
      label: platformLabel(platform),
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
  return {
    total,
    platforms,
    counts: Object.fromEntries(platforms.map((item) => [item.platform, item.count])),
    shares: Object.fromEntries(platforms.map((item) => [item.platform, item.share])),
    dominant: platforms[0] || null,
  }
}

function velocityMetrics(reservations, now, baselineDays = OPS_SCAN_POLICY.bookingVelocityBaselineDays) {
  const recentStart = addMilliseconds(now, -OPS_SCAN_POLICY.bookingVelocityWindowHours * 60 * 60 * 1000)
  const baselineStart = addUtcDays(recentStart, -baselineDays)
  const recentBookings = reservations.filter((reservation) => dateValue(reservation.createdAt || now) >= recentStart).length
  const baselineBookings = reservations.filter((reservation) => {
    const createdAt = dateValue(reservation.createdAt || now)
    return createdAt >= baselineStart && createdAt < recentStart
  }).length
  const baselineDaily = baselineBookings / baselineDays
  const velocityRatio = recentBookings / Math.max(baselineDaily, 1)
  return {
    recentBookings,
    baselineBookings,
    baselineDaily,
    velocityRatio,
  }
}

function cancellationMetrics(cancellationLogs, now) {
  const recentStart = addMilliseconds(now, -OPS_SCAN_POLICY.cancellationRecentHours * 60 * 60 * 1000)
  const baselineStart = addUtcDays(recentStart, -OPS_SCAN_POLICY.cancellationBaselineDays)
  const cancellationsLast24h = cancellationLogs.filter((log) => dateValue(log.createdAt || now) >= recentStart).length
  const baselineCancellations = cancellationLogs.filter((log) => {
    const createdAt = dateValue(log.createdAt || now)
    return createdAt >= baselineStart && createdAt < recentStart
  }).length
  const rollingDailyAverage = baselineCancellations / OPS_SCAN_POLICY.cancellationBaselineDays
  const spikeThreshold = rollingDailyAverage * OPS_SCAN_POLICY.cancellationSpikeMultiplier
  const cancellationRatio = cancellationsLast24h / Math.max(rollingDailyAverage, 1)
  return {
    cancellationsLast24h,
    baselineCancellations,
    rollingDailyAverage,
    spikeThreshold,
    cancellationRatio,
  }
}

export function buildOpsScanInsights({
  reservations = [],
  cancellationLogs = [],
  sellableRooms = 0,
  now = new Date(),
  force,
} = {}) {
  const scanNow = dateValue(now)
  const today = bangkokTodayDate(scanNow)
  const weekEnd = addUtcDays(today, OPS_SCAN_POLICY.horizonDays)
  const start = isoDate(today)
  const end = isoDate(weekEnd)
  const activeReservations = reservations.filter((reservation) => (
    ['CONFIRMED', 'CHECKED_IN'].includes(String(reservation.status || '')) && reservationOverlaps(reservation, today, weekEnd)
  ))
  const occupancy = sellableRooms > 0 ? activeReservations.length / sellableRooms : 0
  const roomType = dominantRoomType(activeReservations)
  const velocity = velocityMetrics(activeReservations, scanNow)
  const cancellation = cancellationMetrics(cancellationLogs, scanNow)
  const weekend = nextDayOfWeek(6, scanNow)
  const weekendEnd = addUtcDays(weekend, 1)
  const weekendKey = isoDate(weekend)
  const weekendReservations = activeReservations.filter((reservation) => reservationOverlaps(reservation, weekend, weekendEnd))
  const weekendVelocity = velocityMetrics(weekendReservations, scanNow)
  const otaDistribution = otaPlatformDistribution(activeReservations)
  const dominantOta = otaDistribution.dominant
  const insights = []
  const forceValue = String(force || '')

  if ((sellableRooms > 0 && occupancy >= OPS_SCAN_POLICY.highDemandOccupancy && velocity.velocityRatio >= OPS_SCAN_POLICY.highDemandVelocityRatio) || forceValue === 'high-demand') {
    insights.push({
      alertType: 'HIGH_DEMAND',
      severity: 'HIGH',
      title: 'High demand window',
      summary: `Upcoming occupancy is ${(occupancy * 100).toFixed(0)}% and booking velocity is ${velocity.velocityRatio.toFixed(1)}x baseline. Review rates before rooms sell out.`,
      platform: 'all',
      roomType,
      dateStart: dateOrNull(start),
      dateEnd: dateOrNull(end),
      metrics: { occupancy, activeReservations: activeReservations.length, sellableRooms, horizonDays: OPS_SCAN_POLICY.horizonDays, ...velocity },
      recommendedAction: recommendedRateTask('HIGH_DEMAND', roomType, start, end),
    })
  }

  if ((sellableRooms > 0 && occupancy < OPS_SCAN_POLICY.lowDemandOccupancy) || forceValue === 'low-demand') {
    insights.push({
      alertType: 'LOW_DEMAND',
      severity: 'MEDIUM',
      title: 'Low demand next 7 days',
      summary: `Upcoming occupancy is ${(occupancy * 100).toFixed(0)}%. Consider a controlled promotion or direct-booking push.`,
      platform: 'all',
      roomType,
      dateStart: dateOrNull(start),
      dateEnd: dateOrNull(end),
      metrics: { occupancy, activeReservations: activeReservations.length, sellableRooms, horizonDays: OPS_SCAN_POLICY.horizonDays, ...velocity },
      recommendedAction: recommendedRateTask('LOW_DEMAND', roomType, start, end),
    })
  }

  if ((cancellation.cancellationsLast24h > 0 && cancellation.cancellationsLast24h > cancellation.spikeThreshold) || forceValue === 'cancellation-spike') {
    insights.push({
      alertType: 'CANCELLATION_SPIKE',
      severity: cancellation.cancellationsLast24h >= 3 ? 'HIGH' : 'MEDIUM',
      title: 'Cancellation spike detected',
      summary: `${cancellation.cancellationsLast24h} cancellation${cancellation.cancellationsLast24h === 1 ? '' : 's'} in the last 24 hours versus ${cancellation.rollingDailyAverage.toFixed(1)} daily baseline. Review resale and refund follow-up.`,
      platform: 'all',
      roomType: 'All Rooms',
      dateStart: dateOrNull(start),
      dateEnd: dateOrNull(end),
      metrics: cancellation,
      recommendedAction: null,
    })
  }

  if (weekendVelocity.velocityRatio >= OPS_SCAN_POLICY.weekendVelocityRatio || forceValue === 'weekend-spike') {
    insights.push({
      alertType: 'WEEKEND_SPIKE',
      severity: 'MEDIUM',
      title: 'Weekend booking acceleration',
      summary: `Weekend booking velocity is ${weekendVelocity.velocityRatio.toFixed(1)}x baseline. Review weekend rate controls before the window fills.`,
      platform: 'all',
      roomType: dominantRoomType(weekendReservations),
      dateStart: dateOrNull(weekendKey),
      dateEnd: dateOrNull(weekendKey),
      metrics: {
        occupancy,
        activeReservations: activeReservations.length,
        weekendReservations: weekendReservations.length,
        sellableRooms,
        ...weekendVelocity,
      },
      recommendedAction: recommendedRateTask('WEEKEND_SPIKE', dominantRoomType(weekendReservations), weekendKey, weekendKey),
    })
  }

  if (
    (
      dominantOta
      && otaDistribution.total >= OPS_SCAN_POLICY.otaImbalanceMinimumReservations
      && dominantOta.share >= OPS_SCAN_POLICY.otaImbalanceDominanceRatio
    )
    || forceValue === 'ota-imbalance'
  ) {
    const platform = dominantOta?.platform || 'unknown'
    const share = dominantOta?.share || 0
    const reservationCount = dominantOta?.count || 0
    insights.push({
      alertType: 'OTA_IMBALANCE',
      severity: share >= 0.8 ? 'HIGH' : 'MEDIUM',
      title: 'OTA channel imbalance',
      summary: dominantOta
        ? `${dominantOta.label} accounts for ${(share * 100).toFixed(0)}% of OTA reservations in the next ${OPS_SCAN_POLICY.horizonDays} days. Review channel mix and direct-booking exposure.`
        : 'OTA channel mix needs review. Check booking sources before changing rates or availability.',
      platform,
      roomType,
      dateStart: dateOrNull(start),
      dateEnd: dateOrNull(end),
      metrics: {
        totalOtaReservations: otaDistribution.total,
        dominantPlatform: platform,
        dominantPlatformLabel: dominantOta?.label || platformLabel(platform),
        dominantReservations: reservationCount,
        dominantShare: share,
        platformCounts: otaDistribution.counts,
        platformShares: otaDistribution.shares,
        minimumReservations: OPS_SCAN_POLICY.otaImbalanceMinimumReservations,
        dominanceThreshold: OPS_SCAN_POLICY.otaImbalanceDominanceRatio,
        horizonDays: OPS_SCAN_POLICY.horizonDays,
      },
      recommendedAction: null,
    })
  }

  return insights
}

function trendAlertIdentity(insight = {}) {
  return {
    alertType: insight.alertType,
    platform: normalizeNullableString(insight.platform),
    roomType: normalizeNullableString(insight.roomType),
    dateStart: alertDateOrNull(insight.dateStart),
    dateEnd: alertDateOrNull(insight.dateEnd),
  }
}

async function upsertActiveOpsTrendAlert(prisma, propertyId, insight) {
  const identity = trendAlertIdentity(insight)
  const existing = await prisma.hotelOpsTrendAlert.findFirst({
    where: {
      propertyId,
      ...identity,
      status: { in: ACTIVE_TREND_ALERT_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    const updated = await prisma.hotelOpsTrendAlert.update({
      where: { id: existing.id },
      data: {
        severity: insight.severity,
        title: insight.title,
        summary: insight.summary,
        metrics: insight.metrics,
        recommendedAction: insight.recommendedAction ?? null,
      },
    })
    return { alert: updated, created: false }
  }

  const created = await prisma.hotelOpsTrendAlert.create({
    data: {
      propertyId,
      ...insight,
    },
  })
  return { alert: created, created: true }
}

export async function runOpsScan(prisma, input = {}, actor = { id: 'system', role: 'SYSTEM' }) {
  const property = await getProperty(prisma)
  const now = input?.now ? dateValue(input.now) : new Date()
  const today = bangkokTodayDate(now)
  const weekEnd = addUtcDays(today, OPS_SCAN_POLICY.horizonDays)
  const cancellationWindowStart = addUtcDays(
    addMilliseconds(now, -OPS_SCAN_POLICY.cancellationRecentHours * 60 * 60 * 1000),
    -OPS_SCAN_POLICY.cancellationBaselineDays,
  )
  const [reservations, rooms, cancellationLogs] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        propertyId: property.id,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: weekEnd },
        checkOut: { gte: today },
      },
      include: { roomType: true, sourceEmailEvent: true },
    }),
    prisma.room.count({ where: { propertyId: property.id, operationalStatus: 'AVAILABLE' } }),
    prisma.reservationLog.findMany({
      where: {
        action: { in: ['CANCELLED', 'NO_SHOW'] },
        createdAt: { gte: cancellationWindowStart },
        reservation: { is: { propertyId: property.id } },
      },
      include: { reservation: { include: { roomType: true } } },
    }),
  ])

  const insights = buildOpsScanInsights({
    reservations,
    cancellationLogs,
    sellableRooms: rooms,
    now,
    force: input?.force,
  })
  const alerts = []
  const createdAlerts = []
  let createdCount = 0
  let updatedCount = 0
  for (const insight of insights) {
    const result = await upsertActiveOpsTrendAlert(prisma, property.id, insight)
    alerts.push(result.alert)
    if (result.created) {
      createdCount += 1
      createdAlerts.push(result.alert)
    } else {
      updatedCount += 1
    }
  }

  await audit(prisma, actor, 'OPS_SCAN_RUN', 'hotelOpsTrendAlert', alerts[0]?.id || null, {
    created: createdCount,
    updated: updatedCount,
    activeAlerts: alerts.length,
    activeReservations: reservations.length,
    sellableRooms: rooms,
    cancellationLogs: cancellationLogs.length,
  })
  for (const alert of createdAlerts) {
    await recordOpsNotifications(prisma, property.id, {
      type: 'TREND_ALERT',
      trendAlertId: alert.id,
      recipientRole: 'HOTEL_MANAGER',
      title: alert.title,
      summary: alert.summary,
      actionPath: '/ops/intelligence',
      metadata: {
        alertType: alert.alertType,
        severity: alert.severity,
        recommendation: Boolean(alert.recommendedAction),
      },
    }, actor)
  }
  return alerts.map(serializeAlert)
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

async function updateOpsAlertStatus(prisma, alertId, status, input, actor) {
  const property = await getProperty(prisma)
  const alert = await prisma.hotelOpsTrendAlert.findUnique({ where: { id: alertId } })
  if (!alert || alert.propertyId !== property.id) throw new PmsValidationError('Hotel Ops alert was not found.', 404)
  if (alert.status === 'RESOLVED' && status !== 'RESOLVED') {
    throw new PmsValidationError('Resolved Hotel Ops alerts cannot be reopened from this action.', 409)
  }
  if (alert.status === status) return serializeAlert(alert)

  const updated = await prisma.hotelOpsTrendAlert.update({
    where: { id: alert.id },
    data: { status },
  })
  await audit(prisma, actor, `OPS_ALERT_${status}`, 'hotelOpsTrendAlert', alert.id, {
    alertType: alert.alertType,
    previousStatus: alert.status,
    status,
    reason: normalizeNullableString(input?.reason || input?.notes),
  })
  return serializeAlert(updated)
}

export async function acknowledgeOpsTrendAlert(prisma, alertId, input, actor) {
  return updateOpsAlertStatus(prisma, alertId, 'ACKNOWLEDGED', input, actor)
}

export async function resolveOpsTrendAlert(prisma, alertId, input, actor) {
  return updateOpsAlertStatus(prisma, alertId, 'RESOLVED', input, actor)
}

export async function approveOpsAlertRecommendation(prisma, alertId, input, actor) {
  const property = await getProperty(prisma)
  const alert = await prisma.hotelOpsTrendAlert.findUnique({ where: { id: alertId } })
  if (!alert || alert.propertyId !== property.id) throw new PmsValidationError('Hotel Ops alert was not found.', 404)
  if (alert.status === 'RESOLVED') throw new PmsValidationError('Resolved Hotel Ops alerts cannot queue recommendations.', 409)
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
  await audit(prisma, actor, 'OPS_ALERT_RECOMMENDATION_APPROVED', 'hotelOpsTrendAlert', alert.id, {
    alertType: alert.alertType,
    previousStatus: alert.status,
    taskId: result.task?.id,
  })
  return result
}
