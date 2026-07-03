/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { parseDatabaseUrl } from './db-safety.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import { bookingEmailGmailCredentialStatus } from '../server/pms-service.mjs'

loadEnvDefaults()

const statuses = ['NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED']
const eventTypes = ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE', 'GUEST_MESSAGE', 'UNKNOWN']

function fail(message) {
  throw new Error(message)
}

function databaseTargetSummary(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl)
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '') || '(none)',
    schema: parsed.searchParams.get('schema') || 'public',
  }
}

function zeroCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]))
}

function increment(target, key, value) {
  target[key] = (target[key] || 0) + value
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null
}

function redactError(value) {
  const text = String(value || '').trim()
  if (!text) return null
  return text
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[redacted]')
}

function sourceKey(index) {
  return `SOURCE_${String(index + 1).padStart(2, '0')}`
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for booking email capture proof.')

  const prisma = createPrismaClient()
  try {
    const [
      sources,
      totalEvents,
      statusGroups,
      typeGroups,
      statusTypeGroups,
      linkedEvents,
      sourceMessageEvents,
      receivedRange,
    ] = await Promise.all([
      prisma.bookingEmailSource.findMany({
        select: {
          provider: true,
          mailbox: true,
          enabled: true,
          autoProcessSafeEvents: true,
          reviewThreshold: true,
          lastSyncAt: true,
          lastError: true,
        },
        orderBy: [{ enabled: 'desc' }, { mailbox: 'asc' }],
      }),
      prisma.bookingEmailEvent.count(),
      prisma.bookingEmailEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.bookingEmailEvent.groupBy({
        by: ['eventType'],
        _count: { _all: true },
      }),
      prisma.bookingEmailEvent.groupBy({
        by: ['status', 'eventType'],
        _count: { _all: true },
      }),
      prisma.bookingEmailEvent.count({ where: { reservationId: { not: null } } }),
      prisma.bookingEmailEvent.count({ where: { sourceMessageId: { not: null } } }),
      prisma.bookingEmailEvent.aggregate({
        _min: { receivedAt: true },
        _max: { receivedAt: true },
      }),
    ])

    const statusCounts = zeroCounts(statuses)
    for (const group of statusGroups) increment(statusCounts, group.status, group._count._all)

    const eventTypeCounts = zeroCounts(eventTypes)
    for (const group of typeGroups) increment(eventTypeCounts, group.eventType, group._count._all)

    const eventTypesByStatus = Object.fromEntries(statuses.map((status) => [status, zeroCounts(eventTypes)]))
    for (const group of statusTypeGroups) {
      if (!eventTypesByStatus[group.status]) eventTypesByStatus[group.status] = zeroCounts(eventTypes)
      increment(eventTypesByStatus[group.status], group.eventType, group._count._all)
    }

    const output = {
      generatedAt: new Date().toISOString(),
      purpose: 'read-only aggregate booking email capture proof',
      databaseTarget: databaseTargetSummary(process.env.DATABASE_URL),
      credential: {
        configured: bookingEmailGmailCredentialStatus().configured,
        mode: bookingEmailGmailCredentialStatus().mode,
      },
      sources: sources.map((source, index) => ({
        sourceKey: sourceKey(index),
        provider: source.provider,
        mailbox: source.mailbox,
        enabled: source.enabled,
        autoProcessSafeEvents: source.autoProcessSafeEvents,
        reviewThreshold: source.reviewThreshold,
        lastSyncAt: isoOrNull(source.lastSyncAt),
        lastError: redactError(source.lastError),
      })),
      capture: {
        totalEvents,
        sourceMessageEvents,
        linkedEvents,
        needsReview: statusCounts.NEEDS_REVIEW,
        processed: statusCounts.PROCESSED,
        errors: statusCounts.ERROR,
        ignored: statusCounts.IGNORED,
        firstReceivedAt: isoOrNull(receivedRange._min.receivedAt),
        lastReceivedAt: isoOrNull(receivedRange._max.receivedAt),
      },
      statusCounts,
      eventTypeCounts,
      eventTypesByStatus,
      redaction: {
        eventIds: 'omitted',
        messageIds: 'omitted',
        senders: 'omitted',
        recipients: 'omitted',
        subjects: 'omitted',
        rawEmailText: 'omitted',
        guestData: 'omitted',
        paymentData: 'omitted',
        credentials: 'omitted',
      },
      interpretation: totalEvents > 0
        ? 'Booking email events exist in the PMS database; use /booking-inbox for visual review and staff approval.'
        : 'No booking email events currently exist in the PMS database.',
      limitations: [
        'This proves PMS database capture state only; it does not scan Gmail.',
        'Gmail historical scanning still requires backend Gmail OAuth credentials.',
        'Events are not operational reservations until staff approve/link/create them through the PMS.',
      ],
    }

    console.log(JSON.stringify(output, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
