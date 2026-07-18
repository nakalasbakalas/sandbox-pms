import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ACTIVE_FEED_STATUSES = ['PENDING', 'CONFIRMED', 'HOLD', 'CHECKED_IN']
const ICAL_PROVIDERS = ['BOOKING_COM', 'AGODA', 'EXPEDIA', 'AIRBNB', 'ICAL']
const PROVIDER_LABELS = {
  BOOKING_COM: 'Booking.com',
  AGODA: 'Agoda',
  EXPEDIA: 'Expedia',
  AIRBNB: 'Airbnb',
  ICAL: 'iCal',
}

export class IcalFeedError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'IcalFeedError'
    this.statusCode = statusCode
  }
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function providerSlug(provider) {
  return String(provider || '').toLowerCase().replaceAll('_', '-')
}

function labelForProvider(provider) {
  return PROVIDER_LABELS[provider] || provider
}

function safeFeedFileName(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fileName = cleaned || fallback
  return fileName.endsWith('.ics') ? fileName : `${fileName}.ics`
}

function escapeIcalText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcalLine(line) {
  if (line.length <= 74) return line
  const chunks = []
  let remaining = line
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74))
    remaining = ` ${remaining.slice(74)}`
  }
  chunks.push(remaining)
  return chunks.join('\r\n')
}

function dateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function dateKeyToIcalDate(value) {
  const key = dateKey(value)
  return key ? key.replaceAll('-', '') : null
}

export function hashIcalFeedToken(token) {
  return createHash('sha256').update(String(token || '')).digest('base64url')
}

function tokenHashFromChannel(channel) {
  const config = cleanJsonObject(channel?.config)
  return config.exportTokenHash || (config.exportToken ? hashIcalFeedToken(config.exportToken) : null)
}

function sanitizedTokenConfig(value) {
  const config = cleanJsonObject(value)
  if (config.exportToken && !config.exportTokenHash) config.exportTokenHash = hashIcalFeedToken(config.exportToken)
  delete config.exportToken
  return config
}

function tokenHashMatches(expected, actual) {
  if (!expected || !actual) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

function feedFileNameForChannel(channel) {
  const config = cleanJsonObject(channel?.config)
  return safeFeedFileName(config.exportFileName, `${providerSlug(channel?.provider)}-sandbox-hotel-blocks.ics`)
}

function publicChannelPayload(channel, origin, issuedToken = null) {
  const config = cleanJsonObject(channel.config)
  return {
    id: channel.id,
    provider: channel.provider,
    name: channel.name,
    importUrl: config.importUrl || undefined,
    exportFileName: feedFileNameForChannel(channel),
    exportFeedUrl: issuedToken && origin ? buildIcalFeedUrl(origin, issuedToken) : undefined,
    exportTokenConfigured: Boolean(tokenHashFromChannel(channel)),
    lastPublishedAt: config.lastPublishedAt || undefined,
    exportTokenIssuedAt: config.exportTokenIssuedAt || undefined,
  }
}

async function migrateLegacyRawToken(prisma, channel) {
  const config = cleanJsonObject(channel?.config)
  if (!config.exportToken) return channel
  const sanitizedConfig = sanitizedTokenConfig(config)
  await prisma.channel.update({ where: { id: channel.id }, data: { config: sanitizedConfig } })
  return { ...channel, config: sanitizedConfig }
}

function propertyIdFromContext(context) {
  const propertyId = String(context?.propertyId || '').trim()
  if (!propertyId) throw new IcalFeedError('Authenticated property context is required.', 403)
  return propertyId
}

export function normalizeIcalProvider(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, '_')
  const provider = normalized === 'BOOKING' ? 'BOOKING_COM' : normalized
  if (!ICAL_PROVIDERS.includes(provider)) {
    throw new IcalFeedError('Unsupported iCal channel provider.', 400)
  }
  return provider
}

export function createIcalFeedToken() {
  return randomBytes(24).toString('base64url')
}

export function buildIcalFeedUrl(origin, token) {
  const normalizedOrigin = String(origin || '').replace(/\/+$/g, '')
  if (!normalizedOrigin) throw new IcalFeedError('Cannot build an iCal feed URL without an app origin.', 500)
  return `${normalizedOrigin}/ical/${encodeURIComponent(token)}.ics`
}

export function generateIcalFeed(calendarName, events, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//Sandbox Hotel PMS//iCal Bridge//EN',
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
  ]

  for (const event of events) {
    const start = dateKeyToIcalDate(event.checkIn)
    const end = dateKeyToIcalDate(event.checkOut)
    if (!start || !end) continue

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcalText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcalText(event.summary)}`,
    )

    if (event.description) lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`)
    lines.push('TRANSP:OPAQUE', 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.map(foldIcalLine).join('\r\n')}\r\n`
}

export async function buildIcalFeedForChannel(prisma, channel, now = new Date()) {
  const activeMappings = (channel.mappings || []).filter((mapping) => mapping.active && mapping.roomTypeId)
  const mappedRoomTypeIds = [...new Set(activeMappings.map((mapping) => mapping.roomTypeId))]
  const where = {
    propertyId: channel.propertyId,
    status: { in: ACTIVE_FEED_STATUSES },
  }

  if (mappedRoomTypeIds.length > 0) {
    where.roomTypeId = { in: mappedRoomTypeIds }
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: { roomType: true },
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
  })

  const events = reservations.map((reservation) => ({
    uid: `sandbox-${reservation.id}@sandbox-hotel-pms`,
    summary: `Sandbox Hotel block - ${reservation.roomType?.name || reservation.roomType?.code || 'Room'}`,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    description: `Unavailable in Sandbox Hotel PMS. Source reservation: ${reservation.confirmationCode || reservation.id}`,
  }))

  return generateIcalFeed(`${channel.name || labelForProvider(channel.provider)} - Sandbox Hotel Blocks`, events, now)
}

export async function listIcalFeedChannels(prisma, context, origin) {
  const propertyId = propertyIdFromContext(context)
  const channels = await prisma.channel.findMany({
    where: { propertyId, provider: { in: ICAL_PROVIDERS } },
    include: { mappings: true },
    orderBy: [{ name: 'asc' }],
  })
  const sanitizedChannels = await Promise.all(channels.map((channel) => migrateLegacyRawToken(prisma, channel)))
  return sanitizedChannels.map((channel) => publicChannelPayload(channel, origin))
}

export async function configureIcalFeedChannel(prisma, context, input, origin) {
  const provider = normalizeIcalProvider(input.provider)
  const propertyId = propertyIdFromContext(context)
  const property = await prisma.property.findUnique({ where: { id: propertyId } })
  if (!property) {
    throw new IcalFeedError('Property setup has not been completed yet.', 503)
  }

  const existing = await prisma.channel.findFirst({
    where: { propertyId: property.id, provider },
    include: { mappings: true },
  })
  const previousConfig = sanitizedTokenConfig(existing?.config)
  const shouldIssueToken = input.rotateToken || !previousConfig.exportTokenHash
  const issuedToken = shouldIssueToken ? createIcalFeedToken() : null
  const now = new Date().toISOString()
  const importUrl = String(input.importUrl || '').trim()
  const config = {
    ...previousConfig,
    connectionMode: 'ICAL',
    exportTokenHash: issuedToken ? hashIcalFeedToken(issuedToken) : previousConfig.exportTokenHash,
    exportFileName: safeFeedFileName(input.exportFileName, `${providerSlug(provider)}-sandbox-hotel-blocks.ics`),
    exportTokenIssuedAt: shouldIssueToken ? now : previousConfig.exportTokenIssuedAt || now,
    lastPublishedAt: now,
  }

  if (importUrl) {
    config.importUrl = importUrl
  } else {
    delete config.importUrl
  }

  const data = {
    propertyId: property.id,
    provider,
    name: existing?.name || labelForProvider(provider),
    hotelId: existing?.hotelId || null,
    credentialRef: null,
    credentialStatus: {
      state: 'not_required',
      provider: 'ical',
      secretStored: false,
    },
    active: true,
    sandboxMode: false,
    syncEnabled: Boolean(importUrl),
    config,
    lastSync: new Date(),
    lastSyncStatus: 'ICAL_FEED_PUBLISHED',
  }

  const channel = existing
    ? await prisma.channel.update({ where: { id: existing.id }, data, include: { mappings: true } })
    : await prisma.channel.create({ data, include: { mappings: true } })

  return publicChannelPayload(channel, origin, issuedToken)
}

export async function deactivateIcalFeedChannel(prisma, context, providerValue, origin) {
  const provider = normalizeIcalProvider(providerValue)
  const propertyId = propertyIdFromContext(context)
  const property = await prisma.property.findUnique({ where: { id: propertyId } })
  if (!property) {
    throw new IcalFeedError('Property setup has not been completed yet.', 503)
  }

  const existing = await prisma.channel.findFirst({
    where: { propertyId: property.id, provider },
    include: { mappings: true },
  })

  if (!existing) {
    return {
      provider,
      name: labelForProvider(provider),
      exportFileName: safeFeedFileName('', `${providerSlug(provider)}-sandbox-hotel-blocks.ics`),
    }
  }

  const config = {
    ...sanitizedTokenConfig(existing.config),
    lastDisabledAt: new Date().toISOString(),
  }

  const channel = await prisma.channel.update({
    where: { id: existing.id },
    data: {
      active: false,
      syncEnabled: false,
      config,
      lastSyncStatus: 'ICAL_FEED_DISABLED',
    },
    include: { mappings: true },
  })

  return publicChannelPayload(channel, origin)
}

export async function getIcalFeedByToken(prisma, token, now = new Date()) {
  const cleanToken = String(token || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,200}$/.test(cleanToken)) {
    throw new IcalFeedError('iCal feed was not found.', 404)
  }

  const channels = await prisma.channel.findMany({
    where: { active: true, provider: { in: ICAL_PROVIDERS } },
    include: { mappings: true },
  })
  const requestedHash = hashIcalFeedToken(cleanToken)
  const channel = channels.find((item) => tokenHashMatches(tokenHashFromChannel(item), requestedHash))
  if (!channel) {
    throw new IcalFeedError('iCal feed was not found.', 404)
  }


  const sanitizedChannel = await migrateLegacyRawToken(prisma, channel)

  return {
    fileName: feedFileNameForChannel(sanitizedChannel),
    contents: await buildIcalFeedForChannel(prisma, sanitizedChannel, now),
  }
}
