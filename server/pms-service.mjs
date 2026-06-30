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
      },
      payments: {
        include: {
          sourceEmailEvent: true,
        },
      },
    },
  },
  bookingEmailEvents: {
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
  return actor?.name || actor?.email || actor?.id || 'System'
}

function normalizeNullableString(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizePaymentReferenceFingerprint(method, reference) {
  const normalizedReference = normalizeNullableString(reference)
  if (!normalizedReference) return null
  return `${normalizePaymentMethod(method)}:${normalizedReference.toUpperCase().replace(/\s+/g, '')}`
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
      extraGuestFee: setupNumber(roomTypes[0]?.extraGuestFee ?? 0, 'Extra guest fee'),
      childFee: setupNumber(roomTypes[0]?.childFee ?? 0, 'Child fee'),
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
const VALID_BOOKING_EMAIL_STATUSES = ['NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED']
const VALID_BOOKING_EMAIL_EVENT_TYPES = ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE', 'GUEST_MESSAGE', 'UNKNOWN']
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

function bookingEmailGmailAccessToken() {
  return normalizeNullableString(process.env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN || process.env.GMAIL_ACCESS_TOKEN)
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

function normalizeBookingSourceFromEmail(sender, sourceName) {
  const text = `${sender || ''} ${sourceName || ''}`.toLowerCase()
  if (text.includes('booking.com') || text.includes('bookingcom')) return 'BOOKING_COM'
  if (text.includes('agoda')) return 'AGODA'
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
  const amountMatch = String(text || '').match(/\b(?:THB)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:THB)?\b/i)
  if (!amountMatch) return {}
  const amount = Number(amountMatch[1].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return {}
  return { amount, currency: /THB/i.test(amountMatch[0]) ? 'THB' : undefined }
}

function parseDateFromText(label, text) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const labeled = String(text || '').match(new RegExp(`${escaped}\\s*[:#-]?\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})`, 'i'))
  const raw = labeled?.[1]
  if (!raw) return undefined
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map((part) => part.padStart(2, '0'))
    return `${year}-${month}-${day}`
  }
  const [day, month, yearPart] = raw.split(/[/.]/)
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseBookingEmailDetails(input = {}) {
  const parsedInput = safeJsonObject(input.parsedDetails)
  const rawText = String(input.rawText || input.body || input.snippet || '')
  const subject = String(input.subject || '')
  const combined = `${subject}\n${rawText}`
  const lower = combined.toLowerCase()

  const explicitType = normalizeBookingEmailEventType(input.eventType)
  const eventType = explicitType !== 'UNKNOWN'
    ? explicitType
    : lower.includes('cancel')
      ? 'CANCELLATION'
      : lower.includes('modification') || lower.includes('changed') || lower.includes('amended')
        ? 'MODIFICATION'
        : lower.includes('payment') || lower.includes('paid') || lower.includes('deposit')
          ? 'PAYMENT_NOTICE'
          : lower.includes('message') || lower.includes('request') || lower.includes('question')
            ? 'GUEST_MESSAGE'
            : lower.includes('booking') || lower.includes('reservation') || lower.includes('confirmation')
              ? 'NEW_BOOKING'
              : 'UNKNOWN'

  const channelRef = normalizeNullableString(input.channelRef || parsedInput.channelRef || parsedInput.confirmationCode)
    || combined.match(/\b(?:confirmation|booking|reservation|reference|ref|booking id|reservation id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i)?.[1]
    || null
  const guestName = normalizeNullableString(input.guestName || parsedInput.guestName)
    || combined.match(/\b(?:guest|guest name|name)\s*[:#-]\s*([A-Z][A-Za-z .'-]{2,80})/i)?.[1]
    || null
  const checkIn = dateKeyOrUndefined(input.checkIn || parsedInput.checkIn)
    || parseDateFromText('check in', combined)
    || parseDateFromText('arrival', combined)
  const checkOut = dateKeyOrUndefined(input.checkOut || parsedInput.checkOut)
    || parseDateFromText('check out', combined)
    || parseDateFromText('departure', combined)
  const roomType = normalizeRoomTypeCode(input.roomType || parsedInput.roomType)
    || (/\bdouble\b/i.test(combined) ? 'DOUBLE' : /\btwin\b/i.test(combined) ? 'TWIN' : undefined)
  const money = parseMoney(combined)
  const amount = Number(input.amount ?? parsedInput.amount ?? money.amount)
  const adults = Number(input.adults ?? parsedInput.adults ?? combined.match(/\b(?:adults?)\s*[:#-]?\s*(\d+)/i)?.[1] ?? 1)
  const children = Number(input.children ?? parsedInput.children ?? combined.match(/\b(?:children|kids?)\s*[:#-]?\s*(\d+)/i)?.[1] ?? 0)
  const paymentStatus = normalizeNullableString(input.paymentStatus || parsedInput.paymentStatus)
    || (lower.includes('paid') || lower.includes('payment received') ? 'PAID' : lower.includes('deposit') ? 'DEPOSIT' : null)

  const details = {
    guestName: guestName || undefined,
    checkIn,
    checkOut,
    roomType,
    adults: Number.isInteger(adults) && adults > 0 ? adults : 1,
    children: Number.isInteger(children) && children >= 0 ? children : 0,
    amount: Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : undefined,
    currency: normalizeNullableString(input.currency || parsedInput.currency || money.currency) || 'THB',
    paymentStatus: paymentStatus || undefined,
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

function proposedBookingEmailAction(eventType) {
  if (eventType === 'NEW_BOOKING') return 'Create reservation after staff review'
  if (eventType === 'MODIFICATION') return 'Link to reservation and review changes'
  if (eventType === 'CANCELLATION') return 'Cancel matched reservation after approval'
  if (eventType === 'PAYMENT_NOTICE') return 'Record payment after duplicate check'
  if (eventType === 'GUEST_MESSAGE') return 'Link message to reservation'
  return 'Review raw email and classify'
}

function bookingEmailSourceResponse(source) {
  return {
    id: source.id,
    name: source.name,
    provider: bookingEmailProviderForClient(source.provider),
    enabled: source.enabled,
    mailbox: source.mailbox,
    lastSyncAt: isoOrUndefined(source.lastSyncAt),
    lastError: source.lastError || undefined,
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
    sourceEmailId: event.sourceMessageId || undefined,
    parsedDetails,
    createdAt: isoOrUndefined(event.createdAt),
    updatedAt: isoOrUndefined(event.updatedAt),
  }
}

async function ensurePrimaryBookingEmailSource(tx) {
  const property = await getProperty(tx)
  const mailbox = primaryBookingMailbox()
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
      lastError: bookingEmailGmailAccessToken() ? null : 'Gmail API credentials are not configured for this server.',
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

async function fetchGmailJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PmsValidationError(payload?.error?.message || 'Gmail API request failed.', response.status)
  }
  return payload
}

async function fetchGmailEventsForSource(source, options = {}) {
  const token = bookingEmailGmailAccessToken()
  if (!token) {
    throw new PmsValidationError('Gmail API credentials are not configured for booking email sync.', 503)
  }
  const userId = encodeURIComponent(process.env.BOOKING_EMAIL_GMAIL_USER_ID || 'me')
  const query = source.query || `to:${source.mailbox} -in:spam -in:trash newer_than:30d`
  const maxResults = Math.min(Math.max(Number(options.limit || 10), 1), 50)
  const listUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages`)
  listUrl.searchParams.set('q', query)
  listUrl.searchParams.set('maxResults', String(maxResults))

  const listed = await fetchGmailJson(listUrl, token)
  const messages = []
  for (const item of listed.messages || []) {
    const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${encodeURIComponent(item.id)}`)
    messageUrl.searchParams.set('format', 'full')
    const message = await fetchGmailJson(messageUrl, token)
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
      },
    })
  }
  return messages
}

async function findDuplicateBookingEmailEvent(tx, sourceId, channelRef, eventId) {
  if (!channelRef) return null
  return tx.bookingEmailEvent.findFirst({
    where: {
      id: eventId ? { not: eventId } : undefined,
      sourceId: sourceId || undefined,
      channelRef,
    },
    orderBy: { receivedAt: 'asc' },
  })
}

async function findReservationForBookingEmailEvent(tx, event, details = safeJsonObject(event.parsedDetails)) {
  if (event.reservationId) {
    const reservation = await tx.reservation.findUnique({
      where: { id: event.reservationId },
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
  const duplicateEvent = await findDuplicateBookingEmailEvent(tx, source.id, parsed.channelRef, existingEventId)
  const sourceMessageId = normalizeNullableString(input.sourceMessageId || input.sourceEmailId || input.gmailMessageId || input.messageId)
  const status = normalizeBookingEmailStatus(input.status, 'NEEDS_REVIEW')
  const reviewReason = normalizeNullableString(input.reviewReason)
    || (duplicateEvent ? `Possible duplicate of email event ${duplicateEvent.id}.` : null)
    || parsed.reviewReason

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
    confidence: Number(input.confidence ?? parsed.confidence),
    channelRef: parsed.channelRef,
    guestName: parsed.details.guestName || null,
    checkIn: parsed.details.checkIn ? dateFromKey(parsed.details.checkIn) : null,
    checkOut: parsed.details.checkOut ? dateFromKey(parsed.details.checkOut) : null,
    roomType: parsed.details.roomType || null,
    amount: parsed.details.amount ?? null,
    currency: parsed.details.currency || null,
    paymentStatus: parsed.details.paymentStatus || null,
    proposedAction: normalizeNullableString(input.proposedAction) || proposedBookingEmailAction(parsed.eventType),
    completedAction: normalizeNullableString(input.completedAction),
    reviewReason,
    errorReason: normalizeNullableString(input.errorReason),
    parsedDetails: parsed.details,
    rawHeaders: safeJsonObject(input.rawHeaders),
    rawText: normalizeNullableString(input.rawText || input.body || input.snippet),
    duplicateOfEventId: duplicateEvent?.id || null,
  }
}

async function upsertBookingEmailEvent(tx, source, input) {
  const data = await buildBookingEmailEventData(tx, source, input)
  if (data.sourceMessageId) {
    return tx.bookingEmailEvent.upsert({
      where: {
        sourceId_sourceMessageId: {
          sourceId: source.id,
          sourceMessageId: data.sourceMessageId,
        },
      },
      update: {
        ...data,
        status: data.status === 'PROCESSED' ? 'PROCESSED' : undefined,
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

async function approveNewBookingEmailEvent(tx, event, details, actor) {
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

async function approvePaymentEmailEvent(tx, event, details, actor, reservationId) {
  const reservation = reservationId
    ? await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
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
    notes: `Payment notice from booking email event ${event.id}`,
    sourceEmailEventId: event.id,
    allowOverpayment: Boolean(details.allowOverpayment),
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
  const reservation = reservationId
    ? await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    : await findReservationForBookingEmailEvent(tx, event, details)
  if (!reservation) throw new PmsValidationError('Link this cancellation to a reservation before applying it.')
  if (reservation.status === 'CHECKED_IN') throw new PmsValidationError('Checked-in reservations must be checked out before cancellation.')

  await tx.roomDateInventory.deleteMany({ where: { reservationId: reservation.id } })
  const updatedReservation = await tx.reservation.update({
    where: { id: reservation.id },
    data: {
      status: 'CANCELLED',
      notes: [reservation.notes, reason || `Cancelled from booking email event ${event.id}`].filter(Boolean).join('\n'),
    },
    include: reservationInclude,
  })
  await createReservationLog(tx, reservation.id, 'CANCELLED', actor, {
    fromStatus: reservation.status,
    toStatus: 'CANCELLED',
    notes: reason || `Cancelled from booking email event ${event.id}.`,
    changes: { sourceEmailEventId: event.id, sourceMessageId: event.sourceMessageId },
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
    reason,
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
  const subtotal = roundMoney(charges.reduce((sum, charge) => sum + charge.total, 0))
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0))
  const balance = roundMoney(subtotal - paid)

  return tx.folio.update({
    where: { id: folioId },
    data: {
      subtotal,
      tax: 0,
      total: subtotal,
      paid,
      balance,
      status: balance <= 0 ? 'CLOSED' : 'OPEN',
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
  const amount = Number(input?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PmsValidationError('Payment amount must be greater than zero.')
  }
  const method = normalizePaymentMethod(input.method)
  const reference = normalizeNullableString(input.reference)
  if (paymentMethodRequiresReference(method) && !reference) {
    throw new PmsValidationError('Payment reference is required for card, bank transfer, and online payments.')
  }
  const referenceFingerprint = normalizePaymentReferenceFingerprint(method, reference)
  const folio = await tx.folio.findUnique({ where: { id: folioId } })
  if (!folio) throw new PmsValidationError('Folio was not found.', 404)
  if (amount > folio.balance && !input.allowOverpayment) {
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
      amount: roundMoney(amount),
      method,
      reference,
      referenceFingerprint,
      sourceEmailEventId,
      notes: normalizeNullableString(input.notes),
      processedBy: actorName(actor),
    },
  })
  const updatedFolio = await recomputeFolio(tx, folio.id)
  await createAudit(tx, actor, 'PAYMENT_CREATED', 'payment', payment.id, { folioId: folio.id, amount: payment.amount, method, sourceEmailEventId })
  return { payment, folio: updatedFolio }
}

export async function authenticateUser(prisma, email, password) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user?.active) return null

  const { verifyPassword } = await import('./security.mjs')
  if (!verifyPassword(password, user.passwordHash)) return null

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
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

export async function completeInitialSetup(prisma, input) {
  const setup = validateSetupPayload(input)
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
          baseRate: setupNumber(rate?.baseRate, `Base rate for ${roomType.name}`, { min: 1 }),
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

export async function updateReservation(prisma, reservationId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: reservationInclude,
    })
    if (!current) throw new PmsValidationError('Reservation was not found.', 404)
    if (['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(current.status)) {
      throw new PmsValidationError('Completed or cancelled reservations cannot be edited.')
    }

    const property = await getProperty(tx)
    let roomTypeId = current.roomTypeId
    let pricingRoomType = current.roomType
    if (input.roomTypeCode || input.roomType) {
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
    const ratePerNight = input.ratePerNight ?? current.ratePerNight
    const adults = input.adults ?? current.adults
    const children = input.children ?? current.children
    const childAges = input.childAges ?? current.childAges
    const { checkInKey, checkOutKey } = validateStayInput({ checkIn, checkOut })
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
      const assignedRoom = await tx.room.findUnique({ where: { id: assignedRoomId } })
      if (!assignedRoom || assignedRoom.roomTypeId !== roomTypeId) {
        assignedRoomId = null
      } else {
        const candidate = { ...current, roomTypeId, checkIn: dateFromKey(checkInKey), checkOut: dateFromKey(checkOutKey) }
        await validateRoomAssignable(tx, candidate, assignedRoomId)
      }
    }

    const updated = await tx.reservation.update({
      where: { id: current.id },
      data: {
        roomTypeId,
        assignedRoomId,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        adults: Number(adults),
        children: Number(children || 0),
        childAges: Array.isArray(childAges) ? childAges.map(Number) : [],
        ratePerNight: Number(ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
        source: input.source || current.source,
        channelRef: input.channelRef ?? current.channelRef,
        sourceEmailEventId: input.sourceEmailEventId === undefined ? current.sourceEmailEventId : normalizeNullableString(input.sourceEmailEventId),
        notes: input.notes ?? current.notes,
        specialRequests: input.specialRequests ?? current.specialRequests,
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
            amount: Number(ratePerNight),
            quantity: pricing.nights,
            total: pricing.total,
          },
        })
      }
      await recomputeFolio(tx, current.folio.id)
    }

    await createReservationLog(tx, current.id, 'MODIFIED', actor, { changes: input })
    await createAudit(tx, actor, 'MODIFIED', 'reservation', current.id, input)
    return updated
  })
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
  const baseRate = setupNumber(input?.baseRate ?? existing?.baseRate, 'Base rate', { min: 1 })

  return {
    code: normalizeSetupRoomTypeCode(input),
    name,
    description: setupString(input?.description ?? existing?.description, 'Room type description', false),
    baseRate,
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
    const guest = await tx.guest.create({ data: guestData })

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
        ratePerNight: Number(input.ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
        depositPaid: false,
        source: input.source || 'DIRECT',
        channelRef: input.channelRef || null,
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

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        subtotal: pricing.total,
        tax: 0,
        total: pricing.total,
        paid: 0,
        balance: pricing.total,
      },
    })

    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: Number(input.ratePerNight),
        quantity: pricing.nights,
        total: pricing.total,
        createdBy: actorName(actor),
      },
    })

    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: assignedReservation.status })
    await createAudit(tx, actor, 'CREATED', 'reservation', reservation.id, { confirmationCode: reservation.confirmationCode })

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
}

export async function createReservation(prisma, input, actor) {
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
    const existing = await tx.bookingEmailSource.findUnique({ where: { id: sourceId } })
    if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
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

export async function getBookingEmailStatus(prisma) {
  return prisma.$transaction(async (tx) => {
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
    const configured = enabledSources.length > 0 && (!gmailEnabled || Boolean(bookingEmailGmailAccessToken()))
    const lastSyncAt = sources.map((source) => source.lastSyncAt).filter(Boolean).sort((a, b) => b - a)[0]
    return {
      configured,
      lastSyncAt: isoOrUndefined(lastSyncAt),
      needsReview,
      processedToday,
      errors,
      ignored,
      sources: sources.map(bookingEmailSourceResponse),
      message: configured ? undefined : `Primary booking mailbox ${primaryBookingMailbox()} is registered, but Gmail API credentials are not configured on the server.`,
    }
  })
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

async function autoProcessBookingEmailEvent(tx, event, source, actor) {
  if (!source.autoProcessSafeEvents) return event
  if (event.status !== 'NEEDS_REVIEW') return event
  if (event.reviewReason || Number(event.confidence || 0) < source.reviewThreshold) return event
  const details = safeJsonObject(event.parsedDetails)
  try {
    if (event.eventType === 'NEW_BOOKING') return approveNewBookingEmailEvent(tx, event, details, actor)
    if (event.eventType === 'PAYMENT_NOTICE') return approvePaymentEmailEvent(tx, event, details, actor)
    return event
  } catch (error) {
    return tx.bookingEmailEvent.update({
      where: { id: event.id },
      data: {
        status: 'ERROR',
        errorReason: error instanceof Error ? error.message : String(error),
      },
      include: bookingEmailEventInclude(),
    })
  }
}

export async function syncBookingEmail(prisma, input = {}, actor) {
  const source = await prisma.$transaction(async (tx) => {
    if (input.sourceId) {
      const existing = await tx.bookingEmailSource.findUnique({ where: { id: input.sourceId } })
      if (!existing) throw new PmsValidationError('Booking email source was not found.', 404)
      return existing
    }
    return ensurePrimaryBookingEmailSource(tx)
  })

  let importedEvents = Array.isArray(input.events) ? input.events : null
  if (!importedEvents) {
    try {
      importedEvents = await fetchGmailEventsForSource(source, { limit: input.limit })
    } catch (error) {
      await prisma.bookingEmailSource.update({
        where: { id: source.id },
        data: { lastError: error instanceof Error ? error.message : String(error) },
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
      events.push(await autoProcessBookingEmailEvent(tx, event, currentSource, actor))
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
    })
    return events
  })

  return {
    status: await getBookingEmailStatus(prisma),
    events: results.map(bookingEmailEventResponse),
  }
}

async function linkBookingEmailEventToReservation(tx, event, reservationId, actor) {
  const reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
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

export async function approveBookingEmailEvent(prisma, eventId, input = {}, actor) {
  return serializableTransaction(prisma, async (tx) => {
    const event = await tx.bookingEmailEvent.findUnique({
      where: { id: eventId },
      include: bookingEmailEventInclude(),
    })
    if (!event) throw new PmsValidationError('Booking email event was not found.', 404)
    if (event.status === 'PROCESSED') throw new PmsValidationError('This booking email event has already been processed.', 409)
    if (event.status === 'IGNORED') throw new PmsValidationError('Ignored booking email events must be reprocessed before approval.', 409)

    const details = detailsForApproval(event, input.editedDetails)
    const mode = String(input.mode || 'apply_parsed')
    if (mode === 'link_reservation') {
      if (!input.reservationId) throw new PmsValidationError('Select a reservation to link this email event.')
      return bookingEmailEventResponse(await linkBookingEmailEventToReservation(tx, event, input.reservationId, actor))
    }

    if (event.eventType === 'NEW_BOOKING' || mode === 'create_reservation') {
      return bookingEmailEventResponse(await approveNewBookingEmailEvent(tx, event, details, actor))
    }
    if (event.eventType === 'PAYMENT_NOTICE') {
      return bookingEmailEventResponse(await approvePaymentEmailEvent(tx, event, details, actor, input.reservationId))
    }
    if (event.eventType === 'CANCELLATION') {
      return bookingEmailEventResponse(await approveCancellationEmailEvent(tx, event, details, actor, input.reservationId, input.reason))
    }

    if (!input.reservationId) {
      throw new PmsValidationError('This email type needs a linked reservation and staff notes before it can be marked processed.')
    }
    return bookingEmailEventResponse(await linkBookingEmailEventToReservation(tx, event, input.reservationId, actor))
  })
}

export async function rejectBookingEmailEvent(prisma, eventId, input = {}, actor) {
  return prisma.$transaction(async (tx) => {
    const reason = normalizeNullableString(input.reason)
    if (!reason) throw new PmsValidationError('Rejecting or ignoring an email event requires a reason.')
    const event = await tx.bookingEmailEvent.findUnique({ where: { id: eventId } })
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
    const event = await tx.bookingEmailEvent.findUnique({
      where: { id: eventId },
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
    const property = await getProperty(tx)
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
        ratePerNight: Number(input.ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
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

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        subtotal: pricing.total,
        tax: 0,
        total: pricing.total,
        paid: 0,
        balance: pricing.total,
      },
    })

    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: Number(input.ratePerNight),
        quantity: pricing.nights,
        total: pricing.total,
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

export async function assignRoom(prisma, reservationId, roomId, actor) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
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

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
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
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function checkOutReservation(prisma, reservationId, actor, options = {}) {
  return prisma.$transaction(async (tx) => {
    let reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (reservation.status !== 'CHECKED_IN') {
      throw new PmsValidationError('Only checked-in reservations can be checked out.')
    }
    if (!reservation.assignedRoomId || !reservation.assignedRoom) {
      throw new PmsValidationError('Checked-in reservation is missing its assigned room.')
    }

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
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
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function cancelReservation(prisma, reservationId, actor, status = 'CANCELLED', notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
      throw new PmsValidationError('Cancellation status must be CANCELLED or NO_SHOW.')
    }
    if (reservation.status === 'CHECKED_IN') {
      throw new PmsValidationError('Checked-in reservations must be checked out before cancellation.')
    }

    await tx.roomDateInventory.deleteMany({ where: { reservationId } })
    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: { status, notes: notes || reservation.notes },
      include: reservationInclude,
    })
    await createReservationLog(tx, reservation.id, status === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED', actor, {
      fromStatus: reservation.status,
      toStatus: status,
      notes,
    })
    await createAudit(tx, actor, status, 'reservation', reservation.id, { notes })
    return updated
  })
}

export async function updateHousekeepingStatus(prisma, roomId, cleanStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { roomType: true } })
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
    return updated
  })
}

export async function createPayment(prisma, input, actor) {
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
  return prisma.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({ where: { id: input.folioId } })
    if (!folio) throw new PmsValidationError('Folio was not found.', 404)
    if (folio.status !== 'OPEN') {
      throw new PmsValidationError('Charges can only be posted to an open folio.')
    }

    const amount = Number(input.amount)
    const quantity = Number(input.quantity || 1)
    const description = normalizeNullableString(input.description)
    const category = String(input.category || 'OTHER').toUpperCase()
    const validCategories = ['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER']

    if (!description) throw new PmsValidationError('Charge description is required.')
    if (!validCategories.includes(category)) throw new PmsValidationError('Select a valid charge category.')
    if (!Number.isFinite(amount) || amount <= 0) throw new PmsValidationError('Charge amount must be greater than zero.')
    if (!Number.isInteger(quantity) || quantity < 1) throw new PmsValidationError('Charge quantity must be at least 1.')

    const charge = await tx.charge.create({
      data: {
        folioId: folio.id,
        date: input.date ? dateFromKey(getBangkokDateKey(input.date)) : dateFromKey(getBangkokDateKey(new Date())),
        description,
        category,
        amount: roundMoney(amount),
        quantity,
        total: roundMoney(amount * quantity),
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
