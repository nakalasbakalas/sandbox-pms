import { createHash } from 'node:crypto'
import {
  PmsValidationError,
  activeReservationStatuses,
  dateFromKey,
  getBangkokDateKey,
  stayDates,
} from './pms-domain.mjs'

const MAX_RECONCILE_CELLS = 2_500
const MANUAL_CHANNEL_MANAGEMENT_ROLES = new Set(['ADMIN', 'MANAGER'])
const MANUAL_CHANNEL_COMPLETION_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK'])

export const MANUAL_CHANNEL_PROVIDERS = Object.freeze({
  booking_com: Object.freeze({
    providerCode: 'booking_com',
    displayName: 'Booking.com',
    allowedExtranetDomains: Object.freeze(['booking.com']),
  }),
  agoda: Object.freeze({
    providerCode: 'agoda',
    displayName: 'Agoda',
    allowedExtranetDomains: Object.freeze(['agoda.com']),
  }),
  trip_com: Object.freeze({
    providerCode: 'trip_com',
    displayName: 'Trip.com',
    allowedExtranetDomains: Object.freeze(['trip.com']),
  }),
})

export const MANUAL_CHANNEL_PROVIDER_CODES = Object.freeze(Object.keys(MANUAL_CHANNEL_PROVIDERS))

const PROVIDER_ALIASES = Object.freeze({
  booking: 'booking_com',
  'booking.com': 'booking_com',
  booking_com: 'booking_com',
  bookingcom: 'booking_com',
  agoda: 'agoda',
  'agoda.com': 'agoda',
  trip: 'trip_com',
  'trip.com': 'trip_com',
  trip_com: 'trip_com',
  tripcom: 'trip_com',
})

export const DISABLED_CHANNEX_ADAPTER = Object.freeze({
  code: 'channex',
  enabled: false,
  automaticAvailabilityPush: false,
  async healthCheck() {
    return {
      ok: false,
      configured: false,
      enabled: false,
      code: 'CHANNEX_NOT_CONFIGURED',
      message: 'Channex delivery is disabled. Manual Extranet tasks remain authoritative until a certified channel connection is configured and verified.',
    }
  },
  async pushAvailabilityBatch() {
    throw new PmsValidationError(
      'Channex delivery is disabled. Complete this availability task manually in the OTA Extranet.',
      409,
    )
  },
})

function normalizeNullableString(value, maxLength = 500) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length > maxLength) throw new PmsValidationError(`Value must be ${maxLength} characters or fewer.`)
  return text
}

function requiredString(value, label, maxLength = 200) {
  const text = normalizeNullableString(value, maxLength)
  if (!text) throw new PmsValidationError(`${label} is required.`)
  return text
}

function actorId(actor) {
  return normalizeNullableString(actor?.id || actor?.username || actor?.email, 200) || 'system'
}

function actorLabel(actor) {
  return normalizeNullableString(actor?.name || actor?.displayName || actor?.username || actor?.email || actor?.id, 200) || 'System'
}

function actorRole(actor) {
  return String(actor?.role || '').trim().toUpperCase().replaceAll('-', '_')
}

function requireRole(actor, allowedRoles, message) {
  if (!allowedRoles.has(actorRole(actor))) throw new PmsValidationError(message, 403)
}

function requireReason(value, label = 'This action') {
  const reason = normalizeNullableString(value, 1_000)
  if (!reason) throw new PmsValidationError(`${label} requires an operational reason.`)
  return reason
}

function assertAllowedFields(input, allowedFields, label) {
  const allowed = new Set(allowedFields)
  const unknown = Object.keys(input || {}).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new PmsValidationError(`${label} contains unsupported fields: ${unknown.join(', ')}.`)
}

function assertNoCredentialShapedFields(input) {
  const stack = [input]
  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    for (const [key, child] of Object.entries(value)) {
      if (/(password|passcode|secret|token|cookie|session|api[_-]?key|credential)/i.test(key)) {
        throw new PmsValidationError('Manual channel configuration cannot contain credentials, cookies, tokens, or passwords.')
      }
      if (child && typeof child === 'object') stack.push(child)
    }
  }
}

function safeAuditChanges(changes = {}) {
  const safe = {}
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue
    if (/(password|passcode|secret|token|cookie|session|credential|rawEmail|guest)/i.test(key)) continue
    safe[key] = typeof value === 'string' && value.length > 1_000 ? `${value.slice(0, 997)}...` : value
  }
  return safe
}

async function createManualChannelAudit(tx, actor, action, entityType, entityId, changes = {}) {
  return tx.auditLog.create({
    data: {
      userId: actorId(actor),
      action,
      entityType,
      entityId: entityId || null,
      changes: safeAuditChanges(changes),
    },
  })
}

async function serializableTransaction(prisma, callback) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 15_000,
      })
    } catch (error) {
      if (error?.code === 'P2034' && attempt === 0) continue
      throw error
    }
  }
}

function manualChannelMappingTargetKey(mapping) {
  return `${mapping.externalRoomTypeId}\u0000${mapping.externalRatePlanId || ''}`
}

async function physicalRoomTypesInTransaction(tx, propertyId) {
  return tx.roomType.findMany({
    where: {
      propertyId,
      // RoomType has no lifecycle flag. A type with at least one physical room
      // must remain mapped even if every room is temporarily out of service,
      // because any of those rooms can later return to sellable inventory.
      rooms: { some: {} },
    },
    select: { id: true, code: true, name: true },
    orderBy: [{ code: 'asc' }, { name: 'asc' }],
  })
}

async function assertManualChannelMappingCoverageInTransaction(tx, input = {}) {
  const propertyId = requiredString(input.propertyId, 'Property id')
  const connectionId = requiredString(input.connectionId, 'Connection id')
  const [physicalRoomTypes, activeMappings] = await Promise.all([
    physicalRoomTypesInTransaction(tx, propertyId),
    tx.manualChannelRoomMapping.findMany({
      where: { connectionId, active: true },
      select: {
        id: true,
        roomTypeId: true,
        externalRoomTypeId: true,
        externalRoomTypeName: true,
        externalRatePlanId: true,
      },
    }),
  ])

  if (physicalRoomTypes.length === 0) {
    throw new PmsValidationError('Add at least one physical room before enabling this channel connection.', 409)
  }

  const activeRoomTypeIds = new Set(activeMappings.map((mapping) => mapping.roomTypeId))
  const missing = physicalRoomTypes.filter((roomType) => !activeRoomTypeIds.has(roomType.id))
  if (missing.length > 0) {
    const labels = missing.map((roomType) => roomType.name || roomType.code || roomType.id).join(', ')
    throw new PmsValidationError(
      `Map every physical room type before enabling this channel connection. Missing active mappings: ${labels}.`,
      409,
    )
  }

  const mappingByTarget = new Map()
  for (const mapping of activeMappings) {
    const key = manualChannelMappingTargetKey(mapping)
    const existing = mappingByTarget.get(key)
    if (existing && existing.roomTypeId !== mapping.roomTypeId) {
      throw new PmsValidationError(
        'Two PMS room types cannot share the same active OTA room type and rate-plan target.',
        409,
      )
    }
    mappingByTarget.set(key, mapping)
  }

  return { physicalRoomTypes, activeMappings }
}

function validCalendarDateKey(value) {
  const key = getBangkokDateKey(value)
  const parsed = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError('Enter a valid date in YYYY-MM-DD format.')
  }
  return key
}

function nextDateKey(key) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function dateOverlaps(checkIn, checkOut, dateKey) {
  return getBangkokDateKey(checkIn) <= dateKey && getBangkokDateKey(checkOut) > dateKey
}

function logicalTaskKey(connectionId, roomTypeId, dateKey) {
  return `${connectionId}\u0000${roomTypeId}\u0000${dateKey}`
}

function activeTaskKey(connectionId, roomTypeId, dateKey) {
  return createHash('sha256').update(logicalTaskKey(connectionId, roomTypeId, dateKey)).digest('hex')
}

function externalReferenceKey(propertyId, providerCode, externalReservationId) {
  const reference = requiredString(externalReservationId, 'External reservation id', 300).toUpperCase().replace(/\s+/g, '')
  return createHash('sha256').update(`${propertyId}\u0000${providerCode}\u0000${reference}`).digest('hex')
}

function providerDomainMatches(hostname, allowedDomain) {
  return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`)
}

export function normalizeManualChannelProviderCode(value) {
  const key = String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  const providerCode = PROVIDER_ALIASES[key]
  if (!providerCode) {
    throw new PmsValidationError(`Provider must be one of: ${MANUAL_CHANNEL_PROVIDER_CODES.join(', ')}.`)
  }
  return providerCode
}

export function manualChannelProviderFromEmailSender(sender) {
  const text = String(sender || '').trim().toLowerCase()
  const address = text.match(/<([^<>]+)>/)?.[1] || text.match(/\b[^\s<>@]+@[^\s<>]+\b/)?.[0] || ''
  const hostname = address.split('@').at(-1)?.replace(/[>,;]+$/g, '') || ''
  if (!hostname) return null
  for (const provider of Object.values(MANUAL_CHANNEL_PROVIDERS)) {
    if (provider.allowedExtranetDomains.some((domain) => providerDomainMatches(hostname, domain))) {
      return provider.providerCode
    }
  }
  return null
}

export function buildManualChannelExternalReferenceKey(propertyId, providerValue, externalReservationId) {
  const providerCode = normalizeManualChannelProviderCode(providerValue)
  return externalReferenceKey(requiredString(propertyId, 'Property id'), providerCode, externalReservationId)
}

export function validateManualChannelExtranetUrl(value, providerValue) {
  const providerCode = normalizeManualChannelProviderCode(providerValue)
  const raw = requiredString(value, 'Extranet URL', 1_000)
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new PmsValidationError('Extranet URL must be a valid HTTPS URL.')
  }
  if (url.protocol !== 'https:') throw new PmsValidationError('Extranet URL must use HTTPS.')
  if (url.username || url.password) throw new PmsValidationError('Extranet URL cannot contain embedded credentials.')
  if (url.search || url.hash) throw new PmsValidationError('Extranet URL cannot contain query parameters or fragments.')
  if (url.port && url.port !== '443') throw new PmsValidationError('Extranet URL cannot use a non-standard port.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const allowed = MANUAL_CHANNEL_PROVIDERS[providerCode].allowedExtranetDomains
  if (!allowed.some((domain) => providerDomainMatches(hostname, domain))) {
    throw new PmsValidationError(`${MANUAL_CHANNEL_PROVIDERS[providerCode].displayName} Extranet URL must use an official ${allowed.join(' or ')} domain.`)
  }
  return url.toString()
}

export function manualChannelDeliveryBoundary(connection) {
  if (connection?.deliveryMode === 'CHANNEX') {
    return {
      deliveryMode: 'CHANNEX',
      automatic: false,
      enabled: false,
      reason: 'CHANNEX_NOT_CONFIGURED',
      adapter: DISABLED_CHANNEX_ADAPTER,
    }
  }
  return {
    deliveryMode: 'MANUAL',
    automatic: false,
    enabled: true,
    reason: null,
    adapter: null,
  }
}

export async function ensureManualChannelConnectionsInTransaction(tx, propertyId, actor = { id: 'system', role: 'SYSTEM' }) {
  const cleanPropertyId = requiredString(propertyId, 'Property id')
  const existing = await tx.manualChannelConnection.findMany({
    where: { propertyId: cleanPropertyId, providerCode: { in: MANUAL_CHANNEL_PROVIDER_CODES } },
  })
  const existingCodes = new Set(existing.map((connection) => connection.providerCode))
  const created = []

  for (const providerCode of MANUAL_CHANNEL_PROVIDER_CODES) {
    if (existingCodes.has(providerCode)) continue
    const connection = await tx.manualChannelConnection.create({
      data: {
        propertyId: cleanPropertyId,
        providerCode,
        displayName: MANUAL_CHANNEL_PROVIDERS[providerCode].displayName,
        deliveryMode: 'MANUAL',
        enabled: false,
      },
    })
    created.push(connection)
    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_CONNECTION_CREATED', 'manualChannelConnection', connection.id, {
      propertyId: cleanPropertyId,
      providerCode,
      deliveryMode: 'MANUAL',
      enabled: false,
    })
  }

  return [...existing, ...created].sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function ensureManualChannelConnections(prisma, propertyId, actor) {
  return serializableTransaction(prisma, (tx) => ensureManualChannelConnectionsInTransaction(tx, propertyId, actor))
}

export async function saveManualChannelConnection(prisma, input = {}, actor) {
  requireRole(actor, MANUAL_CHANNEL_MANAGEMENT_ROLES, 'Only a manager or administrator can change channel connections.')
  assertNoCredentialShapedFields(input)
  assertAllowedFields(input, [
    'propertyId',
    'providerCode',
    'displayName',
    'deliveryMode',
    'externalPropertyId',
    'extranetUrl',
    'enabled',
    'reason',
  ], 'Manual channel connection')

  const propertyId = requiredString(input.propertyId, 'Property id')
  const providerCode = normalizeManualChannelProviderCode(input.providerCode)
  const reason = requireReason(input.reason, 'Changing a channel connection')
  const deliveryMode = String(input.deliveryMode || 'MANUAL').trim().toUpperCase()
  if (deliveryMode !== 'MANUAL' && deliveryMode !== 'CHANNEX') {
    throw new PmsValidationError('Delivery mode must be MANUAL or CHANNEX.')
  }
  if (deliveryMode === 'CHANNEX') {
    throw new PmsValidationError('Channex delivery is disabled until a certified connection and backend secret path are configured.', 409)
  }

  const enabled = Boolean(input.enabled)
  const extranetUrl = input.extranetUrl ? validateManualChannelExtranetUrl(input.extranetUrl, providerCode) : null
  if (enabled && !extranetUrl) throw new PmsValidationError('An official Extranet URL is required before enabling a manual channel connection.')
  const displayName = normalizeNullableString(input.displayName, 100) || MANUAL_CHANNEL_PROVIDERS[providerCode].displayName
  const externalPropertyId = normalizeNullableString(input.externalPropertyId, 200)

  return serializableTransaction(prisma, async (tx) => {
    const property = await tx.property.findUnique({ where: { id: propertyId }, select: { id: true } })
    if (!property) throw new PmsValidationError('Property was not found.', 404)
    const existingConnection = await tx.manualChannelConnection.findUnique({
      where: { propertyId_providerCode: { propertyId, providerCode } },
      select: { id: true },
    })
    if (enabled) {
      if (!existingConnection) {
        throw new PmsValidationError(
          'Save this connection as disabled, add every physical room-type mapping, then enable it.',
          409,
        )
      }
      await assertManualChannelMappingCoverageInTransaction(tx, {
        propertyId,
        connectionId: existingConnection.id,
      })
    }
    const connection = await tx.manualChannelConnection.upsert({
      where: { propertyId_providerCode: { propertyId, providerCode } },
      create: {
        propertyId,
        providerCode,
        displayName,
        deliveryMode: 'MANUAL',
        externalPropertyId,
        extranetUrl,
        enabled,
      },
      update: {
        displayName,
        deliveryMode: 'MANUAL',
        externalPropertyId,
        extranetUrl,
        enabled,
      },
      include: { mappings: true },
    })
    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_CONNECTION_SAVED', 'manualChannelConnection', connection.id, {
      propertyId,
      providerCode,
      displayName,
      deliveryMode: 'MANUAL',
      externalPropertyId,
      extranetUrl,
      enabled,
      reason,
    })
    return connection
  })
}

export async function saveManualChannelRoomMapping(prisma, input = {}, actor) {
  requireRole(actor, MANUAL_CHANNEL_MANAGEMENT_ROLES, 'Only a manager or administrator can change channel mappings.')
  assertNoCredentialShapedFields(input)
  assertAllowedFields(input, [
    'connectionId',
    'roomTypeId',
    'externalRoomTypeId',
    'externalRoomTypeName',
    'externalRatePlanId',
    'active',
    'reason',
  ], 'Manual channel room mapping')

  const connectionId = requiredString(input.connectionId, 'Connection id')
  const roomTypeId = requiredString(input.roomTypeId, 'Room type id')
  const externalRoomTypeId = requiredString(input.externalRoomTypeId, 'External room type id', 200)
  const externalRoomTypeName = requiredString(input.externalRoomTypeName, 'External room type name', 200)
  const externalRatePlanId = normalizeNullableString(input.externalRatePlanId, 200)
  const active = input.active === undefined ? true : Boolean(input.active)
  const reason = requireReason(input.reason, 'Changing a channel room mapping')

  return serializableTransaction(prisma, async (tx) => {
    const connection = await tx.manualChannelConnection.findUnique({ where: { id: connectionId } })
    if (!connection) throw new PmsValidationError('Manual channel connection was not found.', 404)
    const roomType = await tx.roomType.findFirst({
      where: { id: roomTypeId, propertyId: connection.propertyId },
      select: { id: true, name: true },
    })
    if (!roomType) throw new PmsValidationError('Room type was not found for this property.', 404)

    if (active) {
      const conflictingMapping = await tx.manualChannelRoomMapping.findFirst({
        where: {
          connectionId,
          active: true,
          externalRoomTypeId,
          externalRatePlanId,
          roomTypeId: { not: roomTypeId },
        },
        select: { id: true, roomTypeId: true },
      })
      if (conflictingMapping) {
        throw new PmsValidationError(
          'This active OTA room type and rate-plan target is already mapped to another PMS room type.',
          409,
        )
      }
    }

    let mapping
    try {
      mapping = await tx.manualChannelRoomMapping.upsert({
        where: { connectionId_roomTypeId: { connectionId, roomTypeId } },
        create: {
          connectionId,
          roomTypeId,
          externalRoomTypeId,
          externalRoomTypeName,
          externalRatePlanId,
          active,
        },
        update: {
          externalRoomTypeId,
          externalRoomTypeName,
          externalRatePlanId,
          active,
        },
      })
    } catch (error) {
      // The partial unique index is the final concurrency guard when two
      // serializable writers race after both preflight checks saw no row.
      if (active && error?.code === 'P2002') {
        throw new PmsValidationError(
          'This active OTA room type and rate-plan target is already mapped to another PMS room type.',
          409,
        )
      }
      throw error
    }
    if (connection.enabled) {
      await assertManualChannelMappingCoverageInTransaction(tx, {
        propertyId: connection.propertyId,
        connectionId,
      })
    }
    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_MAPPING_SAVED', 'manualChannelRoomMapping', mapping.id, {
      connectionId,
      providerCode: connection.providerCode,
      roomTypeId,
      roomTypeName: roomType.name,
      externalRoomTypeId,
      externalRoomTypeName,
      externalRatePlanId,
      active,
      reason,
    })
    return mapping
  })
}

function affectedCells(input = {}) {
  const affected = Array.isArray(input.affected) ? input.affected : []
  if (affected.length === 0) throw new PmsValidationError('At least one affected room type and date is required.')
  const cells = new Map()

  for (const item of affected) {
    const roomTypeId = requiredString(item?.roomTypeId, 'Room type id')
    let dates = []
    if (Array.isArray(item?.dates)) dates = item.dates.map(validCalendarDateKey)
    else if (item?.date) dates = [validCalendarDateKey(item.date)]
    else if (item?.dateStart && item?.dateEnd) {
      dates = stayDates(validCalendarDateKey(item.dateStart), validCalendarDateKey(item.dateEnd))
    }
    if (dates.length === 0) throw new PmsValidationError('Each affected room type must include at least one valid stay date.')
    for (const dateKey of dates) cells.set(`${roomTypeId}\u0000${dateKey}`, { roomTypeId, dateKey })
  }

  if (cells.size > MAX_RECONCILE_CELLS) {
    throw new PmsValidationError(`Manual channel reconciliation is limited to ${MAX_RECONCILE_CELLS} room-date cells per transaction.`)
  }
  return [...cells.values()].sort((left, right) => left.roomTypeId.localeCompare(right.roomTypeId) || left.dateKey.localeCompare(right.dateKey))
}

export async function calculateManualChannelAvailabilityMatrixInTransaction(tx, input = {}) {
  const propertyId = requiredString(input.propertyId, 'Property id')
  const cells = Array.isArray(input.cells) ? input.cells.map((cell) => ({
    roomTypeId: requiredString(cell.roomTypeId, 'Room type id'),
    dateKey: validCalendarDateKey(cell.dateKey || cell.date),
  })) : affectedCells(input)
  const now = input.now ? new Date(input.now) : new Date()
  if (Number.isNaN(now.getTime())) throw new PmsValidationError('Availability calculation time is invalid.')

  const byRoomType = new Map()
  for (const cell of cells) {
    const entries = byRoomType.get(cell.roomTypeId) || []
    entries.push(cell.dateKey)
    byRoomType.set(cell.roomTypeId, entries)
  }

  const results = []
  for (const [roomTypeId, rawDateKeys] of byRoomType) {
    const dateKeys = [...new Set(rawDateKeys)].sort()
    const minDate = dateFromKey(dateKeys[0])
    const exclusiveEnd = dateFromKey(nextDateKey(dateKeys.at(-1)))
    const dateValues = dateKeys.map(dateFromKey)
    const [sellableRooms, reservations, holds, blocks] = await Promise.all([
      tx.room.count({
        where: { propertyId, roomTypeId, operationalStatus: 'AVAILABLE' },
      }),
      tx.reservation.findMany({
        where: {
          propertyId,
          roomTypeId,
          status: { in: activeReservationStatuses() },
          checkIn: { lt: exclusiveEnd },
          checkOut: { gt: minDate },
        },
        select: { checkIn: true, checkOut: true },
      }),
      tx.inventoryHold.findMany({
        where: {
          propertyId,
          roomTypeId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          checkIn: { lt: exclusiveEnd },
          checkOut: { gt: minDate },
        },
        select: { checkIn: true, checkOut: true },
      }),
      tx.roomDateInventory.findMany({
        where: {
          propertyId,
          date: { in: dateValues },
          status: { in: ['BLOCKED', 'OUT_OF_SERVICE'] },
          room: { roomTypeId, operationalStatus: 'AVAILABLE' },
        },
        select: { date: true, roomId: true },
        distinct: ['date', 'roomId'],
      }),
    ])

    const blockedRoomsByDate = new Map()
    for (const block of blocks) {
      const dateKey = getBangkokDateKey(block.date)
      const roomIds = blockedRoomsByDate.get(dateKey) || new Set()
      roomIds.add(block.roomId)
      blockedRoomsByDate.set(dateKey, roomIds)
    }

    for (const dateKey of dateKeys) {
      const activeReservations = reservations.filter((reservation) => dateOverlaps(reservation.checkIn, reservation.checkOut, dateKey)).length
      const activeHolds = holds.filter((hold) => dateOverlaps(hold.checkIn, hold.checkOut, dateKey)).length
      const blockedRooms = blockedRoomsByDate.get(dateKey)?.size || 0
      const desiredAvailability = Math.max(0, sellableRooms - blockedRooms - activeReservations - activeHolds)
      results.push({
        propertyId,
        roomTypeId,
        dateKey,
        desiredAvailability,
        sellableRooms,
        blockedRooms,
        activeReservations,
        activeHolds,
      })
    }
  }

  return results.sort((left, right) => left.roomTypeId.localeCompare(right.roomTypeId) || left.dateKey.localeCompare(right.dateKey))
}

export async function calculateManualChannelAvailabilityInTransaction(tx, input = {}) {
  const [result] = await calculateManualChannelAvailabilityMatrixInTransaction(tx, {
    propertyId: input.propertyId,
    cells: [{ roomTypeId: input.roomTypeId, date: input.date }],
    now: input.now,
  })
  return result
}

export async function reconcileManualChannelTasksInTransaction(tx, input = {}, actor = { id: 'system', role: 'SYSTEM' }) {
  const propertyId = requiredString(input.propertyId, 'Property id')
  const triggerType = requiredString(input.triggerType, 'Trigger type', 100).toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  const sourceProviderCode = input.sourceProviderCode ? normalizeManualChannelProviderCode(input.sourceProviderCode) : null
  const sourceProviderAlreadyUpdated = Boolean(input.sourceProviderAlreadyUpdated)
  const sourceReservationId = normalizeNullableString(input.sourceReservationId, 200)
  const sourceBookingEmailEventId = normalizeNullableString(input.sourceBookingEmailEventId, 200)
  const todayKey = getBangkokDateKey(input.now || new Date())
  const requestedCells = affectedCells(input)
  const cells = requestedCells.filter((cell) => cell.dateKey >= todayKey)
  const skippedPastCellCount = requestedCells.length - cells.length

  if (cells.length === 0) {
    return {
      created: [],
      superseded: [],
      coalesced: [],
      unchanged: [],
      unmapped: [],
      unmappedCellCount: 0,
      excludedProviderCode: null,
      sourceProviderCode,
      sourceProviderAlreadyUpdated,
      skippedPastCellCount,
      availability: [],
    }
  }

  const [connections, availability] = await Promise.all([
    tx.manualChannelConnection.findMany({
      where: {
        propertyId,
        enabled: true,
        providerCode: {
          in: MANUAL_CHANNEL_PROVIDER_CODES,
        },
      },
      include: {
        mappings: {
          where: { active: true },
          select: {
            id: true,
            roomTypeId: true,
            externalRoomTypeId: true,
            externalRoomTypeName: true,
            externalRatePlanId: true,
          },
        },
      },
      orderBy: { providerCode: 'asc' },
    }),
    calculateManualChannelAvailabilityMatrixInTransaction(tx, { propertyId, cells, now: input.now }),
  ])

  if (connections.length === 0) {
    return {
      created: [],
      superseded: [],
      coalesced: [],
      unchanged: [],
      unmapped: [],
      unmappedCellCount: 0,
      excludedProviderCode: null,
      sourceProviderCode,
      sourceProviderAlreadyUpdated,
      skippedPastCellCount,
      availability,
    }
  }

  const connectionIds = connections.map((connection) => connection.id)
  const roomTypeIds = [...new Set(availability.map((item) => item.roomTypeId))]
  const stayDates = [...new Set(availability.map((item) => item.dateKey))].map(dateFromKey)
  const history = await tx.manualChannelTask.findMany({
    where: {
      connectionId: { in: connectionIds },
      roomTypeId: { in: roomTypeIds },
      stayDate: { in: stayDates },
    },
    orderBy: [{ createdAt: 'desc' }, { revision: 'desc' }],
  })

  const currentByLogicalKey = new Map()
  const latestCompletedByLogicalKey = new Map()
  const latestByLogicalKey = new Map()
  for (const task of history) {
    const key = logicalTaskKey(task.connectionId, task.roomTypeId, getBangkokDateKey(task.stayDate))
    if (!latestByLogicalKey.has(key)) latestByLogicalKey.set(key, task)
    if (task.activeKey && !currentByLogicalKey.has(key)) currentByLogicalKey.set(key, task)
    if (task.status === 'COMPLETED' && !latestCompletedByLogicalKey.has(key)) latestCompletedByLogicalKey.set(key, task)
  }

  const result = {
    created: [],
    superseded: [],
    coalesced: [],
    unchanged: [],
    unmapped: [],
    unmappedCellCount: 0,
    excludedProviderCode: null,
    sourceProviderCode,
    sourceProviderAlreadyUpdated,
    skippedPastCellCount,
    availability,
  }
  for (const connection of connections) {
    const boundary = manualChannelDeliveryBoundary(connection)
    if (connection.deliveryMode === 'CHANNEX' && !boundary.enabled) {
      throw new PmsValidationError('An enabled connection cannot use Channex until the adapter is configured and verified.', 409)
    }

    const mappingByRoomTypeId = new Map(
      (connection.mappings || []).map((mapping) => [mapping.roomTypeId, mapping]),
    )
    const missingDatesByRoomTypeId = new Map()
    for (const cell of availability) {
      if (mappingByRoomTypeId.has(cell.roomTypeId)) continue
      const dates = missingDatesByRoomTypeId.get(cell.roomTypeId) || []
      dates.push(cell.dateKey)
      missingDatesByRoomTypeId.set(cell.roomTypeId, dates)
    }
    for (const [roomTypeId, stayDateKeys] of missingDatesByRoomTypeId) {
      const unmapped = {
        connectionId: connection.id,
        providerCode: connection.providerCode,
        roomTypeId,
        stayDateKeys,
        cellCount: stayDateKeys.length,
        errorCode: 'ACTIVE_MAPPING_REQUIRED',
      }
      result.unmapped.push(unmapped)
      result.unmappedCellCount += stayDateKeys.length
      await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED', 'manualChannelConnection', connection.id, {
        propertyId,
        providerCode: connection.providerCode,
        roomTypeId,
        stayDateStart: stayDateKeys[0],
        stayDateEnd: stayDateKeys.at(-1),
        cellCount: stayDateKeys.length,
        errorCode: unmapped.errorCode,
        triggerType,
        sourceProviderCode,
        sourceProviderAlreadyUpdated,
        sourceReservationId,
        sourceBookingEmailEventId,
      })
    }

    for (const cell of availability) {
      const mapping = mappingByRoomTypeId.get(cell.roomTypeId)
      if (!mapping) continue
      const logicalKey = logicalTaskKey(connection.id, cell.roomTypeId, cell.dateKey)
      const activeTask = currentByLogicalKey.get(logicalKey)
      const latestCompleted = latestCompletedByLogicalKey.get(logicalKey)
      const latestTask = latestByLogicalKey.get(logicalKey)

      if (activeTask && activeTask.desiredAvailability === cell.desiredAvailability) {
        result.coalesced.push(activeTask)
        await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASK_COALESCED', 'manualChannelTask', activeTask.id, {
          propertyId,
          providerCode: connection.providerCode,
          roomTypeId: cell.roomTypeId,
          stayDate: cell.dateKey,
          desiredAvailability: cell.desiredAvailability,
          triggerType,
          sourceProviderCode,
          sourceProviderAlreadyUpdated,
          sourceReservationId,
          sourceBookingEmailEventId,
          externalRoomTypeId: mapping.externalRoomTypeId,
          externalRoomTypeName: mapping.externalRoomTypeName,
          externalRatePlanId: mapping.externalRatePlanId,
        })
        continue
      }

      if (!activeTask && latestCompleted?.confirmedAvailability === cell.desiredAvailability) {
        result.unchanged.push(latestCompleted)
        continue
      }

      let supersedesTaskId = null
      if (activeTask) {
        await tx.manualChannelTask.update({
          where: { id: activeTask.id },
          data: {
            status: 'SUPERSEDED',
            activeKey: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        })
        supersedesTaskId = activeTask.id
        result.superseded.push(activeTask)
      }

      const task = await tx.manualChannelTask.create({
        data: {
          propertyId,
          connectionId: connection.id,
          roomTypeId: cell.roomTypeId,
          stayDate: dateFromKey(cell.dateKey),
          desiredAvailability: cell.desiredAvailability,
          status: 'PENDING',
          revision: Number(latestTask?.revision || 0) + 1,
          activeKey: activeTaskKey(connection.id, cell.roomTypeId, cell.dateKey),
          triggerType,
          sourceProviderCode,
          sourceReservationId,
          sourceBookingEmailEventId,
          supersedesTaskId,
          createdBy: actorLabel(actor),
        },
      })
      result.created.push(task)
      currentByLogicalKey.set(logicalKey, task)
      latestByLogicalKey.set(logicalKey, task)

      if (activeTask) {
        await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASK_SUPERSEDED', 'manualChannelTask', activeTask.id, {
          propertyId,
          providerCode: connection.providerCode,
          roomTypeId: cell.roomTypeId,
          stayDate: cell.dateKey,
          previousDesiredAvailability: activeTask.desiredAvailability,
          desiredAvailability: cell.desiredAvailability,
          supersededByTaskId: task.id,
          triggerType,
          sourceProviderCode,
          sourceProviderAlreadyUpdated,
        })
      }
      await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASK_CREATED', 'manualChannelTask', task.id, {
        propertyId,
        providerCode: connection.providerCode,
        roomTypeId: cell.roomTypeId,
        stayDate: cell.dateKey,
        desiredAvailability: cell.desiredAvailability,
        revision: task.revision,
        triggerType,
        sourceProviderCode,
        sourceProviderAlreadyUpdated,
        sourceReservationId,
        sourceBookingEmailEventId,
        externalRoomTypeId: mapping.externalRoomTypeId,
        externalRoomTypeName: mapping.externalRoomTypeName,
        externalRatePlanId: mapping.externalRatePlanId,
      })
    }
  }

  return result
}

export async function reconcileManualChannelTasks(prisma, input = {}, actor) {
  requireRole(actor, MANUAL_CHANNEL_MANAGEMENT_ROLES, 'Only a manager or administrator can run a manual channel reconciliation.')
  const reason = requireReason(input.reason, 'Manual channel reconciliation')
  return serializableTransaction(prisma, async (tx) => {
    const result = await reconcileManualChannelTasksInTransaction(tx, {
      ...input,
      triggerType: input.triggerType || 'MANUAL_RECONCILIATION',
    }, actor)
    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_RECONCILED', 'property', input.propertyId, {
      propertyId: input.propertyId,
      reason,
      createdCount: result.created.length,
      supersededCount: result.superseded.length,
      coalescedCount: result.coalesced.length,
      unchangedCount: result.unchanged.length,
      unmappedGroupCount: result.unmapped.length,
      unmappedCellCount: result.unmappedCellCount,
      excludedProviderCode: result.excludedProviderCode,
      sourceProviderCode: result.sourceProviderCode,
      sourceProviderAlreadyUpdated: result.sourceProviderAlreadyUpdated,
      skippedPastCellCount: result.skippedPastCellCount,
    })
    return result
  })
}

export async function completeManualChannelTask(prisma, taskId, input = {}, actor) {
  requireRole(actor, MANUAL_CHANNEL_COMPLETION_ROLES, 'Only front desk, manager, or administrator staff can complete a channel task.')
  assertNoCredentialShapedFields(input)
  assertAllowedFields(input, ['revision', 'confirmedAvailability', 'notes', 'completionNotes'], 'Manual channel task completion')
  const cleanTaskId = requiredString(taskId, 'Task id')
  const revision = Number(input.revision)
  const confirmedAvailability = Number(input.confirmedAvailability)
  if (!Number.isInteger(revision) || revision < 1) throw new PmsValidationError('Task revision must be a positive integer.')
  if (!Number.isInteger(confirmedAvailability) || confirmedAvailability < 0) {
    throw new PmsValidationError('Confirmed availability must be a non-negative integer.')
  }
  const notes = requireReason(input.completionNotes ?? input.notes, 'Completing a manual channel task')
  if (notes.length < 5) throw new PmsValidationError('Completion evidence must be at least 5 characters.')

  return serializableTransaction(prisma, async (tx) => {
    const task = await tx.manualChannelTask.findUnique({
      where: { id: cleanTaskId },
      include: { connection: true, roomType: true },
    })
    if (!task) throw new PmsValidationError('Manual channel task was not found.', 404)
    if (task.status !== 'PENDING' || !task.activeKey) {
      throw new PmsValidationError('This channel task is no longer current. Refresh the Channel Desk.', 409)
    }
    if (task.revision !== revision) throw new PmsValidationError('This channel task changed after it was opened. Refresh and try again.', 409)
    if (task.desiredAvailability !== confirmedAvailability) {
      throw new PmsValidationError(`Confirm the current desired availability of ${task.desiredAvailability} rooms.`, 409)
    }
    if (!task.connection.enabled) throw new PmsValidationError('This channel connection is disabled.', 409)
    if (task.connection.deliveryMode !== 'MANUAL') {
      throw new PmsValidationError('Automatic channel tasks cannot be completed through the manual workflow.', 409)
    }
    validateManualChannelExtranetUrl(task.connection.extranetUrl, task.connection.providerCode)
    const mapping = await tx.manualChannelRoomMapping.findFirst({
      where: { connectionId: task.connectionId, roomTypeId: task.roomTypeId, active: true },
    })
    if (!mapping) throw new PmsValidationError('Map this PMS room type to the OTA room type before completing the task.', 409)

    const completedAt = new Date()
    const update = await tx.manualChannelTask.updateMany({
      where: {
        id: task.id,
        status: 'PENDING',
        revision,
        activeKey: task.activeKey,
      },
      data: {
        status: 'COMPLETED',
        activeKey: null,
        confirmedAvailability,
        completedBy: actorLabel(actor),
        completedAt,
        completionNotes: notes,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    })
    if (update.count !== 1) throw new PmsValidationError('This channel task changed before completion. Refresh and try again.', 409)

    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASK_COMPLETED', 'manualChannelTask', task.id, {
      propertyId: task.propertyId,
      providerCode: task.connection.providerCode,
      roomTypeId: task.roomTypeId,
      roomTypeName: task.roomType.name,
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRoomTypeName: mapping.externalRoomTypeName,
      externalRatePlanId: mapping.externalRatePlanId,
      stayDate: getBangkokDateKey(task.stayDate),
      confirmedAvailability,
      revision,
      notes,
    })
    return tx.manualChannelTask.findUnique({
      where: { id: task.id },
      include: { connection: true, roomType: true },
    })
  })
}

export async function reopenManualChannelTask(prisma, taskId, input = {}, actor) {
  requireRole(actor, MANUAL_CHANNEL_MANAGEMENT_ROLES, 'Only a manager or administrator can reopen a channel task.')
  assertNoCredentialShapedFields(input)
  assertAllowedFields(input, ['reason'], 'Manual channel task reopen')
  const cleanTaskId = requiredString(taskId, 'Task id')
  const reason = requireReason(input.reason, 'Reopening a channel task')

  return serializableTransaction(prisma, async (tx) => {
    const task = await tx.manualChannelTask.findUnique({ where: { id: cleanTaskId }, include: { connection: true } })
    if (!task) throw new PmsValidationError('Manual channel task was not found.', 404)
    if (task.status !== 'COMPLETED') throw new PmsValidationError('Only a completed channel task can be reopened.', 409)
    if (!task.connection.enabled) throw new PmsValidationError('This channel connection is disabled.', 409)
    if (task.connection.deliveryMode !== 'MANUAL') {
      throw new PmsValidationError('Automatic channel tasks cannot be reopened through the manual workflow.', 409)
    }
    validateManualChannelExtranetUrl(task.connection.extranetUrl, task.connection.providerCode)
    const mapping = await tx.manualChannelRoomMapping.findFirst({
      where: { connectionId: task.connectionId, roomTypeId: task.roomTypeId, active: true },
    })
    if (!mapping) throw new PmsValidationError('Map this PMS room type to the OTA room type before reopening the task.', 409)
    const dateKey = getBangkokDateKey(task.stayDate)
    const key = activeTaskKey(task.connectionId, task.roomTypeId, dateKey)
    const current = await tx.manualChannelTask.findUnique({ where: { activeKey: key } })
    if (current) throw new PmsValidationError('A current channel task already exists for this provider, room type, and date.', 409)
    const reopened = await tx.manualChannelTask.create({
      data: {
        propertyId: task.propertyId,
        connectionId: task.connectionId,
        roomTypeId: task.roomTypeId,
        stayDate: task.stayDate,
        desiredAvailability: task.desiredAvailability,
        status: 'PENDING',
        revision: task.revision + 1,
        activeKey: key,
        triggerType: 'MANUAL_REOPEN',
        sourceProviderCode: task.sourceProviderCode,
        sourceReservationId: task.sourceReservationId,
        sourceBookingEmailEventId: task.sourceBookingEmailEventId,
        supersedesTaskId: task.id,
        createdBy: actorLabel(actor),
      },
    })
    await createManualChannelAudit(tx, actor, 'MANUAL_CHANNEL_TASK_REOPENED', 'manualChannelTask', reopened.id, {
      propertyId: task.propertyId,
      providerCode: task.connection.providerCode,
      roomTypeId: task.roomTypeId,
      stayDate: dateKey,
      desiredAvailability: task.desiredAvailability,
      revision: reopened.revision,
      previousTaskId: task.id,
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRoomTypeName: mapping.externalRoomTypeName,
      externalRatePlanId: mapping.externalRatePlanId,
      reason,
    })
    return reopened
  })
}
