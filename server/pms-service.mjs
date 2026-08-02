import { createHash } from 'node:crypto'
import {
  SANDBOX_RULES,
  activeReservationStatuses,
  calculateStayPricing,
  checkedInRoomStatus,
  dateFromKey,
  getBangkokDateKey,
  normalizePaymentMethod,
  paymentMethodRequiresReference,
  roundMoney,
  roomStatusForHousekeeping,
  stayDates,
  validateStayInput,
  PmsValidationError,
} from './pms-domain.mjs'
import { canPerformAction } from './rbac.mjs'
import { createPasswordHash } from './security.mjs'
import { recordDomainEvent } from './domain-events.mjs'
import { chargeIntentFingerprint } from './charge-idempotency.mjs'
import {
  assertPmsCreateReplay,
  claimPmsCreateAttempt,
  completePmsCreateAttempt,
  requireCreateIdempotencyKey,
} from './create-mutation-idempotency.mjs'
import {
  bahtToSatang,
  dualWriteMoney,
  parseSatang,
  readMoneySatang,
  resolveMoneyInput,
  satangToApiString,
  sumMoneySatang,
} from './money.mjs'

const reservationInclude = {
  guest: true,
  roomType: true,
  assignedRoom: true,
  sourceEmailEvent: true,
  folio: {
    include: {
      charges: {
        include: {
          sourceEmailEvent: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      payments: {
        include: {
          sourceEmailEvent: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  },
  bookingEmailEvents: {
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: 10,
  },
}

const MAX_SAFE_MONEY_SATANG = BigInt(Number.MAX_SAFE_INTEGER)
const POSTGRES_INTEGER_MAX = 2_147_483_647

async function serializableTransaction(prisma, callback) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 10_000,
      })
    } catch (error) {
      if (error?.code === 'P2034' && attempt === 0) continue
      throw error
    }
  }
}

async function reservationMutationTransaction(prisma, callback) {
  try {
    return await serializableTransaction(prisma, callback)
  } catch (error) {
    if (error?.code === 'P2034') {
      throw new PmsValidationError('Room inventory changed before this reservation update could complete. Refresh and try again.', 409)
    }
    if (error?.code === 'P2002') {
      const target = Array.isArray(error?.meta?.target)
        ? error.meta.target.join(',')
        : String(error?.meta?.target || '')
      if (/RoomDateInventory|roomId.*date|date.*roomId/i.test(target)) {
        throw new PmsValidationError('Room inventory changed before this reservation update could complete. Refresh and try again.', 409)
      }
      throw new PmsValidationError('The reservation update conflicts with existing data. Refresh and review the request before trying again.', 409)
    }
    throw error
  }
}

function actorName(actor) {
  return actor?.name || actor?.email || actor?.username || actor?.id || 'System'
}

function normalizeNullableString(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizeReservationMutationIdempotencyKey(value) {
  const key = normalizeNullableString(value)
  if (!key) return null
  if (key.length > 200) throw new PmsValidationError('Reservation mutation idempotency key must be 200 characters or fewer.')
  return key
}

function requireReservationLifecycleIdempotencyKey(value) {
  const key = normalizeReservationMutationIdempotencyKey(value)
  if (!key) throw new PmsValidationError('Reservation lifecycle idempotency key is required.')
  return key
}

function stableMutationValue(value) {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stableMutationValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableMutationValue(value[key])]))
  }
  return value
}

function reservationMutationFingerprint(operation, reservationId, intent) {
  return createHash('sha256')
    .update(JSON.stringify(stableMutationValue({ operation, reservationId, intent })))
    .digest('hex')
}

function reservationMutationResultFingerprint(result) {
  return createHash('sha256')
    .update(JSON.stringify(stableMutationValue(result)))
    .digest('hex')
}

async function acquireReservationMutationLocks(tx, lockKeys) {
  if (typeof tx?.$queryRawUnsafe !== 'function') return
  const uniqueKeys = [...new Set(lockKeys.filter(Boolean).map(String))].sort()
  for (const lockKey of uniqueKeys) {
    // The statement is constant and the lock identity is parameterized. Locks end with this transaction.
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked', lockKey)
  }
}

function reservationRoomDateLockKeys(propertyId, reservationId, roomId, checkIn, checkOut) {
  const keys = [`reservation-mutation:reservation:${propertyId}:${reservationId}`]
  if (!roomId) return keys
  for (const dateKey of stayDates(checkIn, checkOut)) {
    keys.push(`reservation-mutation:room-date:${propertyId}:${roomId}:${dateKey}`)
  }
  return keys
}

async function claimReservationMutationAttempt(tx, {
  propertyId,
  reservationId,
  operation,
  idempotencyKey,
  intent,
}) {
  if (!idempotencyKey) return { replay: false, attempt: null }
  const intentFingerprint = reservationMutationFingerprint(operation, reservationId, intent)
  await acquireReservationMutationLocks(tx, [`reservation-mutation:idempotency:${propertyId}:${idempotencyKey}`])
  const existing = await tx.reservationMutationAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId, idempotencyKey } },
  })
  if (existing) {
    if (existing.reservationId !== reservationId || existing.operation !== operation || existing.intentFingerprint !== intentFingerprint) {
      throw new PmsValidationError('This reservation mutation idempotency key was already used for a different command.', 409)
    }
    return { replay: true, attempt: existing }
  }
  const attempt = await tx.reservationMutationAttempt.create({
    data: { propertyId, reservationId, operation, idempotencyKey, intentFingerprint },
  })
  return { replay: false, attempt }
}

function replayReservationMutation(attempt, current) {
  if (!attempt?.resultFingerprint) {
    throw new PmsValidationError('The original reservation mutation outcome is unavailable. Refresh before trying another command.', 409)
  }
  if (attempt.resultFingerprint !== reservationMutationResultFingerprint(current)) {
    throw new PmsValidationError('The original reservation mutation outcome has been superseded by a later change. Refresh to view the current reservation.', 409)
  }
  return current
}

async function completeReservationMutationAttempt(tx, attempt, result) {
  if (!attempt) return
  await tx.reservationMutationAttempt.update({
    where: { id: attempt.id },
    data: { resultFingerprint: reservationMutationResultFingerprint(result) },
  })
}

function normalizePaymentReferenceFingerprint(method, reference) {
  const normalizedReference = normalizeNullableString(reference)
  if (!normalizedReference) return null
  return `${normalizePaymentMethod(method)}:${normalizedReference.toUpperCase().replace(/\s+/g, '')}`
}

function normalizePaymentIdempotencyKey(value) {
  const key = normalizeNullableString(value)
  if (!key) throw new PmsValidationError('Payment idempotency key is required.')
  if (key.length > 200) throw new PmsValidationError('Payment idempotency key must be 200 characters or fewer.')
  return key
}

function normalizeChargeIdempotencyKey(value) {
  const key = normalizeNullableString(value)
  if (!key) throw new PmsValidationError('Charge idempotency key is required.')
  if (key.length > 200) throw new PmsValidationError('Charge idempotency key must be 200 characters or fewer.')
  return key
}

const RESERVATION_UPDATE_FIELDS = new Set([
  'roomTypeCode',
  'roomType',
  'checkIn',
  'checkOut',
  'ratePerNight',
  'adults',
  'children',
  'childAges',
  'source',
  'channelRef',
  'sourceEmailEventId',
  'notes',
  'specialRequests',
  'expectedUpdatedAt',
])

const CREDENTIAL_FIELD_PATTERN = /(authorization|credential|password|secret|token|api[_-]?key|private[_-]?key|session|cookie)/i

function validateReservationUpdateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PmsValidationError('Reservation update must be an object.')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => !RESERVATION_UPDATE_FIELDS.has(key) || CREDENTIAL_FIELD_PATTERN.test(key))) {
    throw new PmsValidationError('Reservation update contains unsupported fields.')
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

function normalizeExpectedReservationUpdatedAt(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new PmsValidationError('expectedUpdatedAt must be an ISO-8601 timestamp.')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new PmsValidationError('expectedUpdatedAt must be an ISO-8601 timestamp.')
  }
  return parsed
}

function normalizeExpectedGuestUpdatedAt(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new PmsValidationError('expectedGuestUpdatedAt must be an ISO-8601 timestamp.')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new PmsValidationError('expectedGuestUpdatedAt must be an ISO-8601 timestamp.')
  }
  return parsed
}

function requiredMoneyInput(input, legacyField = 'amount', satangField = `${legacyField}Satang`) {
  try {
    return resolveMoneyInput(input, legacyField, satangField)
  } catch (error) {
    throw new PmsValidationError(error instanceof Error ? error.message : 'Enter a valid money amount.')
  }
}

function moneyDataFromBaht(legacyField, satangField, value) {
  return dualWriteMoney(legacyField, satangField, bahtToSatang(value, legacyField))
}

function pricingRulesFor(property, roomType) {
  return {
    standardOccupancy: roomType?.standardOcc ?? SANDBOX_RULES.standardOccupancy,
    maxOccupancy: roomType?.maxOccupancy ?? SANDBOX_RULES.maxOccupancy,
    extraGuestFeePerNight: property?.extraGuestFee ?? SANDBOX_RULES.extraGuestFeePerNight,
    childSharingFeePerNight: property?.childFee ?? SANDBOX_RULES.childSharingFeePerNight,
  }
}

function canUseOverride(actor, permission) {
  return canPerformAction(actor, permission)
}

function requireOverride(actor, permission, reason, label) {
  if (!canUseOverride(actor, permission)) {
    throw new PmsValidationError(`${label} requires manager or admin permission.`, 403)
  }
  if (!normalizeNullableString(reason)) {
    throw new PmsValidationError(`${label} requires a reason.`)
  }
}

function isReadyRoomStatus(status) {
  return status === 'VACANT_CLEAN' || status === 'INSPECTED'
}

function isOccupiedRoomStatus(status) {
  return status === 'OCCUPIED' || status === 'OCCUPIED_CLEAN' || status === 'OCCUPIED_DIRTY'
}

function hasGuestIdentity(guest) {
  return Boolean(normalizeNullableString(guest?.nationality) && normalizeNullableString(guest?.idNumber))
}

function validateReservationDateForCheckIn(reservation, options) {
  const todayKey = getBangkokDateKey(new Date())
  const checkInKey = getBangkokDateKey(reservation.checkIn)
  const checkOutKey = getBangkokDateKey(reservation.checkOut)
  if (todayKey >= checkInKey && todayKey < checkOutKey) return
  if (options.allowDateOverride) {
    requireOverride(options.actor, 'override:check-in', options.overrideReason, 'Date override')
    return
  }
  throw new PmsValidationError('This reservation is not within the allowed check-in date range.')
}

function nextDateKey(key) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

const FRONT_DESK_BOARD_MAX_RANGE_DAYS = 93

function validCalendarDateKey(value, label) {
  const key = normalizeNullableString(value)
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new PmsValidationError(`${label} must use YYYY-MM-DD format.`)
  }
  const date = dateFromKey(key)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError(`${label} must be a valid calendar date.`)
  }
  return { key, date }
}

export function resolveFrontDeskBoardRange(input = {}) {
  const fromInput = normalizeNullableString(input?.from)
  const toInput = normalizeNullableString(input?.to)
  if (!fromInput && !toInput) return null
  if (!fromInput || !toInput) {
    throw new PmsValidationError('Board range requires both from and to dates.')
  }

  const from = validCalendarDateKey(fromInput, 'Board from date')
  const to = validCalendarDateKey(toInput, 'Board to date')
  const durationDays = Math.round((to.date.getTime() - from.date.getTime()) / 86_400_000)
  if (durationDays <= 0) {
    throw new PmsValidationError('Board to date must be after from date.')
  }
  if (durationDays > FRONT_DESK_BOARD_MAX_RANGE_DAYS) {
    throw new PmsValidationError(`Board date range cannot exceed ${FRONT_DESK_BOARD_MAX_RANGE_DAYS} days.`)
  }

  return {
    from: from.key,
    to: to.key,
    fromDate: from.date,
    toDate: to.date,
    durationDays,
  }
}

function isOperationallySellableRoom(room) {
  return Boolean(
    String(room?.number || '').trim() &&
    !['BLOCKED', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(room.operationalStatus),
  )
}

async function getProperty(tx, actor = undefined) {
  const propertyId = normalizeNullableString(actor?.propertyId)
  const property = propertyId
    ? await tx.property.findUnique({ where: { id: propertyId } })
    : await tx.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } })
  if (!property) {
    throw new PmsValidationError('Property setup has not been completed yet.', 503)
  }
  return property
}

function setupString(value, label, required = true) {
  const normalized = String(value || '').trim()
  if (required && !normalized) throw new PmsValidationError(`${label} is required.`)
  return normalized || null
}

const VALID_USER_ROLES = ['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF']

function normalizeUserEmail(value) {
  const email = normalizeNullableString(value)?.toLowerCase() || null
  if (!email) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PmsValidationError('Email must be a valid email address.')
  }
  return email
}

function normalizeUserUsername(value, fallbackEmail = null) {
  const username = normalizeNullableString(value || fallbackEmail)?.toLowerCase() || null
  if (!username) {
    throw new PmsValidationError('Login username is required when no email address is supplied.')
  }
  if (username.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      throw new PmsValidationError('Login username must be a valid email address or staff username.')
    }
    return username
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(username)) {
    throw new PmsValidationError('Login username must be 2-63 characters using letters, numbers, dot, dash, or underscore.')
  }
  return username
}

function normalizeUserRole(value) {
  const role = String(value || 'FRONT_DESK').trim().toUpperCase().replace(/-/g, '_')
  if (!VALID_USER_ROLES.includes(role)) {
    throw new PmsValidationError(`Role must be one of: ${VALID_USER_ROLES.join(', ')}.`)
  }
  return role
}

function normalizeUserNameParts(input) {
  const displayName = normalizeNullableString(input?.displayName || input?.name)
  const firstName = normalizeNullableString(input?.firstName)
  const lastName = normalizeNullableString(input?.lastName)
  if (firstName && lastName) return { firstName, lastName }
  if (displayName) {
    const parts = displayName.split(/\s+/)
    return {
      firstName: firstName || parts.shift() || 'Staff',
      lastName: lastName || parts.join(' ') || 'User',
    }
  }
  return {
    firstName: firstName || 'Staff',
    lastName: lastName || 'User',
  }
}

function validateUserPassword(password, required = true) {
  const value = String(password || '')
  if (!value && !required) return null
  if (value.length < 12) {
    throw new PmsValidationError('User password must be at least 12 characters.')
  }
  return value
}

function setupNumber(value, label, options = {}) {
  const number = Number(value)
  const min = options.min ?? 0
  if (!Number.isFinite(number) || number < min) {
    throw new PmsValidationError(`${label} must be ${min > 0 ? `at least ${min}` : 'a valid number'}.`)
  }
  return number
}

export const ROOM_TYPE_CANONICAL_BASE_RATES = Object.freeze({
  TWIN: 750,
  DOUBLE: 850,
})

function detectRoomCodeFromInput(input) {
  const normalizedId = String(input?.id || input?.code || '').toUpperCase()
  const normalizedName = String(input?.name || '').toUpperCase()
  if (normalizedId.includes('DOUBLE') || normalizedName.includes('DOUBLE')) return 'DOUBLE'
  if (normalizedId.includes('TWIN') || normalizedName.includes('TWIN')) return 'TWIN'
  return null
}

function canonicalizeRoomTypeBaseRate(roomType, baseRate) {
  const roomCode = detectRoomCodeFromInput(roomType)
  const canonicalRate = roomCode ? ROOM_TYPE_CANONICAL_BASE_RATES[roomCode] : null
  if (!canonicalRate || !Number.isFinite(baseRate)) {
    return {
      baseRate,
      roomCode: roomCode || null,
      changed: false,
      canonicalRate,
    }
  }

  if (baseRate === canonicalRate) {
    return {
      baseRate,
      roomCode,
      changed: false,
      canonicalRate,
    }
  }

  if (baseRate === 2000) {
    return {
      baseRate: canonicalRate,
      roomCode,
      changed: true,
      canonicalRate,
    }
  }

  return {
    baseRate,
    roomCode,
    changed: false,
    canonicalRate,
  }
}

function setupRoomTypeCode(roomType, index, usedCodes) {
  const normalizedId = String(roomType?.id || '').toUpperCase()
  const normalizedName = String(roomType?.name || '').toUpperCase()
  let code = normalizedId === 'DOUBLE' || normalizedId === 'DOUBLE_ROOM' || normalizedName.includes('DOUBLE')
    ? 'DOUBLE'
    : normalizedId === 'TWIN' || normalizedId === 'TWIN_ROOM' || normalizedName.includes('TWIN')
      ? 'TWIN'
      : normalizedName.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16)

  if (!code) code = `TYPE_${index + 1}`

  let uniqueCode = code
  let suffix = 2
  while (usedCodes.has(uniqueCode)) {
    uniqueCode = `${code}_${suffix}`
    suffix += 1
  }
  usedCodes.add(uniqueCode)
  return uniqueCode
}

function setupFloorForRoomNumber(roomNumber) {
  const firstDigit = String(roomNumber).match(/\d/)?.[0]
  return firstDigit ? Number(firstDigit) : 1
}

function validateSetupPayload(input) {
  const property = input?.property || {}
  const roomTypes = Array.isArray(input?.roomTypes) ? input.roomTypes : []
  const rooms = Array.isArray(input?.rooms) ? input.rooms : []
  const rates = Array.isArray(input?.rates) ? input.rates : []
  const adminUser = input?.adminUser || {}

  if (roomTypes.length === 0) throw new PmsValidationError('Add at least one room type.')
  if (rooms.length === 0) throw new PmsValidationError('Add at least one room.')
  if (new Set(rooms.map((room) => setupString(room.number, 'Room number'))).size !== rooms.length) {
    throw new PmsValidationError('Room numbers must be unique.')
  }

  const rateByRoomType = new Map(rates.map((rate) => [rate.roomTypeId, rate]))
  const roomTypeIds = new Set(roomTypes.map((roomType) => setupString(roomType.id, 'Room type id')))

  for (const roomType of roomTypes) {
    if (!roomTypeIds.has(roomType.id)) throw new PmsValidationError('Room type ids must be valid.')
    setupString(roomType.name, 'Room type name')
    setupNumber(roomType.baseOccupancy, 'Base occupancy', { min: 1 })
    setupNumber(roomType.maxOccupancy, 'Max occupancy', { min: setupNumber(roomType.baseOccupancy, 'Base occupancy', { min: 1 }) })
    const rate = rateByRoomType.get(roomType.id)
    const baseRate = setupNumber(rate?.baseRate, `Base rate for ${roomType.name}`, { min: 1 })
    const canonicalBaseRate = canonicalizeRoomTypeBaseRate(roomType, baseRate)

    if (canonicalBaseRate.canonicalRate && canonicalBaseRate.baseRate !== baseRate) {
      if (!canonicalBaseRate.changed) {
        throw new PmsValidationError(`Base rate for ${roomType.name} must be ${canonicalBaseRate.canonicalRate} THB.`)
      }
      rateByRoomType.set(roomType.id, { ...rate, baseRate: canonicalBaseRate.baseRate })
    }
  }

  for (const room of rooms) {
    if (!roomTypeIds.has(room.roomTypeId)) throw new PmsValidationError(`Room ${room.number} has an invalid room type.`)
    if (!['available', 'out-of-service'].includes(room.status)) {
      throw new PmsValidationError(`Room ${room.number} has an invalid operational status.`)
    }
  }

  const adminName = setupString(adminUser.name, 'Admin name')
  const adminEmail = setupString(adminUser.email, 'Admin email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new PmsValidationError('Admin email must be valid.')
  }
  if (String(adminUser.password || '').length < 12) {
    throw new PmsValidationError('Admin password must be at least 12 characters.')
  }

  return {
    property: {
      code: SANDBOX_RULES.propertyCode,
      name: setupString(property.name, 'Property name'),
      address: [property.address, property.city, property.country].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || null,
      phone: setupString(property.phone, 'Property phone'),
      email: setupString(property.email, 'Property email').toLowerCase(),
      timezone: setupString(property.timeZone, 'Time zone'),
      defaultCheckIn: setupString(property.defaultCheckIn, 'Default check-in time'),
      defaultCheckOut: setupString(property.defaultCheckOut, 'Default check-out time'),
      currency: setupString(property.currency, 'Currency').toUpperCase(),
      taxRate: 0,
      taxRateBasisPoints: 0,
      ...moneyDataFromBaht('extraGuestFee', 'extraGuestFeeSatang', setupNumber(roomTypes[0]?.extraGuestFee ?? 0, 'Extra guest fee')),
      ...moneyDataFromBaht('childFee', 'childFeeSatang', setupNumber(roomTypes[0]?.childFee ?? 0, 'Child fee')),
    },
    roomTypes,
    rooms,
    rates: rateByRoomType,
    adminUser: {
      name: adminName,
      email: adminEmail,
      password: String(adminUser.password),
    },
  }
}

async function getUserBySession(tx, session) {
  if (!session?.sub) return null
  return tx.user.findFirst({
    where: {
      id: session.sub,
      active: true,
    },
  })
}

async function createAudit(tx, actor, action, entityType, entityId, changes = undefined) {
  const property = await getProperty(tx, actor)
  return tx.auditLog.create({
    data: {
      propertyId: property.id,
      userId: actor?.id || 'system',
      action,
      entityType,
      entityId,
      changes,
    },
  })
}

async function createReservationLog(tx, reservationId, action, actor, data = {}) {
  return tx.reservationLog.create({
    data: {
      reservationId,
      action,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      changes: data.changes,
      notes: data.notes,
      performedBy: actorName(actor),
    },
  })
}

async function createRoomStatusLog(tx, room, toStatus, actor, notes) {
  return tx.roomStatusLog.create({
    data: {
      roomId: room.id,
      fromStatus: room.currentStatus,
      toStatus,
      changedBy: actorName(actor),
      notes,
    },
  })
}

const DEFAULT_BOOKING_EMAIL_MAILBOX = 'booking@sandboxhotel.com'
const BOOKING_EMAIL_DEFAULT_REVIEW_THRESHOLD = 0.85
const BOOKING_EMAIL_AUTONOMY_VERSION = 'booking-email-autonomy-v1'
const BOOKING_EMAIL_MIN_AUTONOMOUS_CONFIDENCE = 0.95
const BOOKING_EMAIL_GMAIL_MISSING_CREDENTIALS_MESSAGE = 'Gmail API OAuth credentials are not configured for this server.'
const LOGIN_FAILURE_LOCK_LIMIT = 3
const VALID_BOOKING_EMAIL_STATUSES = ['NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED']
const VALID_BOOKING_EMAIL_EVENT_TYPES = ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE', 'GUEST_MESSAGE', 'UNKNOWN']
const GMAIL_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_DEFAULT_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
const CLIENT_PROVIDER_BY_DB = {
  GMAIL: 'gmail',
  IMAP: 'imap',
  FORWARDED_MAILBOX: 'forwarded-mailbox',
  MANUAL: 'manual',
  OTHER: 'other',
}
const DB_PROVIDER_BY_CLIENT = {
  gmail: 'GMAIL',
  imap: 'IMAP',
  'forwarded-mailbox': 'FORWARDED_MAILBOX',
  manual: 'MANUAL',
  other: 'OTHER',
}

function primaryBookingMailbox() {
  return String(process.env.BOOKING_EMAIL_PRIMARY_MAILBOX || DEFAULT_BOOKING_EMAIL_MAILBOX).trim().toLowerCase()
}

function primaryBookingMailboxFromEnv(env = process.env) {
  return String(env.BOOKING_EMAIL_PRIMARY_MAILBOX || DEFAULT_BOOKING_EMAIL_MAILBOX).trim().toLowerCase()
}

function bookingEmailEnvFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase())
}

function bookingEmailTrustedSenderDomains(env = process.env) {
  return [...new Set(String(env.BOOKING_EMAIL_TRUSTED_SENDER_DOMAINS || '')
    .split(/[\s,]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, '').replace(/^\.+|\.+$/g, ''))
    .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))]
}

export function bookingEmailAutomationPolicy(env = process.env) {
  const requested = bookingEmailEnvFlag(env.BOOKING_EMAIL_AUTONOMY_ENABLED)
  const trustedSenderDomains = bookingEmailTrustedSenderDomains(env)
  const configured = requested && trustedSenderDomains.length > 0
  const requestedConfidence = Number(env.BOOKING_EMAIL_AUTONOMY_MIN_CONFIDENCE)
  const minimumConfidence = Number.isFinite(requestedConfidence)
    ? Math.min(0.99, Math.max(BOOKING_EMAIL_MIN_AUTONOMOUS_CONFIDENCE, requestedConfidence))
    : BOOKING_EMAIL_MIN_AUTONOMOUS_CONFIDENCE
  const missing = []
  if (requested && trustedSenderDomains.length === 0) missing.push('BOOKING_EMAIL_TRUSTED_SENDER_DOMAINS')

  return {
    version: BOOKING_EMAIL_AUTONOMY_VERSION,
    requested,
    configured,
    operationalMutationsEnabled: configured,
    autoAssignRooms: configured && bookingEmailEnvFlag(env.BOOKING_EMAIL_AUTO_ASSIGN_ROOMS, true),
    notifyManager: bookingEmailEnvFlag(env.BOOKING_EMAIL_NOTIFY_MANAGER, true),
    requireAuthenticationResults: bookingEmailEnvFlag(env.BOOKING_EMAIL_REQUIRE_AUTHENTICATION_RESULTS, true),
    requireCorroboration: bookingEmailEnvFlag(env.BOOKING_EMAIL_REQUIRE_CORROBORATION, false),
    minimumConfidence,
    trustedSenderDomains,
    missing,
  }
}

function gmailScopeList(env = process.env) {
  const configured = normalizeNullableString(env.BOOKING_EMAIL_GMAIL_SCOPES || env.GMAIL_SCOPES)
  if (!configured) return GMAIL_DEFAULT_SCOPES
  return configured.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean)
}

function bookingEmailGmailAccessToken(env = process.env) {
  return normalizeNullableString(env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN || env.GMAIL_ACCESS_TOKEN)
}

function bookingEmailGmailRefreshCredentials(env = process.env) {
  return {
    clientId: normalizeNullableString(env.BOOKING_EMAIL_GMAIL_CLIENT_ID || env.GMAIL_CLIENT_ID),
    clientSecret: normalizeNullableString(env.BOOKING_EMAIL_GMAIL_CLIENT_SECRET || env.GMAIL_CLIENT_SECRET),
    refreshToken: normalizeNullableString(env.BOOKING_EMAIL_GMAIL_REFRESH_TOKEN || env.GMAIL_REFRESH_TOKEN),
  }
}

export function bookingEmailGmailCredentialStatus(env = process.env) {
  const hasAccessToken = Boolean(bookingEmailGmailAccessToken(env))
  const refreshCredentials = bookingEmailGmailRefreshCredentials(env)
  const oauthClientConfigured = Boolean(refreshCredentials.clientId && refreshCredentials.clientSecret)
  const refreshTokenConfigured = Boolean(refreshCredentials.refreshToken)
  const hasRefreshToken = Boolean(oauthClientConfigured && refreshTokenConfigured)
  const missing = []
  if (!hasAccessToken && !refreshCredentials.clientId) missing.push('BOOKING_EMAIL_GMAIL_CLIENT_ID or GMAIL_CLIENT_ID')
  if (!hasAccessToken && !refreshCredentials.clientSecret) missing.push('BOOKING_EMAIL_GMAIL_CLIENT_SECRET or GMAIL_CLIENT_SECRET')
  if (!hasAccessToken && !refreshCredentials.refreshToken) missing.push('BOOKING_EMAIL_GMAIL_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN')
  const targetMailbox = primaryBookingMailboxFromEnv(env)
  if (!targetMailbox) missing.push('BOOKING_EMAIL_PRIMARY_MAILBOX')
  return {
    configured: hasAccessToken || hasRefreshToken,
    mode: hasAccessToken ? 'access_token' : hasRefreshToken ? 'refresh_token' : 'missing',
    hasAccessToken,
    hasRefreshToken,
    oauthClientConfigured,
    refreshTokenConfigured,
    targetMailboxConfigured: Boolean(targetMailbox),
    targetMailbox,
    userIdConfigured: Boolean(normalizeNullableString(env.BOOKING_EMAIL_GMAIL_USER_ID || env.GMAIL_USER_ID)),
    userId: normalizeNullableString(env.BOOKING_EMAIL_GMAIL_USER_ID || env.GMAIL_USER_ID) || 'me',
    scopes: gmailScopeList(env),
    missing,
    remediation: missing.length
      ? `Configure ${missing.join(', ')} in the server secret store. Do not use a Gmail mailbox password.`
      : undefined,
  }
}

function redactedCredentialMessage(value) {
  return String(value || '')
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[redacted]')
}

async function refreshBookingEmailGmailAccessToken(env = process.env, fetchImpl = fetch) {
  const credentials = bookingEmailGmailRefreshCredentials(env)
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) return null

  const response = await fetchImpl(GMAIL_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.access_token) {
    const providerMessage = payload?.error_description || payload?.error || 'Gmail OAuth refresh failed.'
    throw new PmsValidationError(redactedCredentialMessage(providerMessage), response.status || 502)
  }
  return String(payload.access_token)
}

export async function resolveBookingEmailGmailAccessToken(options = {}) {
  const env = options.env || process.env
  const accessToken = bookingEmailGmailAccessToken(env)
  if (accessToken) return accessToken
  return refreshBookingEmailGmailAccessToken(env, options.fetchImpl || fetch)
}

function normalizeBookingEmailProvider(provider) {
  const key = String(provider || 'gmail').trim().toLowerCase()
  return DB_PROVIDER_BY_CLIENT[key] || 'OTHER'
}

function bookingEmailProviderForClient(provider) {
  return CLIENT_PROVIDER_BY_DB[provider] || 'other'
}

function normalizeBookingEmailStatus(status, fallback = 'NEEDS_REVIEW') {
  const value = String(status || fallback).trim().toUpperCase()
  return VALID_BOOKING_EMAIL_STATUSES.includes(value) ? value : fallback
}

function normalizeBookingEmailEventType(type) {
  const value = String(type || '').trim().toUpperCase()
  return VALID_BOOKING_EMAIL_EVENT_TYPES.includes(value) ? value : 'UNKNOWN'
}

function safeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isoOrUndefined(value) {
  return value ? new Date(value).toISOString() : undefined
}

function dateKeyOrUndefined(value) {
  if (!value) return undefined
  try {
    return getBangkokDateKey(value)
  } catch {
    return undefined
  }
}

function normalizeRoomTypeCode(value) {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return undefined
  if (text.includes('DOUBLE')) return 'DOUBLE'
  if (text.includes('TWIN')) return 'TWIN'
  return text.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || undefined
}

function normalizedBookingEmailMatchValue(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function bookingEmailSenderDomain(sender) {
  return String(sender || '').toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})\b/i)?.[1] || null
}

function domainMatchesTrustedSender(domain, trustedDomains) {
  const normalized = String(domain || '').trim().toLowerCase().replace(/^@/, '').replace(/^\.+|\.+$/g, '')
  return Boolean(normalized && trustedDomains.some((trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`)))
}

export function bookingEmailAuthenticationPass(rawHeaders, trustedDomains) {
  const value = String(safeJsonObject(rawHeaders).authenticationResults || '').toLowerCase()
  if (!value) return false
  const authenticatedDomains = [
    ...[...value.matchAll(/\bdkim=pass\b[^;\r\n]*(?:header\.d|header\.i)=@?([a-z0-9.-]+\.[a-z]{2,})\b/g)].map((match) => match[1]),
    ...[...value.matchAll(/\bspf=pass\b[^;\r\n]*smtp\.mailfrom=(?:[^@\s;<>]+@)?([a-z0-9.-]+\.[a-z]{2,})\b/g)].map((match) => match[1]),
    ...[...value.matchAll(/\bdmarc=pass\b[^;\r\n]*header\.from=([a-z0-9.-]+\.[a-z]{2,})\b/g)].map((match) => match[1]),
  ]
  return authenticatedDomains.some((domain) => domainMatchesTrustedSender(domain, trustedDomains))
}

function bookingEmailChannelProvider(event) {
  const source = normalizeBookingSourceFromEmail(event.sender, event.sourceName)
  if (source === 'BOOKING_COM') return 'BOOKING_COM'
  if (source === 'AGODA') return 'AGODA'
  if (source === 'EXPEDIA') return 'EXPEDIA'
  if (source === 'AIRBNB') return 'AIRBNB'
  if (source === 'TRIP') return 'TRIP'
  return null
}

function normalizeBookingSourceFromEmail(sender, sourceName) {
  const text = `${sender || ''} ${sourceName || ''}`.toLowerCase()
  if (text.includes('booking.com') || text.includes('bookingcom')) return 'BOOKING_COM'
  if (text.includes('agoda')) return 'AGODA'
  if (text.includes('trip.com') || text.includes('tripcom') || text.includes('ctrip')) return 'TRIP'
  if (text.includes('expedia')) return 'EXPEDIA'
  if (text.includes('airbnb')) return 'AIRBNB'
  return 'EMAIL'
}

function splitGuestName(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  const parts = normalized.split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Guest' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

function parseMoney(text) {
  const amountMatch = firstMatch([
    /\b(?:total(?: amount| price)?|amount received|amount paid|payment amount|paid amount|deposit amount)\s*[:#-]?\s*(?:THB\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)\b/i,
    /\bTHB\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/i,
    /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*THB\b/i,
  ], text)
  if (!amountMatch) return {}
  const amount = Number(amountMatch.replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return {}
  return { amount, currency: 'THB' }
}

function normalizeParsedDateValue(raw) {
  if (!raw) return undefined
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map((part) => part.padStart(2, '0'))
    return `${year}-${month}-${day}`
  }
  const [day, month, yearPart] = raw.split(/[/.]/)
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseDateFromText(label, text) {
  const labels = Array.isArray(label) ? label : [label]
  for (const currentLabel of labels) {
    const normalizedLabel = String(currentLabel || '')
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_-]*')
    if (!normalizedLabel) continue
    const labeled = String(text || '').match(new RegExp(`${normalizedLabel}(?:\\s*date)?\\s*[:#-]?\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})`, 'i'))
    const raw = labeled?.[1]
    if (!raw) continue
    return normalizeParsedDateValue(raw)
  }
  return undefined
}

function parseDateRangeFromText(labels, text) {
  for (const label of Array.isArray(labels) ? labels : [labels]) {
    const normalizedLabel = String(label || '')
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_-]*')
    if (!normalizedLabel) continue
    const labeled = String(text || '').match(new RegExp(`${normalizedLabel}(?:\\s*dates?)?\\s*[:#-]?\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})\\s*(?:to|until|through|-|–|—)\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})`, 'i'))
    const start = parseDateFromText(label, labeled?.[1])
    const end = parseDateFromText(label, labeled?.[2])
    if (start && end) return { start, end }
  }
  return null
}

function parseDateRangeFromNormalizedText(labels, text) {
  for (const label of Array.isArray(labels) ? labels : [labels]) {
    const normalizedLabel = String(label || '')
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s_-]*')
    if (!normalizedLabel) continue
    const labeled = String(text || '').match(new RegExp(`${normalizedLabel}(?:\\s*dates?)?\\s*[:#-]?\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})\\s*(?:to|until|through|-)\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})`, 'i'))
    const start = normalizeParsedDateValue(labeled?.[1])
    const end = normalizeParsedDateValue(labeled?.[2])
    if (start && end) return { start, end }
  }
  return null
}

function firstMatch(patterns, text) {
  for (const pattern of patterns) {
    const candidate = normalizeNullableString(String(text || '').match(pattern)?.[1])
    if (candidate) return candidate
  }
  return null
}

function normalizeBookingEmailMessageId(value) {
  return normalizeNullableString(value)?.replace(/[<>]/g, '').toLowerCase() || null
}

function bookingEmailDuplicateFingerprint(input = {}, parsed = undefined) {
  const event = safeJsonObject(input)
  const derived = parsed || parseBookingEmailDetails(event)
  const details = safeJsonObject(derived.details)
  const headers = safeJsonObject(event.rawHeaders)
  const payload = [
    normalizeBookingEmailEventType(event.eventType || derived.eventType),
    normalizeNullableString(event.channelRef || derived.channelRef)?.toUpperCase() || '',
    normalizeNullableString(event.subject)?.toLowerCase() || '',
    normalizeNullableString(event.sender)?.toLowerCase() || '',
    normalizeBookingEmailMessageId(headers.messageId) || '',
    normalizeNullableString(event.threadId)?.toLowerCase() || '',
    normalizeNullableString(details.guestName)?.toLowerCase() || '',
    normalizeNullableString(details.checkIn) || '',
    normalizeNullableString(details.checkOut) || '',
    normalizeNullableString(details.roomType)?.toUpperCase() || '',
    Number.isFinite(Number(details.amount)) ? roundMoney(Number(details.amount)).toFixed(2) : '',
    normalizeNullableString(details.paymentStatus)?.toUpperCase() || '',
    normalizeNullableString(event.rawText || event.body || event.snippet)?.toLowerCase().replace(/\s+/g, ' ').slice(0, 2000) || '',
  ]
  return createHash('sha256').update(payload.join('\n')).digest('hex')
}

function hasNonBookingOperationalSignal(text) {
  return /\b(account security|security update|two-factor authentication|new sign-?in|sign(?:ed)? in from a new device|performance report|weekly performance report|partner hub|invoice\b|boost campaigns|phishing|market manager)\b/i.test(String(text || ''))
}

export function parseBookingEmailDetails(input = {}) {
  const parsedInput = safeJsonObject(input.parsedDetails)
  const rawText = String(input.rawText || input.body || input.snippet || '')
  const subject = String(input.subject || '')
  const combined = `${subject}\n${rawText}`
  const stayDateRange = parseDateRangeFromNormalizedText(['stay', 'stay dates', 'travel dates', 'dates'], combined)
    || parseDateRangeFromText(['stay', 'stay dates', 'travel dates', 'dates'], combined)
  const channelRef = normalizeNullableString(input.channelRef || parsedInput.channelRef || parsedInput.confirmationCode)
    || firstMatch([
      /\b(?:confirmation number|confirmation no\.?|booking number|reservation number|booking id|reservation id|booking reference|reservation reference|booking ref|reservation ref|reference|ref)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i,
      /\b(?:booking confirmation|reservation confirmation|confirmed booking|confirmed reservation)\s+([A-Z0-9][A-Z0-9-]{3,})\b/i,
    ], combined)
    || null
  const guestName = normalizeNullableString(input.guestName || parsedInput.guestName)
    || firstMatch([
      /\b(?:guest name|lead guest|main guest|customer name|booker|guest|name)\s*[:#-]\s*([A-Z][A-Za-z .'-]{2,80}?)(?=\s+(?:booking|reservation|reference|check(?:\s*|-)?in|arrival|check(?:\s*|-)?out|departure|room type|adults?|children|amount|total|payment|special requests?|notes?)\b|$)/i,
    ], combined)
    || null
  const checkIn = dateKeyOrUndefined(input.checkIn || parsedInput.checkIn)
    || parseDateFromText(['check in', 'check-in', 'checkin', 'arrival'], combined)
    || stayDateRange?.start
  const checkOut = dateKeyOrUndefined(input.checkOut || parsedInput.checkOut)
    || parseDateFromText(['check out', 'check-out', 'checkout', 'departure'], combined)
    || stayDateRange?.end
  const externalRoomType = normalizeNullableString(input.externalRoomType || parsedInput.externalRoomType)
    || firstMatch([
      /\b(?:room type|room category|accommodation|unit type)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 /&'()-]{2,80}?)(?=\s+(?:adults?|children|check(?:\s*|-)?in|arrival|check(?:\s*|-)?out|departure|amount|total|payment|special requests?|notes?|booking|reservation|reference)\b|$)/i,
    ], combined)
  const roomType = normalizeRoomTypeCode(input.roomType || parsedInput.roomType)
    || normalizeRoomTypeCode(externalRoomType)
    || (/\bdouble\b/i.test(combined) ? 'DOUBLE' : /\btwin\b/i.test(combined) ? 'TWIN' : undefined)
  const money = parseMoney(combined)
  const amount = Number(input.amount ?? parsedInput.amount ?? money.amount)
  const adults = Number(input.adults ?? parsedInput.adults ?? combined.match(/\b(?:adults?)\s*[:#-]?\s*(\d+)/i)?.[1] ?? 1)
  const children = Number(input.children ?? parsedInput.children ?? combined.match(/\b(?:children|kids?)\s*[:#-]?\s*(\d+)/i)?.[1] ?? 0)
  const paymentStatus = normalizeNullableString(input.paymentStatus || parsedInput.paymentStatus)
    || (/\b(payment received|paid in full|fully paid|prepaid)\b/i.test(combined) ? 'PAID' : /\bdeposit\b/i.test(combined) ? 'DEPOSIT' : null)
  const newBookingSignal = /\b(new booking|booking confirmation|reservation confirmation|confirmed booking|confirmed reservation)\b/i.test(combined)
  const cancellationSignal = /\b(cancelled|canceled|cancellation|booking cancelled|reservation cancelled)\b/i.test(combined)
  const modificationSignal = /\b(modification|modified|changed booking|booking changed|updated booking|updated reservation|reservation updated|amended|amendment|alteration|revised)\b/i.test(combined)
  const paymentSignal = /\b(payment received|payment notice|paid in full|fully paid|deposit received|deposit paid|transfer received|amount received|prepaid)\b/i.test(combined)
  const guestMessageSignal = /\b(guest message|message from guest|guest request|guest question|guest enquiry|special request from guest|question from guest)\b/i.test(combined)
  const nonBookingOperationalSignal = hasNonBookingOperationalSignal(combined)
  const reservationStructureSignal = Boolean(channelRef || guestName || (checkIn && checkOut) || roomType)
  const generalBookingSignal = !nonBookingOperationalSignal && (
    /\b(your booking|your reservation|booking details|reservation details|booking reference|reservation reference|booking number|reservation number|booking id|reservation id|booking ref|reservation ref)\b/i.test(combined)
    || (/\breservation\b/i.test(combined) && reservationStructureSignal)
  )

  const explicitType = normalizeBookingEmailEventType(input.eventType)
  const eventType = explicitType !== 'UNKNOWN'
    ? explicitType
    : cancellationSignal
      ? 'CANCELLATION'
      : modificationSignal
        ? 'MODIFICATION'
        : guestMessageSignal
          ? 'GUEST_MESSAGE'
          : newBookingSignal
            ? 'NEW_BOOKING'
            : paymentSignal
              ? 'PAYMENT_NOTICE'
              : generalBookingSignal && reservationStructureSignal
                ? 'NEW_BOOKING'
                : 'UNKNOWN'

  const details = {
    guestName: guestName || undefined,
    checkIn,
    checkOut,
    roomType,
    externalRoomType: externalRoomType || undefined,
    adults: Number.isInteger(adults) && adults > 0 ? adults : 1,
    children: Number.isInteger(children) && children >= 0 ? children : 0,
    amount: Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : undefined,
    currency: normalizeNullableString(input.currency || parsedInput.currency || money.currency) || 'THB',
    paymentStatus: paymentStatus || undefined,
    paymentReference: normalizeNullableString(input.paymentReference || parsedInput.paymentReference) || undefined,
    specialRequests: normalizeNullableString(input.specialRequests || parsedInput.specialRequests) || undefined,
    notes: normalizeNullableString(input.notes || parsedInput.notes) || undefined,
  }

  let confidence = 0.25
  if (channelRef) confidence += 0.2
  if (details.guestName) confidence += 0.15
  if (details.checkIn && details.checkOut) confidence += 0.2
  if (details.roomType) confidence += 0.1
  if (details.amount) confidence += 0.05
  if (eventType !== 'UNKNOWN') confidence += 0.05

  const missing = []
  if (eventType === 'UNKNOWN') missing.push('event type')
  if (eventType === 'NEW_BOOKING' && !details.guestName) missing.push('guest name')
  if (eventType === 'NEW_BOOKING' && (!details.checkIn || !details.checkOut)) missing.push('stay dates')
  if (eventType === 'NEW_BOOKING' && !details.roomType) missing.push('room type')
  if (eventType === 'PAYMENT_NOTICE' && !details.amount) missing.push('payment amount')
  if ((eventType === 'PAYMENT_NOTICE' || eventType === 'CANCELLATION' || eventType === 'MODIFICATION') && !channelRef) {
    missing.push('reservation reference')
  }

  return {
    eventType,
    channelRef,
    details,
    confidence: Math.min(0.99, roundMoney(confidence)),
    reviewReason: missing.length > 0 ? `Missing ${missing.join(', ')}.` : null,
  }
}

export function previewBookingEmailEvent(input = {}) {
  const parsed = parseBookingEmailDetails(input)
  return {
    eventType: parsed.eventType,
    confidence: parsed.confidence,
    channelRefPresent: Boolean(parsed.channelRef),
    guestNamePresent: Boolean(parsed.details.guestName),
    stayDatesPresent: Boolean(parsed.details.checkIn && parsed.details.checkOut),
    roomTypePresent: Boolean(parsed.details.roomType),
    amountPresent: Boolean(parsed.details.amount),
    paymentStatusPresent: Boolean(parsed.details.paymentStatus),
    needsReview: Boolean(parsed.reviewReason),
  }
}

function proposedBookingEmailAction(eventType) {
  if (eventType === 'NEW_BOOKING') return 'Create reservation after staff review'
  if (eventType === 'MODIFICATION') return 'Link to reservation and review changes'
  if (eventType === 'CANCELLATION') return 'Cancel matched reservation after approval'
  if (eventType === 'PAYMENT_NOTICE') return 'Record payment after duplicate check'
  if (eventType === 'GUEST_MESSAGE') return 'Link message to reservation'
  return 'Review raw email and classify'
}

function bookingEmailSourceResponse(source) {
  const lastError = source.lastError === BOOKING_EMAIL_GMAIL_MISSING_CREDENTIALS_MESSAGE && bookingEmailGmailCredentialStatus().configured
    ? null
    : source.lastError
  return {
    id: source.id,
    name: source.name,
    provider: bookingEmailProviderForClient(source.provider),
    enabled: source.enabled,
    mailbox: source.mailbox,
    lastSyncAt: isoOrUndefined(source.lastSyncAt),
    lastError: lastError || undefined,
    autoProcessSafeEvents: source.autoProcessSafeEvents,
    reviewThreshold: source.reviewThreshold,
  }
}

function bookingEmailEventResponse(event) {
  const parsedDetails = safeJsonObject(event.parsedDetails)
  return {
    id: event.id,
    sourceId: event.sourceId || undefined,
    sourceName: event.source?.name || event.sourceName || undefined,
    source: event.source?.name || event.sourceName || event.sourceMailbox || 'Booking email',
    sender: event.sender,
    subject: event.subject || undefined,
    receivedAt: new Date(event.receivedAt).toISOString(),
    eventType: event.eventType,
    status: event.status,
    channelRef: event.channelRef || undefined,
    guestName: event.guestName || parsedDetails.guestName || undefined,
    checkIn: dateKeyOrUndefined(event.checkIn || parsedDetails.checkIn),
    checkOut: dateKeyOrUndefined(event.checkOut || parsedDetails.checkOut),
    roomType: event.roomType || parsedDetails.roomType || undefined,
    amount: event.amount ?? parsedDetails.amount,
    currency: event.currency || parsedDetails.currency || undefined,
    paymentStatus: event.paymentStatus || parsedDetails.paymentStatus || undefined,
    confidence: event.confidence,
    proposedAction: event.proposedAction || undefined,
    completedAction: event.completedAction || undefined,
    reviewReason: event.reviewReason || undefined,
    errorReason: event.errorReason || undefined,
    rawEmailUrl: event.rawEmailUrl || undefined,
    reservationId: event.reservationId || undefined,
    reservationConfirmation: event.reservation?.confirmationCode || undefined,
    duplicateOfEventId: event.duplicateOfEventId || undefined,
    automationDecision: safeJsonObject(event.automationDecision),
    managerReviewNotifiedAt: isoOrUndefined(event.managerReviewNotifiedAt),
    sourceEmailId: event.sourceMessageId || undefined,
    parsedDetails,
    createdAt: isoOrUndefined(event.createdAt),
    updatedAt: isoOrUndefined(event.updatedAt),
  }
}

async function ensurePrimaryBookingEmailSource(tx, actor) {
  const property = await getProperty(tx, actor)
  const mailbox = primaryBookingMailbox()
  const credentials = bookingEmailGmailCredentialStatus()
  return tx.bookingEmailSource.upsert({
    where: {
      propertyId_mailbox: {
        propertyId: property.id,
        mailbox,
      },
    },
    update: {
      name: 'Primary booking Gmail',
      provider: 'GMAIL',
      enabled: true,
      ...(credentials.configured ? {} : { lastError: BOOKING_EMAIL_GMAIL_MISSING_CREDENTIALS_MESSAGE }),
    },
    create: {
      propertyId: property.id,
      name: 'Primary booking Gmail',
      provider: 'GMAIL',
      mailbox,
      enabled: true,
      autoProcessSafeEvents: false,
      reviewThreshold: BOOKING_EMAIL_DEFAULT_REVIEW_THRESHOLD,
      query: `to:${mailbox} -in:spam -in:trash newer_than:30d`,
      lastError: credentials.configured ? null : BOOKING_EMAIL_GMAIL_MISSING_CREDENTIALS_MESSAGE,
    },
  })
}

function bookingEmailEventInclude() {
  return {
    source: true,
    reservation: {
      select: {
        id: true,
        confirmationCode: true,
      },
    },
  }
}

function gmailHeader(message, name) {
  return message?.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function decodeGmailBody(data) {
  if (!data) return ''
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function collectGmailTextParts(part, output = []) {
  if (!part) return output
  if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
    const body = decodeGmailBody(part.body?.data)
    if (body) output.push(body)
  }
  for (const child of part.parts || []) collectGmailTextParts(child, output)
  return output
}

async function fetchGmailJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PmsValidationError(redactedCredentialMessage(payload?.error?.message || 'Gmail API request failed.'), response.status)
  }
  return payload
}

export async function testBookingEmailGmailConnection(options = {}) {
  const env = options.env || process.env
  const credentials = bookingEmailGmailCredentialStatus(env)
  if (!credentials.configured) {
    return {
      checked: false,
      status: 'not_configured',
      message: credentials.remediation || 'Gmail API OAuth credentials are not configured.',
    }
  }

  try {
    const token = await resolveBookingEmailGmailAccessToken({ env, fetchImpl: options.fetchImpl || fetch })
    if (!token) {
      return {
        checked: false,
        status: 'not_configured',
        message: 'Gmail API OAuth credentials are not configured.',
      }
    }
    const userId = encodeURIComponent(credentials.userId || 'me')
    const profile = await fetchGmailJson(`https://gmail.googleapis.com/gmail/v1/users/${userId}/profile`, token, options.fetchImpl || fetch)
    const authenticatedMailbox = normalizeNullableString(profile?.emailAddress)?.toLowerCase() || null
    return {
      checked: true,
      status: 'pass',
      message: authenticatedMailbox && authenticatedMailbox !== credentials.targetMailbox
        ? `Gmail API is reachable, but the authenticated Gmail account (${authenticatedMailbox}) is not the target mailbox ${credentials.targetMailbox}. Confirm forwarding, delegation, or BOOKING_EMAIL_GMAIL_USER_ID before syncing.`
        : 'Gmail API connection test passed.',
      authenticatedMailbox: authenticatedMailbox || undefined,
      targetMailboxMatchesAuthenticatedAccount: authenticatedMailbox ? authenticatedMailbox === credentials.targetMailbox : undefined,
    }
  } catch (error) {
    return {
      checked: true,
      status: 'fail',
      message: redactedCredentialMessage(error instanceof Error ? error.message : String(error)),
    }
  }
}

export async function fetchGmailEventsForSource(source, options = {}) {
  const token = await resolveBookingEmailGmailAccessToken(options)
  if (!token) {
    const status = bookingEmailGmailCredentialStatus(options.env || process.env)
    throw new PmsValidationError(
      status.remediation || 'Gmail API OAuth credentials are not configured for booking email sync.',
      503,
    )
  }
  const env = options.env || process.env
  const userId = encodeURIComponent(env.BOOKING_EMAIL_GMAIL_USER_ID || env.GMAIL_USER_ID || 'me')
  const query = normalizeNullableString(options.query) || source.query || `to:${source.mailbox} -in:spam -in:trash newer_than:30d`
  const maxMessages = Math.min(Math.max(Number(options.maxMessages || options.limit || 10), 1), 1000)
  const pageSize = Math.min(Math.max(Number(options.pageSize || Math.min(maxMessages, 50)), 1), 50)
  const maxPages = Math.min(Math.max(Number(options.maxPages || Math.ceil(maxMessages / pageSize)), 1), 100)
  const messages = []
  let pageToken = normalizeNullableString(options.pageToken)
  let pageCount = 0
  do {
    const listUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages`)
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('maxResults', String(Math.min(pageSize, maxMessages - messages.length)))
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken)

    const listed = await fetchGmailJson(listUrl, token, options.fetchImpl || fetch)
    for (const item of listed.messages || []) {
      if (messages.length >= maxMessages) break
      const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${encodeURIComponent(item.id)}`)
      messageUrl.searchParams.set('format', 'full')
      const message = await fetchGmailJson(messageUrl, token, options.fetchImpl || fetch)
      const rawText = collectGmailTextParts(message.payload).join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const receivedAt = Number(message.internalDate) ? new Date(Number(message.internalDate)).toISOString() : gmailHeader(message, 'date')
      messages.push({
        sourceMessageId: message.id,
        threadId: message.threadId,
        sender: gmailHeader(message, 'from') || 'Unknown sender',
        recipient: gmailHeader(message, 'to') || source.mailbox,
        subject: gmailHeader(message, 'subject') || '(no subject)',
        receivedAt,
        rawText: rawText || message.snippet || '',
        snippet: message.snippet || '',
        rawEmailUrl: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
        rawHeaders: {
          messageId: gmailHeader(message, 'message-id'),
          date: gmailHeader(message, 'date'),
          authenticationResults: gmailHeader(message, 'authentication-results'),
          replyTo: gmailHeader(message, 'reply-to'),
        },
      })
    }
    pageToken = normalizeNullableString(listed.nextPageToken)
    pageCount += 1
  } while (pageToken && messages.length < maxMessages && pageCount < maxPages)
  return messages
}

async function findDuplicateBookingEmailEvent(tx, sourceId, parsed, input, eventId) {
  const sourceMessageId = normalizeNullableString(input.sourceMessageId || input.sourceEmailId || input.gmailMessageId || input.messageId)
  if (sourceMessageId) {
    const exactSourceMessage = await tx.bookingEmailEvent.findFirst({
      where: {
        id: eventId ? { not: eventId } : undefined,
        sourceId: sourceId || undefined,
        sourceMessageId,
      },
      orderBy: { receivedAt: 'asc' },
    })
    if (exactSourceMessage) return exactSourceMessage
  }

  if (!parsed.channelRef) return null
  const candidates = await tx.bookingEmailEvent.findMany({
    where: {
      id: eventId ? { not: eventId } : undefined,
      sourceId: sourceId || undefined,
      channelRef: parsed.channelRef,
      eventType: parsed.eventType,
    },
    orderBy: { receivedAt: 'asc' },
    take: 25,
  })
  if (candidates.length === 0) return null

  const targetHeaders = safeJsonObject(input.rawHeaders)
  const targetMessageId = normalizeBookingEmailMessageId(targetHeaders.messageId)
  const targetFingerprint = bookingEmailDuplicateFingerprint(input, parsed)
  for (const candidate of candidates) {
    const candidateHeaders = safeJsonObject(candidate.rawHeaders)
    if (targetMessageId && normalizeBookingEmailMessageId(candidateHeaders.messageId) === targetMessageId) {
      return candidate
    }
    if (bookingEmailDuplicateFingerprint(candidate, {
      eventType: candidate.eventType,
      channelRef: candidate.channelRef,
      details: safeJsonObject(candidate.parsedDetails),
    }) === targetFingerprint) {
      return candidate
    }
  }
  return null
}

function bookingEmailCorroborationValue(field, value) {
  if (field === 'amount') {
    const amount = Number(value)
    return Number.isFinite(amount) ? roundMoney(amount).toFixed(2) : ''
  }
  return normalizedBookingEmailMatchValue(value)
}

async function findBookingEmailCorroboration(tx, propertyId, parsed, eventId) {
  if (!parsed.channelRef || parsed.eventType === 'UNKNOWN') return { count: 0, eventIds: [], conflicts: [] }
  const candidates = await tx.bookingEmailEvent.findMany({
    where: {
      id: eventId ? { not: eventId } : undefined,
      propertyId,
      channelRef: parsed.channelRef,
      eventType: parsed.eventType,
    },
    orderBy: { receivedAt: 'asc' },
    take: 25,
  })
  const target = safeJsonObject(parsed.details)
  const corroborating = []
  const conflicts = new Set()
  for (const candidate of candidates) {
    const candidateDetails = safeJsonObject(candidate.parsedDetails)
    const candidateConflicts = []
    for (const field of ['guestName', 'checkIn', 'checkOut', 'roomType', 'amount']) {
      const left = bookingEmailCorroborationValue(field, target[field])
      const right = bookingEmailCorroborationValue(field, candidateDetails[field] ?? candidate[field])
      if (left && right && left !== right) candidateConflicts.push(field)
    }
    if (candidateConflicts.length > 0) {
      candidateConflicts.forEach((field) => conflicts.add(field))
      continue
    }
    corroborating.push(candidate.id)
  }
  return {
    count: corroborating.length,
    eventIds: corroborating.slice(0, 10),
    conflicts: [...conflicts],
  }
}

async function findReservationForBookingEmailEvent(tx, event, details = safeJsonObject(event.parsedDetails)) {
  if (event.reservationId) {
    const reservation = await tx.reservation.findFirst({
      where: { id: event.reservationId, propertyId: event.propertyId },
      include: reservationInclude,
    })
    if (reservation) return reservation
  }

  if (event.channelRef) {
    const reservation = await tx.reservation.findFirst({
      where: {
        propertyId: event.propertyId,
        channelRef: event.channelRef,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      include: reservationInclude,
    })
    if (reservation) return reservation
  }

  if (details.guestName && details.checkIn && details.checkOut) {
    const [firstName, ...lastNameParts] = String(details.guestName).trim().split(/\s+/)
    const lastName = lastNameParts.join(' ')
    return tx.reservation.findFirst({
      where: {
        propertyId: event.propertyId,
        checkIn: dateFromKey(details.checkIn),
        checkOut: dateFromKey(details.checkOut),
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        guest: {
          firstName: { equals: firstName, mode: 'insensitive' },
          ...(lastName ? { lastName: { equals: lastName, mode: 'insensitive' } } : {}),
        },
      },
      include: reservationInclude,
    })
  }

  return null
}

async function buildBookingEmailEventData(tx, source, input, existingEventId = undefined) {
  const parsed = parseBookingEmailDetails(input)
  const duplicateEvent = await findDuplicateBookingEmailEvent(tx, source.id, parsed, input, existingEventId)
  const corroboration = await findBookingEmailCorroboration(tx, source.propertyId, parsed, existingEventId)
  const sourceMessageId = normalizeNullableString(input.sourceMessageId || input.sourceEmailId || input.gmailMessageId || input.messageId)
  const status = normalizeBookingEmailStatus(input.status, 'NEEDS_REVIEW')
  const confidence = Math.min(0.99, roundMoney(Number(input.confidence ?? parsed.confidence) + Math.min(0.04, corroboration.count * 0.02)))
  const reviewReason = [
    normalizeNullableString(input.reviewReason),
    parsed.reviewReason,
    corroboration.conflicts.length > 0 ? `Conflicting duplicate evidence for ${corroboration.conflicts.join(', ')}.` : null,
  ].filter(Boolean).join(' ') || null

  return {
    propertyId: source.propertyId,
    sourceId: source.id,
    sourceName: source.name,
    sourceMailbox: source.mailbox,
    sourceMessageId,
    threadId: normalizeNullableString(input.threadId),
    rawEmailUrl: normalizeNullableString(input.rawEmailUrl),
    sender: normalizeNullableString(input.sender) || 'Unknown sender',
    recipient: normalizeNullableString(input.recipient) || source.mailbox,
    subject: normalizeNullableString(input.subject),
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    eventType: parsed.eventType,
    status,
    confidence,
    channelRef: parsed.channelRef,
    guestName: parsed.details.guestName || null,
    checkIn: parsed.details.checkIn ? dateFromKey(parsed.details.checkIn) : null,
    checkOut: parsed.details.checkOut ? dateFromKey(parsed.details.checkOut) : null,
    roomType: parsed.details.roomType || null,
    ...(parsed.details.amount === undefined || parsed.details.amount === null
      ? { amount: null, amountSatang: null }
      : moneyDataFromBaht('amount', 'amountSatang', parsed.details.amount)),
    currency: parsed.details.currency || null,
    paymentStatus: parsed.details.paymentStatus || null,
    proposedAction: normalizeNullableString(input.proposedAction) || proposedBookingEmailAction(parsed.eventType),
    completedAction: normalizeNullableString(input.completedAction),
    reviewReason,
    errorReason: normalizeNullableString(input.errorReason),
    parsedDetails: parsed.details,
    automationDecision: {
      version: BOOKING_EMAIL_AUTONOMY_VERSION,
      stage: 'EXTRACTED',
      confidence,
      corroborationCount: corroboration.count,
      corroboratingEventIds: corroboration.eventIds,
      conflictingFields: corroboration.conflicts,
      duplicateOfEventId: duplicateEvent?.id || null,
      evaluatedAt: new Date().toISOString(),
    },
    rawHeaders: safeJsonObject(input.rawHeaders),
    rawText: normalizeNullableString(input.rawText || input.body || input.snippet),
    duplicateOfEventId: duplicateEvent?.id || null,
  }
}

async function upsertBookingEmailEvent(tx, source, input) {
  const data = await buildBookingEmailEventData(tx, source, input)
  if (data.sourceMessageId) {
    const existing = await tx.bookingEmailEvent.findFirst({
      where: { sourceId: source.id, sourceMessageId: data.sourceMessageId },
      include: bookingEmailEventInclude(),
    })
    if (existing && ['PROCESSED', 'IGNORED'].includes(existing.status)) return existing
    return tx.bookingEmailEvent.upsert({
      where: {
        sourceId_sourceMessageId: {
          sourceId: source.id,
          sourceMessageId: data.sourceMessageId,
        },
      },
      update: {
        ...data,
      },
      create: data,
      include: bookingEmailEventInclude(),
    })
  }
  return tx.bookingEmailEvent.create({
    data,
    include: bookingEmailEventInclude(),
  })
}

function detailsForApproval(event, editedDetails) {
  return {
    ...safeJsonObject(event.parsedDetails),
    ...safeJsonObject(editedDetails),
  }
}

const BOOKING_EMAIL_APPROVAL_MODES = new Set(['apply_parsed', 'create_reservation', 'link_reservation'])

const BOOKING_EMAIL_EVENT_MODES = {
  NEW_BOOKING: new Set(['apply_parsed', 'create_reservation', 'link_reservation']),
  PAYMENT_NOTICE: new Set(['apply_parsed', 'link_reservation']),
  CANCELLATION: new Set(['apply_parsed', 'link_reservation']),
  MODIFICATION: new Set(['apply_parsed', 'link_reservation']),
  GUEST_MESSAGE: new Set(['link_reservation']),
  UNKNOWN: new Set(['link_reservation']),
}

export function assertBookingEmailApprovalContract(eventType, mode, input = {}, actor) {
  const normalizedEventType = String(eventType || 'UNKNOWN').toUpperCase()
  const normalizedMode = String(mode || 'apply_parsed')
  if (!BOOKING_EMAIL_APPROVAL_MODES.has(normalizedMode)) {
    throw new PmsValidationError('Booking email approval mode is not supported.')
  }
  const allowedModes = BOOKING_EMAIL_EVENT_MODES[normalizedEventType] || BOOKING_EMAIL_EVENT_MODES.UNKNOWN
  if (!allowedModes.has(normalizedMode)) {
    throw new PmsValidationError(`${normalizedMode} is not allowed for ${normalizedEventType.toLowerCase().replaceAll('_', ' ')} email events.`)
  }

  const requiredPermission = normalizedMode === 'link_reservation'
    ? 'edit:reservation'
    : normalizedEventType === 'NEW_BOOKING'
      ? 'create:reservation'
      : normalizedEventType === 'PAYMENT_NOTICE'
        ? 'process:payment'
        : normalizedEventType === 'CANCELLATION'
          ? 'cancel:reservation'
          : 'edit:reservation'
  if (!canPerformAction(actor, requiredPermission)) {
    throw new PmsValidationError('You do not have permission to apply this booking email action.', 403)
  }

  if (normalizedMode === 'apply_parsed' && ['CANCELLATION', 'MODIFICATION'].includes(normalizedEventType)) {
    if (!normalizeNullableString(input.reason)) {
      throw new PmsValidationError(`${normalizedEventType === 'CANCELLATION' ? 'Cancellation' : 'Modification'} email actions require an operational reason.`)
    }
  }
  return { eventType: normalizedEventType, mode: normalizedMode, requiredPermission }
}

async function reservationInputFromBookingEmailEvent(tx, event, details) {
  const guest = splitGuestName(details.guestName)
  if (!guest) throw new PmsValidationError('Guest name is required before creating a reservation.')
  if (!details.checkIn || !details.checkOut) throw new PmsValidationError('Check-in and check-out dates are required before creating a reservation.')
  const roomTypeCode = normalizeRoomTypeCode(details.roomType)
  if (!roomTypeCode) throw new PmsValidationError('Room type is required before creating a reservation.')

  const property = await tx.property.findUnique({ where: { id: event.propertyId } })
  if (!property) throw new PmsValidationError('Booking email property was not found.', 404)
  const roomType = await tx.roomType.findFirst({
    where: {
      propertyId: property.id,
      code: roomTypeCode,
    },
  })
  if (!roomType) throw new PmsValidationError('Parsed room type does not match a configured PMS room type.')
  const { nights } = validateStayInput({ checkIn: details.checkIn, checkOut: details.checkOut })
  const amount = Number(details.amount || event.amount)
  const ratePerNight = Number.isFinite(amount) && amount > 0 ? roundMoney(amount / nights) : roomType.baseRate

  return {
    guest: {
      ...guest,
      email: normalizeNullableString(details.guestEmail),
      phone: normalizeNullableString(details.guestPhone),
    },
    confirmationCode: event.channelRef || undefined,
    checkIn: details.checkIn,
    checkOut: details.checkOut,
    roomTypeCode,
    adults: Number(details.adults || 1),
    children: Number(details.children || 0),
    childAges: Array.isArray(details.childAges) ? details.childAges.map(Number) : [],
    ratePerNight,
    source: normalizeBookingSourceFromEmail(event.sender, event.sourceName),
    channelRef: event.channelRef || undefined,
    sourceEmailEventId: event.id,
    notes: [details.notes, `Created from booking email event ${event.id}`].filter(Boolean).join('\n'),
    specialRequests: normalizeNullableString(details.specialRequests),
  }
}

async function approveNewBookingEmailEvent(tx, event, details, actor, options = {}) {
  const duplicateReservation = await findReservationForBookingEmailEvent(tx, event, details)
  if (duplicateReservation) {
    await tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        status: 'NEEDS_REVIEW',
        reservationId: duplicateReservation.id,
        reviewReason: `Possible duplicate of reservation ${duplicateReservation.confirmationCode}. Link instead of creating a new booking.`,
      },
    })
    throw new PmsValidationError(`Reservation ${duplicateReservation.confirmationCode} already appears to match this email.`, 409)
  }

  const reservationInput = await reservationInputFromBookingEmailEvent(tx, event, details)
  if (options.assignedRoomId) reservationInput.assignedRoomId = options.assignedRoomId
  const reservation = await createReservationInTransaction(tx, reservationInput, actor)
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: reservation.id,
      completedAction: options.autonomous
        ? `Autonomously created reservation ${reservation.confirmationCode} and assigned Room ${reservation.assignedRoom?.number}.`
        : `Created reservation ${reservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
      parsedDetails: details,
      roomType: normalizeRoomTypeCode(details.roomType) || event.roomType,
      automationDecision: options.automationDecision || event.automationDecision,
      processedAt: new Date(),
      processedBy: actorName(actor),
    },
    include: bookingEmailEventInclude(),
  })
  await createReservationLog(tx, reservation.id, 'CREATED', actor, {
    notes: `Created from booking email event ${event.id}.`,
    changes: { sourceEmailEventId: event.id, sourceMessageId: event.sourceMessageId },
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_CREATED_RESERVATION', 'bookingEmailEvent', event.id, {
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    sourceMessageId: event.sourceMessageId,
    autonomous: Boolean(options.autonomous),
    assignedRoomId: reservation.assignedRoomId,
  })
  return updated
}

async function approvePaymentEmailEvent(tx, event, details, actor, reservationId) {
  const reservation = reservationId
    ? await tx.reservation.findFirst({ where: { id: reservationId, propertyId: event.propertyId }, include: reservationInclude })
    : await findReservationForBookingEmailEvent(tx, event, details)
  if (!reservation) throw new PmsValidationError('Link this payment notice to a reservation before applying it.')
  if (!reservation.folio?.id) throw new PmsValidationError('Matched reservation does not have a folio.')

  const amount = Number(details.amount || event.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new PmsValidationError('Payment amount is required before applying this email.')
  const reference = normalizeNullableString(details.paymentReference || event.channelRef || event.sourceMessageId)
  const result = await recordPaymentInTransaction(tx, reservation.folio.id, {
    amount,
    method: details.paymentMethod || 'ONLINE',
    reference,
    idempotencyKey: `booking-email-payment:${event.propertyId}:${event.id}`,
    notes: `Payment notice from booking email event ${event.id}`,
    sourceEmailEventId: event.id,
  }, actor)
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: reservation.id,
      completedAction: `Recorded payment ${result.payment.id} on reservation ${reservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
      processedAt: new Date(),
      processedBy: actorName(actor),
    },
    include: bookingEmailEventInclude(),
  })
  await createReservationLog(tx, reservation.id, 'DEPOSIT_PAID', actor, {
    notes: `Payment notice applied from booking email event ${event.id}.`,
    changes: { paymentId: result.payment.id, amount: result.payment.amount, sourceEmailEventId: event.id },
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_CREATED_PAYMENT', 'bookingEmailEvent', event.id, {
    reservationId: reservation.id,
    paymentId: result.payment.id,
    amount: result.payment.amount,
    sourceMessageId: event.sourceMessageId,
  })
  return updated
}

async function approveCancellationEmailEvent(tx, event, details, actor, reservationId, reason) {
  const normalizedReason = normalizeNullableString(reason)
  if (!normalizedReason) throw new PmsValidationError('Cancellation email actions require an operational reason.')
  const reservation = reservationId
    ? await tx.reservation.findFirst({ where: { id: reservationId, propertyId: event.propertyId }, include: reservationInclude })
    : await findReservationForBookingEmailEvent(tx, event, details)
  if (!reservation) throw new PmsValidationError('Link this cancellation to a reservation before applying it.')
  const updatedReservation = await cancelReservationInTransaction(tx, reservation.id, actor, 'CANCELLED', normalizedReason, {
    expectedUpdatedAt: reservation.updatedAt.toISOString(),
    idempotencyKey: `booking-email-cancellation:${event.propertyId}:${event.id}`,
  })
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: updatedReservation.id,
      completedAction: `Cancelled reservation ${updatedReservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
      processedAt: new Date(),
      processedBy: actorName(actor),
    },
    include: bookingEmailEventInclude(),
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_CANCELLED_RESERVATION', 'bookingEmailEvent', event.id, {
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    sourceMessageId: event.sourceMessageId,
    reason: normalizedReason,
  })
  return updated
}

function validateGuestInput(guest) {
  if (!guest?.firstName?.trim() || !guest?.lastName?.trim()) {
    throw new PmsValidationError('Guest first and last name are required.')
  }
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) {
    throw new PmsValidationError('Enter a valid guest email address.')
  }
  return {
    firstName: guest.firstName.trim(),
    lastName: guest.lastName.trim(),
    email: guest.email?.trim() || null,
    phone: guest.phone?.trim() || null,
    nationality: guest.nationality?.trim() || null,
    idType: guest.idType?.trim() || null,
    idNumber: guest.idNumber?.trim() || null,
    vipStatus: Boolean(guest.vipStatus),
    notes: guest.notes?.trim() || null,
  }
}

const RESERVATION_GUEST_UPDATE_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'nationality', 'idType', 'idNumber', 'vipStatus', 'notes', 'expectedGuestUpdatedAt',
])

function validateReservationGuestUpdateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PmsValidationError('Guest update must be an object.')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => !RESERVATION_GUEST_UPDATE_FIELDS.has(key) || CREDENTIAL_FIELD_PATTERN.test(key))) {
    throw new PmsValidationError('Guest update contains unsupported fields.')
  }
  if (!keys.some((key) => key !== 'expectedGuestUpdatedAt')) {
    throw new PmsValidationError('Guest update must include at least one guest field.')
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

function guestUpdateData(current, update) {
  const updatedValue = (field) => Object.prototype.hasOwnProperty.call(update, field) ? update[field] : current[field]
  return validateGuestInput({
    firstName: updatedValue('firstName'),
    lastName: updatedValue('lastName'),
    email: updatedValue('email'),
    phone: updatedValue('phone'),
    nationality: updatedValue('nationality'),
    idType: updatedValue('idType'),
    idNumber: updatedValue('idNumber'),
    vipStatus: updatedValue('vipStatus'),
    notes: updatedValue('notes'),
  })
}

function boardReservationDto(reservation, actor) {
  const canViewGuest = canPerformAction(actor, 'view:guests')
  const canViewReservation = canPerformAction(actor, 'view:reservations')
  const canViewFinance = canPerformAction(actor, 'view:cashier')
    || canPerformAction(actor, 'post:charges')
    || canPerformAction(actor, 'process:payment')
  const guest = reservation.guest ? {
    id: reservation.guest.id,
    firstName: reservation.guest.firstName,
    lastName: reservation.guest.lastName,
    vipStatus: Boolean(reservation.guest.vipStatus),
    updatedAt: reservation.guest.updatedAt,
    ...(canViewGuest ? {
      email: reservation.guest.email,
      phone: reservation.guest.phone,
      nationality: reservation.guest.nationality,
      idType: reservation.guest.idType,
      idNumber: reservation.guest.idNumber,
      notes: reservation.guest.notes,
    } : {}),
  } : null
  const folio = reservation.folio && canViewFinance ? {
    id: reservation.folio.id,
    status: reservation.folio.status,
    total: reservation.folio.total,
    paid: reservation.folio.paid,
    balance: reservation.folio.balance,
    totalSatang: satangToApiString(readMoneySatang(reservation.folio, 'total')),
    paidSatang: satangToApiString(readMoneySatang(reservation.folio, 'paid')),
    balanceSatang: satangToApiString(readMoneySatang(reservation.folio, 'balance')),
  } : null
  return {
    id: reservation.id,
    confirmationCode: reservation.confirmationCode,
    propertyId: reservation.propertyId,
    guestId: reservation.guestId,
    roomTypeId: reservation.roomTypeId,
    assignedRoomId: reservation.assignedRoomId,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    actualCheckIn: reservation.actualCheckIn,
    actualCheckOut: reservation.actualCheckOut,
    status: reservation.status,
    adults: reservation.adults,
    children: reservation.children,
    childAges: reservation.childAges,
    source: reservation.source,
    ...(canViewReservation ? {
      channelRef: reservation.channelRef,
      notes: reservation.notes,
      specialRequests: reservation.specialRequests,
    } : {}),
    updatedAt: reservation.updatedAt,
    guest,
    roomType: reservation.roomType ? {
      id: reservation.roomType.id,
      code: reservation.roomType.code,
      name: reservation.roomType.name,
      standardOcc: reservation.roomType.standardOcc,
      maxOccupancy: reservation.roomType.maxOccupancy,
    } : null,
    assignedRoom: reservation.assignedRoom ? {
      id: reservation.assignedRoom.id,
      number: reservation.assignedRoom.number,
      floor: reservation.assignedRoom.floor,
      currentStatus: reservation.assignedRoom.currentStatus,
      operationalStatus: reservation.assignedRoom.operationalStatus,
    } : null,
    ...(canViewFinance ? {
      ratePerNight: reservation.ratePerNight,
      ratePerNightSatang: satangToApiString(readMoneySatang(reservation, 'ratePerNight')),
      totalAmount: reservation.totalAmount,
      totalAmountSatang: satangToApiString(readMoneySatang(reservation, 'totalAmount')),
      depositAmount: reservation.depositAmount,
      depositAmountSatang: satangToApiString(readMoneySatang(reservation, 'depositAmount')),
      depositPaid: reservation.depositPaid,
      folio,
    } : {}),
  }
}

async function ensureRoomTypeCapacity(tx, propertyId, roomTypeId, checkInKey, checkOutKey, excludeReservationId) {
  const sellableRooms = await tx.room.count({
    where: {
      propertyId,
      roomTypeId,
      operationalStatus: 'AVAILABLE',
    },
  })

  if (sellableRooms < 1) {
    throw new PmsValidationError('No sellable rooms are configured for this room type.')
  }

  for (const dateKey of stayDates(checkInKey, checkOutKey)) {
    const reserved = await tx.reservation.count({
      where: {
        propertyId,
        roomTypeId,
        id: excludeReservationId ? { not: excludeReservationId } : undefined,
        status: { in: activeReservationStatuses() },
        checkIn: { lt: dateFromKey(nextDateKey(dateKey)) },
        checkOut: { gt: dateFromKey(dateKey) },
      },
    })

    if (reserved >= sellableRooms) {
      throw new PmsValidationError(`No ${sellableRooms > 1 ? 'rooms are' : 'room is'} available for ${dateKey}.`)
    }
  }
}

async function validateRoomAssignable(tx, reservation, roomId) {
  const room = await tx.room.findUnique({
    where: { id: roomId },
    include: { roomType: true },
  })

  if (!room) throw new PmsValidationError('Selected room was not found.', 404)
  if (room.propertyId !== reservation.propertyId) throw new PmsValidationError('Selected room was not found.', 404)
  if (!String(room.number || '').trim()) {
    throw new PmsValidationError('Selected room must have a room number before it can be assigned.')
  }
  if (room.operationalStatus === 'BLOCKED') {
    throw new PmsValidationError(`Room ${room.number} is blocked and cannot be assigned.`)
  }
  if (room.operationalStatus === 'OUT_OF_SERVICE') {
    throw new PmsValidationError(`Room ${room.number} is out of service and cannot be assigned.`)
  }
  if (room.operationalStatus === 'OUT_OF_ORDER') {
    throw new PmsValidationError(`Room ${room.number} is out of order and cannot be assigned.`)
  }
  if (room.roomTypeId !== reservation.roomTypeId) {
    throw new PmsValidationError(`Room ${room.number} does not match the reservation room type.`)
  }
  if (['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'].includes(room.currentStatus) && room.currentReservation !== reservation.id) {
    throw new PmsValidationError(`Room ${room.number} is occupied and cannot be assigned.`, 409)
  }

  const overlappingReservation = await tx.reservation.findFirst({
    where: {
      id: { not: reservation.id },
      propertyId: reservation.propertyId,
      assignedRoomId: room.id,
      status: { in: activeReservationStatuses() },
      checkIn: { lt: reservation.checkOut },
      checkOut: { gt: reservation.checkIn },
    },
  })
  if (overlappingReservation) {
    throw new PmsValidationError(`Room ${room.number} already has a reservation for the selected dates.`, 409)
  }

  const inventoryConflict = await tx.roomDateInventory.findFirst({
    where: {
      roomId: room.id,
      propertyId: reservation.propertyId,
      reservationId: { not: reservation.id },
      date: {
        in: stayDates(reservation.checkIn, reservation.checkOut).map(dateFromKey),
      },
      status: { in: ['RESERVED', 'HELD', 'BLOCKED', 'OUT_OF_SERVICE'] },
    },
  })
  if (inventoryConflict) {
    throw new PmsValidationError(`Room ${room.number} is not available on ${getBangkokDateKey(inventoryConflict.date)}.`, 409)
  }

  return room
}

async function reserveRoomDates(tx, propertyId, reservationId, roomId, checkIn, checkOut) {
  await tx.roomDateInventory.deleteMany({
    where: { reservationId },
  })

  for (const dateKey of stayDates(checkIn, checkOut)) {
    await tx.roomDateInventory.create({
      data: {
        propertyId,
        roomId,
        reservationId,
        date: dateFromKey(dateKey),
        status: 'RESERVED',
      },
    })
  }
}

async function recomputeFolio(tx, folioId) {
  const [charges, payments] = await Promise.all([
    tx.charge.findMany({ where: { folioId, void: false } }),
    tx.payment.findMany({ where: { folioId } }),
  ])
  const subtotalSatang = sumMoneySatang(charges, 'total')
  const paidSatang = sumMoneySatang(payments, 'amount')
  const balanceSatang = subtotalSatang - paidSatang

  return tx.folio.update({
    where: { id: folioId },
    data: {
      ...dualWriteMoney('subtotal', 'subtotalSatang', subtotalSatang),
      ...dualWriteMoney('tax', 'taxSatang', 0n),
      ...dualWriteMoney('total', 'totalSatang', subtotalSatang),
      ...dualWriteMoney('paid', 'paidSatang', paidSatang),
      ...dualWriteMoney('balance', 'balanceSatang', balanceSatang),
      status: balanceSatang <= 0n ? 'CLOSED' : 'OPEN',
    },
    include: {
      charges: true,
      payments: true,
      reservation: {
        include: {
          guest: true,
          roomType: true,
          assignedRoom: true,
        },
      },
    },
  })
}

async function recordPaymentInTransaction(tx, folioId, input, actor) {
  const { satang: amountSatang } = requiredMoneyInput(input)
  if (amountSatang <= 0n) {
    throw new PmsValidationError('Payment amount must be greater than zero.')
  }
  const method = normalizePaymentMethod(input.method)
  const reference = normalizeNullableString(input.reference)
  if (paymentMethodRequiresReference(method) && !reference) {
    throw new PmsValidationError('Payment reference is required for card, bank transfer, and online payments.')
  }
  const referenceFingerprint = normalizePaymentReferenceFingerprint(method, reference)
  const idempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey)
  const property = await getProperty(tx, actor)

  if (idempotencyKey) {
    const existingPayment = await tx.payment.findUnique({
      where: { propertyId_idempotencyKey: { propertyId: property.id, idempotencyKey } },
    })
    if (existingPayment) {
      const sameIntent = existingPayment.folioId === folioId
        && readMoneySatang(existingPayment, 'amount') === amountSatang
        && existingPayment.method === method
        && existingPayment.referenceFingerprint === referenceFingerprint
      if (!sameIntent) {
        throw new PmsValidationError('This payment idempotency key was already used for a different payment.', 409)
      }
      const existingFolio = await tx.folio.findUnique({
        where: { id: folioId },
        include: { charges: true, payments: true },
      })
      return { payment: existingPayment, folio: existingFolio, idempotentReplay: true }
    }
  }

  const folio = await tx.folio.findFirst({
    where: { id: folioId, reservation: { propertyId: property.id } },
    include: { reservation: true },
  })
  if (!folio) throw new PmsValidationError('Folio was not found.', 404)
  if (folio.status !== 'OPEN') {
    throw new PmsValidationError('Payments can only be recorded on an open folio.', 409)
  }
  const balanceSatang = readMoneySatang(folio, 'balance')
  if (amountSatang > balanceSatang) {
    throw new PmsValidationError('Payment cannot exceed the remaining balance.')
  }
  if (referenceFingerprint) {
    const duplicateReference = await tx.payment.findUnique({
      where: { propertyId_referenceFingerprint: { propertyId: property.id, referenceFingerprint } },
    })
    if (duplicateReference) {
      throw new PmsValidationError('This payment reference has already been processed.', 409)
    }
  }
  const sourceEmailEventId = normalizeNullableString(input.sourceEmailEventId)
  if (sourceEmailEventId) {
    await validateSourceEmailEventId(tx, property.id, sourceEmailEventId)
    const duplicateSourcePayment = await tx.payment.findUnique({ where: { sourceEmailEventId } })
    if (duplicateSourcePayment) {
      throw new PmsValidationError('This booking email has already created a payment.', 409)
    }
  }

  const payment = await tx.payment.create({
    data: {
      propertyId: property.id,
      folioId: folio.id,
      ...dualWriteMoney('amount', 'amountSatang', amountSatang),
      method,
      reference,
      referenceFingerprint,
      idempotencyKey,
      sourceEmailEventId,
      notes: normalizeNullableString(input.notes),
      processedBy: actorName(actor),
    },
  })
  const updatedFolio = await recomputeFolio(tx, folio.id)
  await createAudit(tx, actor, 'PAYMENT_CREATED', 'payment', payment.id, {
    folioId: folio.id,
    amount: payment.amount,
    amountSatang: satangToApiString(amountSatang),
    method,
    sourceEmailEventId,
    idempotencyKey: idempotencyKey ? createHash('sha256').update(idempotencyKey).digest('hex') : null,
  })
  await emitOperationalEvent(tx, property.id, 'PAYMENT_CREATED', 'payment', payment.id, actor, { folioId: folio.id })
  return { payment, folio: updatedFolio }
}

async function validateSourceEmailEventId(tx, propertyId, value) {
  const sourceEmailEventId = normalizeNullableString(value)
  if (!sourceEmailEventId) return null
  const sourceEmailEvent = await tx.bookingEmailEvent.findFirst({
    where: { id: sourceEmailEventId, propertyId },
    select: { id: true },
  })
  if (!sourceEmailEvent) {
    throw new PmsValidationError('Booking email event was not found for the active property.', 404)
  }
  return sourceEmailEvent.id
}

async function emitOperationalEvent(tx, propertyId, eventType, aggregateType, aggregateId, actor, metadata = undefined) {
  return recordDomainEvent(tx, {
    propertyId,
    eventType,
    aggregateType,
    aggregateId,
    actorUserId: actor?.id,
    metadata,
  })
}

export async function authenticateUser(prisma, identity, password) {
  const normalizedIdentity = String(identity || '').trim().toLowerCase()
  if (!normalizedIdentity) return null
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: normalizedIdentity },
        { email: normalizedIdentity },
      ],
    },
  })
  if (!user?.active) return null
  if (user.lockedAt) {
    throw new PmsValidationError('Account is locked after too many failed login attempts. Ask an admin to reset the password.', 423)
  }

  const { verifyPassword } = await import('./security.mjs')
  if (!verifyPassword(password, user.passwordHash)) {
    const failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1
    const lockedAt = failedLoginAttempts >= LOGIN_FAILURE_LOCK_LIMIT ? new Date() : null
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts,
        ...(lockedAt ? { lockedAt } : {}),
      },
    })
    if (lockedAt) {
      throw new PmsValidationError('Account is locked after too many failed login attempts. Ask an admin to reset the password.', 423)
    }
    return null
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedAt: null },
  })

  return user
}

export async function getSetupStatus(prisma) {
  const [property, userCount] = await Promise.all([
    prisma.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } }),
    prisma.user.count({ where: { active: true } }),
  ])

  return {
    needsSetup: !property || userCount === 0,
    hasProperty: Boolean(property),
    hasUsers: userCount > 0,
    propertyName: property?.name || null,
  }
}

export async function listUsers(prisma) {
  return prisma.user.findMany({
    orderBy: [
      { active: 'desc' },
      { role: 'asc' },
      { username: 'asc' },
    ],
  })
}

export async function createUser(prisma, input, actor) {
  const email = normalizeUserEmail(input?.email)
  const username = normalizeUserUsername(input?.username, email)
  const { firstName, lastName } = normalizeUserNameParts(input)
  const role = normalizeUserRole(input?.role)
  const password = validateUserPassword(input?.password, true)

  const duplicate = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        ...(email ? [{ email }] : []),
      ],
    },
  })
  if (duplicate) {
    throw new PmsValidationError(email && duplicate.email === email ? 'A user with this email already exists.' : 'A user with this username already exists.', 409)
  }

  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash: createPasswordHash(password),
        firstName,
        lastName,
        role,
        active: input?.active === undefined ? true : Boolean(input.active),
      },
    })
    await tx.userPropertyMembership.create({
      data: { userId: user.id, propertyId: property.id, role: user.role, active: user.active },
    })
    await createAudit(tx, actor, 'USER_CREATED', 'user', user.id, {
      username: user.username,
      email: user.email,
      role: user.role,
      active: user.active,
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'USER_CREATED',
      aggregateType: 'user',
      aggregateId: user.id,
      actorUserId: actor?.id,
    })
    return user
  })
}

export async function updateUser(prisma, userId, input, actor) {
  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (!existing) throw new PmsValidationError('User was not found.', 404)

  const data = {}
  if (input?.email !== undefined) data.email = normalizeUserEmail(input.email)
  if (input?.username !== undefined) data.username = normalizeUserUsername(input.username, data.email ?? existing.email)
  if (input?.displayName !== undefined || input?.name !== undefined) {
    Object.assign(data, normalizeUserNameParts({ displayName: input?.displayName || input?.name }))
  } else if (input?.firstName !== undefined || input?.lastName !== undefined) {
    Object.assign(data, normalizeUserNameParts({
      firstName: input?.firstName ?? existing.firstName,
      lastName: input?.lastName ?? existing.lastName,
    }))
  }
  if (input?.role !== undefined) data.role = normalizeUserRole(input.role)
  if (input?.active !== undefined) data.active = Boolean(input.active)
  const password = validateUserPassword(input?.password, false)
  if (password) {
    data.passwordHash = createPasswordHash(password)
    data.failedLoginAttempts = 0
    data.lockedAt = null
  }

  const nextUsername = data.username ?? existing.username
  const nextEmail = data.email === undefined ? existing.email : data.email
  const duplicate = await prisma.user.findFirst({
    where: {
      id: { not: existing.id },
      OR: [
        { username: nextUsername },
        ...(nextEmail ? [{ email: nextEmail }] : []),
      ],
    },
  })
  if (duplicate) {
    throw new PmsValidationError(nextEmail && duplicate.email === nextEmail ? 'A user with this email already exists.' : 'A user with this username already exists.', 409)
  }

  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const user = await tx.user.update({ where: { id: existing.id }, data })
    await tx.userPropertyMembership.upsert({
      where: { userId_propertyId: { userId: user.id, propertyId: property.id } },
      create: { userId: user.id, propertyId: property.id, role: user.role, active: user.active },
      update: { role: user.role, active: user.active },
    })
    await createAudit(tx, actor, 'USER_UPDATED', 'user', user.id, {
      username: user.username,
      email: user.email,
      role: user.role,
      active: user.active,
      passwordChanged: Boolean(password),
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'USER_UPDATED',
      aggregateType: 'user',
      aggregateId: user.id,
      actorUserId: actor?.id,
    })
    return user
  })
}

export async function deactivateUser(prisma, userId, actor) {
  if (actor?.id === userId) {
    throw new PmsValidationError('You cannot deactivate your own account.', 409)
  }
  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (!existing) throw new PmsValidationError('User was not found.', 404)
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const user = await tx.user.update({ where: { id: existing.id }, data: { active: false } })
    await tx.userPropertyMembership.updateMany({
      where: { userId: user.id, propertyId: property.id },
      data: { active: false },
    })
    await createAudit(tx, actor, 'USER_DEACTIVATED', 'user', user.id, {
      username: user.username,
      email: user.email,
      role: user.role,
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'USER_DEACTIVATED',
      aggregateType: 'user',
      aggregateId: user.id,
      actorUserId: actor?.id,
    })
    return user
  })
}

export async function completeInitialSetup(prisma, input) {
  const status = await getSetupStatus(prisma)

  if (status.hasUsers) {
    throw new PmsValidationError('Initial setup has already been completed.', 409)
  }

  const operationalRecords = await Promise.all([
    prisma.reservation.count(),
    prisma.guest.count(),
    prisma.folio.count(),
    prisma.payment.count(),
    prisma.charge.count(),
  ])

  if (operationalRecords.some((count) => count > 0)) {
    throw new PmsValidationError('Initial setup cannot run while operational records already exist.', 409)
  }

  const setup = validateSetupPayload(input)

  return prisma.$transaction(async (tx) => {
    const property = await tx.property.upsert({
      where: { code: SANDBOX_RULES.propertyCode },
      update: setup.property,
      create: setup.property,
    })

    await tx.room.deleteMany({ where: { propertyId: property.id } })
    await tx.roomType.deleteMany({ where: { propertyId: property.id } })

    const usedCodes = new Set()
    const createdRoomTypes = new Map()

    for (const [index, roomType] of setup.roomTypes.entries()) {
      const rate = setup.rates.get(roomType.id)
      const createdRoomType = await tx.roomType.create({
        data: {
          propertyId: property.id,
          code: setupRoomTypeCode(roomType, index, usedCodes),
          name: setupString(roomType.name, 'Room type name'),
          description: null,
          ...moneyDataFromBaht('baseRate', 'baseRateSatang', setupNumber(rate?.baseRate, `Base rate for ${roomType.name}`, { min: 1 })),
          maxOccupancy: setupNumber(roomType.maxOccupancy, 'Max occupancy', { min: 1 }),
          standardOcc: setupNumber(roomType.baseOccupancy, 'Base occupancy', { min: 1 }),
        },
      })
      createdRoomTypes.set(roomType.id, createdRoomType)
    }

    for (const room of setup.rooms) {
      const roomType = createdRoomTypes.get(room.roomTypeId)
      if (!roomType) throw new PmsValidationError(`Room ${room.number} has an invalid room type.`)

      await tx.room.create({
        data: {
          propertyId: property.id,
          roomTypeId: roomType.id,
          number: setupString(room.number, 'Room number'),
          floor: setupFloorForRoomNumber(room.number),
          operationalStatus: room.status === 'out-of-service' ? 'OUT_OF_SERVICE' : 'AVAILABLE',
          currentStatus: 'VACANT_CLEAN',
          notes: setupString(room.notes, 'Room notes', false),
        },
      })
    }

    const nameParts = setup.adminUser.name.split(/\s+/)
    const firstName = nameParts.shift() || 'Admin'
    const lastName = nameParts.join(' ') || 'User'
    const admin = await tx.user.create({
      data: {
        email: setup.adminUser.email,
        username: setup.adminUser.email,
        passwordHash: createPasswordHash(setup.adminUser.password),
        firstName,
        lastName,
        role: 'ADMIN',
        active: true,
      },
    })

    await tx.userPropertyMembership.create({
      data: { userId: admin.id, propertyId: property.id, role: 'ADMIN', active: true },
    })

    await createAudit(tx, admin, 'INITIAL_SETUP_COMPLETED', 'property', property.id, {
      propertyName: property.name,
      roomTypes: setup.roomTypes.length,
      rooms: setup.rooms.length,
    })
    await recordDomainEvent(tx, {
      propertyId: property.id,
      eventType: 'INITIAL_SETUP_COMPLETED',
      aggregateType: 'property',
      aggregateId: property.id,
      actorUserId: admin.id,
    })

    return { property, admin }
  })
}

export async function getAuthenticatedUser(prisma, session) {
  return getUserBySession(prisma, session)
}

export async function listReservations(prisma, actor) {
  const property = await getProperty(prisma, actor)
  return prisma.reservation.findMany({
    where: { propertyId: property.id },
    include: reservationInclude,
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
  })
}

function cashierSatangString(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new PmsValidationError(`Cashier data is missing exact satang for ${label}.`, 503)
  }
  try {
    return satangToApiString(parseSatang(value, label))
  } catch {
    throw new PmsValidationError(`Cashier data has invalid exact satang for ${label}.`, 503)
  }
}

function cashierGuestName(guest) {
  const value = [guest?.firstName, guest?.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
  return value || 'Guest'
}

function cashierFolioProjection(folio) {
  return {
    id: folio.id,
    reservationId: folio.reservationId,
    guestName: cashierGuestName(folio.reservation?.guest),
    roomNumber: String(folio.reservation?.assignedRoom?.number || 'Unassigned'),
    checkIn: folio.reservation?.checkIn,
    checkOut: folio.reservation?.checkOut || null,
    status: folio.status,
    charges: folio.charges.map((charge) => ({
      id: charge.id,
      postedAt: charge.createdAt,
      category: charge.category,
      description: charge.description,
      quantity: charge.quantity,
      unitPriceSatang: cashierSatangString(charge.amountSatang, `charge ${charge.id} unit price`),
      totalSatang: cashierSatangString(charge.totalSatang, `charge ${charge.id} total`),
      postedBy: charge.createdBy,
    })),
    payments: folio.payments.map((payment) => ({
      id: payment.id,
      postedAt: payment.createdAt,
      method: payment.method,
      amountSatang: cashierSatangString(payment.amountSatang, `payment ${payment.id} amount`),
      reference: payment.reference || null,
      receivedBy: payment.processedBy,
    })),
    subtotalSatang: cashierSatangString(folio.subtotalSatang, `folio ${folio.id} subtotal`),
    taxSatang: cashierSatangString(folio.taxSatang, `folio ${folio.id} tax`),
    totalSatang: cashierSatangString(folio.totalSatang, `folio ${folio.id} total`),
    paidSatang: cashierSatangString(folio.paidSatang, `folio ${folio.id} paid`),
    balanceSatang: cashierSatangString(folio.balanceSatang, `folio ${folio.id} balance`),
    createdAt: folio.createdAt,
    updatedAt: folio.updatedAt,
  }
}

// This intentionally has its own allowlisted projection. Do not substitute the
// broader reservation include here: it carries booking-email relations and guest
// contact data that a Cashier workspace never needs.
export async function listCashierFolios(prisma, actor) {
  const property = await getProperty(prisma, actor)
  const folios = await prisma.folio.findMany({
    where: { reservation: { propertyId: property.id } },
    select: {
      id: true,
      reservationId: true,
      status: true,
      subtotalSatang: true,
      taxSatang: true,
      totalSatang: true,
      paidSatang: true,
      balanceSatang: true,
      createdAt: true,
      updatedAt: true,
      reservation: {
        select: {
          checkIn: true,
          checkOut: true,
          guest: { select: { firstName: true, lastName: true } },
          assignedRoom: { select: { number: true } },
        },
      },
      charges: {
        where: { void: false },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          createdAt: true,
          category: true,
          description: true,
          quantity: true,
          amountSatang: true,
          totalSatang: true,
          createdBy: true,
        },
      },
      payments: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          createdAt: true,
          method: true,
          amountSatang: true,
          reference: true,
          processedBy: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  })

  return {
    property: {
      id: property.id,
      name: property.name,
      currency: property.currency,
    },
    folios: folios.map(cashierFolioProjection),
  }
}

export async function updateReservation(prisma, reservationId, input, actor, options = {}) {
  const validatedUpdate = validateReservationUpdateInput(input)
  const expectedUpdatedAt = normalizeExpectedReservationUpdatedAt(validatedUpdate.expectedUpdatedAt)
  const update = { ...validatedUpdate }
  delete update.expectedUpdatedAt
  const idempotencyKey = normalizeReservationMutationIdempotencyKey(options?.idempotencyKey)
  return reservationMutationTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    const current = await tx.reservation.findFirst({
      where: { id: reservationId, propertyId: property.id },
      include: reservationInclude,
    })
    if (!current) throw new PmsValidationError('Reservation was not found.', 404)
    const proposedCheckIn = update.checkIn ?? current.checkIn
    const proposedCheckOut = update.checkOut ?? current.checkOut
    const proposedStay = validateStayInput({ checkIn: proposedCheckIn, checkOut: proposedCheckOut })
    await acquireReservationMutationLocks(tx, [
      ...reservationRoomDateLockKeys(property.id, current.id, current.assignedRoomId, current.checkIn, current.checkOut),
      ...reservationRoomDateLockKeys(property.id, current.id, current.assignedRoomId, proposedStay.checkInKey, proposedStay.checkOutKey),
    ])
    const mutationAttempt = await claimReservationMutationAttempt(tx, {
      propertyId: property.id,
      reservationId: current.id,
      operation: 'UPDATE_RESERVATION',
      idempotencyKey,
      intent: {
        update,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() || null,
      },
    })
    if (mutationAttempt.replay) return replayReservationMutation(mutationAttempt.attempt, current)
    if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new PmsValidationError('This reservation changed after the booking board loaded it. Refresh before applying new stay dates.', 409)
    }
    if (['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(current.status)) {
      throw new PmsValidationError('Completed or cancelled reservations cannot be edited.')
    }

    let roomTypeId = current.roomTypeId
    let pricingRoomType = current.roomType
    if (update.roomTypeCode || update.roomType) {
      const roomType = await tx.roomType.findFirst({
        where: {
          propertyId: property.id,
          code: update.roomTypeCode || update.roomType,
        },
      })
      if (!roomType) throw new PmsValidationError('Selected room type was not found.')
      roomTypeId = roomType.id
      pricingRoomType = roomType
    }

    const checkIn = update.checkIn ?? current.checkIn
    const checkOut = update.checkOut ?? current.checkOut
    const ratePerNight = update.ratePerNight ?? current.ratePerNight
    const adults = update.adults ?? current.adults
    const children = update.children ?? current.children
    const childAges = update.childAges ?? current.childAges
    const { checkInKey, checkOutKey } = proposedStay
    const pricing = calculateStayPricing({
      checkIn,
      checkOut,
      ratePerNight,
      adults,
      childAges,
      ...pricingRulesFor(property, pricingRoomType),
    })

    await ensureRoomTypeCapacity(tx, property.id, roomTypeId, checkInKey, checkOutKey, current.id)

    let assignedRoomId = current.assignedRoomId
    if (assignedRoomId) {
      const assignedRoom = await tx.room.findFirst({ where: { id: assignedRoomId, propertyId: property.id } })
      if (!assignedRoom || assignedRoom.roomTypeId !== roomTypeId) {
        assignedRoomId = null
      } else {
        const candidate = { ...current, roomTypeId, checkIn: dateFromKey(checkInKey), checkOut: dateFromKey(checkOutKey) }
        await validateRoomAssignable(tx, candidate, assignedRoomId)
      }
    }

    const sourceEmailEventId = update.sourceEmailEventId === undefined
      ? current.sourceEmailEventId
      : await validateSourceEmailEventId(tx, property.id, update.sourceEmailEventId)
    await tx.reservation.update({
      where: { id: current.id },
      data: {
        roomTypeId,
        assignedRoomId,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        adults: Number(adults),
        children: Number(children || 0),
        childAges: Array.isArray(childAges) ? childAges.map(Number) : [],
        ...moneyDataFromBaht('ratePerNight', 'ratePerNightSatang', Number(ratePerNight)),
        ...moneyDataFromBaht('totalAmount', 'totalAmountSatang', pricing.total),
        ...moneyDataFromBaht('depositAmount', 'depositAmountSatang', roundMoney(pricing.total * 0.3)),
        source: update.source || current.source,
        channelRef: update.channelRef ?? current.channelRef,
        sourceEmailEventId,
        notes: update.notes ?? current.notes,
        specialRequests: update.specialRequests ?? current.specialRequests,
      },
      include: reservationInclude,
    })

    if (assignedRoomId) {
      await reserveRoomDates(tx, property.id, current.id, assignedRoomId, checkInKey, checkOutKey)
    } else {
      await tx.roomDateInventory.deleteMany({ where: { reservationId: current.id } })
    }

    if (current.folio) {
      const roomCharge = await tx.charge.findFirst({
        where: { folioId: current.folio.id, category: 'ROOM', void: false },
        orderBy: { createdAt: 'asc' },
      })
      if (roomCharge) {
        await tx.charge.update({
          where: { id: roomCharge.id },
          data: {
            date: dateFromKey(checkInKey),
            ...moneyDataFromBaht('amount', 'amountSatang', Number(ratePerNight)),
            quantity: pricing.nights,
            ...moneyDataFromBaht('total', 'totalSatang', pricing.total),
          },
        })
      }
      await recomputeFolio(tx, current.folio.id)
    }

    await createReservationLog(tx, current.id, 'MODIFIED', actor, { changes: update })
    await createAudit(tx, actor, 'MODIFIED', 'reservation', current.id, update)
    await emitOperationalEvent(tx, current.propertyId, 'RESERVATION_UPDATED', 'reservation', current.id, actor)
    const result = await tx.reservation.findUnique({
      where: { id: current.id },
      include: reservationInclude,
    })
    await completeReservationMutationAttempt(tx, mutationAttempt.attempt, result)
    return result
  })
}

export async function listRooms(prisma, actor) {
  const property = await getProperty(prisma, actor)
  return prisma.room.findMany({
    where: { propertyId: property.id },
    include: { roomType: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  })
}

function normalizeSetupRoomTypeCode(input) {
  const normalized = String(input?.code || input?.name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) throw new PmsValidationError('Room type code is required.')
  return normalized.slice(0, 16)
}

function normalizeSetupRoomTypeInput(input, existing = undefined) {
  const name = setupString(input?.name, 'Room type name')
  const standardOcc = setupNumber(input?.baseOccupancy ?? input?.standardOcc ?? existing?.standardOcc, 'Base occupancy', { min: 1 })
  const maxOccupancy = setupNumber(input?.maxOccupancy ?? existing?.maxOccupancy, 'Max occupancy', { min: standardOcc })
  const baseRate = setupNumber(input?.baseRate ?? existing?.baseRate, 'Base rate', { min: 1 })
  const canonicalBaseRate = canonicalizeRoomTypeBaseRate(input, baseRate)
  const effectiveBaseRate = canonicalBaseRate.baseRate

  if (canonicalBaseRate.canonicalRate && canonicalBaseRate.baseRate !== baseRate) {
    if (!canonicalBaseRate.changed) {
      const label = canonicalBaseRate.roomCode || setupString(input?.name, 'Room type name')
      throw new PmsValidationError(`Base rate for ${label} must be ${canonicalBaseRate.canonicalRate} THB.`)
    }
  }

  return {
    code: normalizeSetupRoomTypeCode(input),
    name,
    description: setupString(input?.description ?? existing?.description, 'Room type description', false),
    ...moneyDataFromBaht('baseRate', 'baseRateSatang', effectiveBaseRate),
    maxOccupancy,
    standardOcc,
  }
}

function normalizeSetupRoomInput(input) {
  const number = setupString(input?.number, 'Room number')
  if (!/^[A-Za-z0-9-]+$/.test(number)) {
    throw new PmsValidationError('Room number may only contain letters, numbers, and hyphens.')
  }

  const floor = setupNumber(input?.floor ?? setupFloorForRoomNumber(number), 'Floor')
  if (!Number.isInteger(floor)) throw new PmsValidationError('Floor must be an integer.')

  const status = String(input?.status || '').trim()
  const operationalStatus = input?.operationalStatus
    ? String(input.operationalStatus).trim().toUpperCase()
    : status === 'out-of-service'
      ? 'OUT_OF_SERVICE'
      : 'AVAILABLE'

  if (!['AVAILABLE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER', 'BLOCKED'].includes(operationalStatus)) {
    throw new PmsValidationError('Room operational status is invalid.')
  }

  return {
    number,
    floor,
    operationalStatus,
    notes: setupString(input?.notes, 'Room notes', false),
  }
}

export async function getRoomSetup(prisma, actor) {
  const property = await getProperty(prisma, actor)
  const [roomTypes, rooms] = await Promise.all([
    prisma.roomType.findMany({
      where: { propertyId: property.id },
      orderBy: [{ code: 'asc' }],
    }),
    prisma.room.findMany({
      where: { propertyId: property.id },
      include: { roomType: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
  ])

  return {
    propertyId: property.id,
    roomTypes: roomTypes.map((roomType) => ({
      ...roomType,
      extraGuestFee: property.extraGuestFee,
      childFee: property.childFee,
    })),
    rooms,
  }
}

export async function createRoomType(prisma, input, actor) {
  const property = await getProperty(prisma, actor)
  const data = normalizeSetupRoomTypeInput(input)

  return prisma.$transaction(async (tx) => {
    const roomType = await tx.roomType.create({
      data: {
        propertyId: property.id,
        ...data,
      },
    })
    await createAudit(tx, actor, 'ROOM_TYPE_CREATED', 'roomType', roomType.id, data)
    return roomType
  })
}

export async function updateRoomType(prisma, roomTypeId, input, actor) {
  const property = await getProperty(prisma, actor)
  const existing = await prisma.roomType.findFirst({
    where: {
      id: roomTypeId,
      propertyId: property.id,
    },
  })
  if (!existing) throw new PmsValidationError('Room type was not found.', 404)
  const data = normalizeSetupRoomTypeInput(input, existing)

  return prisma.$transaction(async (tx) => {
    const roomType = await tx.roomType.update({
      where: { id: existing.id },
      data,
    })
    await createAudit(tx, actor, 'ROOM_TYPE_UPDATED', 'roomType', roomType.id, data)
    return roomType
  })
}

export async function deleteRoomType(prisma, roomTypeId, actor) {
  const property = await getProperty(prisma, actor)
  const existing = await prisma.roomType.findFirst({
    where: {
      id: roomTypeId,
      propertyId: property.id,
    },
  })
  if (!existing) throw new PmsValidationError('Room type was not found.', 404)

  const [roomCount, reservationCount] = await Promise.all([
    prisma.room.count({ where: { roomTypeId } }),
    prisma.reservation.count({ where: { roomTypeId } }),
  ])
  if (roomCount > 0 || reservationCount > 0) {
    throw new PmsValidationError('Room type cannot be deleted while rooms or reservations use it.')
  }

  return prisma.$transaction(async (tx) => {
    await tx.roomType.delete({ where: { id: roomTypeId } })
    await createAudit(tx, actor, 'ROOM_TYPE_DELETED', 'roomType', roomTypeId, { code: existing.code, name: existing.name })
    return existing
  })
}

export async function createSetupRoom(prisma, input, actor) {
  const property = await getProperty(prisma, actor)
  const data = normalizeSetupRoomInput(input)
  const roomTypeId = setupString(input?.roomTypeId, 'Room type')
  const roomType = await prisma.roomType.findFirst({
    where: {
      id: roomTypeId,
      propertyId: property.id,
    },
  })
  if (!roomType) throw new PmsValidationError('Room type was not found.', 404)

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        propertyId: property.id,
        roomTypeId,
        currentStatus: 'VACANT_CLEAN',
        ...data,
      },
      include: { roomType: true },
    })
    await createAudit(tx, actor, 'ROOM_CREATED', 'room', room.id, data)
    return room
  })
}

export async function updateSetupRoom(prisma, roomId, input, actor) {
  const property = await getProperty(prisma, actor)
  const existing = await prisma.room.findFirst({
    where: {
      id: roomId,
      propertyId: property.id,
    },
    include: {
      assignedReservations: true,
    },
  })
  if (!existing) throw new PmsValidationError('Room was not found.', 404)

  const data = normalizeSetupRoomInput(input)
  const roomTypeId = setupString(input?.roomTypeId ?? existing.roomTypeId, 'Room type')
  const roomType = await prisma.roomType.findFirst({
    where: {
      id: roomTypeId,
      propertyId: property.id,
    },
  })
  if (!roomType) throw new PmsValidationError('Room type was not found.', 404)

  const changingAssignmentSensitiveFields = data.number !== existing.number ||
    roomTypeId !== existing.roomTypeId ||
    data.operationalStatus !== existing.operationalStatus
  if (changingAssignmentSensitiveFields && (existing.currentReservation || existing.assignedReservations.length > 0)) {
    throw new PmsValidationError('Room number, type, or operational status cannot be changed while the room has current or historical assignments.')
  }

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.update({
      where: { id: existing.id },
      data: {
        ...data,
        roomTypeId,
      },
      include: { roomType: true },
    })
    await createAudit(tx, actor, 'ROOM_UPDATED', 'room', room.id, { ...data, roomTypeId })
    return room
  })
}

export async function deleteSetupRoom(prisma, roomId, actor) {
  const property = await getProperty(prisma, actor)
  const existing = await prisma.room.findFirst({
    where: {
      id: roomId,
      propertyId: property.id,
    },
    include: {
      assignedReservations: true,
      inventory: true,
    },
  })
  if (!existing) throw new PmsValidationError('Room was not found.', 404)
  if (existing.currentReservation || existing.assignedReservations.length > 0 || existing.inventory.length > 0) {
    throw new PmsValidationError('Room cannot be deleted while reservations or inventory records reference it.')
  }

  return prisma.$transaction(async (tx) => {
    await tx.room.delete({ where: { id: roomId } })
    await createAudit(tx, actor, 'ROOM_DELETED', 'room', roomId, { number: existing.number })
    return existing
  })
}

export async function listGuests(prisma, actor) {
  const property = await getProperty(prisma, actor)
  return prisma.guest.findMany({
    where: { propertyId: property.id },
    include: {
      reservations: {
        include: {
          roomType: true,
          assignedRoom: true,
          folio: true,
        },
        orderBy: [{ checkIn: 'desc' }],
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  })
}

async function createReservationInTransaction(tx, input, actor, options = {}) {
    const property = await getProperty(tx, actor)
    const idempotencyKey = options.requireIdempotency || options.idempotencyKey
      ? requireCreateIdempotencyKey(options.idempotencyKey)
      : null
    const createAttempt = idempotencyKey
      ? await claimPmsCreateAttempt(tx, {
        propertyId: property.id,
        idempotencyKey,
        operation: 'CREATE_RESERVATION',
        intent: input,
      })
      : null
    if (createAttempt?.replay) {
      const existing = createAttempt.attempt.entityId
        ? await tx.reservation.findFirst({
          where: { id: createAttempt.attempt.entityId, propertyId: property.id },
          include: reservationInclude,
        })
        : null
      return assertPmsCreateReplay(createAttempt.attempt, {
        entityType: 'reservation',
        entityId: existing?.id,
        result: existing,
      })
    }
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const sourceEmailEventId = await validateSourceEmailEventId(tx, property.id, input.sourceEmailEventId)

    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')
    const pricing = calculateStayPricing({
      ...input,
      ...pricingRulesFor(property, roomType),
    })

    await ensureRoomTypeCapacity(tx, property.id, roomType.id, checkInKey, checkOutKey)

    const guestData = validateGuestInput(input.guest)
    const guest = await tx.guest.create({ data: { ...guestData, propertyId: property.id } })

    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: input.confirmationCode || `SBX-${Date.now()}`,
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        status: input.status || 'CONFIRMED',
        adults: Number(input.adults),
        children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [],
        ...moneyDataFromBaht('ratePerNight', 'ratePerNightSatang', Number(input.ratePerNight)),
        ...moneyDataFromBaht('totalAmount', 'totalAmountSatang', pricing.total),
        ...moneyDataFromBaht('depositAmount', 'depositAmountSatang', roundMoney(pricing.total * 0.3)),
        depositPaid: false,
        source: input.source || 'DIRECT',
        channelRef: input.channelRef || null,
        sourceEmailEventId,
        notes: input.notes || null,
        specialRequests: input.specialRequests || null,
      },
      include: reservationInclude,
    })

    let assignedReservation = reservation
    if (input.assignedRoomId) {
      const room = await validateRoomAssignable(tx, reservation, input.assignedRoomId)
      await reserveRoomDates(tx, property.id, reservation.id, room.id, checkInKey, checkOutKey)
      assignedReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: { assignedRoomId: room.id },
        include: reservationInclude,
      })
      await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    }

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        ...moneyDataFromBaht('subtotal', 'subtotalSatang', pricing.total),
        ...moneyDataFromBaht('tax', 'taxSatang', 0),
        ...moneyDataFromBaht('total', 'totalSatang', pricing.total),
        ...moneyDataFromBaht('paid', 'paidSatang', 0),
        ...moneyDataFromBaht('balance', 'balanceSatang', pricing.total),
      },
    })

    const roomChargeIdempotencyKey = `reservation-room-charge:${property.id}:${reservation.id}`
    const roomChargeDescription = `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`
    await tx.charge.create({
      data: {
        propertyId: property.id,
        folioId: folio.id,
        idempotencyKey: roomChargeIdempotencyKey,
        intentFingerprint: chargeIntentFingerprint({
          folioId: folio.id,
          dateKey: checkInKey,
          description: roomChargeDescription,
          category: 'ROOM',
          amountSatang: bahtToSatang(Number(input.ratePerNight)),
          quantity: pricing.nights,
        }),
        date: dateFromKey(checkInKey),
        description: roomChargeDescription,
        category: 'ROOM',
        ...moneyDataFromBaht('amount', 'amountSatang', Number(input.ratePerNight)),
        quantity: pricing.nights,
        ...moneyDataFromBaht('total', 'totalSatang', pricing.total),
        createdBy: actorName(actor),
      },
    })

    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: assignedReservation.status })
    await createAudit(tx, actor, 'CREATED', 'reservation', reservation.id, { confirmationCode: reservation.confirmationCode })
    await emitOperationalEvent(tx, property.id, 'RESERVATION_CREATED', 'reservation', reservation.id, actor)

    const created = await tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
    if (createAttempt) {
      await completePmsCreateAttempt(tx, createAttempt.attempt, {
        entityType: 'reservation',
        entityId: reservation.id,
        result: created,
      })
    }
    return created
}

export async function createReservation(prisma, input, actor, options = {}) {
  return serializableTransaction(prisma, async (tx) => createReservationInTransaction(tx, input, actor, options))
}

export async function listBookingEmailSources(prisma, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    await ensurePrimaryBookingEmailSource(tx, actor)
    const sources = await tx.bookingEmailSource.findMany({
      where: { propertyId: property.id },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    })
    return sources.map(bookingEmailSourceResponse)
  })
}

function assertBookingEmailAutonomyConfiguration(actor, input, existing = null) {
  const nextAutoProcess = input.autoProcessSafeEvents === undefined
    ? Boolean(existing?.autoProcessSafeEvents)
    : Boolean(input.autoProcessSafeEvents)
  const changesAutonomy = input.autoProcessSafeEvents !== undefined
    || (nextAutoProcess && input.reviewThreshold !== undefined)
  if (changesAutonomy && !['ADMIN', 'MANAGER'].includes(String(actor?.role || '').toUpperCase())) {
    throw new PmsValidationError('Manager or administrator authority is required to change booking-email automation.', 403)
  }
}

export async function createBookingEmailSource(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    assertBookingEmailAutonomyConfiguration(actor, input)
    const property = await getProperty(tx, actor)
    const mailbox = String(input.mailbox || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) {
      throw new PmsValidationError('Booking email source mailbox must be a valid email address.')
    }
    const reviewThreshold = input.reviewThreshold === undefined
      ? BOOKING_EMAIL_DEFAULT_REVIEW_THRESHOLD
      : Number(input.reviewThreshold)
    if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) {
      throw new PmsValidationError('Review threshold must be between 0 and 1.')
    }
    const source = await tx.bookingEmailSource.upsert({
      where: {
        propertyId_mailbox: {
          propertyId: property.id,
          mailbox,
        },
      },
      update: {
        name: normalizeNullableString(input.name) || mailbox,
        provider: normalizeBookingEmailProvider(input.provider),
        enabled: input.enabled !== false,
        autoProcessSafeEvents: Boolean(input.autoProcessSafeEvents),
        reviewThreshold,
        query: normalizeNullableString(input.query),
      },
      create: {
        propertyId: property.id,
        name: normalizeNullableString(input.name) || mailbox,
        provider: normalizeBookingEmailProvider(input.provider),
        mailbox,
        enabled: input.enabled !== false,
        autoProcessSafeEvents: Boolean(input.autoProcessSafeEvents),
        reviewThreshold,
        query: normalizeNullableString(input.query),
      },
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_SOURCE_SAVED', 'bookingEmailSource', source.id, { mailbox: source.mailbox, provider: source.provider })
    return bookingEmailSourceResponse(source)
  })
}

export async function updateBookingEmailSource(prisma, sourceId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const existing = await tx.bookingEmailSource.findFirst({ where: { id: sourceId, propertyId: property.id } })
    if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
    assertBookingEmailAutonomyConfiguration(actor, input, existing)
    const reviewThreshold = input.reviewThreshold === undefined ? existing.reviewThreshold : Number(input.reviewThreshold)
    if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) {
      throw new PmsValidationError('Review threshold must be between 0 and 1.')
    }
    const source = await tx.bookingEmailSource.update({
      where: { id: sourceId },
      data: {
        name: input.name === undefined ? existing.name : normalizeNullableString(input.name) || existing.name,
        provider: input.provider === undefined ? existing.provider : normalizeBookingEmailProvider(input.provider),
        enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
        autoProcessSafeEvents: input.autoProcessSafeEvents === undefined ? existing.autoProcessSafeEvents : Boolean(input.autoProcessSafeEvents),
        reviewThreshold,
        query: input.query === undefined ? existing.query : normalizeNullableString(input.query),
      },
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_SOURCE_UPDATED', 'bookingEmailSource', source.id, { changes: input })
    return bookingEmailSourceResponse(source)
  })
}

export async function getBookingEmailStatus(prisma, actor) {
  const status = await prisma.$transaction(async (tx) => {
    await ensurePrimaryBookingEmailSource(tx, actor)
    const property = await getProperty(tx, actor)
    const sources = await tx.bookingEmailSource.findMany({
      where: { propertyId: property.id },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    })
    const today = dateFromKey(getBangkokDateKey(new Date()))
    const [needsReview, processedToday, errors, ignored] = await Promise.all([
      tx.bookingEmailEvent.count({ where: { propertyId: property.id, status: 'NEEDS_REVIEW' } }),
      tx.bookingEmailEvent.count({ where: { propertyId: property.id, status: 'PROCESSED', processedAt: { gte: today } } }),
      tx.bookingEmailEvent.count({ where: { propertyId: property.id, status: 'ERROR' } }),
      tx.bookingEmailEvent.count({ where: { propertyId: property.id, status: 'IGNORED' } }),
    ])
    const enabledSources = sources.filter((source) => source.enabled)
    const gmailEnabled = enabledSources.some((source) => source.provider === 'GMAIL')
    const gmailCredentials = bookingEmailGmailCredentialStatus()
    const automation = bookingEmailAutomationPolicy()
    const configured = enabledSources.length > 0 && (!gmailEnabled || gmailCredentials.configured)
    const lastSyncAt = sources.map((source) => source.lastSyncAt).filter(Boolean).sort((a, b) => b - a)[0]
    return {
      configured,
      credentialMode: gmailEnabled ? gmailCredentials.mode : 'not-required',
      credentialStatus: gmailEnabled
        ? {
            gmailOauthClientConfigured: gmailCredentials.oauthClientConfigured,
            refreshTokenConfigured: gmailCredentials.refreshTokenConfigured,
            accessTokenConfigured: gmailCredentials.hasAccessToken,
            targetMailboxConfigured: gmailCredentials.targetMailboxConfigured,
            targetMailbox: gmailCredentials.targetMailbox,
            userId: gmailCredentials.userId,
            scopes: gmailCredentials.scopes,
            missing: gmailCredentials.missing,
            remediation: gmailCredentials.remediation,
            connectionTest: {
              checked: false,
              status: gmailCredentials.configured ? 'not_tested' : 'not_configured',
              message: gmailCredentials.configured ? 'Gmail API connection test was not run yet.' : gmailCredentials.remediation,
            },
          }
        : {
            gmailOauthClientConfigured: false,
            refreshTokenConfigured: false,
            accessTokenConfigured: false,
            targetMailboxConfigured: false,
            targetMailbox: primaryBookingMailbox(),
            userId: 'not-required',
            scopes: [],
            missing: [],
            connectionTest: {
              checked: false,
              status: 'not_required',
              message: 'No enabled Gmail booking-email source requires OAuth credentials.',
            },
          },
      lastSyncAt: isoOrUndefined(lastSyncAt),
      needsReview,
      processedToday,
      errors,
      ignored,
      automation: {
        version: automation.version,
        requested: automation.requested,
        configured: automation.configured,
        operationalMutationsEnabled: automation.operationalMutationsEnabled,
        autoAssignRooms: automation.autoAssignRooms,
        notifyManager: automation.notifyManager,
        requireAuthenticationResults: automation.requireAuthenticationResults,
        requireCorroboration: automation.requireCorroboration,
        minimumConfidence: automation.minimumConfidence,
        trustedSenderDomainCount: automation.trustedSenderDomains.length,
        missing: automation.missing,
      },
      sources: sources.map(bookingEmailSourceResponse),
      message: configured
        ? undefined
        : `Primary booking mailbox ${primaryBookingMailbox()} is registered, but Gmail API OAuth credentials are not configured on the server. ${gmailCredentials.remediation || ''}`.trim(),
    }
  })
  if (status.credentialMode === 'access_token' || status.credentialMode === 'refresh_token') {
    status.credentialStatus.connectionTest = await testBookingEmailGmailConnection()
  }
  return status
}

export async function listBookingEmailEvents(prisma, filters = {}, actor) {
  return prisma.$transaction(async (tx) => {
    await ensurePrimaryBookingEmailSource(tx, actor)
    const property = await getProperty(tx, actor)
    const status = filters.status ? normalizeBookingEmailStatus(filters.status) : undefined
    const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 250)
    const events = await tx.bookingEmailEvent.findMany({
      where: {
        propertyId: property.id,
        status,
        sourceId: normalizeNullableString(filters.sourceId) || undefined,
      },
      include: bookingEmailEventInclude(),
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    })
    return events.map(bookingEmailEventResponse)
  })
}

export async function getBookingEmailEvent(prisma, eventId, actor) {
  const property = await getProperty(prisma, actor)
  const event = await prisma.bookingEmailEvent.findFirst({
    where: { id: eventId, propertyId: property.id },
    include: bookingEmailEventInclude(),
  })
  if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
  return bookingEmailEventResponse(event)
}

async function resolveBookingEmailRoomMapping(tx, event, details) {
  const provider = bookingEmailChannelProvider(event)
  if (!provider) {
    return { blocker: 'The sender does not map to a configured OTA provider.' }
  }
  const externalRoomType = normalizeNullableString(details.externalRoomType)
  if (!externalRoomType) {
    return { provider, blocker: 'The OTA room label was not extracted, so an authoritative room mapping cannot be selected.' }
  }
  const matchValue = normalizedBookingEmailMatchValue(externalRoomType)
  const mappings = await tx.channelMapping.findMany({
    where: {
      active: true,
      channel: {
        propertyId: event.propertyId,
        provider,
        active: true,
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  })
  const matchingMappings = mappings.filter((mapping) => (
    normalizedBookingEmailMatchValue(mapping.externalRoomTypeId) === matchValue
    || normalizedBookingEmailMatchValue(mapping.externalRoomTypeName) === matchValue
  ))
  const roomTypeIds = [...new Set(matchingMappings.map((mapping) => mapping.roomTypeId))]
  if (matchingMappings.length === 0) {
    return { provider, blocker: `No active ${provider} room mapping matches "${externalRoomType}".` }
  }
  if (roomTypeIds.length !== 1) {
    return { provider, blocker: `The ${provider} room label matches multiple PMS room types.` }
  }
  const roomType = await tx.roomType.findFirst({
    where: { id: roomTypeIds[0], propertyId: event.propertyId },
  })
  if (!roomType) return { provider, blocker: 'The mapped PMS room type no longer exists.' }
  const roomIds = [...new Set(matchingMappings.flatMap((mapping) => Array.isArray(mapping.roomIds) ? mapping.roomIds : []))]
  if (roomIds.length === 0) return { provider, blocker: 'The OTA room mapping does not contain any operational PMS rooms.' }
  return {
    provider,
    roomType,
    roomIds,
    mappingIds: matchingMappings.map((mapping) => mapping.id),
    externalRoomType,
  }
}

async function findAssignableBookingEmailRoom(tx, event, roomType, roomIds, details) {
  const candidates = await tx.room.findMany({
    where: {
      id: { in: roomIds },
      propertyId: event.propertyId,
      roomTypeId: roomType.id,
      operationalStatus: 'AVAILABLE',
    },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }, { id: 'asc' }],
  })
  const reservationCandidate = {
    id: `booking-email-candidate:${event.id}`,
    propertyId: event.propertyId,
    roomTypeId: roomType.id,
    checkIn: dateFromKey(details.checkIn),
    checkOut: dateFromKey(details.checkOut),
  }
  for (const room of candidates) {
    try {
      return await validateRoomAssignable(tx, reservationCandidate, room.id)
    } catch {
      // Try the next mapped room. The authoritative validator is repeated during reservation creation.
    }
  }
  return null
}

async function recordBookingEmailManagerReview(tx, event, decision, actor, policy) {
  const reviewReason = event.reviewReason || decision.blockers[0] || 'Booking email automation could not safely apply this event.'
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: event.status === 'ERROR' ? 'ERROR' : 'NEEDS_REVIEW',
      reviewReason,
      automationDecision: decision,
    },
    include: bookingEmailEventInclude(),
  })
  if (!policy.notifyManager || event.managerReviewNotifiedAt) return updated

  const notifiedAt = new Date()
  const claim = await tx.bookingEmailEvent.updateMany({
    where: { id: event.id, managerReviewNotifiedAt: null },
    data: { managerReviewNotifiedAt: notifiedAt },
  })
  if (claim.count === 0) return updated
  const reference = event.channelRef ? ` ${event.channelRef}` : ''
  await tx.hotelOpsNotification.create({
    data: {
      propertyId: event.propertyId,
      type: 'APPROVAL_REQUEST',
      channel: 'IN_APP',
      status: 'SENT',
      recipientRole: 'HOTEL_MANAGER',
      title: 'Booking Inbox review required',
      summary: `Booking email${reference} stayed in review: ${reviewReason}`.slice(0, 500),
      actionUrl: '/booking-inbox',
      metadata: {
        source: 'booking-email',
        bookingEmailEventId: event.id,
        eventType: event.eventType,
        confidence: Number(event.confidence || 0),
        blockers: decision.blockers,
        automationVersion: BOOKING_EMAIL_AUTONOMY_VERSION,
      },
      sentAt: notifiedAt,
    },
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_MANAGER_REVIEW_REQUESTED', 'bookingEmailEvent', event.id, {
    eventType: event.eventType,
    confidence: Number(event.confidence || 0),
    blockers: decision.blockers,
  })
  return tx.bookingEmailEvent.findUnique({ where: { id: event.id }, include: bookingEmailEventInclude() })
}

async function autoProcessBookingEmailEvent(tx, event, source, actor, options = {}) {
  const policy = bookingEmailAutomationPolicy(options.env || process.env)
  if (!source.autoProcessSafeEvents || !policy.configured) return event
  if (event.status !== 'NEEDS_REVIEW') return event

  const details = safeJsonObject(event.parsedDetails)
  const extractionDecision = safeJsonObject(event.automationDecision)
  const blockers = []
  const decision = {
    ...extractionDecision,
    version: BOOKING_EMAIL_AUTONOMY_VERSION,
    stage: 'EVALUATING',
    evaluatedAt: new Date().toISOString(),
    blockers,
  }

  if (event.eventType !== 'NEW_BOOKING') blockers.push('Only new-booking events are eligible for autonomous PMS writes.')
  if (event.reviewReason) blockers.push(event.reviewReason)
  if (!event.channelRef) blockers.push('A provider reservation reference is required for autonomous processing.')
  const minimumConfidence = Math.max(policy.minimumConfidence, Number(source.reviewThreshold || 0))
  if (Number(event.confidence || 0) < minimumConfidence) {
    blockers.push(`Confidence ${Number(event.confidence || 0).toFixed(2)} is below the autonomous threshold ${minimumConfidence.toFixed(2)}.`)
  }
  const senderDomain = bookingEmailSenderDomain(event.sender)
  if (!domainMatchesTrustedSender(senderDomain, policy.trustedSenderDomains)) {
    blockers.push('The sender domain is not in the owner-configured trusted sender list.')
  }
  if (policy.requireAuthenticationResults && !bookingEmailAuthenticationPass(event.rawHeaders, policy.trustedSenderDomains)) {
    blockers.push('Gmail authentication results do not prove an approved SPF or DKIM sender domain.')
  }
  if (policy.requireCorroboration && Number(extractionDecision.corroborationCount || 0) < 1) {
    blockers.push('A second consistent provider email is required by the current corroboration policy.')
  }
  if (!policy.autoAssignRooms) blockers.push('Autonomous room assignment is disabled.')

  try {
    if (blockers.length > 0) {
      decision.stage = 'REVIEW_REQUIRED'
      return recordBookingEmailManagerReview(tx, event, decision, actor, policy)
    }

    if (event.duplicateOfEventId) {
      const duplicate = await tx.bookingEmailEvent.findFirst({
        where: { id: event.duplicateOfEventId, propertyId: event.propertyId },
        include: bookingEmailEventInclude(),
      })
      if (duplicate?.reservationId) {
        decision.stage = 'AUTO_LINKED_DUPLICATE'
        decision.reservationId = duplicate.reservationId
        decision.blockers = []
        return linkBookingEmailEventToReservation(tx, event, duplicate.reservationId, actor, { automationDecision: decision, parsedDetails: details })
      }
    }

    const mapping = await resolveBookingEmailRoomMapping(tx, event, details)
    if (mapping.blocker) {
      decision.stage = 'REVIEW_REQUIRED'
      decision.blockers.push(mapping.blocker)
      return recordBookingEmailManagerReview(tx, event, decision, actor, policy)
    }
    decision.provider = mapping.provider
    decision.channelMappingIds = mapping.mappingIds
    decision.resolvedRoomTypeId = mapping.roomType.id
    decision.resolvedRoomTypeCode = mapping.roomType.code

    const mappedDetails = {
      ...details,
      roomType: mapping.roomType.code,
      externalRoomType: mapping.externalRoomType,
    }
    const existingReservation = await findReservationForBookingEmailEvent(tx, event, mappedDetails)
    if (existingReservation) {
      decision.stage = 'AUTO_LINKED_EXISTING'
      decision.reservationId = existingReservation.id
      decision.blockers = []
      return linkBookingEmailEventToReservation(tx, event, existingReservation.id, actor, { automationDecision: decision, parsedDetails: mappedDetails })
    }

    const room = await findAssignableBookingEmailRoom(tx, event, mapping.roomType, mapping.roomIds, mappedDetails)
    if (!room) {
      decision.stage = 'REVIEW_REQUIRED'
      decision.blockers.push('No mapped PMS room is safely assignable for the requested stay dates.')
      return recordBookingEmailManagerReview(tx, event, decision, actor, policy)
    }

    decision.stage = 'AUTO_APPLIED'
    decision.assignedRoomId = room.id
    decision.blockers = []
    return approveNewBookingEmailEvent(tx, event, mappedDetails, actor, {
      assignedRoomId: room.id,
      autonomous: true,
      automationDecision: decision,
    })
  } catch (error) {
    const errorReason = redactedCredentialMessage(error instanceof Error ? error.message : String(error))
    const failed = await tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        status: 'ERROR',
        errorReason,
        automationDecision: {
          ...decision,
          stage: 'ERROR',
          blockers: [...new Set([...decision.blockers, errorReason])],
        },
      },
      include: bookingEmailEventInclude(),
    })
    return recordBookingEmailManagerReview(tx, failed, safeJsonObject(failed.automationDecision), actor, policy)
  }
}

export async function syncBookingEmail(prisma, input = {}, actor, options = {}) {
  const reviewOnly = Boolean(input.reviewOnly)
  const suppliedEvents = Array.isArray(input.events)
  if (suppliedEvents && options.allowImportedEvents !== true) {
    throw new PmsValidationError('Caller-supplied booking email events are not accepted by the public sync path.')
  }
  const source = await prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    if (input.sourceId) {
      const existing = await tx.bookingEmailSource.findFirst({ where: { id: input.sourceId, propertyId: property.id } })
      if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
      return existing
    }
    return ensurePrimaryBookingEmailSource(tx, actor)
  })

  let importedEvents = suppliedEvents ? input.events : null
  if (!importedEvents) {
    try {
      importedEvents = await fetchGmailEventsForSource(source, { limit: input.limit })
    } catch (error) {
      await prisma.bookingEmailSource.update({
        where: { id: source.id },
        data: { lastError: redactedCredentialMessage(error instanceof Error ? error.message : String(error)) },
      })
      throw error
    }
  }

  const results = await serializableTransaction(prisma, async (tx) => {
    const currentSource = await tx.bookingEmailSource.findFirst({ where: { id: source.id, propertyId: source.propertyId } })
    if (!currentSource) throw new PmsValidationError('Booking email source was not found.', 404)
    const events = []
    for (const inputEvent of importedEvents) {
      const event = await upsertBookingEmailEvent(tx, currentSource, inputEvent)
      events.push(reviewOnly ? event : await autoProcessBookingEmailEvent(tx, event, currentSource, actor, options))
    }
    await tx.bookingEmailSource.update({
      where: { id: currentSource.id },
      data: {
        lastSyncAt: new Date(),
        lastError: null,
      },
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_SYNCED', 'bookingEmailSource', currentSource.id, {
      imported: events.length,
      mailbox: currentSource.mailbox,
      reviewOnly,
    })
    return events
  })

  return {
    status: await getBookingEmailStatus(prisma, actor),
    events: results.map(bookingEmailEventResponse),
    opsCommandEvents: suppliedEvents && options.providerVerified !== true ? [] : results.map((event) => ({
      ...bookingEmailEventResponse(event),
      sourceMessageId: event.sourceMessageId || undefined,
      rawText: event.rawText || undefined,
      body: event.rawText || undefined,
    })),
  }
}

async function linkBookingEmailEventToReservation(tx, event, reservationId, actor, options = {}) {
  const reservation = await tx.reservation.findFirst({
    where: { id: reservationId, propertyId: event.propertyId },
    include: reservationInclude,
  })
  if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
  if (!reservation.sourceEmailEventId && event.eventType === 'NEW_BOOKING') {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { sourceEmailEventId: event.id },
    })
  }
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: reservation.id,
      completedAction: `Linked to reservation ${reservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
      ...(options.parsedDetails ? {
        parsedDetails: options.parsedDetails,
        roomType: normalizeRoomTypeCode(options.parsedDetails.roomType) || event.roomType,
      } : {}),
      automationDecision: options.automationDecision || event.automationDecision,
      processedAt: new Date(),
      processedBy: actorName(actor),
    },
    include: bookingEmailEventInclude(),
  })
  await createReservationLog(tx, reservation.id, 'MODIFIED', actor, {
    notes: `Linked booking email event ${event.id}.`,
    changes: { sourceEmailEventId: event.id, sourceMessageId: event.sourceMessageId },
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_LINKED_RESERVATION', 'bookingEmailEvent', event.id, {
    reservationId: reservation.id,
    confirmationCode: reservation.confirmationCode,
    sourceMessageId: event.sourceMessageId,
  })
  return updated
}

function modificationUpdateFromBookingEmail(event, details, reservation, reason) {
  const update = {
    expectedUpdatedAt: reservation.updatedAt.toISOString(),
    notes: [reservation.notes, `Booking email modification ${event.id}: ${reason}`, normalizeNullableString(details.notes)]
      .filter(Boolean)
      .join('\n'),
  }
  if (details.checkIn) update.checkIn = details.checkIn
  if (details.checkOut) update.checkOut = details.checkOut
  if (details.roomType) update.roomTypeCode = details.roomType
  if (details.adults !== undefined) update.adults = Number(details.adults)
  if (details.children !== undefined) update.children = Number(details.children)
  if (Array.isArray(details.childAges)) update.childAges = details.childAges.map(Number)
  if (details.channelRef) update.channelRef = details.channelRef
  if (details.specialRequests !== undefined) update.specialRequests = normalizeNullableString(details.specialRequests)

  if (details.amount !== undefined && details.amount !== null && details.amount !== '') {
    const amount = Number(details.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new PmsValidationError('Modified reservation amount must be greater than zero.')
    const { nights } = validateStayInput({
      checkIn: update.checkIn || reservation.checkIn,
      checkOut: update.checkOut || reservation.checkOut,
    })
    update.ratePerNight = roundMoney(amount / nights)
  }
  return update
}

async function approveModificationEmailEvent(prisma, event, details, actor, reservationId, reason) {
  const normalizedReason = normalizeNullableString(reason)
  if (!normalizedReason) throw new PmsValidationError('Modification email actions require an operational reason.')
  const reservation = reservationId
    ? await prisma.reservation.findFirst({ where: { id: reservationId, propertyId: event.propertyId }, include: reservationInclude })
    : await findReservationForBookingEmailEvent(prisma, event, details)
  if (!reservation) throw new PmsValidationError('Link this modification to a reservation before applying it.')

  const updatedReservation = await updateReservation(
    prisma,
    reservation.id,
    modificationUpdateFromBookingEmail(event, details, reservation, normalizedReason),
    actor,
    { idempotencyKey: `booking-email-modification:${event.propertyId}:${event.id}` },
  )

  return serializableTransaction(prisma, async (tx) => {
    const currentEvent = await tx.bookingEmailEvent.findFirst({
      where: { id: event.id, propertyId: event.propertyId },
      include: bookingEmailEventInclude(),
    })
    if (!currentEvent) throw new PmsValidationError('Booking email event was not found.', 404)
    if (currentEvent.status === 'PROCESSED') return bookingEmailEventResponse(currentEvent)
    const updated = await tx.bookingEmailEvent.update({
      where: { id: currentEvent.id },
      data: {
        status: 'PROCESSED',
        reservationId: updatedReservation.id,
        completedAction: `Applied modification to reservation ${updatedReservation.confirmationCode}.`,
        reviewReason: null,
        errorReason: null,
        processedAt: new Date(),
        processedBy: actorName(actor),
      },
      include: bookingEmailEventInclude(),
    })
    await createReservationLog(tx, updatedReservation.id, 'MODIFIED', actor, {
      notes: normalizedReason,
      changes: { sourceEmailEventId: currentEvent.id, sourceMessageId: currentEvent.sourceMessageId },
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_MODIFIED_RESERVATION', 'bookingEmailEvent', currentEvent.id, {
      reservationId: updatedReservation.id,
      confirmationCode: updatedReservation.confirmationCode,
      sourceMessageId: currentEvent.sourceMessageId,
      reason: normalizedReason,
    })
    return bookingEmailEventResponse(updated)
  })
}

export async function approveBookingEmailEvent(prisma, eventId, input = {}, actor) {
  const property = await getProperty(prisma, actor)
  const candidate = await prisma.bookingEmailEvent.findFirst({
    where: { id: eventId, propertyId: property.id },
    include: bookingEmailEventInclude(),
  })
  if (!candidate) throw new PmsValidationError('Booking email event was not found.', 404)
  if (candidate.status === 'PROCESSED') throw new PmsValidationError('This booking email event has already been processed.', 409)
  if (candidate.status === 'IGNORED') throw new PmsValidationError('Ignored booking email events must be reprocessed before approval.', 409)
  const mode = String(input.mode || 'apply_parsed')
  assertBookingEmailApprovalContract(candidate.eventType, mode, input, actor)
  if (candidate.eventType === 'MODIFICATION' && mode === 'apply_parsed') {
    return approveModificationEmailEvent(
      prisma,
      candidate,
      detailsForApproval(candidate, input.editedDetails),
      actor,
      input.reservationId,
      input.reason,
    )
  }

  return serializableTransaction(prisma, async (tx) => {
    const event = await tx.bookingEmailEvent.findFirst({
      where: { id: eventId, propertyId: property.id },
      include: bookingEmailEventInclude(),
    })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    if (event.status === 'PROCESSED') throw new PmsValidationError('This booking email event has already been processed.', 409)
    if (event.status === 'IGNORED') throw new PmsValidationError('Ignored booking email events must be reprocessed before approval.', 409)

    const details = detailsForApproval(event, input.editedDetails)
    assertBookingEmailApprovalContract(event.eventType, mode, input, actor)
    if (mode === 'link_reservation') {
      if (!input.reservationId) throw new PmsValidationError('Select a reservation to link this email event.')
      return bookingEmailEventResponse(await linkBookingEmailEventToReservation(tx, event, input.reservationId, actor))
    }

    if (event.eventType === 'NEW_BOOKING') {
      return bookingEmailEventResponse(await approveNewBookingEmailEvent(tx, event, details, actor))
    }
    if (event.eventType === 'PAYMENT_NOTICE') {
      return bookingEmailEventResponse(await approvePaymentEmailEvent(tx, event, details, actor, input.reservationId))
    }
    if (event.eventType === 'CANCELLATION') {
      return bookingEmailEventResponse(await approveCancellationEmailEvent(tx, event, details, actor, input.reservationId, input.reason))
    }

    throw new PmsValidationError('This booking email event must be linked to a reservation before it can be processed.')
  })
}

export async function rejectBookingEmailEvent(prisma, eventId, input = {}, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const reason = normalizeNullableString(input.reason)
    if (!reason) throw new PmsValidationError('Rejecting or ignoring an email event requires a reason.')
    const event = await tx.bookingEmailEvent.findFirst({ where: { id: eventId, propertyId: property.id } })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    const updated = await tx.bookingEmailEvent.update({
      where: { id: eventId },
      data: {
        status: 'IGNORED',
        reviewReason: reason,
        errorReason: null,
        rejectedAt: new Date(),
        processedBy: actorName(actor),
        completedAction: 'Rejected or ignored by staff.',
      },
      include: bookingEmailEventInclude(),
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_REJECTED', 'bookingEmailEvent', event.id, {
      reason,
      sourceMessageId: event.sourceMessageId,
    })
    return bookingEmailEventResponse(updated)
  })
}

export async function reprocessBookingEmailEvent(prisma, eventId, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const event = await tx.bookingEmailEvent.findFirst({
      where: { id: eventId, propertyId: property.id },
      include: bookingEmailEventInclude(),
    })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    const data = await buildBookingEmailEventData(tx, event.source || {
      id: event.sourceId,
      propertyId: event.propertyId,
      name: event.sourceName || 'Booking email',
      mailbox: event.sourceMailbox || primaryBookingMailbox(),
    }, {
      sourceMessageId: event.sourceMessageId,
      threadId: event.threadId,
      rawEmailUrl: event.rawEmailUrl,
      sender: event.sender,
      recipient: event.recipient,
      subject: event.subject,
      receivedAt: event.receivedAt,
      rawText: event.rawText,
      parsedDetails: event.parsedDetails,
    }, event.id)
    const updated = await tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        ...data,
        status: 'NEEDS_REVIEW',
        reservationId: event.reservationId,
        completedAction: null,
        processedAt: null,
        processedBy: null,
        rejectedAt: null,
      },
      include: bookingEmailEventInclude(),
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_REPROCESSED', 'bookingEmailEvent', event.id, {
      sourceMessageId: event.sourceMessageId,
    })
    return bookingEmailEventResponse(updated)
  })
}

export async function createWalkInCheckIn(prisma, input, actor) {
  return serializableTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')
    const pricing = calculateStayPricing({
      ...input,
      ...pricingRulesFor(property, roomType),
    })

    await ensureRoomTypeCapacity(tx, property.id, roomType.id, checkInKey, checkOutKey)

    const guestData = validateGuestInput(input.guest)
    if (!hasGuestIdentity(guestData)) {
      if (input.recordIdentityLater) {
        requireOverride(actor, 'override:check-in', input.recordIdentityLaterReason || input.overrideReason, 'Record-later identity override')
      } else {
        throw new PmsValidationError('Record guest nationality and ID/passport number before walk-in check-in.')
      }
    }
    const guest = await tx.guest.create({ data: { ...guestData, propertyId: property.id } })

    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: input.confirmationCode || `SBX-WI-${Date.now()}`,
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        status: 'CONFIRMED',
        adults: Number(input.adults),
        children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [],
        ...moneyDataFromBaht('ratePerNight', 'ratePerNightSatang', Number(input.ratePerNight)),
        ...moneyDataFromBaht('totalAmount', 'totalAmountSatang', pricing.total),
        ...moneyDataFromBaht('depositAmount', 'depositAmountSatang', roundMoney(pricing.total * 0.3)),
        depositPaid: false,
        source: 'WALK_IN',
        channelRef: null,
        notes: input.notes || null,
        specialRequests: input.specialRequests || null,
      },
      include: reservationInclude,
    })

    const candidateRoom = input.assignedRoomId
      ? await tx.room.findFirst({ where: { id: input.assignedRoomId, propertyId: property.id }, include: { roomType: true } })
      : await tx.room.findFirst({
          where: {
            propertyId: property.id,
            roomTypeId: roomType.id,
            operationalStatus: 'AVAILABLE',
            currentReservation: null,
            currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
          },
          include: { roomType: true },
          orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        })

    if (!candidateRoom) throw new PmsValidationError('No clean available room is ready for this walk-in.')
    const room = await validateRoomAssignable(tx, reservation, candidateRoom.id)
    if (!isReadyRoomStatus(room.currentStatus)) {
      throw new PmsValidationError(`Room ${room.number} must be clean or inspected before walk-in check-in.`)
    }

    await reserveRoomDates(tx, property.id, reservation.id, room.id, checkInKey, checkOutKey)
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { assignedRoomId: room.id },
    })

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        ...moneyDataFromBaht('subtotal', 'subtotalSatang', pricing.total),
        ...moneyDataFromBaht('tax', 'taxSatang', 0),
        ...moneyDataFromBaht('total', 'totalSatang', pricing.total),
        ...moneyDataFromBaht('paid', 'paidSatang', 0),
        ...moneyDataFromBaht('balance', 'balanceSatang', pricing.total),
      },
    })

    const roomChargeIdempotencyKey = `walk-in-room-charge:${property.id}:${reservation.id}`
    const roomChargeDescription = `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`
    await tx.charge.create({
      data: {
        propertyId: property.id,
        folioId: folio.id,
        idempotencyKey: roomChargeIdempotencyKey,
        intentFingerprint: chargeIntentFingerprint({
          folioId: folio.id,
          dateKey: checkInKey,
          description: roomChargeDescription,
          category: 'ROOM',
          amountSatang: bahtToSatang(Number(input.ratePerNight)),
          quantity: pricing.nights,
        }),
        date: dateFromKey(checkInKey),
        description: roomChargeDescription,
        category: 'ROOM',
        ...moneyDataFromBaht('amount', 'amountSatang', Number(input.ratePerNight)),
        quantity: pricing.nights,
        ...moneyDataFromBaht('total', 'totalSatang', pricing.total),
        createdBy: actorName(actor),
      },
    })
    await recomputeFolio(tx, folio.id)

    if (input.payment?.amount) {
      await recordPaymentInTransaction(tx, folio.id, input.payment, actor)
    }
    const settledFolio = await tx.folio.findUnique({ where: { id: folio.id } })
    const remainingBalance = roundMoney(settledFolio?.balance || 0)
    if (remainingBalance > 0) {
      if (input.allowPayLater) {
        requireOverride(actor, 'override:check-in', input.payLaterReason || input.overrideReason, 'Pay-later walk-in check-in')
      } else {
        throw new PmsValidationError('Collect or override the amount due before walk-in check-in.')
      }
    }

    const toStatus = checkedInRoomStatus(room.currentStatus)
    const roomUpdate = await tx.room.updateMany({
      where: {
        id: room.id,
        currentReservation: null,
        currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
      },
      data: {
        currentStatus: toStatus,
        currentReservation: reservation.id,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before walk-in could complete. Refresh and try again.`, 409)
    }

    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CHECKED_IN',
        actualCheckIn: new Date(),
      },
    })

    await createRoomStatusLog(tx, room, toStatus, actor, 'Walk-in check-in completed')
    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: 'CONFIRMED', changes: { source: 'WALK_IN' } })
    await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    await createReservationLog(tx, reservation.id, 'CHECKED_IN', actor, {
      fromStatus: 'CONFIRMED',
      toStatus: 'CHECKED_IN',
      notes: input.overrideReason || input.additionalNotes || undefined,
      changes: { roomId: room.id, roomNumber: room.number, source: 'WALK_IN' },
    })
    await createAudit(tx, actor, 'WALK_IN_CHECKED_IN', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: 'NEW', roomStatus: room.currentStatus },
      newState: { reservationStatus: 'CHECKED_IN', roomStatus: toStatus },
      overrideReason: input.overrideReason || input.payLaterReason || input.recordIdentityLaterReason || null,
    })

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function assignRoom(prisma, reservationId, roomId, actor, options = {}) {
  const targetRoomId = normalizeNullableString(roomId)
  if (!targetRoomId) throw new PmsValidationError('Select a room before assigning the reservation.')
  const idempotencyKey = normalizeReservationMutationIdempotencyKey(options?.idempotencyKey)
  const expectedUpdatedAt = normalizeExpectedReservationUpdatedAt(options?.expectedUpdatedAt)
  return reservationMutationTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    await acquireReservationMutationLocks(
      tx,
      reservationRoomDateLockKeys(property.id, reservationId, null, null, null),
    )
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, propertyId: property.id } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    await acquireReservationMutationLocks(tx, [
      ...reservationRoomDateLockKeys(property.id, reservation.id, reservation.assignedRoomId, reservation.checkIn, reservation.checkOut),
      ...reservationRoomDateLockKeys(property.id, reservation.id, targetRoomId, reservation.checkIn, reservation.checkOut),
    ])
    const mutationAttempt = await claimReservationMutationAttempt(tx, {
      propertyId: property.id,
      reservationId: reservation.id,
      operation: 'ASSIGN_ROOM',
      idempotencyKey,
      intent: {
        roomId: targetRoomId,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() || null,
      },
    })
    if (mutationAttempt.replay) {
      const current = await tx.reservation.findFirst({
        where: { id: reservation.id, propertyId: property.id },
        include: reservationInclude,
      })
      return replayReservationMutation(mutationAttempt.attempt, current)
    }
    if (expectedUpdatedAt && reservation.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new PmsValidationError('This reservation changed after the booking board loaded it. Refresh before assigning a room.', 409)
    }
    if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(reservation.status)) {
      throw new PmsValidationError('Only active reservations can be assigned a room.')
    }
    if (reservation.assignedRoomId === targetRoomId) {
      const current = await tx.reservation.findFirst({
        where: { id: reservation.id, propertyId: property.id },
        include: reservationInclude,
      })
      await completeReservationMutationAttempt(tx, mutationAttempt.attempt, current)
      return current
    }

    const room = await validateRoomAssignable(tx, reservation, targetRoomId)
    await reserveRoomDates(tx, property.id, reservation.id, room.id, reservation.checkIn, reservation.checkOut)

    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: { assignedRoomId: room.id },
      include: reservationInclude,
    })
    await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    await createAudit(tx, actor, 'ASSIGNED_ROOM', 'reservation', reservation.id, { roomId: room.id, roomNumber: room.number })
    await emitOperationalEvent(tx, reservation.propertyId, 'RESERVATION_ROOM_ASSIGNED', 'reservation', reservation.id, actor, { roomId: room.id })
    await completeReservationMutationAttempt(tx, mutationAttempt.attempt, updated)
    return updated
  })
}

export async function checkInReservation(prisma, reservationId, actor, options = {}) {
  const idempotencyKey = requireReservationLifecycleIdempotencyKey(options.idempotencyKey)
  const expectedUpdatedAt = normalizeExpectedReservationUpdatedAt(options.expectedUpdatedAt)
  const commandOptions = { ...options }
  delete commandOptions.idempotencyKey
  delete commandOptions.expectedUpdatedAt
  return reservationMutationTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    await acquireReservationMutationLocks(
      tx,
      reservationRoomDateLockKeys(property.id, reservationId, null, null, null),
    )
    let reservation = await tx.reservation.findFirst({ where: { id: reservationId, propertyId: property.id }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    await acquireReservationMutationLocks(tx, reservationRoomDateLockKeys(
      property.id,
      reservation.id,
      reservation.assignedRoomId,
      reservation.checkIn,
      reservation.checkOut,
    ))
    const mutationAttempt = await claimReservationMutationAttempt(tx, {
      propertyId: property.id,
      reservationId: reservation.id,
      operation: 'CHECK_IN_RESERVATION',
      idempotencyKey,
      intent: {
        options: commandOptions,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() || null,
      },
    })
    if (mutationAttempt.replay) return replayReservationMutation(mutationAttempt.attempt, reservation)
    if (expectedUpdatedAt && reservation.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new PmsValidationError('This reservation changed after the front desk loaded it. Refresh before checking in.', 409)
    }
    if (!['CONFIRMED', 'PENDING'].includes(reservation.status)) {
      throw new PmsValidationError('Only confirmed or pending reservations can be checked in.')
    }
    if (!reservation.assignedRoomId) {
      throw new PmsValidationError('Assign a room before checking in this reservation.')
    }

    validateReservationDateForCheckIn(reservation, { ...options, actor })

    const totalGuests = Number(reservation.adults || 0) + Number(reservation.children || 0)
    if (totalGuests > SANDBOX_RULES.maxOccupancy) {
      throw new PmsValidationError(`Maximum occupancy is ${SANDBOX_RULES.maxOccupancy} guests per room.`)
    }

    const guestUpdates = {}
    if (options.guest?.nationality !== undefined) guestUpdates.nationality = normalizeNullableString(options.guest.nationality)
    if (options.guest?.idType !== undefined) guestUpdates.idType = normalizeNullableString(options.guest.idType)
    if (options.guest?.idNumber !== undefined) guestUpdates.idNumber = normalizeNullableString(options.guest.idNumber)
    if (options.guest?.phone !== undefined) guestUpdates.phone = normalizeNullableString(options.guest.phone)
    if (options.guest?.email !== undefined) guestUpdates.email = normalizeNullableString(options.guest.email)
    if (Object.keys(guestUpdates).length > 0) {
      const guest = await tx.guest.update({
        where: { id: reservation.guestId },
        data: guestUpdates,
      })
      reservation = { ...reservation, guest }
      await createAudit(tx, actor, 'MODIFIED', 'guest', reservation.guestId, guestUpdates)
    }

    if (!hasGuestIdentity(reservation.guest)) {
      if (options.recordIdentityLater) {
        requireOverride(actor, 'override:check-in', options.recordIdentityLaterReason || options.overrideReason, 'Record-later identity override')
      } else {
        throw new PmsValidationError('Record guest nationality and ID/passport number before check-in.')
      }
    }

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findFirst({ where: { id: reservationId, propertyId: property.id }, include: reservationInclude })
    }

    const remainingBalance = roundMoney(reservation.folio?.balance || 0)
    if (remainingBalance > 0) {
      if (options.allowPayLater) {
        requireOverride(actor, 'override:check-in', options.payLaterReason || options.overrideReason, 'Pay-later check-in')
      } else {
        throw new PmsValidationError('Collect or override the amount due before check-in.')
      }
    }

    const room = await validateRoomAssignable(tx, reservation, reservation.assignedRoomId)
    if (isOccupiedRoomStatus(room.currentStatus)) {
      throw new PmsValidationError(`Room ${room.number} is occupied and cannot be checked in.`)
    }
    if (!isReadyRoomStatus(room.currentStatus)) {
      if (options.allowRoomReadinessOverride) {
        requireOverride(actor, 'override:check-in', options.overrideReason, 'Room readiness override')
      } else {
        throw new PmsValidationError(`Room ${room.number} must be clean or inspected before check-in.`)
      }
    }

    const toStatus = checkedInRoomStatus(room.currentStatus)
    await createRoomStatusLog(tx, room, toStatus, actor, 'Check-in completed')

    const roomWhere = {
      id: room.id,
      currentReservation: null,
      currentStatus: options.allowRoomReadinessOverride
        ? { notIn: ['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'] }
        : { in: ['VACANT_CLEAN', 'INSPECTED'] },
    }
    const roomUpdate = await tx.room.updateMany({
      where: roomWhere,
      data: {
        currentStatus: toStatus,
        currentReservation: reservation.id,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before check-in could complete. Refresh and try again.`, 409)
    }

    const reservationUpdate = await tx.reservation.updateMany({
      where: { id: reservation.id, status: { in: ['CONFIRMED', 'PENDING'] } },
      data: {
        status: 'CHECKED_IN',
        actualCheckIn: new Date(),
      },
    })
    if (reservationUpdate.count !== 1) {
      throw new PmsValidationError('Reservation changed state before check-in could complete. Refresh and try again.', 409)
    }

    await createReservationLog(tx, reservation.id, 'CHECKED_IN', actor, {
      fromStatus: reservation.status,
      toStatus: 'CHECKED_IN',
      notes: options.overrideReason || options.additionalNotes || undefined,
      changes: {
        roomId: room.id,
        roomNumber: room.number,
        overrides: {
          roomReadiness: Boolean(options.allowRoomReadinessOverride),
          date: Boolean(options.allowDateOverride),
          payLater: Boolean(options.allowPayLater),
          recordIdentityLater: Boolean(options.recordIdentityLater),
        },
      },
    })
    await createAudit(tx, actor, 'CHECKED_IN', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: reservation.status, roomStatus: room.currentStatus },
      newState: { reservationStatus: 'CHECKED_IN', roomStatus: toStatus },
      overrideReason: options.overrideReason || options.payLaterReason || options.recordIdentityLaterReason || null,
      overrides: {
        roomReadiness: Boolean(options.allowRoomReadinessOverride),
        date: Boolean(options.allowDateOverride),
        payLater: Boolean(options.allowPayLater),
        recordIdentityLater: Boolean(options.recordIdentityLater),
      },
    })
    await emitOperationalEvent(tx, reservation.propertyId, 'RESERVATION_CHECKED_IN', 'reservation', reservation.id, actor, { roomId: room.id })
    const result = await tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
    await completeReservationMutationAttempt(tx, mutationAttempt.attempt, result)
    return result
  })
}

export async function checkOutReservation(prisma, reservationId, actor, options = {}) {
  const idempotencyKey = requireReservationLifecycleIdempotencyKey(options.idempotencyKey)
  const expectedUpdatedAt = normalizeExpectedReservationUpdatedAt(options.expectedUpdatedAt)
  const commandOptions = { ...options }
  delete commandOptions.idempotencyKey
  delete commandOptions.expectedUpdatedAt
  return reservationMutationTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    await acquireReservationMutationLocks(
      tx,
      reservationRoomDateLockKeys(property.id, reservationId, null, null, null),
    )
    let reservation = await tx.reservation.findFirst({ where: { id: reservationId, propertyId: property.id }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    await acquireReservationMutationLocks(tx, reservationRoomDateLockKeys(
      property.id,
      reservation.id,
      reservation.assignedRoomId,
      reservation.checkIn,
      reservation.checkOut,
    ))
    const mutationAttempt = await claimReservationMutationAttempt(tx, {
      propertyId: property.id,
      reservationId: reservation.id,
      operation: 'CHECK_OUT_RESERVATION',
      idempotencyKey,
      intent: {
        options: commandOptions,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() || null,
      },
    })
    if (mutationAttempt.replay) return replayReservationMutation(mutationAttempt.attempt, reservation)
    if (expectedUpdatedAt && reservation.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new PmsValidationError('This reservation changed after the front desk loaded it. Refresh before checking out.', 409)
    }
    if (reservation.status !== 'CHECKED_IN') {
      throw new PmsValidationError('Only checked-in reservations can be checked out.')
    }
    if (!reservation.assignedRoomId || !reservation.assignedRoom) {
      throw new PmsValidationError('Checked-in reservation is missing its assigned room.')
    }

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findFirst({ where: { id: reservationId, propertyId: property.id }, include: reservationInclude })
    }

    const remainingBalance = roundMoney(reservation.folio?.balance || 0)
    if (remainingBalance > 0) {
      if (options.allowUnpaidOverride) {
        requireOverride(actor, 'override:check-out', options.overrideReason, 'Unpaid checkout override')
      } else {
        throw new PmsValidationError('Collect or override the remaining balance before checkout.')
      }
    }

    const room = reservation.assignedRoom
    await createRoomStatusLog(tx, room, 'VACANT_DIRTY', actor, 'Checkout completed; room sent to housekeeping')

    const roomUpdate = await tx.room.updateMany({
      where: {
        id: room.id,
        OR: [
          { currentReservation: reservation.id },
          { currentReservation: null },
        ],
      },
      data: {
        currentStatus: 'VACANT_DIRTY',
        currentReservation: null,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before checkout could complete. Refresh and try again.`, 409)
    }

    const reservationUpdate = await tx.reservation.updateMany({
      where: { id: reservation.id, status: 'CHECKED_IN' },
      data: {
        status: 'CHECKED_OUT',
        actualCheckOut: new Date(),
      },
    })
    if (reservationUpdate.count !== 1) {
      throw new PmsValidationError('Reservation has already been checked out or changed state. Refresh and try again.', 409)
    }

    if (reservation.folio?.id) {
      await tx.folio.update({
        where: { id: reservation.folio.id },
        data: { status: 'CLOSED' },
      })
    }

    await createReservationLog(tx, reservation.id, 'CHECKED_OUT', actor, {
      fromStatus: reservation.status,
      toStatus: 'CHECKED_OUT',
      notes: options.overrideReason || options.additionalNotes || undefined,
      changes: {
        roomId: room.id,
        roomNumber: room.number,
        markedRoomStatus: 'VACANT_DIRTY',
        folioClosed: Boolean(reservation.folio?.id),
        overrides: {
          unpaidBalance: Boolean(options.allowUnpaidOverride),
        },
      },
    })
    await createAudit(tx, actor, 'CHECKED_OUT', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: reservation.status, roomStatus: room.currentStatus, balance: remainingBalance },
      newState: { reservationStatus: 'CHECKED_OUT', roomStatus: 'VACANT_DIRTY' },
      overrideReason: options.overrideReason || null,
      overrides: {
        unpaidBalance: Boolean(options.allowUnpaidOverride),
      },
      housekeepingHandoff: {
        roomId: room.id,
        status: 'VACANT_DIRTY',
        priorityTurnover: false,
      },
    })
    await emitOperationalEvent(tx, reservation.propertyId, 'RESERVATION_CHECKED_OUT', 'reservation', reservation.id, actor, { roomId: room.id })
    const result = await tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
    await completeReservationMutationAttempt(tx, mutationAttempt.attempt, result)
    return result
  })
}

async function cancelReservationInTransaction(tx, reservationId, actor, status = 'CANCELLED', notes = undefined, options = {}) {
  const reason = normalizeNullableString(notes)
  const idempotencyKey = normalizeReservationMutationIdempotencyKey(options.idempotencyKey)
  const expectedUpdatedAt = normalizeExpectedReservationUpdatedAt(options.expectedUpdatedAt)
  if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
    throw new PmsValidationError('Cancellation status must be CANCELLED or NO_SHOW.')
  }
  if (!reason) {
    throw new PmsValidationError(`${status === 'NO_SHOW' ? 'No-show' : 'Cancellation'} reason is required.`)
  }
  const property = await getProperty(tx, actor)
  const reservation = await tx.reservation.findFirst({
    where: { id: reservationId, propertyId: property.id },
    include: reservationInclude,
  })
  if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
  await acquireReservationMutationLocks(tx, reservationRoomDateLockKeys(
    property.id,
    reservation.id,
    reservation.assignedRoomId,
    reservation.checkIn,
    reservation.checkOut,
  ))
  const mutationAttempt = await claimReservationMutationAttempt(tx, {
    propertyId: property.id,
    reservationId: reservation.id,
    operation: `MARK_${status}`,
    idempotencyKey,
    intent: { status, reason, expectedUpdatedAt: expectedUpdatedAt?.toISOString() || null },
  })
  if (mutationAttempt.replay) return replayReservationMutation(mutationAttempt.attempt, reservation)
  if (expectedUpdatedAt && reservation.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new PmsValidationError('This reservation changed after the booking board loaded it. Refresh before changing its status.', 409)
  }
  if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(reservation.status)) {
    throw new PmsValidationError('Completed, cancelled, or no-show reservations cannot be changed.', 409)
  }
  if (reservation.status === 'CHECKED_IN') {
    throw new PmsValidationError('Checked-in reservations must be checked out before cancellation.')
  }
  if (status === 'NO_SHOW' && getBangkokDateKey(reservation.checkIn) > getBangkokDateKey(new Date())) {
    throw new PmsValidationError('A future arrival cannot be marked as a no-show.')
  }

  await tx.roomDateInventory.deleteMany({ where: { reservationId } })
  const updated = await tx.reservation.update({
    where: { id: reservation.id },
    data: {
      status,
      notes: [
        reservation.notes,
        `${status === 'NO_SHOW' ? 'No-show' : 'Cancellation'} reason: ${reason}`,
      ].filter(Boolean).join('\n'),
    },
    include: reservationInclude,
  })
  await createReservationLog(tx, reservation.id, status === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED', actor, {
    fromStatus: reservation.status,
    toStatus: status,
    notes: reason,
  })
  await createAudit(tx, actor, status, 'reservation', reservation.id, { reason })
  await emitOperationalEvent(tx, reservation.propertyId, status === 'NO_SHOW' ? 'RESERVATION_NO_SHOW' : 'RESERVATION_CANCELLED', 'reservation', reservation.id, actor)
  await completeReservationMutationAttempt(tx, mutationAttempt.attempt, updated)
  return updated
}

export async function cancelReservation(prisma, reservationId, actor, status = 'CANCELLED', notes = undefined, options = {}) {
  const reason = normalizeNullableString(notes)
  if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
    throw new PmsValidationError('Cancellation status must be CANCELLED or NO_SHOW.')
  }
  if (!reason) {
    throw new PmsValidationError(`${status === 'NO_SHOW' ? 'No-show' : 'Cancellation'} reason is required.`)
  }
  return reservationMutationTransaction(prisma, async (tx) => {
    return cancelReservationInTransaction(tx, reservationId, actor, status, reason, options)
  })
}

export async function updateReservationGuest(prisma, reservationId, input, actor, options = {}) {
  const validatedUpdate = validateReservationGuestUpdateInput(input)
  const expectedGuestUpdatedAt = normalizeExpectedGuestUpdatedAt(validatedUpdate.expectedGuestUpdatedAt)
  const update = { ...validatedUpdate }
  delete update.expectedGuestUpdatedAt
  const idempotencyKey = normalizeReservationMutationIdempotencyKey(options.idempotencyKey)
  return reservationMutationTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    const reservation = await tx.reservation.findFirst({
      where: { id: reservationId, propertyId: property.id },
      include: reservationInclude,
    })
    if (!reservation?.guest) throw new PmsValidationError('Reservation was not found.', 404)
    await acquireReservationMutationLocks(tx, [
      `reservation-mutation:reservation:${property.id}:${reservation.id}`,
      `reservation-mutation:guest:${property.id}:${reservation.guest.id}`,
    ])
    const mutationAttempt = await claimReservationMutationAttempt(tx, {
      propertyId: property.id,
      reservationId: reservation.id,
      operation: 'UPDATE_RESERVATION_GUEST',
      idempotencyKey,
      intent: { update, expectedGuestUpdatedAt: expectedGuestUpdatedAt?.toISOString() || null },
    })
    if (mutationAttempt.replay) return replayReservationMutation(mutationAttempt.attempt, reservation)
    if (expectedGuestUpdatedAt && reservation.guest.updatedAt.getTime() !== expectedGuestUpdatedAt.getTime()) {
      throw new PmsValidationError('This guest changed after the booking board loaded it. Refresh before saving.', 409)
    }
    const data = guestUpdateData(reservation.guest, update)
    await tx.guest.update({ where: { id: reservation.guest.id }, data })
    const fieldNames = Object.keys(update).sort()
    await createReservationLog(tx, reservation.id, 'MODIFIED', actor, { changes: { guestFields: fieldNames } })
    await createAudit(tx, actor, 'RESERVATION_GUEST_UPDATED', 'reservation', reservation.id, { guestId: reservation.guest.id, fields: fieldNames })
    await emitOperationalEvent(tx, property.id, 'RESERVATION_GUEST_UPDATED', 'reservation', reservation.id, actor, { guestId: reservation.guest.id, fields: fieldNames })
    const result = await tx.reservation.findUnique({ where: { id: reservation.id }, include: reservationInclude })
    await completeReservationMutationAttempt(tx, mutationAttempt.attempt, result)
    return result
  })
}

export async function updateHousekeepingStatus(prisma, roomId, cleanStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const room = await tx.room.findFirst({ where: { id: roomId, propertyId: property.id }, include: { roomType: true } })
    if (!room) throw new PmsValidationError('Room was not found.', 404)
    if (!['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED', 'MAINTENANCE'].includes(cleanStatus)) {
      throw new PmsValidationError('Select a valid housekeeping status.')
    }

    const operationalStatus = cleanStatus === 'MAINTENANCE' ? 'OUT_OF_SERVICE' : room.operationalStatus
    const toStatus = cleanStatus === 'MAINTENANCE'
      ? 'VACANT_DIRTY'
      : roomStatusForHousekeeping(room.currentStatus, cleanStatus)

    await createRoomStatusLog(tx, room, toStatus, actor, notes)
    const updated = await tx.room.update({
      where: { id: room.id },
      data: {
        currentStatus: toStatus,
        operationalStatus,
        notes: notes || room.notes,
      },
      include: { roomType: true },
    })
    await createAudit(tx, actor, 'HOUSEKEEPING_STATUS_UPDATED', 'room', room.id, { cleanStatus, toStatus })
    await emitOperationalEvent(tx, room.propertyId, 'ROOM_HOUSEKEEPING_UPDATED', 'room', room.id, actor)
    return updated
  })
}

export async function updateRoomOperationalStatus(prisma, roomId, operationalStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const room = await tx.room.findFirst({ where: { id: roomId, propertyId: property.id }, include: { roomType: true } })
    if (!room) throw new PmsValidationError('Room was not found.', 404)
    if (!['AVAILABLE', 'BLOCKED', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(operationalStatus)) {
      throw new PmsValidationError('Select a valid room operational status.')
    }
    if (operationalStatus !== 'AVAILABLE' && ['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'].includes(room.currentStatus)) {
      throw new PmsValidationError('Occupied rooms must be moved or checked out before changing operational status.')
    }

    const currentStatus = operationalStatus === 'AVAILABLE' && room.currentStatus === 'VACANT_DIRTY'
      ? room.currentStatus
      : operationalStatus === 'OUT_OF_SERVICE' || operationalStatus === 'OUT_OF_ORDER'
        ? 'VACANT_DIRTY'
        : room.currentStatus

    const updated = await tx.room.update({
      where: { id: room.id },
      data: {
        operationalStatus,
        currentStatus,
        notes: notes || room.notes,
      },
      include: { roomType: true },
    })
    await createRoomStatusLog(tx, updated, currentStatus, actor, notes || `Room marked ${operationalStatus.toLowerCase().replaceAll('_', ' ')}.`)
    await createAudit(tx, actor, 'ROOM_OPERATIONAL_STATUS_UPDATED', 'room', room.id, { operationalStatus })
    await emitOperationalEvent(tx, room.propertyId, 'ROOM_OPERATIONAL_STATUS_UPDATED', 'room', room.id, actor)
    return updated
  })
}

export async function createPayment(prisma, input, actor) {
  const idempotencyKey = normalizePaymentIdempotencyKey(input?.idempotencyKey)
  try {
    return await serializableTransaction(prisma, async (tx) => recordPaymentInTransaction(tx, input.folioId, input, actor))
  } catch (error) {
    // A concurrent request can pass the pre-read before the first transaction commits.
    // Resolve the unique-key race by replaying through the same intent validation.
    if (error?.code === 'P2002' && idempotencyKey) {
      return serializableTransaction(prisma, async (tx) => recordPaymentInTransaction(tx, input.folioId, input, actor))
    }
    if (error?.code === 'P2002') {
      throw new PmsValidationError('This payment has already been processed.', 409)
    }
    throw error
  }
}

async function chargeFolioSnapshot(tx, folioId, propertyId) {
  return tx.folio.findFirst({
    where: { id: folioId, reservation: { propertyId } },
    include: {
      charges: true,
      payments: true,
      reservation: {
        include: {
          guest: true,
          roomType: true,
          assignedRoom: true,
        },
      },
    },
  })
}

async function recordChargeInTransaction(tx, input, actor) {
  const property = await getProperty(tx, actor)
  const idempotencyKey = normalizeChargeIdempotencyKey(input.idempotencyKey)
  const { satang: amountSatang } = requiredMoneyInput(input)
  const quantity = Number(input.quantity || 1)
  const description = normalizeNullableString(input.description)
  const category = String(input.category || 'OTHER').toUpperCase()
  const validCategories = ['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER']

  if (!description) throw new PmsValidationError('Charge description is required.')
  if (!validCategories.includes(category)) throw new PmsValidationError('Select a valid charge category.')
  if (amountSatang <= 0n) throw new PmsValidationError('Charge amount must be greater than zero.')
  if (!Number.isInteger(quantity) || quantity < 1) throw new PmsValidationError('Charge quantity must be at least 1.')
  if (amountSatang > MAX_SAFE_MONEY_SATANG || quantity > POSTGRES_INTEGER_MAX) {
    throw new PmsValidationError('Charge amount or quantity exceeds the supported exact-money range.')
  }

  const requestedDateKey = input.date ? getBangkokDateKey(input.date) : null
  const sourceEmailEventId = normalizeNullableString(input.sourceEmailEventId)
  const intentFingerprint = chargeIntentFingerprint({
    folioId: input.folioId,
    dateKey: requestedDateKey,
    description,
    category,
    amountSatang,
    quantity,
    sourceEmailEventId,
  })
  const existingCharge = await tx.charge.findUnique({
    where: { propertyId_idempotencyKey: { propertyId: property.id, idempotencyKey } },
  })
  if (existingCharge) {
    if (existingCharge.intentFingerprint !== intentFingerprint) {
      throw new PmsValidationError('This charge idempotency key was already used for a different charge.', 409)
    }
    const existingFolio = await chargeFolioSnapshot(tx, existingCharge.folioId, property.id)
    if (!existingFolio) throw new PmsValidationError('Folio was not found.', 404)
    return { charge: existingCharge, folio: existingFolio, idempotentReplay: true }
  }

  const folio = await tx.folio.findFirst({
    where: { id: input.folioId, reservation: { propertyId: property.id } },
    include: { reservation: true },
  })
  if (!folio) throw new PmsValidationError('Folio was not found.', 404)
  if (folio.status !== 'OPEN') {
    throw new PmsValidationError('Charges can only be posted to an open folio.')
  }

  const validatedSourceEmailEventId = await validateSourceEmailEventId(tx, property.id, sourceEmailEventId)
  const totalSatang = amountSatang * BigInt(quantity)
  if (totalSatang > MAX_SAFE_MONEY_SATANG) {
    throw new PmsValidationError('Charge total exceeds the supported exact-money range.')
  }
  const charge = await tx.charge.create({
    data: {
      propertyId: property.id,
      folioId: folio.id,
      idempotencyKey,
      intentFingerprint,
      date: dateFromKey(requestedDateKey || getBangkokDateKey(new Date())),
      description,
      category,
      ...dualWriteMoney('amount', 'amountSatang', amountSatang),
      quantity,
      ...dualWriteMoney('total', 'totalSatang', totalSatang),
      sourceEmailEventId: validatedSourceEmailEventId,
      createdBy: actorName(actor),
    },
  })
  const updatedFolio = await recomputeFolio(tx, folio.id)
  await createAudit(tx, actor, 'CHARGE_CREATED', 'charge', charge.id, {
    folioId: folio.id,
    amount: charge.amount,
    amountSatang: satangToApiString(amountSatang),
    quantity,
    category,
    sourceEmailEventId: validatedSourceEmailEventId,
    idempotencyKey: createHash('sha256').update(idempotencyKey).digest('hex'),
  })
  await emitOperationalEvent(tx, property.id, 'CHARGE_CREATED', 'charge', charge.id, actor, { folioId: folio.id })
  return { charge, folio: updatedFolio, idempotentReplay: false }
}

export async function createCharge(prisma, input, actor) {
  const idempotencyKey = normalizeChargeIdempotencyKey(input?.idempotencyKey)
  try {
    return await serializableTransaction(prisma, async (tx) => recordChargeInTransaction(tx, input, actor))
  } catch (error) {
    if (error?.code === 'P2002' && idempotencyKey) {
      return serializableTransaction(prisma, async (tx) => recordChargeInTransaction(tx, input, actor))
    }
    throw error
  }
}

export async function createGuest(prisma, input, actor, options = {}) {
  return serializableTransaction(prisma, async (tx) => {
    const property = await getProperty(tx, actor)
    const idempotencyKey = options.requireIdempotency || options.idempotencyKey
      ? requireCreateIdempotencyKey(options.idempotencyKey)
      : null
    const createAttempt = idempotencyKey
      ? await claimPmsCreateAttempt(tx, {
        propertyId: property.id,
        idempotencyKey,
        operation: 'CREATE_GUEST',
        intent: input,
      })
      : null
    if (createAttempt?.replay) {
      const existing = createAttempt.attempt.entityId
        ? await tx.guest.findFirst({ where: { id: createAttempt.attempt.entityId, propertyId: property.id } })
        : null
      return assertPmsCreateReplay(createAttempt.attempt, {
        entityType: 'guest',
        entityId: existing?.id,
        result: existing,
      })
    }
    const guest = await tx.guest.create({ data: { ...validateGuestInput(input), propertyId: property.id } })
    await createAudit(tx, actor, 'CREATED', 'guest', guest.id)
    await emitOperationalEvent(tx, property.id, 'GUEST_CREATED', 'guest', guest.id, actor)
    if (createAttempt) {
      await completePmsCreateAttempt(tx, createAttempt.attempt, {
        entityType: 'guest',
        entityId: guest.id,
        result: guest,
      })
    }
    return guest
  })
}

export async function updateGuest(prisma, guestId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx, actor)
    const data = validateGuestInput(input)
    const existing = await tx.guest.findFirst({ where: { id: guestId, propertyId: property.id } })
    if (!existing) throw new PmsValidationError('Guest was not found.', 404)
    const guest = await tx.guest.update({ where: { id: existing.id }, data })
    await createAudit(tx, actor, 'MODIFIED', 'guest', guest.id)
    await emitOperationalEvent(tx, property.id, 'GUEST_UPDATED', 'guest', guest.id, actor)
    return guest
  })
}

export async function getTodayData(prisma, actor) {
  const property = await getProperty(prisma, actor)
  const todayKey = getBangkokDateKey(new Date())
  const today = dateFromKey(todayKey)
  const tomorrow = dateFromKey(nextDateKey(todayKey))
  const [rooms, arrivals, departures, inHouse, unpaidFolios, unassignedArrivals, noShows, inboxExceptions, housekeepingBlockers] = await Promise.all([
    prisma.room.findMany({ where: { propertyId: property.id }, include: { roomType: true }, orderBy: [{ floor: 'asc' }, { number: 'asc' }] }),
    prisma.reservation.count({ where: { propertyId: property.id, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN', checkOut: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN' } }),
    prisma.folio.count({ where: { reservation: { propertyId: property.id }, balance: { gt: 0 } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: { in: ['PENDING', 'CONFIRMED'] }, assignedRoomId: null, checkIn: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'NO_SHOW', checkIn: { gte: today, lt: tomorrow } } }),
    prisma.bookingEmailEvent.count({ where: { propertyId: property.id, status: { in: ['NEEDS_REVIEW', 'ERROR'] } } }),
    prisma.housekeepingIssue.count({ where: { propertyId: property.id, status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] }, severity: { in: ['HIGH', 'CRITICAL'] } } }),
  ])

  return {
    hotelDate: todayKey,
    arrivals,
    departures,
    inHouse,
    unpaidFolios,
    unassignedArrivals,
    noShows,
    inboxExceptions,
    housekeepingBlockers,
    roomsTotal: rooms.length,
    roomsSellable: rooms.filter(isOperationallySellableRoom).length,
    roomsDirty: rooms.filter((room) => room.currentStatus === 'VACANT_DIRTY' || room.currentStatus === 'OCCUPIED_DIRTY').length,
    roomsReady: rooms.filter((room) => room.operationalStatus === 'AVAILABLE' && ['VACANT_CLEAN', 'INSPECTED'].includes(room.currentStatus)).length,
  }
}

export async function getFrontDeskBoard(prisma, actor, rangeInput = {}) {
  const property = await getProperty(prisma, actor)
  const range = resolveFrontDeskBoardRange(rangeInput)
  const reservationWhere = {
    propertyId: property.id,
    status: { in: activeReservationStatuses() },
    ...(range ? {
      checkIn: { lt: range.toDate },
      checkOut: { gt: range.fromDate },
    } : {}),
  }
  const inventoryBlockWhere = range ? {
    propertyId: property.id,
    date: { gte: range.fromDate, lt: range.toDate },
    status: { in: ['BLOCKED', 'OUT_OF_SERVICE'] },
  } : null

  const [roomTypes, rooms, reservations, inventoryBlocks] = await Promise.all([
    prisma.roomType.findMany({
      where: { propertyId: property.id },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    }),
    prisma.room.findMany({
      where: { propertyId: property.id },
      include: { roomType: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: reservationWhere,
      include: reservationInclude,
      orderBy: [{ checkIn: 'asc' }, { checkOut: 'asc' }, { id: 'asc' }],
    }),
    inventoryBlockWhere
      ? prisma.roomDateInventory.findMany({
          where: inventoryBlockWhere,
          select: {
            id: true,
            roomId: true,
            date: true,
            status: true,
            notes: true,
            updatedAt: true,
          },
          orderBy: [{ date: 'asc' }, { roomId: 'asc' }],
        })
      : Promise.resolve([]),
  ])

  return {
    property,
    rooms,
    reservations: reservations.map((reservation) => boardReservationDto(reservation, actor)),
    propertyDisplay: {
      id: property.id,
      code: property.code,
      name: property.name,
      timezone: property.timezone,
      currency: property.currency,
      defaultCheckIn: property.defaultCheckIn,
      defaultCheckOut: property.defaultCheckOut,
      extraGuestFee: property.extraGuestFee,
      extraGuestFeeSatang: satangToApiString(readMoneySatang(property, 'extraGuestFee')),
      childFee: property.childFee,
      childFeeSatang: satangToApiString(readMoneySatang(property, 'childFee')),
      taxRate: property.taxRate,
      taxRateBasisPoints: property.taxRateBasisPoints ?? Math.round(Number(property.taxRate || 0) * 100),
    },
    roomTypes,
    inventoryBlocks,
    range: range ? {
      from: range.from,
      to: range.to,
      durationDays: range.durationDays,
      semantics: 'FROM_INCLUSIVE_TO_EXCLUSIVE',
    } : null,
  }
}
