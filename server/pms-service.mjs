import { createHash } from 'node:crypto'
import {
  SANDBOX_RULES,
  activeReservationStatuses,
  assertHousekeepingTransition,
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
import {
  MONEY_SATANG_MIN,
  assertMoneySatang,
  dualWriteMoneyFromSatang,
  dualWriteMoneyFromThb,
  dualWriteTaxRateFromPercent,
  sumMoneySatang,
} from './money-satang.mjs'
import {
  MANUAL_CHANNEL_PROVIDERS,
  buildManualChannelExternalReferenceKey,
  manualChannelProviderFromEmailSender,
  normalizeManualChannelProviderCode,
  reconcileManualChannelTasksInTransaction,
} from './manual-channel-service.mjs'
import {
  approvedBookingEmailProviderQuery,
  bookingEmailSourceReconciliationQuery,
} from './booking-email-query.mjs'

const reservationBookingEmailEventSelect = {
  id: true,
  sourceId: true,
  sourceName: true,
  sourceMailbox: true,
  sourceMessageId: true,
  sender: true,
  subject: true,
  receivedAt: true,
  eventType: true,
  status: true,
  channelRef: true,
  providerCode: true,
  externalReservationId: true,
  guestName: true,
  checkIn: true,
  checkOut: true,
  roomType: true,
  amount: true,
  amountSatang: true,
  currency: true,
  confidence: true,
  proposedAction: true,
  completedAction: true,
  reviewReason: true,
  errorReason: true,
  rawEmailUrl: true,
  reservationId: true,
  duplicateOfEventId: true,
  processedAt: true,
  processedBy: true,
  rejectedAt: true,
  createdAt: true,
  updatedAt: true,
}

const reservationInclude = {
  guest: true,
  roomType: true,
  assignedRoom: true,
  sourceEmailEvent: { select: reservationBookingEmailEventSelect },
  folio: {
    include: {
      charges: {
        include: {
          sourceEmailEvent: { select: reservationBookingEmailEventSelect },
        },
      },
      payments: {
        include: {
          sourceEmailEvent: { select: reservationBookingEmailEventSelect },
        },
      },
    },
  },
  bookingEmailEvents: {
    select: reservationBookingEmailEventSelect,
    orderBy: { receivedAt: 'desc' },
    take: 10,
  },
}

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

function actorName(actor) {
  return actor?.name || actor?.email || actor?.username || actor?.id || 'System'
}

function normalizeNullableString(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function moneyValidationError(error) {
  if (error instanceof PmsValidationError) return error
  return new PmsValidationError(error?.message || 'Enter a valid monetary amount.')
}

function moneyPairFromThb(value, label, {
  nullable = false,
  minimum = 0,
} = {}) {
  try {
    return dualWriteMoneyFromThb(value, { label, nullable, minimum })
  } catch (error) {
    throw moneyValidationError(error)
  }
}

function moneyPairFromSatang(value, label, {
  nullable = false,
  minimum = 0,
} = {}) {
  try {
    return dualWriteMoneyFromSatang(value, { label, nullable, minimum })
  } catch (error) {
    throw moneyValidationError(error)
  }
}

const folioRuntimeInclude = {
  charges: true,
  payments: true,
  reservation: {
    include: {
      guest: true,
      roomType: true,
      assignedRoom: true,
    },
  },
}

function assertExpectedReservationVersion(reservation, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined) return
  const expected = new Date(expectedUpdatedAt)
  if (Number.isNaN(expected.getTime())) {
    throw new PmsValidationError('Reservation version must be a valid timestamp.')
  }
  if (expected.toISOString() !== reservation.updatedAt.toISOString()) {
    throw new PmsValidationError('This reservation changed after you opened it. Refresh the booking board and try again.', 409)
  }
}

function moneyPairFromInput(input, satangField, thbField, label, options = {}) {
  const hasSatang = Object.hasOwn(input || {}, satangField)
  const hasThb = Object.hasOwn(input || {}, thbField)
  if (!hasSatang && !hasThb) {
    return moneyPairFromSatang(undefined, label, options)
  }

  const authoritative = hasSatang
    ? moneyPairFromSatang(input[satangField], label, options)
    : moneyPairFromThb(input[thbField], label, options)
  if (hasSatang && hasThb) {
    const legacy = moneyPairFromThb(input[thbField], label, options)
    if (authoritative.satang !== legacy.satang) {
      throw new PmsValidationError(`${label} THB and MoneySatang values do not match.`)
    }
  }
  return authoritative
}

function taxRatePairFromPercent(value, label = 'Tax rate') {
  try {
    return dualWriteTaxRateFromPercent(value, { label })
  } catch (error) {
    throw moneyValidationError(error)
  }
}

function storedMoneyPair(record, satangField, thbField, label, options = {}) {
  // Satang is the runtime authority. The Float fallback is retained only for
  // legacy rows/test fixtures during the expand-and-backfill rollback window.
  if (record?.[satangField] !== null && record?.[satangField] !== undefined) {
    return moneyPairFromSatang(record[satangField], label, options)
  }
  return moneyPairFromThb(record?.[thbField], label, options)
}

function multiplyMoneySatang(value, quantity, label) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new PmsValidationError(`${label} quantity must be a non-negative integer.`)
  }
  const product = BigInt(assertMoneySatang(value, { label, minimum: 0 })) * BigInt(quantity)
  if (product > 2_147_483_647n) {
    throw new PmsValidationError(`${label} is outside the supported PostgreSQL INTEGER range.`)
  }
  return Number(product)
}

function percentageMoneySatang(value, basisPoints, label) {
  const satang = assertMoneySatang(value, { label, minimum: 0 })
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new PmsValidationError(`${label} percentage is invalid.`)
  }
  const numerator = BigInt(satang) * BigInt(basisPoints)
  const denominator = 10_000n
  const rounded = (numerator + (denominator / 2n)) / denominator
  return moneyPairFromSatang(Number(rounded), label, { minimum: 0 })
}

export function calculateStayMoney(input) {
  const ratePerNight = moneyPairFromInput(input, 'ratePerNightSatang', 'ratePerNight', 'Rate per night', { minimum: 1 })
  const pricing = calculateStayPricing({ ...input, ratePerNight: ratePerNight.thb })
  const extraGuestFeePerNight = moneyPairFromThb(
    input.extraGuestFeePerNight ?? SANDBOX_RULES.extraGuestFeePerNight,
    'Extra guest fee per night',
  )
  const childSharingFeePerNight = moneyPairFromThb(
    input.childSharingFeePerNight ?? SANDBOX_RULES.childSharingFeePerNight,
    'Child sharing fee per night',
  )
  const adults = Number(input.adults)
  const standardOccupancy = Number(input.standardOccupancy ?? SANDBOX_RULES.standardOccupancy)
  const childAges = Array.isArray(input.childAges) ? input.childAges.map(Number) : []
  const extraAdults = Math.max(0, adults - standardOccupancy)
  const chargedChildren = childAges.filter((age) => (
    age > SANDBOX_RULES.childFreeMaxAge && age <= SANDBOX_RULES.childSharingMaxAge
  )).length
  const roomSubtotalSatang = multiplyMoneySatang(ratePerNight.satang, pricing.nights, 'Room subtotal')
  const extraGuestFeeSatang = multiplyMoneySatang(
    extraGuestFeePerNight.satang,
    extraAdults * pricing.nights,
    'Extra guest fee',
  )
  const childFeeSatang = multiplyMoneySatang(
    childSharingFeePerNight.satang,
    chargedChildren * pricing.nights,
    'Child sharing fee',
  )
  let totalSatang
  try {
    totalSatang = sumMoneySatang(roomSubtotalSatang, extraGuestFeeSatang, childFeeSatang)
  } catch (error) {
    throw moneyValidationError(error)
  }
  const total = moneyPairFromSatang(totalSatang, 'Stay total', { minimum: 0 })
  const deposit = percentageMoneySatang(total.satang, 3_000, 'Reservation deposit')

  return {
    nights: pricing.nights,
    ratePerNight: ratePerNight.thb,
    ratePerNightSatang: ratePerNight.satang,
    roomSubtotal: roomSubtotalSatang / 100,
    roomSubtotalSatang,
    extraGuestFee: extraGuestFeeSatang / 100,
    extraGuestFeeSatang,
    childFee: childFeeSatang / 100,
    childFeeSatang,
    total: total.thb,
    totalSatang: total.satang,
    depositAmount: deposit.thb,
    depositAmountSatang: deposit.satang,
  }
}

export function withAuthoritativeStayTotal(pricing, totalSatang) {
  if (totalSatang === undefined) return pricing
  const total = moneyPairFromSatang(totalSatang, 'Authoritative stay total', { minimum: 1 })
  const deposit = percentageMoneySatang(total.satang, 3_000, 'Reservation deposit')
  return {
    ...pricing,
    // An OTA total is inclusive. Do not add the PMS occupancy supplements a
    // second time when the provider already supplied the full stay amount.
    roomSubtotal: total.thb,
    roomSubtotalSatang: total.satang,
    extraGuestFee: 0,
    extraGuestFeeSatang: 0,
    childFee: 0,
    childFeeSatang: 0,
    total: total.thb,
    totalSatang: total.satang,
    depositAmount: deposit.thb,
    depositAmountSatang: deposit.satang,
  }
}

export function buildChargeMoneyFields(amount, quantity = 1, explicitTotal = undefined) {
  const unit = moneyPairFromThb(amount, 'Charge amount', { minimum: 1 })
  const totalSatang = explicitTotal === undefined
    ? multiplyMoneySatang(unit.satang, quantity, 'Charge total')
    : moneyPairFromThb(explicitTotal, 'Charge total', { minimum: 0 }).satang
  const total = moneyPairFromSatang(totalSatang, 'Charge total', { minimum: 0 })
  return {
    amount: unit.thb,
    amountSatang: unit.satang,
    total: total.thb,
    totalSatang: total.satang,
  }
}

export function buildChargeMoneyFieldsFromSatang(amountSatang, quantity = 1, explicitTotalSatang = undefined) {
  const unit = moneyPairFromSatang(amountSatang, 'Charge amount', { minimum: 1 })
  const totalSatang = explicitTotalSatang === undefined
    ? multiplyMoneySatang(unit.satang, quantity, 'Charge total')
    : moneyPairFromSatang(explicitTotalSatang, 'Charge total', { minimum: 0 }).satang
  const total = moneyPairFromSatang(totalSatang, 'Charge total', { minimum: 0 })
  return {
    amount: unit.thb,
    amountSatang: unit.satang,
    total: total.thb,
    totalSatang: total.satang,
  }
}

export function buildFolioMoneyFields(charges, payments, { taxSatang = 0 } = {}) {
  const chargeValues = (Array.isArray(charges) ? charges : [])
    .filter((charge) => !charge.void)
    .map((charge) => storedMoneyPair(charge, 'totalSatang', 'total', 'Charge total', { minimum: 0 }).satang)
  const paymentValues = (Array.isArray(payments) ? payments : [])
    .map((payment) => storedMoneyPair(payment, 'amountSatang', 'amount', 'Payment amount', { minimum: 0 }).satang)
  let subtotalValue
  let paidValue
  let totalValue
  let balanceValue
  try {
    subtotalValue = sumMoneySatang(...chargeValues)
    paidValue = sumMoneySatang(...paymentValues)
    const normalizedTax = assertMoneySatang(taxSatang, { label: 'Folio tax', minimum: 0 })
    totalValue = sumMoneySatang(subtotalValue, normalizedTax)
    balanceValue = sumMoneySatang(totalValue, -paidValue)
  } catch (error) {
    throw moneyValidationError(error)
  }
  const subtotal = moneyPairFromSatang(subtotalValue, 'Folio subtotal', { minimum: 0 })
  const tax = moneyPairFromSatang(taxSatang, 'Folio tax', { minimum: 0 })
  const total = moneyPairFromSatang(totalValue, 'Folio total', { minimum: 0 })
  const paid = moneyPairFromSatang(paidValue, 'Folio paid', { minimum: 0 })
  const balance = moneyPairFromSatang(balanceValue, 'Folio balance', { minimum: MONEY_SATANG_MIN })
  return {
    subtotal: subtotal.thb,
    subtotalSatang: subtotal.satang,
    tax: tax.thb,
    taxSatang: tax.satang,
    total: total.thb,
    totalSatang: total.satang,
    paid: paid.thb,
    paidSatang: paid.satang,
    balance: balance.thb,
    balanceSatang: balance.satang,
  }
}

function normalizePaymentReferenceFingerprint(method, reference) {
  const normalizedReference = normalizeNullableString(reference)
  if (!normalizedReference) return null
  return `${normalizePaymentMethod(method)}:${normalizedReference.toUpperCase().replace(/\s+/g, '')}`
}

function pricingRulesFor(property, roomType) {
  const extraGuestFee = property
    ? storedMoneyPair(property, 'extraGuestFeeSatang', 'extraGuestFee', 'Extra guest fee', { minimum: 0 }).thb
    : SANDBOX_RULES.extraGuestFeePerNight
  const childFee = property
    ? storedMoneyPair(property, 'childFeeSatang', 'childFee', 'Child sharing fee', { minimum: 0 }).thb
    : SANDBOX_RULES.childSharingFeePerNight
  return {
    standardOccupancy: roomType?.standardOcc ?? SANDBOX_RULES.standardOccupancy,
    maxOccupancy: roomType?.maxOccupancy ?? SANDBOX_RULES.maxOccupancy,
    extraGuestFeePerNight: extraGuestFee,
    childSharingFeePerNight: childFee,
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

function isOperationallySellableRoom(room) {
  return Boolean(
    String(room?.number || '').trim() &&
    !['BLOCKED', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'].includes(room.operationalStatus),
  )
}

async function getProperty(tx) {
  const property = await tx.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } })
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
    setupNumber(rate?.baseRate, `Base rate for ${roomType.name}`, { min: 1 })
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

  const taxRate = taxRatePairFromPercent(property.taxRate ?? property.taxRatePercent ?? 0, 'Property tax rate')
  const extraGuestFee = moneyPairFromThb(
    property.extraGuestFee ?? roomTypes[0]?.extraGuestFee ?? 0,
    'Extra guest fee',
    { minimum: 0 },
  )
  const childFee = moneyPairFromThb(
    property.childFee ?? roomTypes[0]?.childFee ?? 0,
    'Child fee',
    { minimum: 0 },
  )
  const inventoryMinimumRate = moneyPairFromThb(
    property.inventoryMinimumRate ?? null,
    'Inventory minimum rate',
    { nullable: true, minimum: 0 },
  )

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
      taxRate: taxRate.percent,
      taxRateBps: taxRate.basisPoints,
      extraGuestFee: extraGuestFee.thb,
      extraGuestFeeSatang: extraGuestFee.satang,
      childFee: childFee.thb,
      childFeeSatang: childFee.satang,
      inventoryMinimumRate: inventoryMinimumRate.thb,
      inventoryMinimumRateSatang: inventoryMinimumRate.satang,
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

function normalizeBookingSourceFromEmail(sender, sourceName, verifiedProviderCode = null) {
  if (verifiedProviderCode === 'booking_com') return 'BOOKING_COM'
  if (verifiedProviderCode === 'agoda') return 'AGODA'
  if (verifiedProviderCode === 'trip_com') return 'TRIP_COM'
  const senderText = String(sender || '').trim().toLowerCase()
  const senderAddress = senderText.match(/<([^<>]+)>/)?.[1] || senderText.match(/\b[^\s<>@]+@[^\s<>]+\b/)?.[0] || ''
  const senderHostname = senderAddress.split('@').at(-1)?.replace(/[>,;]+$/g, '') || ''
  if (senderHostname === 'expedia.com' || senderHostname.endsWith('.expedia.com')) return 'EXPEDIA'
  if (senderHostname === 'airbnb.com' || senderHostname.endsWith('.airbnb.com')) return 'AIRBNB'
  const text = String(sourceName || '').toLowerCase()
  if (text.includes('booking.com') || text.includes('bookingcom')) return 'BOOKING_COM'
  if (text.includes('agoda')) return 'AGODA'
  if (text.includes('trip.com') || text.includes('tripcom')) return 'TRIP_COM'
  if (text.includes('expedia')) return 'EXPEDIA'
  if (text.includes('airbnb')) return 'AIRBNB'
  return 'EMAIL'
}

const MANUAL_CHANNEL_PROVIDER_BY_BOOKING_SOURCE = Object.freeze({
  BOOKING_COM: 'booking_com',
  AGODA: 'agoda',
  TRIP_COM: 'trip_com',
})

const BOOKING_CONFIRMATION_PREFIX_BY_PROVIDER = Object.freeze({
  booking_com: 'BKG',
  agoda: 'AGO',
  trip_com: 'TRP',
})

function bookingSourceProviderCode(source) {
  return MANUAL_CHANNEL_PROVIDER_BY_BOOKING_SOURCE[String(source || '').trim().toUpperCase()] || null
}

function senderEmailHostname(value) {
  const text = String(value || '').trim().toLowerCase()
  const address = text.match(/<([^<>]+)>/)?.[1] || text.match(/\b[^\s<>@]+@[^\s<>]+\b/)?.[0] || ''
  return address.split('@').at(-1)?.replace(/[>,;]+$/g, '').replace(/\.$/, '') || ''
}

function hostnameMatchesProvider(hostname, providerCode) {
  const allowedDomains = MANUAL_CHANNEL_PROVIDERS[providerCode]?.allowedExtranetDomains || []
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function authenticationResultDomain(segment, key) {
  const expression = new RegExp(`\\b${key.replace('.', '\\.')}=([^\\s;()]+)`, 'i')
  const raw = String(segment || '').match(expression)?.[1] || ''
  const addressDomain = raw.includes('@') ? raw.split('@').at(-1) : raw
  return addressDomain.toLowerCase().replace(/[>,;]+$/g, '').replace(/\.$/, '')
}

function verifiedProviderFromAuthenticationResults(sender, rawHeaders = {}) {
  const senderProvider = manualChannelProviderFromEmailSender(sender)
  if (!senderProvider) return { providerCode: null, senderProvider: null, verified: false, reason: 'not_known_provider_sender' }
  const senderHostname = senderEmailHostname(sender)
  if (!hostnameMatchesProvider(senderHostname, senderProvider)) {
    return { providerCode: null, senderProvider, verified: false, reason: 'sender_domain_not_allowed' }
  }

  // Only Authentication-Results generated by the Gmail receiving path is used.
  // ARC headers are intentionally not sufficient because they can describe a
  // forwarded hop rather than an aligned provider identity.
  const authenticationResults = String(safeJsonObject(rawHeaders).authenticationResults || '').trim().toLowerCase()
  if (!/^mx\.google\.com\s*;/.test(authenticationResults)) {
    return { providerCode: null, senderProvider, verified: false, reason: 'trusted_gmail_authentication_missing' }
  }
  const segments = authenticationResults.split(';')
  const alignedDmarc = segments.some((segment) => {
    if (!/\bdmarc=pass\b/.test(segment)) return false
    return hostnameMatchesProvider(authenticationResultDomain(segment, 'header.from'), senderProvider)
  })
  const alignedDkim = segments.some((segment) => {
    if (!/\bdkim=pass\b/.test(segment)) return false
    const signingDomain = authenticationResultDomain(segment, 'header.d') || authenticationResultDomain(segment, 'header.i')
    return hostnameMatchesProvider(signingDomain, senderProvider)
  })
  const verified = alignedDmarc || alignedDkim
  return {
    providerCode: verified ? senderProvider : null,
    senderProvider,
    verified,
    reason: verified ? (alignedDmarc ? 'aligned_dmarc_pass' : 'aligned_dkim_pass') : 'aligned_authentication_missing',
  }
}

function bookingEmailChannelProviderCode(input = {}) {
  if (input.providerCode) return normalizeManualChannelProviderCode(input.providerCode)
  return verifiedProviderFromAuthenticationResults(input.sender, input.rawHeaders).providerCode
}

function reservationExternalReferenceData(propertyId, input = {}) {
  const externalReservationId = normalizeNullableString(input.externalReservationId || input.channelRef)
  const providerCode = input.providerCode
    ? normalizeManualChannelProviderCode(input.providerCode)
    : bookingSourceProviderCode(input.source)
  if (!providerCode || !externalReservationId) {
    return {
      providerCode: providerCode || null,
      externalReservationId: null,
      externalReferenceKey: null,
    }
  }
  return {
    providerCode,
    externalReservationId,
    externalReferenceKey: buildManualChannelExternalReferenceKey(propertyId, providerCode, externalReservationId),
  }
}

function requireOperationalReason(value, label) {
  const reason = normalizeNullableString(value)
  if (!reason) throw new PmsValidationError(`${label} requires an operational reason.`)
  return reason
}

function manualChannelAffectedStay(roomTypeId, checkIn, checkOut) {
  const dateStart = [getBangkokDateKey(new Date()), getBangkokDateKey(checkIn)].sort().at(-1)
  const dateEnd = getBangkokDateKey(checkOut)
  return dateStart < dateEnd ? { roomTypeId, dateStart, dateEnd } : null
}

// Lite V1 reconciles room-capacity changes for the next 90 sell nights, starting
// with today in Bangkok. A room-type move can affect at most two types, so one
// mutation contributes at most 180 room-date cells (below the service cap).
// Beyond-horizon capacity is covered by manual/scheduled maintenance until the
// queue can fan out asynchronously without extending a foreground transaction.
const MANUAL_CHANNEL_ROOM_CAPACITY_HORIZON_DAYS = 90

function dateKeyPlusDays(dateKey, days) {
  const date = dateFromKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function manualChannelFutureCapacityStay(roomTypeId, now = new Date()) {
  const dateStart = getBangkokDateKey(now)
  return {
    roomTypeId,
    dateStart,
    dateEnd: dateKeyPlusDays(dateStart, MANUAL_CHANNEL_ROOM_CAPACITY_HORIZON_DAYS),
  }
}

function manualChannelRemainingStay(roomTypeId, checkIn, checkOut, now = new Date()) {
  const todayKey = getBangkokDateKey(now)
  const dateStart = [todayKey, getBangkokDateKey(checkIn)].sort().at(-1)
  const dateEnd = getBangkokDateKey(checkOut)
  return dateStart < dateEnd ? { roomTypeId, dateStart, dateEnd } : null
}

function roomCapacityAffectedStays(beforeRoom, afterRoom, now = new Date()) {
  const capacityDeltaByRoomType = new Map()
  if (isOperationallySellableRoom(beforeRoom)) {
    capacityDeltaByRoomType.set(beforeRoom.roomTypeId, (capacityDeltaByRoomType.get(beforeRoom.roomTypeId) || 0) - 1)
  }
  if (isOperationallySellableRoom(afterRoom)) {
    capacityDeltaByRoomType.set(afterRoom.roomTypeId, (capacityDeltaByRoomType.get(afterRoom.roomTypeId) || 0) + 1)
  }
  return [...capacityDeltaByRoomType.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([roomTypeId]) => manualChannelFutureCapacityStay(roomTypeId, now))
}

async function reconcileReservationAvailabilityInTransaction(tx, input, actor) {
  const affected = Array.isArray(input.affected) ? input.affected.filter(Boolean) : []
  if (affected.length === 0) return null
  const context = safeJsonObject(input.manualChannelContext)
  return reconcileManualChannelTasksInTransaction(tx, {
    propertyId: input.propertyId,
    affected,
    triggerType: context.triggerType || input.triggerType,
    sourceProviderCode: context.sourceProviderCode || input.sourceProviderCode || undefined,
    sourceProviderAlreadyUpdated: Boolean(context.sourceProviderAlreadyUpdated || input.sourceProviderAlreadyUpdated),
    sourceReservationId: input.sourceReservationId,
    sourceBookingEmailEventId: context.sourceBookingEmailEventId || input.sourceBookingEmailEventId || undefined,
  }, actor)
}

async function reconcileRoomCapacityInTransaction(tx, input, actor) {
  const affected = roomCapacityAffectedStays(input.beforeRoom, input.afterRoom)
  if (affected.length === 0) return null
  return reconcileReservationAvailabilityInTransaction(tx, {
    propertyId: input.propertyId,
    affected,
    triggerType: input.triggerType,
  }, actor)
}

function rejectInternalReservationFields(input, operation) {
  const internalFields = [
    'manualChannelContext',
    'sourceEmailEventId',
    'authoritativeTotalSatang',
    'providerTotalSatang',
    'providerTotalCurrency',
    'providerCode',
    'externalReservationId',
    'externalReferenceKey',
    'status',
  ]
  const supplied = internalFields.filter((field) => Object.hasOwn(input || {}, field))
  if (supplied.length > 0) {
    throw new PmsValidationError(`${operation} cannot set internal integration fields: ${supplied.join(', ')}.`)
  }
}

function requireBookingEmailAmountCurrency(event, details, property, label) {
  const currency = normalizeNullableString(event.currency)?.toUpperCase()
  const editedCurrency = normalizeNullableString(details.currency)?.toUpperCase()
  const propertyCurrency = normalizeNullableString(property.currency)?.toUpperCase()
  if (!propertyCurrency) {
    throw new PmsValidationError('The property currency must be configured before applying booking-email amounts.')
  }
  if (!currency) {
    throw new PmsValidationError(`${label} must have a parser-verified currency before applying the amount.`)
  }
  if (editedCurrency && editedCurrency !== currency) {
    throw new PmsValidationError(`${label} currency cannot be relabelled during approval. Reprocess or reject the source event.`, 409)
  }
  if (currency !== propertyCurrency) {
    throw new PmsValidationError(`${label} currency ${currency} does not match the property currency ${propertyCurrency}.`, 409)
  }
  return currency
}

function requireBookingEmailAmountKind(event, allowedKinds, label) {
  const parsedDetails = safeJsonObject(event.parsedDetails)
  if (parsedDetails.amountAmbiguous) {
    throw new PmsValidationError(
      `${label} has multiple conflicting values in the source email. Reprocess or reject the event instead of applying a guessed amount.`,
      409,
    )
  }
  const amountKind = normalizeBookingEmailAmountKind(parsedDetails.amountKind)
  if (!allowedKinds.includes(amountKind)) {
    throw new PmsValidationError(
      `${label} must be parser-verified as ${allowedKinds.join(' or ').toLowerCase().replaceAll('_', ' ')} before it can be applied.`,
      409,
    )
  }
  return amountKind
}

function splitGuestName(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  const parts = normalized.split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Guest' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

const KNOWN_BOOKING_EMAIL_CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('currency')
    : ['THB', 'USD', 'EUR', 'GBP', 'CNY', 'JPY', 'SGD', 'AUD'],
)

function parsedMoneyCandidate(match, amountIndex, amountKind, currencyIndexes = []) {
  if (!match) return null
  const amount = Number(String(match[amountIndex] || '').replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const currency = currencyIndexes
    .map((index) => normalizeNullableString(match[index]))
    .find((code) => code && code === code.toUpperCase() && KNOWN_BOOKING_EMAIL_CURRENCIES.has(code))
  return {
    amount,
    amountKind,
    ...(currency ? { currency } : {}),
  }
}

function parseMoneyCandidates(text) {
  const value = String(text || '')
  const amountPattern = '([0-9][0-9,]*(?:\\.\\d{1,2})?)'
  const currencyPattern = '([A-Z]{3})'
  const distinctCandidates = (matches, amountIndex, amountKind, currencyIndexes) => {
    const candidates = matches
      .map((match) => parsedMoneyCandidate(match, amountIndex, amountKind, currencyIndexes))
      .filter(Boolean)
    const distinct = new Map(candidates.map((candidate) => [
      `${candidate.amount}|${candidate.currency || ''}`,
      candidate,
    ]))
    return {
      candidate: candidates[0] || null,
      ambiguous: distinct.size > 1,
    }
  }
  const labeledCandidates = (labels, amountKind) => distinctCandidates(
    [...value.matchAll(new RegExp(`\\b(?:${labels})\\s*[:#-]?\\s*(?:${currencyPattern}\\s*)?${amountPattern}(?:\\s*${currencyPattern})?\\b`, 'gi'))],
    2,
    amountKind,
    [1, 3],
  )

  const stayTotal = labeledCandidates(
    'total(?: amount| price)?|booking total|reservation total|total price|booking price|reservation price',
    'STAY_TOTAL',
  )
  const payment = labeledCandidates(
    'amount received|amount paid|payment amount|paid amount|payment received|paid total',
    'PAYMENT',
  )
  const deposit = labeledCandidates('deposit amount|deposit paid|deposit received', 'DEPOSIT')
  const currencyBefore = distinctCandidates(
    [...value.matchAll(new RegExp(`\\b${currencyPattern}\\s*${amountPattern}\\b`, 'gi'))],
    2,
    'UNKNOWN',
    [1],
  )
  const currencyAfter = distinctCandidates(
    [...value.matchAll(new RegExp(`\\b${amountPattern}\\s*${currencyPattern}\\b`, 'gi'))],
    1,
    'UNKNOWN',
    [2],
  )
  const unknownCandidates = [currencyBefore.candidate, currencyAfter.candidate].filter(Boolean)
  const unknownDistinct = new Set(unknownCandidates.map((candidate) => `${candidate.amount}|${candidate.currency || ''}`))
  return {
    stayTotal: stayTotal.candidate,
    payment: payment.candidate,
    deposit: deposit.candidate,
    unknown: unknownCandidates[0] || null,
    ambiguousKinds: [
      ...(stayTotal.ambiguous ? ['STAY_TOTAL'] : []),
      ...(payment.ambiguous ? ['PAYMENT'] : []),
      ...(deposit.ambiguous ? ['DEPOSIT'] : []),
      ...(currencyBefore.ambiguous || currencyAfter.ambiguous || unknownDistinct.size > 1 ? ['UNKNOWN'] : []),
    ],
  }
}

function normalizeBookingEmailAmountKind(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return ['STAY_TOTAL', 'PAYMENT', 'DEPOSIT'].includes(normalized) ? normalized : 'UNKNOWN'
}

function selectParsedMoneyForEvent(eventType, candidates) {
  if (eventType === 'PAYMENT_NOTICE') {
    return candidates.payment || candidates.deposit || candidates.stayTotal || candidates.unknown || {}
  }
  if (eventType === 'NEW_BOOKING' || eventType === 'MODIFICATION') {
    return candidates.stayTotal || candidates.deposit || candidates.payment || candidates.unknown || {}
  }
  return candidates.stayTotal || candidates.payment || candidates.deposit || candidates.unknown || {}
}

function normalizeParsedDateValue(raw) {
  if (!raw) return undefined
  let dateKey
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map((part) => part.padStart(2, '0'))
    dateKey = `${year}-${month}-${day}`
  } else {
    const [day, month, yearPart] = raw.split(/[/.]/)
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart
    dateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  try {
    dateFromKey(dateKey)
    return dateKey
  } catch {
    return undefined
  }
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
    const start = normalizeParsedDateValue(labeled?.[1])
    const end = normalizeParsedDateValue(labeled?.[2])
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
      /(?:^|[\s(])(?:confirmation number|confirmation no\.?|booking number|reservation number|booking id|reservation id|booking reference|reservation reference|booking ref|reservation ref|reference|ref)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/im,
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
  const roomType = normalizeRoomTypeCode(input.roomType || parsedInput.roomType)
    || normalizeRoomTypeCode(firstMatch([
      /\b(?:room type|room category|accommodation|unit type)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 /&'()-]{2,80}?)(?=\s+(?:adults?|children|check(?:\s*|-)?in|arrival|check(?:\s*|-)?out|departure|amount|total|payment|special requests?|notes?|booking|reservation|reference)\b|$)/i,
    ], combined))
    || (/\bdouble\b/i.test(combined) ? 'DOUBLE' : /\btwin\b/i.test(combined) ? 'TWIN' : undefined)
  const moneyCandidates = parseMoneyCandidates(combined)
  const rawAdults = input.adults ?? parsedInput.adults ?? combined.match(/\b(?:adults?)\s*[:#-]?\s*(\d+)/i)?.[1]
  const rawChildren = input.children ?? parsedInput.children ?? combined.match(/\b(?:children|kids?)\s*[:#-]?\s*(\d+)/i)?.[1]
  const adults = rawAdults === undefined ? undefined : Number(rawAdults)
  const children = rawChildren === undefined ? undefined : Number(rawChildren)
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

  const parsedMoney = selectParsedMoneyForEvent(eventType, moneyCandidates)
  const structuredAmountProvided = input.amount !== undefined && input.amount !== null
  const parsedTextAmountAvailable = parsedMoney.amount !== undefined && parsedMoney.amount !== null
  const rawAmount = structuredAmountProvided
    ? input.amount
    : parsedTextAmountAvailable
      ? parsedMoney.amount
      : parsedInput.amount
  const amount = Number(rawAmount)
  const amountKind = Number.isFinite(amount) && amount > 0
    ? normalizeBookingEmailAmountKind(
        structuredAmountProvided
          ? input.amountKind
          : parsedTextAmountAvailable
            ? parsedMoney.amountKind
            : parsedInput.amountKind,
      )
    : undefined
  const currency = normalizeNullableString(
    structuredAmountProvided
      ? input.currency
      : parsedTextAmountAvailable
        ? parsedMoney.currency
        : parsedInput.currency,
  )?.toUpperCase()
  const amountAmbiguous = Boolean(
    amountKind && moneyCandidates.ambiguousKinds.includes(normalizeBookingEmailAmountKind(amountKind)),
  )

  const details = {
    guestName: guestName || undefined,
    checkIn,
    checkOut,
    roomType,
    adults: Number.isInteger(adults) && adults > 0 ? adults : undefined,
    children: Number.isInteger(children) && children >= 0 ? children : undefined,
    amount: Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : undefined,
    amountKind,
    amountAmbiguous: amountAmbiguous || undefined,
    currency,
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
  if (details.amount && !details.currency) missing.push('amount currency')
  if (details.amountAmbiguous) missing.push('unambiguous amount')
  if ((eventType === 'NEW_BOOKING' || eventType === 'MODIFICATION') && details.amount && details.amountKind !== 'STAY_TOTAL') {
    missing.push('explicit stay total')
  }
  if (eventType === 'PAYMENT_NOTICE' && !details.amount) missing.push('payment amount')
  if (eventType === 'PAYMENT_NOTICE' && details.amount && !['PAYMENT', 'DEPOSIT'].includes(details.amountKind)) {
    missing.push('explicit payment or deposit amount')
  }
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
  const amount = event.amountSatang !== null && event.amountSatang !== undefined
    ? moneyPairFromSatang(event.amountSatang, 'Booking email amount', {
        nullable: true,
        minimum: MONEY_SATANG_MIN,
      }).thb
    : event.amount ?? parsedDetails.amount
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
    legacyReadOnly: Boolean(event.legacyReadOnly),
    reviewActionsAllowed: !event.legacyReadOnly && event.status !== 'PROCESSED',
    channelRef: event.channelRef || undefined,
    providerCode: event.providerCode || undefined,
    externalReservationId: event.externalReservationId || undefined,
    guestName: event.guestName || parsedDetails.guestName || undefined,
    checkIn: dateKeyOrUndefined(event.checkIn || parsedDetails.checkIn),
    checkOut: dateKeyOrUndefined(event.checkOut || parsedDetails.checkOut),
    roomType: event.roomType || parsedDetails.roomType || undefined,
    amount,
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
    sourceEmailId: event.sourceMessageId || undefined,
    parsedDetails,
    createdAt: isoOrUndefined(event.createdAt),
    updatedAt: isoOrUndefined(event.updatedAt),
  }
}

async function ensurePrimaryBookingEmailSource(tx) {
  const property = await getProperty(tx)
  const mailbox = primaryBookingMailbox()
  const credentials = bookingEmailGmailCredentialStatus()
  const existing = await tx.bookingEmailSource.findUnique({
    where: {
      propertyId_mailbox: {
        propertyId: property.id,
        mailbox,
      },
    },
  })
  const query = bookingEmailSourceReconciliationQuery(existing?.query, mailbox)
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
      query,
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
      query: approvedBookingEmailProviderQuery(),
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

function gmailTrustedAuthenticationResults(message) {
  return message?.payload?.headers
    ?.filter((header) => header.name?.toLowerCase() === 'authentication-results')
    .map((header) => String(header.value || '').trim())
    .find((value) => /^mx\.google\.com\s*;/i.test(value)) || ''
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
          authenticationResults: gmailTrustedAuthenticationResults(message),
        },
      })
    }
    pageToken = normalizeNullableString(listed.nextPageToken)
    pageCount += 1
  } while (pageToken && messages.length < maxMessages && pageCount < maxPages)
  return messages
}

async function findDuplicateBookingEmailEvent(tx, sourceId, parsed, input, eventId, providerCode = null) {
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
      providerCode: providerCode || undefined,
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

function assertBookingEmailReservationLinkable(event, reservation) {
  if (reservation.propertyId !== event.propertyId) {
    throw new PmsValidationError('The linked reservation belongs to a different property.', 409)
  }
  if (['CANCELLED', 'NO_SHOW'].includes(reservation.status)) {
    throw new PmsValidationError('Cancelled and no-show reservations cannot be linked to actionable booking email events.', 409)
  }
  return reservation
}

async function findExactReservationForBookingEmailEvent(tx, event) {
  if (event.reservationId) {
    const reservation = await tx.reservation.findUnique({
      where: { id: event.reservationId },
      include: reservationInclude,
    })
    if (reservation) return assertBookingEmailReservationLinkable(event, reservation)
  }

  const providerCode = event.providerCode || bookingEmailChannelProviderCode(event)
  const externalReservationId = normalizeNullableString(event.externalReservationId || event.channelRef)
  if (providerCode && externalReservationId) {
    const externalReferenceKey = buildManualChannelExternalReferenceKey(event.propertyId, providerCode, externalReservationId)
    const exactExternalReservation = await tx.reservation.findUnique({
      where: { externalReferenceKey },
      include: reservationInclude,
    })
    if (exactExternalReservation && !['CANCELLED', 'NO_SHOW'].includes(exactExternalReservation.status)) {
      return assertBookingEmailReservationLinkable(event, exactExternalReservation)
    }

    const providerScopedLegacyReservations = await tx.reservation.findMany({
      where: {
        propertyId: event.propertyId,
        providerCode,
        OR: [
          { externalReservationId: { equals: externalReservationId, mode: 'insensitive' } },
          { channelRef: { equals: externalReservationId, mode: 'insensitive' } },
        ],
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      include: reservationInclude,
      take: 2,
    })
    if (providerScopedLegacyReservations.length === 1) return providerScopedLegacyReservations[0]
  }

  return null
}

async function findReservationForBookingEmailEvent(tx, event, details = safeJsonObject(event.parsedDetails)) {
  const exactReservation = await findExactReservationForBookingEmailEvent(tx, event)
  if (exactReservation) return exactReservation

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
  const parsedAmount = moneyPairFromThb(parsed.details.amount ?? null, 'Booking email amount', {
    nullable: true,
    minimum: MONEY_SATANG_MIN,
  })
  const parsedDetails = { ...parsed.details }
  if (parsedAmount.thb === null) delete parsedDetails.amount
  else parsedDetails.amount = parsedAmount.thb
  const rawHeaders = safeJsonObject(input.rawHeaders)
  const providerVerification = String(source.provider || '').toUpperCase() === 'GMAIL'
    ? verifiedProviderFromAuthenticationResults(input.sender, rawHeaders)
    : {
        providerCode: input.providerCode ? normalizeManualChannelProviderCode(input.providerCode) : null,
        senderProvider: null,
        verified: Boolean(input.providerCode),
        reason: input.providerCode ? 'trusted_non_gmail_source' : 'provider_not_supplied',
      }
  const providerCode = bookingEmailChannelProviderCode({
    sender: input.sender,
    rawHeaders,
    providerCode: String(source.provider || '').toUpperCase() === 'GMAIL' ? undefined : input.providerCode,
  })
  const duplicateEvent = await findDuplicateBookingEmailEvent(tx, source.id, parsed, input, existingEventId, providerCode)
  const sourceMessageId = normalizeNullableString(input.sourceMessageId || input.sourceEmailId || input.gmailMessageId || input.messageId)
  const externalReservationId = providerCode
    ? normalizeNullableString(input.externalReservationId || parsed.channelRef)
    : null
  const status = normalizeBookingEmailStatus(input.status, 'NEEDS_REVIEW')
  const reviewReason = [
    normalizeNullableString(input.reviewReason),
    parsed.reviewReason,
    providerVerification.senderProvider && !providerVerification.verified
      ? 'Provider sender authentication could not be verified. Confirm the OTA reference in the official Extranet before linking or applying this event.'
      : null,
    duplicateEvent ? `Possible duplicate of email event ${duplicateEvent.id}.` : null,
  ].filter(Boolean).join(' ') || null

  const data = {
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
    confidence: Number(input.confidence ?? parsed.confidence),
    channelRef: parsed.channelRef,
    providerCode,
    externalReservationId,
    guestName: parsed.details.guestName || null,
    checkIn: parsed.details.checkIn ? dateFromKey(parsed.details.checkIn) : null,
    checkOut: parsed.details.checkOut ? dateFromKey(parsed.details.checkOut) : null,
    roomType: parsed.details.roomType || null,
    amount: parsedAmount.thb,
    amountSatang: parsedAmount.satang,
    currency: parsed.details.currency || null,
    paymentStatus: parsed.details.paymentStatus || null,
    proposedAction: normalizeNullableString(input.proposedAction) || proposedBookingEmailAction(parsed.eventType),
    completedAction: normalizeNullableString(input.completedAction),
    reviewReason,
    errorReason: normalizeNullableString(input.errorReason),
    parsedDetails,
    rawHeaders: {
      ...rawHeaders,
      providerVerification: {
        status: providerVerification.verified ? 'VERIFIED' : 'UNVERIFIED',
        reason: providerVerification.reason,
        providerCode: providerVerification.providerCode,
      },
    },
    rawText: normalizeNullableString(input.rawText || input.body || input.snippet),
    duplicateOfEventId: duplicateEvent?.id || null,
  }

  const exactReservation = await findExactReservationForBookingEmailEvent(tx, data)
  return {
    ...data,
    reservationId: exactReservation?.id || null,
  }
}

async function upsertBookingEmailEvent(tx, source, input) {
  const sourceMessageId = normalizeNullableString(input.sourceMessageId || input.sourceEmailId || input.gmailMessageId || input.messageId)
  if (sourceMessageId) {
    const existing = await tx.bookingEmailEvent.findUnique({
      where: {
        sourceId_sourceMessageId: {
          sourceId: source.id,
          sourceMessageId,
        },
      },
      include: bookingEmailEventInclude(),
    })
    if (existing?.legacyReadOnly
      || existing?.status === 'PROCESSED'
      || existing?.processedAt
      || existing?.status === 'IGNORED'
      || existing?.rejectedAt) return existing

    const data = await buildBookingEmailEventData(tx, source, input, existing?.id)
    return tx.bookingEmailEvent.upsert({
      where: {
        sourceId_sourceMessageId: {
          sourceId: source.id,
          sourceMessageId,
        },
      },
      update: data,
      create: data,
      include: bookingEmailEventInclude(),
    })
  }
  const data = await buildBookingEmailEventData(tx, source, input)
  return tx.bookingEmailEvent.create({
    data,
    include: bookingEmailEventInclude(),
  })
}

function detailsForApproval(event, editedDetails) {
  const parsed = safeJsonObject(event.parsedDetails)
  const edited = safeJsonObject(editedDetails)
  const persistedAmount = storedMoneyPair(event, 'amountSatang', 'amount', 'Booking email amount', {
    nullable: true,
    minimum: 1,
  })

  if (Object.hasOwn(edited, 'amount')) {
    const editedAmount = moneyPairFromThb(edited.amount, 'Edited booking email amount', { minimum: 1 })
    if (persistedAmount.satang === null || editedAmount.satang !== persistedAmount.satang) {
      throw new PmsValidationError(
        'The parser-verified booking email amount cannot be changed during approval. Reprocess or reject the source event.',
        409,
      )
    }
  }

  if (Object.hasOwn(edited, 'currency')) {
    const persistedCurrency = normalizeNullableString(event.currency)?.toUpperCase()
    const editedCurrency = normalizeNullableString(edited.currency)?.toUpperCase()
    if (!persistedCurrency || editedCurrency !== persistedCurrency) {
      throw new PmsValidationError(
        'The parser-verified booking email currency cannot be relabelled during approval. Reprocess or reject the source event.',
        409,
      )
    }
  }

  if (Object.hasOwn(edited, 'amountKind')) {
    const persistedAmountKind = normalizeBookingEmailAmountKind(parsed.amountKind)
    const editedAmountKind = normalizeBookingEmailAmountKind(edited.amountKind)
    if (editedAmountKind !== persistedAmountKind) {
      throw new PmsValidationError(
        'The parser-verified booking email amount type cannot be changed during approval. Reprocess or reject the source event.',
        409,
      )
    }
  }

  const details = { ...parsed, ...edited }
  if (persistedAmount.thb === null) delete details.amount
  else details.amount = persistedAmount.thb
  if (event.currency) details.currency = normalizeNullableString(event.currency)?.toUpperCase()
  else delete details.currency
  details.amountKind = normalizeBookingEmailAmountKind(parsed.amountKind)
  details.amountAmbiguous = Boolean(parsed.amountAmbiguous)
  return details
}

async function reservationInputFromBookingEmailEvent(tx, event, details) {
  const guest = splitGuestName(details.guestName)
  if (!guest) throw new PmsValidationError('Guest name is required before creating a reservation.')
  if (!details.checkIn || !details.checkOut) throw new PmsValidationError('Check-in and check-out dates are required before creating a reservation.')
  const roomTypeCode = normalizeRoomTypeCode(details.roomType)
  if (!roomTypeCode) throw new PmsValidationError('Room type is required before creating a reservation.')

  const property = await getProperty(tx)
  const roomType = await tx.roomType.findFirst({
    where: {
      propertyId: property.id,
      code: roomTypeCode,
    },
  })
  if (!roomType) throw new PmsValidationError('Parsed room type does not match a configured PMS room type.')
  const { nights } = validateStayInput({ checkIn: details.checkIn, checkOut: details.checkOut })
  const emailAmount = storedMoneyPair(event, 'amountSatang', 'amount', 'Booking email amount', { nullable: true, minimum: 1 })
  if (emailAmount.satang === null) {
    throw new PmsValidationError('A parser-verified stay total is required before creating a reservation from booking email.', 409)
  }
  requireBookingEmailAmountKind(event, ['STAY_TOTAL'], 'Booking email amount')
  requireBookingEmailAmountCurrency(event, details, property, 'Booking email amount')
  const ratePerNightSatang = moneyPairFromSatang(
    Math.round(emailAmount.satang / nights),
    'Booking email rate per night',
    { minimum: 1 },
  ).satang
  const source = normalizeBookingSourceFromEmail(event.sender, event.sourceName, event.providerCode)
  const providerCode = event.providerCode || bookingEmailChannelProviderCode(event)
  const externalReservationId = providerCode
    ? normalizeNullableString(event.externalReservationId || event.channelRef)
    : null

  return {
    guest: {
      ...guest,
      email: normalizeNullableString(details.guestEmail),
      phone: normalizeNullableString(details.guestPhone),
    },
    confirmationCode: event.channelRef && providerCode
      ? `${BOOKING_CONFIRMATION_PREFIX_BY_PROVIDER[providerCode]}-${event.channelRef}`
      : event.channelRef || undefined,
    checkIn: details.checkIn,
    checkOut: details.checkOut,
    roomTypeCode,
    adults: Number(details.adults || 1),
    children: Number(details.children || 0),
    childAges: Array.isArray(details.childAges) ? details.childAges.map(Number) : [],
    ratePerNightSatang,
    authoritativeTotalSatang: emailAmount.satang,
    source,
    channelRef: event.channelRef || undefined,
    providerCode,
    externalReservationId,
    sourceEmailEventId: event.id,
    manualChannelContext: {
      triggerType: 'BOOKING_EMAIL_NEW_BOOKING_APPROVED',
      sourceProviderCode: providerCode,
      sourceProviderAlreadyUpdated: Boolean(providerCode),
      sourceBookingEmailEventId: event.id,
    },
    notes: [details.notes, `Created from booking email event ${event.id}`].filter(Boolean).join('\n'),
    specialRequests: normalizeNullableString(details.specialRequests),
  }
}

async function approveNewBookingEmailEvent(tx, event, details, actor) {
  const exactReservation = await findExactReservationForBookingEmailEvent(tx, event)
  if (exactReservation) {
    return linkBookingEmailEventToReservation(tx, event, exactReservation.id, actor)
  }
  const duplicateReservation = await findReservationForBookingEmailEvent(tx, event, details)
  if (duplicateReservation) {
    const reviewEvent = await tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        status: 'NEEDS_REVIEW',
        reservationId: null,
        reviewReason: `Possible duplicate of reservation ${duplicateReservation.confirmationCode}. Link instead of creating a new booking.`,
      },
      include: bookingEmailEventInclude(),
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_DUPLICATE_REVIEW_REQUIRED', 'bookingEmailEvent', event.id, {
      reservationId: duplicateReservation.id,
      confirmationCode: duplicateReservation.confirmationCode,
      sourceMessageId: event.sourceMessageId,
    })
    return reviewEvent
  }

  const reservation = await createReservationInTransaction(tx, await reservationInputFromBookingEmailEvent(tx, event, details), actor)
  const updated = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: reservation.id,
      completedAction: `Created reservation ${reservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
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
  })
  return updated
}

async function requireLinkedReservationForBookingEmailWrite(tx, event, reservationId, eventLabel) {
  const linkedReservationId = normalizeNullableString(reservationId || event.reservationId)
  if (!linkedReservationId) {
    throw new PmsValidationError(`Link this ${eventLabel} to a reservation before applying it.`)
  }
  const reservation = await tx.reservation.findUnique({
    where: { id: linkedReservationId },
    include: reservationInclude,
  })
  if (!reservation) throw new PmsValidationError('The linked reservation was not found.', 404)
  return assertBookingEmailReservationLinkable(event, reservation)
}

async function approvePaymentEmailEvent(tx, event, details, actor, reservationId) {
  const reservation = await requireLinkedReservationForBookingEmailWrite(tx, event, reservationId, 'payment notice')
  if (!reservation.folio?.id) throw new PmsValidationError('Matched reservation does not have a folio.')

  const amount = storedMoneyPair(event, 'amountSatang', 'amount', 'Payment amount', { nullable: true, minimum: 1 })
  if (amount.thb === null || amount.thb <= 0) throw new PmsValidationError('Payment amount is required before applying this email.')
  requireBookingEmailAmountKind(event, ['PAYMENT', 'DEPOSIT'], 'Payment amount')
  const property = await getProperty(tx)
  requireBookingEmailAmountCurrency(event, details, property, 'Payment amount')
  const reference = normalizeNullableString(details.paymentReference || event.sourceMessageId || event.id)
  const result = await recordPaymentInTransaction(tx, reservation.folio.id, {
    amountSatang: amount.satang,
    method: details.paymentMethod || 'ONLINE',
    reference,
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
  await createAudit(tx, actor, 'BOOKING_EMAIL_CREATED_PAYMENT', 'bookingEmailEvent', event.id, {
    reservationId: reservation.id,
    paymentId: result.payment.id,
    amount: result.payment.amount,
    sourceMessageId: event.sourceMessageId,
  })
  return updated
}

async function assertLatestBookingEmailLifecycleEvent(tx, event, reservation, label) {
  const conflictingEvent = await tx.bookingEmailEvent.findFirst({
    where: {
      id: { not: event.id },
      propertyId: event.propertyId,
      reservationId: reservation.id,
      status: 'PROCESSED',
      eventType: { in: ['MODIFICATION', 'CANCELLATION'] },
      receivedAt: { gte: event.receivedAt },
    },
    orderBy: [
      { receivedAt: 'desc' },
      { processedAt: 'desc' },
    ],
    select: {
      id: true,
      eventType: true,
      receivedAt: true,
    },
  })

  if (conflictingEvent) {
    const error = new PmsValidationError(
      `${label} cannot be applied because a same-time or newer provider modification/cancellation has already been processed. Review the provider timeline and reject or reprocess the stale event.`,
      409,
    )
    error.bookingEmailLifecycleDenialAudit = {
      reasonCode: 'STALE_PROVIDER_LIFECYCLE_EVENT',
      reservationId: reservation.id,
      attemptedEventType: event.eventType,
      attemptedReceivedAt: event.receivedAt.toISOString(),
      conflictingEventId: conflictingEvent.id,
      conflictingEventType: conflictingEvent.eventType,
      conflictingReceivedAt: conflictingEvent.receivedAt.toISOString(),
    }
    throw error
  }
}

async function approveCancellationEmailEvent(tx, event, details, actor, reservationId, reason) {
  const operationalReason = requireOperationalReason(reason, 'Approving a booking-email cancellation')
  const reservation = await requireLinkedReservationForBookingEmailWrite(tx, event, reservationId, 'cancellation')
  await assertLatestBookingEmailLifecycleEvent(tx, event, reservation, 'This cancellation')
  const providerCode = event.providerCode || bookingEmailChannelProviderCode(event)
  const updatedReservation = await cancelReservationInTransaction(
    tx,
    reservation.id,
    actor,
    'CANCELLED',
    operationalReason,
    {
      manualChannelContext: {
        triggerType: 'BOOKING_EMAIL_CANCELLATION_APPROVED',
        sourceProviderCode: providerCode,
        sourceProviderAlreadyUpdated: Boolean(providerCode),
        sourceBookingEmailEventId: event.id,
      },
    },
  )
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
    reason: operationalReason,
  })
  return updated
}

async function approveModificationEmailEvent(tx, event, details, actor, reservationId, reason) {
  const operationalReason = requireOperationalReason(reason, 'Approving a booking-email modification')
  const reservation = await requireLinkedReservationForBookingEmailWrite(tx, event, reservationId, 'modification')
  await assertLatestBookingEmailLifecycleEvent(tx, event, reservation, 'This modification')

  const update = {}
  if (details.checkIn) {
    update.checkIn = dateKeyOrUndefined(details.checkIn)
    if (!update.checkIn) throw new PmsValidationError('The modified check-in date is invalid.')
  }
  if (details.checkOut) {
    update.checkOut = dateKeyOrUndefined(details.checkOut)
    if (!update.checkOut) throw new PmsValidationError('The modified check-out date is invalid.')
  }
  if (details.roomType) {
    update.roomTypeCode = normalizeRoomTypeCode(details.roomType)
    if (!update.roomTypeCode) throw new PmsValidationError('The modified room type is invalid.')
  }
  if (details.adults !== undefined && details.adults !== null && Number.isInteger(Number(details.adults)) && Number(details.adults) > 0) {
    update.adults = Number(details.adults)
  }
  if (details.children !== undefined && details.children !== null && Number.isInteger(Number(details.children)) && Number(details.children) >= 0) {
    update.children = Number(details.children)
  }
  if (Array.isArray(details.childAges)) update.childAges = details.childAges.map(Number)
  if (normalizeNullableString(details.specialRequests)) update.specialRequests = normalizeNullableString(details.specialRequests)
  if (normalizeNullableString(details.notes)) update.notes = normalizeNullableString(details.notes)

  const amount = storedMoneyPair(event, 'amountSatang', 'amount', 'Modified booking amount', { nullable: true, minimum: 1 })
  if (amount.satang !== null) {
    requireBookingEmailAmountKind(event, ['STAY_TOTAL'], 'Modified booking amount')
    const property = await getProperty(tx)
    requireBookingEmailAmountCurrency(event, details, property, 'Modified booking amount')
    const { nights } = validateStayInput({
      checkIn: update.checkIn || reservation.checkIn,
      checkOut: update.checkOut || reservation.checkOut,
    })
    update.ratePerNightSatang = moneyPairFromSatang(Math.round(amount.satang / nights), 'Modified rate per night', { minimum: 1 }).satang
    update.authoritativeTotalSatang = amount.satang
  }

  const appliedFields = Object.keys(update)
  if (appliedFields.length === 0) {
    throw new PmsValidationError('No supported reservation changes were parsed. Edit the dates, room type, occupancy, total, requests, or notes before approval.')
  }

  const providerCode = event.providerCode || bookingEmailChannelProviderCode(event)
  const updatedReservation = await updateReservationInTransaction(tx, reservation.id, {
    ...update,
    manualChannelContext: {
      triggerType: 'BOOKING_EMAIL_MODIFICATION_APPROVED',
      sourceProviderCode: providerCode,
      sourceProviderAlreadyUpdated: Boolean(providerCode),
      sourceBookingEmailEventId: event.id,
    },
  }, actor)
  const updatedEvent = await tx.bookingEmailEvent.update({
    where: { id: event.id },
    data: {
      status: 'PROCESSED',
      reservationId: updatedReservation.id,
      completedAction: `Updated reservation ${updatedReservation.confirmationCode}.`,
      reviewReason: null,
      errorReason: null,
      processedAt: new Date(),
      processedBy: actorName(actor),
    },
    include: bookingEmailEventInclude(),
  })
  await createAudit(tx, actor, 'BOOKING_EMAIL_MODIFIED_RESERVATION', 'bookingEmailEvent', event.id, {
    reservationId: updatedReservation.id,
    confirmationCode: updatedReservation.confirmationCode,
    sourceMessageId: event.sourceMessageId,
    appliedFields,
    reason: operationalReason,
  })
  return updatedEvent
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
    throw new PmsValidationError(`Room ${room.number} is occupied and cannot be assigned.`)
  }

  const overlappingReservation = await tx.reservation.findFirst({
    where: {
      id: { not: reservation.id },
      assignedRoomId: room.id,
      status: { in: activeReservationStatuses() },
      checkIn: { lt: reservation.checkOut },
      checkOut: { gt: reservation.checkIn },
    },
  })
  if (overlappingReservation) {
    throw new PmsValidationError(`Room ${room.number} already has a reservation for the selected dates.`)
  }

  const inventoryConflict = await tx.roomDateInventory.findFirst({
    where: {
      roomId: room.id,
      reservationId: { not: reservation.id },
      date: {
        in: stayDates(reservation.checkIn, reservation.checkOut).map(dateFromKey),
      },
      status: { in: ['RESERVED', 'HELD', 'BLOCKED', 'OUT_OF_SERVICE'] },
    },
  })
  if (inventoryConflict) {
    throw new PmsValidationError(`Room ${room.number} is not available on ${getBangkokDateKey(inventoryConflict.date)}.`)
  }

  return room
}

async function reserveRoomDates(tx, propertyId, reservationId, roomId, checkIn, checkOut) {
  await tx.roomDateInventory.deleteMany({
    where: { reservationId },
  })

  for (const dateKey of stayDates(checkIn, checkOut)) {
    await tx.roomDateInventory.upsert({
      where: {
        roomId_date: {
          roomId,
          date: dateFromKey(dateKey),
        },
      },
      update: {
        propertyId,
        reservationId,
        status: 'RESERVED',
      },
      create: {
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
  const money = buildFolioMoneyFields(charges, payments)

  return tx.folio.update({
    where: { id: folioId },
    data: {
      ...money,
    },
    include: folioRuntimeInclude,
  })
}

async function reconcileReservationDepositStatus(tx, reservation, folio) {
  if (!reservation?.id || !folio) {
    return { changed: false, becamePaid: false, depositPaid: Boolean(reservation?.depositPaid) }
  }
  const paid = storedMoneyPair(folio, 'paidSatang', 'paid', 'Folio paid amount', { minimum: MONEY_SATANG_MIN })
  const deposit = storedMoneyPair(reservation, 'depositAmountSatang', 'depositAmount', 'Reservation deposit', { minimum: MONEY_SATANG_MIN })
  const depositPaid = deposit.satang > 0 && paid.satang >= deposit.satang
  const changed = Boolean(reservation.depositPaid) !== depositPaid
  if (changed) {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { depositPaid },
    })
  }
  return {
    changed,
    becamePaid: !reservation.depositPaid && depositPaid,
    depositPaid,
  }
}

function requireActorPermission(actor, permission, label) {
  if (!canPerformAction(actor, permission)) {
    throw new PmsValidationError(`${label} requires ${permission} permission.`, 403)
  }
}

function assertNoPublicBookingEmailProvenance(input, operation) {
  if (Object.hasOwn(input || {}, 'sourceEmailEventId')) {
    throw new PmsValidationError(`${operation} cannot set internal booking-email provenance.`, 400)
  }
}

async function recordPaymentInTransaction(tx, folioId, input, actor) {
  const amount = moneyPairFromInput(input, 'amountSatang', 'amount', 'Payment amount', { minimum: 1 })
  const method = normalizePaymentMethod(input.method)
  const reference = normalizeNullableString(input.reference)
  if (paymentMethodRequiresReference(method) && !reference) {
    throw new PmsValidationError('Payment reference is required for card, bank transfer, and online payments.')
  }
  const referenceFingerprint = normalizePaymentReferenceFingerprint(method, reference)
  const folio = await tx.folio.findUnique({ where: { id: folioId } })
  if (!folio) throw new PmsValidationError('Folio was not found.', 404)
  if (folio.status !== 'OPEN') {
    throw new PmsValidationError('Payments can only be recorded against an open folio.')
  }
  const folioBalance = storedMoneyPair(folio, 'balanceSatang', 'balance', 'Folio balance', { minimum: MONEY_SATANG_MIN })
  if (amount.satang > folioBalance.satang) {
    throw new PmsValidationError('Payment cannot exceed the remaining balance.')
  }
  if (referenceFingerprint) {
    const duplicateReference = await tx.payment.findUnique({ where: { referenceFingerprint } })
    if (duplicateReference) {
      throw new PmsValidationError('This payment reference has already been processed.', 409)
    }
  }
  const sourceEmailEventId = normalizeNullableString(input.sourceEmailEventId)
  if (sourceEmailEventId) {
    const duplicateSourcePayment = await tx.payment.findUnique({ where: { sourceEmailEventId } })
    if (duplicateSourcePayment) {
      throw new PmsValidationError('This booking email has already created a payment.', 409)
    }
  }

  const payment = await tx.payment.create({
    data: {
      folioId: folio.id,
      amount: amount.thb,
      amountSatang: amount.satang,
      method,
      reference,
      referenceFingerprint,
      sourceEmailEventId,
      notes: normalizeNullableString(input.notes),
      processedBy: actorName(actor),
    },
  })
  let updatedFolio = await recomputeFolio(tx, folio.id)
  if (
    updatedFolio.status === 'OPEN'
    && updatedFolio.reservation?.status === 'CHECKED_OUT'
    && storedMoneyPair(updatedFolio, 'balanceSatang', 'balance', 'Folio balance', { minimum: MONEY_SATANG_MIN }).satang <= 0
  ) {
    updatedFolio = await tx.folio.update({
      where: { id: folio.id },
      data: { status: 'CLOSED' },
      include: folioRuntimeInclude,
    })
  }

  const reservation = updatedFolio.reservation
  let depositBecamePaid = false
  if (reservation?.id) {
    const depositStatus = await reconcileReservationDepositStatus(tx, reservation, updatedFolio)
    depositBecamePaid = depositStatus.becamePaid
    if (depositStatus.changed) {
      updatedFolio = {
        ...updatedFolio,
        reservation: { ...reservation, depositPaid: depositStatus.depositPaid },
      }
    }
    if (depositBecamePaid) {
      await createReservationLog(tx, reservation.id, 'DEPOSIT_PAID', actor, {
        notes: sourceEmailEventId
          ? `Deposit threshold reached from booking email event ${sourceEmailEventId}.`
          : `Deposit threshold reached with payment ${payment.id}.`,
        changes: { paymentId: payment.id, amount: payment.amount, sourceEmailEventId },
      })
    }
  }
  await createAudit(tx, actor, 'PAYMENT_CREATED', 'payment', payment.id, {
    folioId: folio.id,
    amount: payment.amount,
    method,
    sourceEmailEventId,
    depositBecamePaid,
  })
  return { payment, folio: updatedFolio, depositBecamePaid }
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

  const user = await prisma.user.create({
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
  await createAudit(prisma, actor, 'USER_CREATED', 'user', user.id, {
    username: user.username,
    email: user.email,
    role: user.role,
    active: user.active,
  })
  return user
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

  const user = await prisma.user.update({
    where: { id: existing.id },
    data,
  })
  await createAudit(prisma, actor, 'USER_UPDATED', 'user', user.id, {
    username: user.username,
    email: user.email,
    role: user.role,
    active: user.active,
    passwordChanged: Boolean(password),
  })
  return user
}

export async function deactivateUser(prisma, userId, actor) {
  if (actor?.id === userId) {
    throw new PmsValidationError('You cannot deactivate your own account.', 409)
  }
  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (!existing) throw new PmsValidationError('User was not found.', 404)
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { active: false },
  })
  await createAudit(prisma, actor, 'USER_DEACTIVATED', 'user', user.id, {
    username: user.username,
    email: user.email,
    role: user.role,
  })
  return user
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
      const baseRate = moneyPairFromThb(
        setupNumber(rate?.baseRate, `Base rate for ${roomType.name}`, { min: 1 }),
        `Base rate for ${roomType.name}`,
        { minimum: 1 },
      )
      const createdRoomType = await tx.roomType.create({
        data: {
          propertyId: property.id,
          code: setupRoomTypeCode(roomType, index, usedCodes),
          name: setupString(roomType.name, 'Room type name'),
          description: null,
          baseRate: baseRate.thb,
          baseRateSatang: baseRate.satang,
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

    await createAudit(tx, admin, 'INITIAL_SETUP_COMPLETED', 'property', property.id, {
      propertyName: property.name,
      roomTypes: setup.roomTypes.length,
      rooms: setup.rooms.length,
    })

    return { property, admin }
  })
}

export async function getAuthenticatedUser(prisma, session) {
  return getUserBySession(prisma, session)
}

export async function listReservations(prisma) {
  return prisma.reservation.findMany({
    include: reservationInclude,
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
  })
}

async function updateReservationInTransaction(tx, reservationId, input, actor) {
  const current = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: reservationInclude,
  })
  if (!current) throw new PmsValidationError('Reservation was not found.', 404)
  assertExpectedReservationVersion(current, input.expectedUpdatedAt)
  if (['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(current.status)) {
    throw new PmsValidationError('Checked-in, completed, or cancelled reservations cannot be edited through the booking editor.')
  }

  const property = await getProperty(tx)
  const pricingFields = [
    'roomTypeCode',
    'roomType',
    'checkIn',
    'checkOut',
    'adults',
    'children',
    'childAges',
    'ratePerNightSatang',
    'ratePerNight',
  ]
  const pricingInputSupplied = pricingFields.some((field) => Object.hasOwn(input, field))
  const hasAuthoritativeTotal = Object.hasOwn(input, 'authoritativeTotalSatang')
  const pricingValidationRequired = pricingInputSupplied || hasAuthoritativeTotal

  let roomTypeId = current.roomTypeId
  let pricingRoomType = current.roomType
  if (Object.hasOwn(input, 'roomTypeCode') || Object.hasOwn(input, 'roomType')) {
    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType,
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')
    roomTypeId = roomType.id
    pricingRoomType = roomType
  }

  const checkIn = input.checkIn ?? current.checkIn
  const checkOut = input.checkOut ?? current.checkOut
  const adults = input.adults ?? current.adults
  const children = input.children ?? current.children
  const childAges = input.childAges ?? current.childAges
  const normalizedChildAges = Array.isArray(childAges) ? childAges.map(Number) : []

  let checkInKey = null
  let checkOutKey = null
  let previousCheckInKey = null
  let previousCheckOutKey = null
  let pricingChanged = false
  let stayInventoryChanged = false
  let pricing = null
  let assignedRoomId = current.assignedRoomId

  if (pricingValidationRequired) {
    const currentRate = storedMoneyPair(current, 'ratePerNightSatang', 'ratePerNight', 'Rate per night', { minimum: 1 })
    const pricingRate = Object.hasOwn(input, 'ratePerNightSatang')
      ? { ratePerNightSatang: input.ratePerNightSatang }
      : { ratePerNight: input.ratePerNight ?? currentRate.thb }
    const validatedStay = validateStayInput({ checkIn, checkOut })
    checkInKey = validatedStay.checkInKey
    checkOutKey = validatedStay.checkOutKey
    previousCheckInKey = getBangkokDateKey(current.checkIn)
    previousCheckOutKey = getBangkokDateKey(current.checkOut)
    const requestedRate = moneyPairFromInput(pricingRate, 'ratePerNightSatang', 'ratePerNight', 'Rate per night', { minimum: 1 })
    pricingChanged = current.roomTypeId !== roomTypeId
      || previousCheckInKey !== checkInKey
      || previousCheckOutKey !== checkOutKey
      || Number(current.adults) !== Number(adults)
      || Number(current.children || 0) !== Number(children || 0)
      || JSON.stringify((current.childAges || []).map(Number)) !== JSON.stringify(normalizedChildAges)
      || currentRate.satang !== requestedRate.satang
    stayInventoryChanged = current.roomTypeId !== roomTypeId
      || previousCheckInKey !== checkInKey
      || previousCheckOutKey !== checkOutKey

    const providerPricedReservation = Boolean(
      current.providerTotalSatang !== null && current.providerTotalSatang !== undefined
      || current.sourceEmailEventId
      || (current.providerCode && (current.externalReferenceKey || current.externalReservationId))
      || safeJsonObject(input.manualChannelContext).sourceBookingEmailEventId,
    )
    if (pricingChanged && providerPricedReservation && !hasAuthoritativeTotal) {
      throw new PmsValidationError(
        'A provider-priced reservation cannot change dates, room type, occupancy, or rate without a new parser-verified stay total.',
        409,
      )
    }

    pricing = withAuthoritativeStayTotal(calculateStayMoney({
      checkIn,
      checkOut,
      ...pricingRate,
      adults,
      children,
      childAges: normalizedChildAges,
      ...pricingRulesFor(property, pricingRoomType),
    }), hasAuthoritativeTotal ? input.authoritativeTotalSatang : undefined)

    if (stayInventoryChanged) {
      await ensureRoomTypeCapacity(tx, property.id, roomTypeId, checkInKey, checkOutKey, current.id)
      if (assignedRoomId) {
        const assignedRoom = await tx.room.findUnique({ where: { id: assignedRoomId } })
        if (!assignedRoom || assignedRoom.roomTypeId !== roomTypeId) {
          assignedRoomId = null
        } else {
          const candidate = { ...current, roomTypeId, checkIn: dateFromKey(checkInKey), checkOut: dateFromKey(checkOutKey) }
          await validateRoomAssignable(tx, candidate, assignedRoomId)
        }
      }
    }
  }

  const providerTotalCurrency = hasAuthoritativeTotal
    ? normalizeNullableString(property.currency)?.toUpperCase()
    : null
  if (hasAuthoritativeTotal && !providerTotalCurrency) {
    throw new PmsValidationError('The property currency must be configured before storing a provider total.')
  }
  const shouldPersistPricing = pricingChanged || hasAuthoritativeTotal
  const integrationFields = ['source', 'channelRef', 'providerCode', 'externalReservationId', 'sourceEmailEventId']
  const integrationInputSupplied = integrationFields.some((field) => Object.hasOwn(input, field))
  let integrationData = {}
  if (integrationInputSupplied) {
    const source = input.source || current.source
    const channelRef = input.channelRef ?? current.channelRef
    const externalReference = reservationExternalReferenceData(property.id, {
      source,
      channelRef,
      providerCode: input.providerCode ?? current.providerCode,
      externalReservationId: input.externalReservationId !== undefined
        ? input.externalReservationId
        : input.channelRef !== undefined
          ? input.channelRef
          : current.externalReservationId,
    })
    integrationData = {
      source,
      channelRef,
      providerCode: externalReference.providerCode,
      externalReservationId: externalReference.externalReservationId,
      externalReferenceKey: externalReference.externalReferenceKey,
      sourceEmailEventId: input.sourceEmailEventId === undefined ? current.sourceEmailEventId : normalizeNullableString(input.sourceEmailEventId),
    }
  }

  let roomCharge = null
  if (shouldPersistPricing) {
    if (!current.folio?.id) {
      throw new PmsValidationError('Reservation pricing cannot change until its folio is repaired.', 409)
    }
    const activeRoomCharges = await tx.charge.findMany({
      where: { folioId: current.folio.id, category: 'ROOM', void: false },
      orderBy: { createdAt: 'asc' },
      take: 2,
    })
    if (activeRoomCharges.length !== 1) {
      throw new PmsValidationError('Reservation pricing cannot change until its folio has exactly one active room charge.', 409)
    }
    roomCharge = activeRoomCharges[0]
  }

  await tx.reservation.update({
    where: { id: current.id },
    data: {
      ...(pricingValidationRequired ? {
        roomTypeId,
        assignedRoomId,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        adults: Number(adults),
        children: Number(children || 0),
        childAges: normalizedChildAges,
      } : {}),
      ...(shouldPersistPricing ? {
        ratePerNight: pricing.ratePerNight,
        ratePerNightSatang: pricing.ratePerNightSatang,
        totalAmount: pricing.total,
        totalAmountSatang: pricing.totalSatang,
        depositAmount: pricing.depositAmount,
        depositAmountSatang: pricing.depositAmountSatang,
      } : {}),
      ...(hasAuthoritativeTotal ? {
        providerTotalSatang: pricing.totalSatang,
        providerTotalCurrency,
      } : {}),
      ...integrationData,
      notes: input.notes ?? current.notes,
      specialRequests: input.specialRequests ?? current.specialRequests,
    },
    include: reservationInclude,
  })

  if (stayInventoryChanged) {
    if (assignedRoomId) {
      await reserveRoomDates(tx, property.id, current.id, assignedRoomId, checkInKey, checkOutKey)
    } else {
      await tx.roomDateInventory.deleteMany({ where: { reservationId: current.id } })
    }
  }

  if (roomCharge) {
    const roomChargeMoney = buildChargeMoneyFieldsFromSatang(pricing.ratePerNightSatang, pricing.nights, pricing.totalSatang)
    await tx.charge.update({
      where: { id: roomCharge.id },
      data: {
        date: dateFromKey(checkInKey),
        description: `${pricingRoomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        amount: roomChargeMoney.amount,
        amountSatang: roomChargeMoney.amountSatang,
        quantity: pricing.nights,
        total: roomChargeMoney.total,
        totalSatang: roomChargeMoney.totalSatang,
      },
    })
    const updatedFolio = await recomputeFolio(tx, current.folio.id)
    await reconcileReservationDepositStatus(tx, updatedFolio.reservation, updatedFolio)
  }

  await createReservationLog(tx, current.id, 'MODIFIED', actor, { changes: input })
  await createAudit(tx, actor, 'MODIFIED', 'reservation', current.id, input)
  if (stayInventoryChanged && activeReservationStatuses().includes(current.status)) {
    await reconcileReservationAvailabilityInTransaction(tx, {
      propertyId: property.id,
      affected: [
        manualChannelAffectedStay(current.roomTypeId, previousCheckInKey, previousCheckOutKey),
        manualChannelAffectedStay(roomTypeId, checkInKey, checkOutKey),
      ],
      triggerType: 'RESERVATION_UPDATED',
      sourceReservationId: current.id,
      manualChannelContext: input.manualChannelContext,
    }, actor)
  }
  return tx.reservation.findUnique({ where: { id: current.id }, include: reservationInclude })
}

export async function updateReservation(prisma, reservationId, input, actor) {
  rejectInternalReservationFields(input, 'Reservation updates')
  return serializableTransaction(prisma, (tx) => updateReservationInTransaction(tx, reservationId, input, actor))
}

export async function listRooms(prisma) {
  const property = await getProperty(prisma)
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
  const existingBaseRate = existing
    ? storedMoneyPair(existing, 'baseRateSatang', 'baseRate', 'Base rate', { minimum: 1 }).thb
    : undefined
  const baseRate = moneyPairFromThb(
    setupNumber(input?.baseRate ?? existingBaseRate, 'Base rate', { min: 1 }),
    'Base rate',
    { minimum: 1 },
  )

  return {
    code: normalizeSetupRoomTypeCode(input),
    name,
    description: setupString(input?.description ?? existing?.description, 'Room type description', false),
    baseRate: baseRate.thb,
    baseRateSatang: baseRate.satang,
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

export async function getRoomSetup(prisma) {
  const property = await getProperty(prisma)
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
  const property = await getProperty(prisma)
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
  const property = await getProperty(prisma)
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
  const property = await getProperty(prisma)
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
  const property = await getProperty(prisma)
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
    await reconcileRoomCapacityInTransaction(tx, {
      propertyId: property.id,
      beforeRoom: null,
      afterRoom: room,
      triggerType: 'ROOM_CREATED',
    }, actor)
    return room
  })
}

export async function updateSetupRoom(prisma, roomId, input, actor) {
  const property = await getProperty(prisma)
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
    await reconcileRoomCapacityInTransaction(tx, {
      propertyId: property.id,
      beforeRoom: existing,
      afterRoom: room,
      triggerType: 'ROOM_UPDATED',
    }, actor)
    return room
  })
}

export async function deleteSetupRoom(prisma, roomId, actor) {
  const property = await getProperty(prisma)
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
    await reconcileRoomCapacityInTransaction(tx, {
      propertyId: property.id,
      beforeRoom: existing,
      afterRoom: null,
      triggerType: 'ROOM_DELETED',
    }, actor)
    return existing
  })
}

export async function listGuests(prisma) {
  return prisma.guest.findMany({
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

async function createReservationInTransaction(tx, input, actor) {
    const property = await getProperty(tx)
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const externalReference = reservationExternalReferenceData(property.id, input)

    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')
    const hasProviderTotal = Object.hasOwn(input, 'authoritativeTotalSatang')
    const providerTotalCurrency = hasProviderTotal
      ? normalizeNullableString(property.currency)?.toUpperCase()
      : null
    if (hasProviderTotal && !providerTotalCurrency) {
      throw new PmsValidationError('The property currency must be configured before storing a provider total.')
    }
    const pricing = withAuthoritativeStayTotal(calculateStayMoney({
      ...input,
      ...pricingRulesFor(property, roomType),
    }), input.authoritativeTotalSatang)

    await ensureRoomTypeCapacity(tx, property.id, roomType.id, checkInKey, checkOutKey)

    const guestData = validateGuestInput(input.guest)
    const guest = await tx.guest.create({ data: guestData })

    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: input.confirmationCode || `SBX-${Date.now()}`,
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        status: 'CONFIRMED',
        adults: Number(input.adults),
        children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [],
        ratePerNight: pricing.ratePerNight,
        ratePerNightSatang: pricing.ratePerNightSatang,
        totalAmount: pricing.total,
        totalAmountSatang: pricing.totalSatang,
        depositAmount: pricing.depositAmount,
        depositAmountSatang: pricing.depositAmountSatang,
        providerTotalSatang: hasProviderTotal ? pricing.totalSatang : null,
        providerTotalCurrency,
        depositPaid: false,
        source: input.source || 'DIRECT',
        channelRef: input.channelRef || null,
        providerCode: externalReference.providerCode,
        externalReservationId: externalReference.externalReservationId,
        externalReferenceKey: externalReference.externalReferenceKey,
        sourceEmailEventId: normalizeNullableString(input.sourceEmailEventId),
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

    const initialFolioMoney = buildFolioMoneyFields([
      { totalSatang: pricing.totalSatang, void: false },
    ], [])
    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        ...initialFolioMoney,
      },
    })

    const roomChargeMoney = buildChargeMoneyFieldsFromSatang(pricing.ratePerNightSatang, pricing.nights, pricing.totalSatang)
    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: roomChargeMoney.amount,
        amountSatang: roomChargeMoney.amountSatang,
        quantity: pricing.nights,
        total: roomChargeMoney.total,
        totalSatang: roomChargeMoney.totalSatang,
        createdBy: actorName(actor),
      },
    })

    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: assignedReservation.status })
    await createAudit(tx, actor, 'CREATED', 'reservation', reservation.id, { confirmationCode: reservation.confirmationCode })

    if (activeReservationStatuses().includes(assignedReservation.status)) {
      await reconcileReservationAvailabilityInTransaction(tx, {
        propertyId: property.id,
        affected: [manualChannelAffectedStay(roomType.id, checkInKey, checkOutKey)],
        triggerType: 'RESERVATION_CREATED',
        sourceReservationId: reservation.id,
        manualChannelContext: input.manualChannelContext,
      }, actor)
    }

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
}

export async function createReservation(prisma, input, actor) {
  rejectInternalReservationFields(input, 'Reservation creation')
  return serializableTransaction(prisma, async (tx) => createReservationInTransaction(tx, input, actor))
}

export async function listBookingEmailSources(prisma) {
  return prisma.$transaction(async (tx) => {
    await ensurePrimaryBookingEmailSource(tx)
    const sources = await tx.bookingEmailSource.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    })
    return sources.map(bookingEmailSourceResponse)
  })
}

export async function createBookingEmailSource(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx)
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
    const provider = normalizeBookingEmailProvider(input.provider)
    if (provider !== 'GMAIL') {
      throw new PmsValidationError('Booking-email intake is Gmail-only in PMS Lite.')
    }
    if (input.autoProcessSafeEvents) {
      throw new PmsValidationError('Booking-email events are review-only and cannot be auto-processed.')
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
        provider: 'GMAIL',
        enabled: input.enabled !== false,
        autoProcessSafeEvents: false,
        reviewThreshold,
        query: normalizeNullableString(input.query),
      },
      create: {
        propertyId: property.id,
        name: normalizeNullableString(input.name) || mailbox,
        provider: 'GMAIL',
        mailbox,
        enabled: input.enabled !== false,
        autoProcessSafeEvents: false,
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
    const existing = await tx.bookingEmailSource.findUnique({ where: { id: sourceId } })
    if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
    const reviewThreshold = input.reviewThreshold === undefined ? existing.reviewThreshold : Number(input.reviewThreshold)
    if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) {
      throw new PmsValidationError('Review threshold must be between 0 and 1.')
    }
    if (input.provider !== undefined && normalizeBookingEmailProvider(input.provider) !== 'GMAIL') {
      throw new PmsValidationError('Booking-email intake is Gmail-only in PMS Lite.')
    }
    if (input.autoProcessSafeEvents) {
      throw new PmsValidationError('Booking-email events are review-only and cannot be auto-processed.')
    }
    const source = await tx.bookingEmailSource.update({
      where: { id: sourceId },
      data: {
        name: input.name === undefined ? existing.name : normalizeNullableString(input.name) || existing.name,
        provider: 'GMAIL',
        enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
        autoProcessSafeEvents: false,
        reviewThreshold,
        query: input.query === undefined ? existing.query : normalizeNullableString(input.query),
      },
    })
    await createAudit(tx, actor, 'BOOKING_EMAIL_SOURCE_UPDATED', 'bookingEmailSource', source.id, { changes: input })
    return bookingEmailSourceResponse(source)
  })
}

export async function getBookingEmailStatus(prisma) {
  const status = await prisma.$transaction(async (tx) => {
    await ensurePrimaryBookingEmailSource(tx)
    const property = await getProperty(tx)
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

export async function listBookingEmailEvents(prisma, filters = {}) {
  return prisma.$transaction(async (tx) => {
    await ensurePrimaryBookingEmailSource(tx)
    const property = await getProperty(tx)
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

export async function getBookingEmailEvent(prisma, eventId) {
  const event = await prisma.bookingEmailEvent.findUnique({
    where: { id: eventId },
    include: bookingEmailEventInclude(),
  })
  if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
  return bookingEmailEventResponse(event)
}

async function syncBookingEmailInternal(prisma, input, actor, trustedEvents) {
  const source = await prisma.$transaction(async (tx) => {
    if (input.sourceId) {
      const existing = await tx.bookingEmailSource.findUnique({ where: { id: input.sourceId } })
      if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
      return existing
    }
    return ensurePrimaryBookingEmailSource(tx)
  })
  const reviewOnly = true

  let importedEvents = trustedEvents
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
    const currentSource = await tx.bookingEmailSource.findUnique({ where: { id: source.id } })
    if (!currentSource) throw new PmsValidationError('Booking email source was not found.', 404)
    const events = []
    for (const inputEvent of importedEvents) {
      const event = await upsertBookingEmailEvent(tx, currentSource, inputEvent)
      events.push(event)
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
    status: await getBookingEmailStatus(prisma),
    events: results.map(bookingEmailEventResponse),
    opsCommandEvents: results.map((event) => ({
      ...bookingEmailEventResponse(event),
      sourceMessageId: event.sourceMessageId || undefined,
      rawText: event.rawText || undefined,
      body: event.rawText || undefined,
    })),
  }
}

async function linkBookingEmailEventToReservation(tx, event, reservationId, actor) {
  const reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
  if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
  assertBookingEmailReservationLinkable(event, reservation)
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

function assertActionableBookingEmailEvent(event) {
  if (event?.legacyReadOnly) {
    throw new PmsValidationError(
      'This historical booking email is read-only legacy evidence and cannot be approved, rejected, or reprocessed.',
      409,
    )
  }
}

export async function syncBookingEmail(prisma, input = {}, actor) {
  if (Object.hasOwn(input, 'events')) {
    throw new PmsValidationError('Public booking-email sync cannot inject events. Use the trusted server ingestion path.', 400)
  }
  return syncBookingEmailInternal(prisma, input, actor, null)
}

export async function ingestBookingEmailEvents(prisma, input = {}, actor) {
  if (!Array.isArray(input.events)) {
    throw new PmsValidationError('Trusted booking-email ingestion requires an events array.')
  }
  return syncBookingEmailInternal(prisma, input, actor, input.events)
}

export async function approveBookingEmailEvent(prisma, eventId, input = {}, actor) {
  try {
    return await serializableTransaction(prisma, async (tx) => {
      const event = await tx.bookingEmailEvent.findUnique({
        where: { id: eventId },
        include: bookingEmailEventInclude(),
      })
      if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
      assertActionableBookingEmailEvent(event)
      if (event.status === 'PROCESSED') throw new PmsValidationError('This booking email event has already been processed.', 409)
      if (event.status === 'IGNORED') throw new PmsValidationError('Ignored booking email events must be reprocessed before approval.', 409)

      const details = detailsForApproval(event, input.editedDetails)
      const mode = String(input.mode || 'apply_parsed')
      if (!['apply_parsed', 'link_reservation', 'create_reservation'].includes(mode)) {
        throw new PmsValidationError('Select a valid booking-email approval mode.')
      }
      if (mode === 'create_reservation' && event.eventType !== 'NEW_BOOKING') {
        throw new PmsValidationError('Only a new-booking email can create a reservation.')
      }
      if (mode === 'link_reservation') {
        requireActorPermission(actor, 'edit:reservation', 'Linking a booking email')
        if (!input.reservationId) throw new PmsValidationError('Select a reservation to link this email event.')
        return bookingEmailEventResponse(await linkBookingEmailEventToReservation(tx, event, input.reservationId, actor))
      }

      if (event.eventType === 'NEW_BOOKING') {
        requireActorPermission(actor, 'create:reservation', 'Creating a reservation from booking email')
        return bookingEmailEventResponse(await approveNewBookingEmailEvent(tx, event, details, actor))
      }
      if (event.eventType === 'PAYMENT_NOTICE') {
        requireActorPermission(actor, 'process:payment', 'Applying a booking-email payment')
        return bookingEmailEventResponse(await approvePaymentEmailEvent(tx, event, details, actor, input.reservationId))
      }
      if (event.eventType === 'CANCELLATION') {
        requireActorPermission(actor, 'cancel:reservation', 'Applying a booking-email cancellation')
        return bookingEmailEventResponse(await approveCancellationEmailEvent(tx, event, details, actor, input.reservationId, input.reason))
      }
      if (event.eventType === 'MODIFICATION') {
        requireActorPermission(actor, 'edit:reservation', 'Applying a booking-email modification')
        return bookingEmailEventResponse(await approveModificationEmailEvent(tx, event, details, actor, input.reservationId, input.reason))
      }

      requireActorPermission(actor, 'edit:reservation', 'Linking a booking email')
      if (!input.reservationId) {
        throw new PmsValidationError('This email type needs a linked reservation and staff notes before it can be marked processed.')
      }
      return bookingEmailEventResponse(await linkBookingEmailEventToReservation(tx, event, input.reservationId, actor))
    })
  } catch (error) {
    const denialEvidence = error?.bookingEmailLifecycleDenialAudit
    if (denialEvidence) {
      try {
        await createAudit(prisma, actor, 'BOOKING_EMAIL_LIFECYCLE_DENIED', 'bookingEmailEvent', eventId, denialEvidence)
      } catch {
        throw new PmsValidationError(
          'The booking-email action was denied, but required audit evidence could not be recorded. No reservation changes were applied.',
          500,
        )
      }
    }
    throw error
  }
}

export async function rejectBookingEmailEvent(prisma, eventId, input = {}, actor) {
  return prisma.$transaction(async (tx) => {
    const reason = normalizeNullableString(input.reason)
    if (!reason) throw new PmsValidationError('Rejecting or ignoring an email event requires a reason.')
    const event = await tx.bookingEmailEvent.findUnique({ where: { id: eventId } })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    assertActionableBookingEmailEvent(event)
    if (event.status === 'PROCESSED' || event.processedAt) {
      throw new PmsValidationError('Processed booking email events cannot be rejected or ignored.', 409)
    }
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
    const event = await tx.bookingEmailEvent.findUnique({
      where: { id: eventId },
      include: bookingEmailEventInclude(),
    })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    assertActionableBookingEmailEvent(event)
    if (event.status === 'PROCESSED' || event.processedAt) {
      throw new PmsValidationError('Processed booking email events cannot be reprocessed.', 409)
    }
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
      rawHeaders: event.rawHeaders,
    }, event.id)
    const updated = await tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        ...data,
        status: 'NEEDS_REVIEW',
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
  assertNoPublicBookingEmailProvenance(input?.payment, 'Walk-in payment')
  return serializableTransaction(prisma, async (tx) => {
    const property = await getProperty(tx)
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')
    const pricing = calculateStayMoney({
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
    const guest = await tx.guest.create({ data: guestData })

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
        ratePerNight: pricing.ratePerNight,
        ratePerNightSatang: pricing.ratePerNightSatang,
        totalAmount: pricing.total,
        totalAmountSatang: pricing.totalSatang,
        depositAmount: pricing.depositAmount,
        depositAmountSatang: pricing.depositAmountSatang,
        depositPaid: false,
        source: 'WALK_IN',
        channelRef: null,
        notes: input.notes || null,
        specialRequests: input.specialRequests || null,
      },
      include: reservationInclude,
    })

    const candidateRoom = input.assignedRoomId
      ? await tx.room.findUnique({ where: { id: input.assignedRoomId }, include: { roomType: true } })
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

    const initialFolioMoney = buildFolioMoneyFields([
      { totalSatang: pricing.totalSatang, void: false },
    ], [])
    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        ...initialFolioMoney,
      },
    })

    const roomChargeMoney = buildChargeMoneyFieldsFromSatang(pricing.ratePerNightSatang, pricing.nights, pricing.totalSatang)
    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: roomChargeMoney.amount,
        amountSatang: roomChargeMoney.amountSatang,
        quantity: pricing.nights,
        total: roomChargeMoney.total,
        totalSatang: roomChargeMoney.totalSatang,
        createdBy: actorName(actor),
      },
    })
    await recomputeFolio(tx, folio.id)

    if (input.payment && (Object.hasOwn(input.payment, 'amount') || Object.hasOwn(input.payment, 'amountSatang'))) {
      await recordPaymentInTransaction(tx, folio.id, input.payment, actor)
    }
    const settledFolio = await tx.folio.findUnique({ where: { id: folio.id } })
    const remainingBalance = storedMoneyPair(
      settledFolio || { balance: 0 },
      'balanceSatang',
      'balance',
      'Folio balance',
      { minimum: MONEY_SATANG_MIN },
    )
    if (remainingBalance.satang > 0) {
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
    await reconcileReservationAvailabilityInTransaction(tx, {
      propertyId: property.id,
      affected: [manualChannelAffectedStay(roomType.id, checkInKey, checkOutKey)],
      triggerType: 'WALK_IN_CHECKED_IN',
      sourceReservationId: reservation.id,
    }, actor)

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function assignRoom(prisma, reservationId, roomId, actor, options = {}) {
  return serializableTransaction(prisma, async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    assertExpectedReservationVersion(reservation, options.expectedUpdatedAt)
    if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(reservation.status)) {
      throw new PmsValidationError('Only active reservations can be assigned a room.')
    }

    const property = await getProperty(tx)
    const room = await validateRoomAssignable(tx, reservation, roomId)
    await reserveRoomDates(tx, property.id, reservation.id, room.id, reservation.checkIn, reservation.checkOut)

    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: { assignedRoomId: room.id },
      include: reservationInclude,
    })
    await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    await createAudit(tx, actor, 'ASSIGNED_ROOM', 'reservation', reservation.id, { roomId: room.id, roomNumber: room.number })
    return updated
  })
}

export async function checkInReservation(prisma, reservationId, actor, options = {}) {
  assertNoPublicBookingEmailProvenance(options?.payment, 'Check-in payment')
  return prisma.$transaction(async (tx) => {
    let reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
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

    if (options.payment && (Object.hasOwn(options.payment, 'amount') || Object.hasOwn(options.payment, 'amountSatang'))) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    }

    const remainingBalance = storedMoneyPair(
      reservation.folio || { balance: 0 },
      'balanceSatang',
      'balance',
      'Folio balance',
      { minimum: MONEY_SATANG_MIN },
    )
    if (remainingBalance.satang > 0) {
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
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function checkOutReservation(prisma, reservationId, actor, options = {}) {
  assertNoPublicBookingEmailProvenance(options?.payment, 'Checkout payment')
  return prisma.$transaction(async (tx) => {
    let reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (reservation.status !== 'CHECKED_IN') {
      throw new PmsValidationError('Only checked-in reservations can be checked out.')
    }
    if (!reservation.assignedRoomId || !reservation.assignedRoom) {
      throw new PmsValidationError('Checked-in reservation is missing its assigned room.')
    }

    if (options.payment && (Object.hasOwn(options.payment, 'amount') || Object.hasOwn(options.payment, 'amountSatang'))) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    }

    const remainingBalance = storedMoneyPair(
      reservation.folio || { balance: 0 },
      'balanceSatang',
      'balance',
      'Folio balance',
      { minimum: MONEY_SATANG_MIN },
    )
    if (remainingBalance.satang > 0) {
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

    await tx.roomDateInventory.deleteMany({ where: { reservationId: reservation.id } })

    const folioClosed = Boolean(reservation.folio?.id && remainingBalance.satang <= 0)
    if (reservation.folio?.id) {
      await tx.folio.update({
        where: { id: reservation.folio.id },
        data: { status: folioClosed ? 'CLOSED' : 'OPEN' },
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
        folioClosed,
        overrides: {
          unpaidBalance: Boolean(options.allowUnpaidOverride),
        },
      },
    })
    await createAudit(tx, actor, 'CHECKED_OUT', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: reservation.status, roomStatus: room.currentStatus, balance: remainingBalance.thb },
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
    const remainingStay = manualChannelRemainingStay(
      reservation.roomTypeId,
      reservation.checkIn,
      reservation.checkOut,
    )
    if (remainingStay) {
      await reconcileReservationAvailabilityInTransaction(tx, {
        propertyId: reservation.propertyId,
        affected: [remainingStay],
        triggerType: 'RESERVATION_EARLY_CHECKOUT',
        sourceReservationId: reservation.id,
      }, actor)
    }
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

async function cancelReservationInTransaction(tx, reservationId, actor, status = 'CANCELLED', notes = undefined, options = {}) {
    if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
      throw new PmsValidationError('Cancellation status must be CANCELLED or NO_SHOW.')
    }
    const reason = requireOperationalReason(notes, status === 'NO_SHOW' ? 'Marking a reservation no-show' : 'Cancelling a reservation')
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (reservation.status === 'CHECKED_IN') {
      throw new PmsValidationError('Checked-in reservations must be checked out before cancellation.')
    }
    if (!activeReservationStatuses().includes(reservation.status)) {
      throw new PmsValidationError('Only an active reservation can be cancelled or marked no-show.', 409)
    }
    if (status === 'NO_SHOW' && getBangkokDateKey(reservation.checkIn) > getBangkokDateKey(new Date())) {
      throw new PmsValidationError('A reservation cannot be marked no-show before its arrival date.')
    }

    await tx.roomDateInventory.deleteMany({ where: { reservationId } })
    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status,
        notes: [
          normalizeNullableString(reservation.notes),
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
    await createAudit(tx, actor, status, 'reservation', reservation.id, { notes: reason })
    if (activeReservationStatuses().includes(reservation.status)) {
      await reconcileReservationAvailabilityInTransaction(tx, {
        propertyId: reservation.propertyId,
        affected: [manualChannelAffectedStay(reservation.roomTypeId, reservation.checkIn, reservation.checkOut)],
        triggerType: status === 'NO_SHOW' ? 'RESERVATION_NO_SHOW' : 'RESERVATION_CANCELLED',
        sourceReservationId: reservation.id,
        manualChannelContext: options.manualChannelContext,
      }, actor)
    }
    return updated
}

export async function cancelReservation(prisma, reservationId, actor, status = 'CANCELLED', notes = undefined) {
  return serializableTransaction(prisma, (tx) => cancelReservationInTransaction(tx, reservationId, actor, status, notes))
}

export async function updateHousekeepingStatus(prisma, roomId, cleanStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { roomType: true } })
    if (!room) throw new PmsValidationError('Room was not found.', 404)
    if (!['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED', 'MAINTENANCE'].includes(cleanStatus)) {
      throw new PmsValidationError('Select a valid housekeeping status.')
    }
    const occupied = Boolean(room.currentReservation)
      || ['OCCUPIED_CLEAN', 'OCCUPIED_DIRTY', 'OCCUPIED'].includes(room.currentStatus)
    assertHousekeepingTransition(room.currentStatus, cleanStatus, { occupied })
    const operationalNotes = cleanStatus === 'MAINTENANCE'
      ? requireOperationalReason(notes, 'Taking a room out of service for maintenance')
      : notes

    const operationalStatus = cleanStatus === 'MAINTENANCE' ? 'OUT_OF_SERVICE' : room.operationalStatus
    const toStatus = cleanStatus === 'MAINTENANCE'
      ? 'VACANT_DIRTY'
      : roomStatusForHousekeeping(room.currentStatus, cleanStatus, occupied)

    await createRoomStatusLog(tx, room, toStatus, actor, operationalNotes)
    const updated = await tx.room.update({
      where: { id: room.id },
      data: {
        currentStatus: toStatus,
        operationalStatus,
        notes: operationalNotes || room.notes,
      },
      include: { roomType: true },
    })
    await createAudit(tx, actor, 'HOUSEKEEPING_STATUS_UPDATED', 'room', room.id, {
      cleanStatus,
      toStatus,
      ...(cleanStatus === 'MAINTENANCE' ? { reason: operationalNotes } : {}),
    })
    await reconcileRoomCapacityInTransaction(tx, {
      propertyId: room.propertyId,
      beforeRoom: room,
      afterRoom: updated,
      triggerType: 'HOUSEKEEPING_MAINTENANCE',
    }, actor)
    return updated
  })
}

export async function updateRoomOperationalStatus(prisma, roomId, operationalStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { roomType: true } })
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
    await reconcileRoomCapacityInTransaction(tx, {
      propertyId: room.propertyId,
      beforeRoom: room,
      afterRoom: updated,
      triggerType: 'ROOM_OPERATIONAL_STATUS_UPDATED',
    }, actor)
    return updated
  })
}

export async function createPayment(prisma, input, actor) {
  assertNoPublicBookingEmailProvenance(input, 'Public payment creation')
  return prisma.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({
      where: { id: input.folioId },
      include: {
        reservation: true,
      },
    })
    if (!folio) throw new PmsValidationError('Folio was not found.', 404)
    return recordPaymentInTransaction(tx, folio.id, input, actor)
  })
}

export async function createCharge(prisma, input, actor) {
  assertNoPublicBookingEmailProvenance(input, 'Public charge creation')
  return prisma.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({ where: { id: input.folioId } })
    if (!folio) throw new PmsValidationError('Folio was not found.', 404)
    if (folio.status !== 'OPEN') {
      throw new PmsValidationError('Charges can only be posted to an open folio.')
    }

    const quantity = Number(input.quantity || 1)
    const description = normalizeNullableString(input.description)
    const category = String(input.category || 'OTHER').toUpperCase()
    const validCategories = ['EXTRA_GUEST', 'CHILD', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER']

    if (!description) throw new PmsValidationError('Charge description is required.')
    if (!validCategories.includes(category)) {
      throw new PmsValidationError('Select a valid incidental charge category. Room charges are managed by the reservation service.')
    }
    if (!Number.isInteger(quantity) || quantity < 1) throw new PmsValidationError('Charge quantity must be at least 1.')
    const chargeMoney = Object.hasOwn(input, 'amountSatang')
      ? buildChargeMoneyFieldsFromSatang(input.amountSatang, quantity)
      : buildChargeMoneyFields(input.amount, quantity)
    if (Object.hasOwn(input, 'amountSatang') && Object.hasOwn(input, 'amount')) {
      const legacyChargeMoney = buildChargeMoneyFields(input.amount, quantity)
      if (legacyChargeMoney.amountSatang !== chargeMoney.amountSatang) {
        throw new PmsValidationError('Charge amount THB and MoneySatang values do not match.')
      }
    }

    const charge = await tx.charge.create({
      data: {
        folioId: folio.id,
        date: input.date ? dateFromKey(getBangkokDateKey(input.date)) : dateFromKey(getBangkokDateKey(new Date())),
        description,
        category,
        amount: chargeMoney.amount,
        amountSatang: chargeMoney.amountSatang,
        quantity,
        total: chargeMoney.total,
        totalSatang: chargeMoney.totalSatang,
        sourceEmailEventId: normalizeNullableString(input.sourceEmailEventId),
        createdBy: actorName(actor),
      },
    })
    const updatedFolio = await recomputeFolio(tx, folio.id)
    await createAudit(tx, actor, 'CHARGE_CREATED', 'charge', charge.id, { folioId: folio.id, amount: charge.amount, quantity, category, sourceEmailEventId: normalizeNullableString(input.sourceEmailEventId) })
    return { charge, folio: updatedFolio }
  })
}

export async function createGuest(prisma, input, actor) {
  const guest = await prisma.guest.create({ data: validateGuestInput(input) })
  await createAudit(prisma, actor, 'CREATED', 'guest', guest.id)
  return guest
}

export async function updateGuest(prisma, guestId, input, actor) {
  const data = validateGuestInput(input)
  const guest = await prisma.guest.update({ where: { id: guestId }, data })
  await createAudit(prisma, actor, 'MODIFIED', 'guest', guest.id)
  return guest
}

export async function getTodayData(prisma) {
  const property = await getProperty(prisma)
  const todayKey = getBangkokDateKey(new Date())
  const today = dateFromKey(todayKey)
  const tomorrow = dateFromKey(nextDateKey(todayKey))
  const [rooms, arrivals, departures, inHouse, unpaidFolios] = await Promise.all([
    prisma.room.findMany({ where: { propertyId: property.id }, include: { roomType: true }, orderBy: [{ floor: 'asc' }, { number: 'asc' }] }),
    prisma.reservation.count({ where: { propertyId: property.id, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN', checkOut: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN' } }),
    prisma.folio.count({ where: { balance: { gt: 0 } } }),
  ])

  return {
    hotelDate: todayKey,
    arrivals,
    departures,
    inHouse,
    unpaidFolios,
    roomsTotal: rooms.length,
    roomsSellable: rooms.filter(isOperationallySellableRoom).length,
    roomsDirty: rooms.filter((room) => room.currentStatus === 'VACANT_DIRTY' || room.currentStatus === 'OCCUPIED_DIRTY').length,
    roomsReady: rooms.filter((room) => room.operationalStatus === 'AVAILABLE' && ['VACANT_CLEAN', 'INSPECTED'].includes(room.currentStatus)).length,
  }
}

export async function getFrontDeskBoard(prisma) {
  const property = await getProperty(prisma)
  const [rooms, reservations] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: property.id },
      include: { roomType: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: { propertyId: property.id, status: { in: activeReservationStatuses() } },
      include: reservationInclude,
      orderBy: [{ checkIn: 'asc' }],
    }),
  ])

  return { property, rooms, reservations }
}
