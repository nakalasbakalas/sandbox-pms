import { randomBytes } from 'node:crypto'

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

function tokenFromChannel(channel) {
  return cleanJsonObject(channel?.config).exportToken
}

function feedFileNameForChannel(channel) {
  const config = cleanJsonObject(channel?.config)
  return safeFeedFileName(config.exportFileName, `${providerSlug(channel?.provider)}-sandbox-hotel-blocks.ics`)
}

function publicChannelPayload(channel, origin) {
  const config = cleanJsonObject(channel.config)
  const exportToken = tokenFromChannel(channel)
  return {
    id: channel.id,
    provider: channel.provider,
    name: channel.name,
    importUrl: config.importUrl || undefined,
    exportFileName: feedFileNameForChannel(channel),
    exportFeedUrl: exportToken && origin ? buildIcalFeedUrl(origin, exportToken) : undefined,
    lastPublishedAt: config.lastPublishedAt || undefined,
    exportTokenIssuedAt: config.exportTokenIssuedAt || undefined,
  }
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

export async function listIcalFeedChannels(prisma, origin) {
  const channels = await prisma.channel.findMany({
    where: { provider: { in: ICAL_PROVIDERS } },
    include: { mappings: true },
    orderBy: [{ name: 'asc' }],
  })
  return channels.map((channel) => publicChannelPayload(channel, origin))
}

export async function configureIcalFeedChannel(prisma, input, origin) {
  const provider = normalizeIcalProvider(input.provider)
  const property = await prisma.property.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!property) {
    throw new IcalFeedError('Property setup has not been completed yet.', 503)
  }

  const existing = await prisma.channel.findFirst({
    where: { propertyId: property.id, provider },
    include: { mappings: true },
  })
  const previousConfig = cleanJsonObject(existing?.config)
  const shouldIssueToken = input.rotateToken || !previousConfig.exportToken
  const exportToken = shouldIssueToken ? createIcalFeedToken() : previousConfig.exportToken
  const now = new Date().toISOString()
  const importUrl = String(input.importUrl || '').trim()
  const config = {
    ...previousConfig,
    connectionMode: 'ICAL',
    exportToken,
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
    credentials: {},
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

  return publicChannelPayload(channel, origin)
}

export async function deactivateIcalFeedChannel(prisma, providerValue, origin) {
  const provider = normalizeIcalProvider(providerValue)
  const property = await prisma.property.findFirst({ orderBy: { createdAt: 'asc' } })
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
    ...cleanJsonObject(existing.config),
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
  const channel = channels.find((item) => tokenFromChannel(item) === cleanToken)
  if (!channel) {
    throw new IcalFeedError('iCal feed was not found.', 404)
  }

  return {
    fileName: feedFileNameForChannel(channel),
    contents: await buildIcalFeedForChannel(prisma, channel, now),
  }
}
