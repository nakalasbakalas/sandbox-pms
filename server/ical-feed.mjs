import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { beginChannelMutation, completeChannelMutation } from './channel-mutation-idempotency.mjs'
import { recordDomainEvent } from './domain-events.mjs'
import { operationalReasonForEvidence, operationalReasonSchema } from './operational-reason.mjs'
import { deriveServerScopedSecret } from './security.mjs'

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
const configureIcalSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  exportFileName: z.string().trim().max(200).optional(),
  rotateToken: z.boolean().optional().default(false),
  reason: operationalReasonSchema,
}).strict()
const deactivateIcalSchema = z.object({ reason: operationalReasonSchema }).strict()

function publicChannelPayload(channel, origin, issuedToken = null) {
  const config = cleanJsonObject(channel.config)
  return Object.fromEntries(Object.entries({
    id: channel.id,
    provider: channel.provider,
    name: channel.name,
    exportFileName: feedFileNameForChannel(channel),
    exportFeedUrl: issuedToken && origin ? buildIcalFeedUrl(origin, issuedToken) : undefined,
    exportTokenConfigured: Boolean(tokenHashFromChannel(channel)),
    lastPublishedAt: config.lastPublishedAt || undefined,
    exportTokenIssuedAt: config.exportTokenIssuedAt || undefined,
    exportTokenGraceUntil: Array.isArray(config.graceExportTokenHashes)
      ? config.graceExportTokenHashes.map((item) => item?.validUntil).filter(Boolean).sort().at(-1)
      : undefined,
  }).filter(([, value]) => value !== undefined))
}

function propertyIdFromContext(context) {
  const propertyId = String(context?.propertyId || '').trim()
  if (!propertyId) throw new IcalFeedError('Authenticated property context is required.', 403)
  return propertyId
}

function channelAcceptsTokenHash(channel, requestedHash, now = new Date()) {
  if (!channel?.active) return false
  if (tokenHashMatches(tokenHashFromChannel(channel), requestedHash)) return true
  const config = cleanJsonObject(channel.config)
  const graceHashes = Array.isArray(config.graceExportTokenHashes) ? config.graceExportTokenHashes : []
  return graceHashes.some((candidate) => (
    candidate &&
    typeof candidate.hash === 'string' &&
    typeof candidate.validUntil === 'string' &&
    new Date(candidate.validUntil) > now &&
    tokenHashMatches(candidate.hash, requestedHash)
  ))
}

function actorIdFromContext(context) {
  const actorId = String(context?.actor?.id || context?.actorId || '').trim()
  if (!actorId) throw new IcalFeedError('Authenticated actor context is required.', 403)
  return actorId
}

function idempotencyKeyFromContext(context) {
  const key = String(context?.idempotencyKey || '').trim()
  if (!/^[a-zA-Z0-9._:-]{16,200}$/.test(key)) {
    throw new IcalFeedError('A valid x-idempotency-key is required for iCal channel mutations.', 400)
  }
  return key
}

function derivedIcalFeedToken(propertyId, provider, idempotencyKey) {
  return deriveServerScopedSecret(`sandbox-ical-token-v1\0${propertyId}\0${provider}\0${idempotencyKey}`)
}

async function lockIcalProvider(tx, propertyId, provider) {
  if (typeof tx.$executeRawUnsafe === 'function') {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `ical-channel:${propertyId}:${provider}`,
    )
  } else if (typeof tx.$queryRawUnsafe === 'function') {
    await tx.$queryRawUnsafe('SELECT true AS locked')
  }
}

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new IcalFeedError(`${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
  }
  return result.data
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
    where: { propertyId, provider: { in: ICAL_PROVIDERS }, active: true },
    include: { mappings: true },
    orderBy: [{ name: 'asc' }],
  })
  return channels.map((channel) => publicChannelPayload(channel, origin))
}

export async function configureIcalFeedChannel(prisma, context, input, origin) {
  const parsed = parseInput(configureIcalSchema, input)
  const provider = normalizeIcalProvider(parsed.provider)
  const propertyId = propertyIdFromContext(context)
  const actorId = actorIdFromContext(context)

  return prisma.$transaction(async (tx) => {
    await lockIcalProvider(tx, propertyId, provider)
    const property = await tx.property.findUnique({ where: { id: propertyId } })
    if (!property) {
      throw new IcalFeedError('Property setup has not been completed yet.', 503)
    }

    const existing = await tx.channel.findFirst({
      where: { propertyId: property.id, provider },
      include: { mappings: true },
    })
    const previousConfig = sanitizedTokenConfig(existing?.config)
    const shouldIssueToken = parsed.rotateToken || !previousConfig.exportTokenHash
    const requestedFileName = safeFeedFileName(
      parsed.exportFileName ?? previousConfig.exportFileName,
      `${providerSlug(provider)}-sandbox-hotel-blocks.ics`,
    )
    const mutationAttempt = await beginChannelMutation(tx, context, 'CONFIGURE_ICAL_CHANNEL', parsed)
    const issueIdempotencyKey = idempotencyKeyFromContext(context)
    if (mutationAttempt.replay) {
      const stored = cleanJsonObject(mutationAttempt.result)
      const payload = cleanJsonObject(stored.payload)
      if (!payload.id || payload.provider !== provider) {
        throw new IcalFeedError('The prior channel mutation result cannot be replayed safely.', 409)
      }
      const replayToken = stored.issuedToken
        ? derivedIcalFeedToken(propertyId, provider, issueIdempotencyKey)
        : null
      if (replayToken && !channelAcceptsTokenHash(existing, hashIcalFeedToken(replayToken))) {
        throw new IcalFeedError('The prior iCal token operation was superseded and cannot be replayed safely.', 409)
      }
      return {
        ...payload,
        ...(replayToken ? { exportFeedUrl: buildIcalFeedUrl(origin, replayToken) } : {}),
        idempotentReplay: true,
      }
    }

    const issuedToken = shouldIssueToken
      ? derivedIcalFeedToken(propertyId, provider, issueIdempotencyKey)
      : null
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const currentTokenHash = previousConfig.exportTokenHash
    const existingGraceHashes = Array.isArray(previousConfig.graceExportTokenHashes)
      ? previousConfig.graceExportTokenHashes.filter((item) => (
        item &&
        typeof item.hash === 'string' &&
        typeof item.validUntil === 'string' &&
        new Date(item.validUntil) > nowDate
      ))
      : []
    const graceExportTokenHashes = issuedToken && currentTokenHash
      ? [
          ...existingGraceHashes,
          { hash: currentTokenHash, validUntil: new Date(nowDate.getTime() + 15 * 60 * 1_000).toISOString() },
        ].slice(-4)
      : existingGraceHashes.slice(-4)
    const config = {
      ...previousConfig,
      connectionMode: 'ICAL',
      exportTokenHash: issuedToken ? hashIcalFeedToken(issuedToken) : previousConfig.exportTokenHash,
      graceExportTokenHashes,
      exportFileName: requestedFileName,
      exportTokenIssuedAt: shouldIssueToken ? now : previousConfig.exportTokenIssuedAt || now,
      lastPublishedAt: now,
    }

    delete config.importUrl

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
      syncEnabled: false,
      config,
      lastSync: new Date(),
      lastSyncStatus: 'ICAL_FEED_PUBLISHED',
    }

    const channel = existing
      ? await tx.channel.update({ where: { id: existing.id }, data, include: { mappings: true } })
      : await tx.channel.create({ data, include: { mappings: true } })
    const action = parsed.rotateToken ? 'ICAL_EXPORT_TOKEN_ROTATED' : 'ICAL_CHANNEL_CONFIGURED'
    const evidence = {
      provider,
      reason: operationalReasonForEvidence(parsed.reason),
      exportTokenConfigured: Boolean(config.exportTokenHash),
      exportTokenGraceUntil: graceExportTokenHashes.map((item) => item.validUntil).sort().at(-1) || null,
      providerWrite: false,
    }
    await tx.auditLog.create({ data: {
      propertyId,
      userId: actorId,
      action,
      entityType: 'channel',
      entityId: channel.id,
      changes: evidence,
    } })
    await recordDomainEvent(tx, {
      propertyId,
      eventType: action,
      aggregateType: 'channel',
      aggregateId: channel.id,
      actorUserId: actorId,
      metadata: evidence,
    })
    const result = publicChannelPayload(channel, origin, issuedToken)
    const storedPayload = { ...result }
    delete storedPayload.exportFeedUrl
    await completeChannelMutation(tx, mutationAttempt, {
      payload: storedPayload,
      issuedToken: Boolean(issuedToken),
    })
    return result
  })
}

export async function deactivateIcalFeedChannel(prisma, context, providerValue, origin, input = {}) {
  const provider = normalizeIcalProvider(providerValue)
  const propertyId = propertyIdFromContext(context)
  const actorId = actorIdFromContext(context)
  const parsed = parseInput(deactivateIcalSchema, input)

  return prisma.$transaction(async (tx) => {
    await lockIcalProvider(tx, propertyId, provider)
    const property = await tx.property.findUnique({ where: { id: propertyId } })
    if (!property) {
      throw new IcalFeedError('Property setup has not been completed yet.', 503)
    }
    const mutationAttempt = await beginChannelMutation(
      tx,
      context,
      'DISABLE_ICAL_CHANNEL',
      { provider, reason: parsed.reason },
    )
    if (mutationAttempt.replay) return mutationAttempt.result

    const existing = await tx.channel.findFirst({
      where: { propertyId: property.id, provider },
      include: { mappings: true },
    })
    const entityId = existing?.id || `${propertyId}:${provider}`
    const evidence = { provider, reason: operationalReasonForEvidence(parsed.reason), providerWrite: false }

    if (!existing) {
      await tx.auditLog.create({ data: {
        propertyId,
        userId: actorId,
        action: 'ICAL_CHANNEL_DISABLE_NOOP',
        entityType: 'channel',
        entityId,
        changes: evidence,
      } })
      await recordDomainEvent(tx, {
        propertyId,
        eventType: 'ICAL_CHANNEL_DISABLE_NOOP',
        aggregateType: 'channel',
        aggregateId: entityId,
        actorUserId: actorId,
        metadata: evidence,
      })
      const result = {
        provider,
        name: labelForProvider(provider),
        exportFileName: safeFeedFileName('', `${providerSlug(provider)}-sandbox-hotel-blocks.ics`),
      }
      return completeChannelMutation(tx, mutationAttempt, result)
    }

    const config = {
      ...sanitizedTokenConfig(existing.config),
      lastDisabledAt: new Date().toISOString(),
    }

    const channel = await tx.channel.update({
      where: { id: existing.id },
      data: {
        active: false,
        syncEnabled: false,
        config,
        lastSyncStatus: 'ICAL_FEED_DISABLED',
      },
      include: { mappings: true },
    })
    await tx.auditLog.create({ data: {
      propertyId,
      userId: actorId,
      action: 'ICAL_CHANNEL_DISABLED',
      entityType: 'channel',
      entityId: channel.id,
      changes: evidence,
    } })
    await recordDomainEvent(tx, {
      propertyId,
      eventType: 'ICAL_CHANNEL_DISABLED',
      aggregateType: 'channel',
      aggregateId: channel.id,
      actorUserId: actorId,
      metadata: evidence,
    })
    return completeChannelMutation(tx, mutationAttempt, publicChannelPayload(channel, origin))
  })
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
  const channel = channels.find((item) => channelAcceptsTokenHash(item, requestedHash, now))
  if (!channel) {
    throw new IcalFeedError('iCal feed was not found.', 404)
  }


  const sanitizedChannel = { ...channel, config: sanitizedTokenConfig(channel.config) }

  return {
    fileName: feedFileNameForChannel(sanitizedChannel),
    contents: await buildIcalFeedForChannel(prisma, sanitizedChannel, now),
  }
}
