/* global console, process */
import { createHash } from 'node:crypto'
import { loadEnvDefaults } from './env-utils.mjs'
import { parseDatabaseUrl } from './db-safety.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import { bookingEmailGmailCredentialStatus, previewBookingEmailEvent } from '../server/pms-service.mjs'

loadEnvDefaults()

const STATUSES = ['NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED']
const EVENT_TYPES = ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE', 'GUEST_MESSAGE', 'UNKNOWN']

function fail(message) {
  throw new Error(message)
}

function optionValue(name, fallback = null) {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  const splitArg = `--${name}`
  const index = process.argv.indexOf(splitArg)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
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

function increment(target, key, value = 1) {
  target[key] = (target[key] || 0) + value
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null
}

function dateKeyOrNull(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null
}

function safeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function hashValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function fingerprint(value) {
  const hash = hashValue(value)
  return hash ? `sha256:${hash}` : null
}

function maskEmail(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text.includes('@')) return text || null
  const [local, domain] = text.split('@')
  return `${local.slice(0, 2)}***@${domain}`
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

function eventPreviewInput(event) {
  const details = safeJsonObject(event.parsedDetails)
  return {
    eventType: event.eventType,
    subject: event.subject,
    rawText: event.rawText,
    sender: event.sender,
    receivedAt: event.receivedAt,
    channelRef: event.channelRef || details.channelRef,
    guestName: event.guestName || details.guestName,
    checkIn: dateKeyOrNull(event.checkIn) || details.checkIn,
    checkOut: dateKeyOrNull(event.checkOut) || details.checkOut,
    roomType: event.roomType || details.roomType,
    amount: event.amount ?? details.amount,
    currency: event.currency || details.currency,
    paymentStatus: event.paymentStatus || details.paymentStatus,
    parsedDetails: details,
  }
}

function eventAnomalyCounters(events) {
  const counters = {
    confidenceOutOfRange: 0,
    invalidStayRange: 0,
    newBookingMissingGuestName: 0,
    newBookingMissingStayDates: 0,
    newBookingMissingRoomType: 0,
    actionableMissingChannelRef: 0,
    paymentNoticeMissingAmount: 0,
    parserTypeDrift: 0,
    parserConfidenceDeltaOverTwentyPoints: 0,
  }

  for (const event of events) {
    const details = safeJsonObject(event.parsedDetails)
    const checkIn = dateKeyOrNull(event.checkIn) || details.checkIn
    const checkOut = dateKeyOrNull(event.checkOut) || details.checkOut
    const channelRef = event.channelRef || details.channelRef
    const amount = event.amount ?? details.amount
    const confidence = Number(event.confidence)
    const preview = previewBookingEmailEvent(eventPreviewInput(event))

    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) counters.confidenceOutOfRange += 1
    if (checkIn && checkOut && String(checkOut) <= String(checkIn)) counters.invalidStayRange += 1
    if (event.eventType === 'NEW_BOOKING' && !(event.guestName || details.guestName)) counters.newBookingMissingGuestName += 1
    if (event.eventType === 'NEW_BOOKING' && (!checkIn || !checkOut)) counters.newBookingMissingStayDates += 1
    if (event.eventType === 'NEW_BOOKING' && !(event.roomType || details.roomType)) counters.newBookingMissingRoomType += 1
    if (['PAYMENT_NOTICE', 'CANCELLATION', 'MODIFICATION'].includes(event.eventType) && !channelRef) counters.actionableMissingChannelRef += 1
    if (event.eventType === 'PAYMENT_NOTICE' && !(Number.isFinite(Number(amount)) && Number(amount) > 0)) counters.paymentNoticeMissingAmount += 1
    if (preview.eventType !== event.eventType) counters.parserTypeDrift += 1
    if (Number.isFinite(confidence) && Math.abs(Number(preview.confidence) - confidence) > 0.2) {
      counters.parserConfidenceDeltaOverTwentyPoints += 1
    }
  }

  return counters
}

function finding(id, severity, count, description, recommendation) {
  return { id, severity, count, description, recommendation }
}

function pushFinding(findings, id, severity, count, description, recommendation) {
  if (count > 0) findings.push(finding(id, severity, count, description, recommendation))
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for booking email deep scan.')

  const sampleLimit = boundedNumber(optionValue('limit'), 250, 1, 2000)
  const strict = process.argv.includes('--strict')
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
      rawTextEvents,
      processedWithoutProcessedAt,
      processedWithErrorReason,
      errorWithoutErrorReason,
      needsReviewWithoutReviewReason,
      unknownEvents,
      channelGroups,
      channelTypeGroups,
      sampledEvents,
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
      prisma.bookingEmailEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.bookingEmailEvent.groupBy({ by: ['eventType'], _count: { _all: true } }),
      prisma.bookingEmailEvent.groupBy({ by: ['status', 'eventType'], _count: { _all: true } }),
      prisma.bookingEmailEvent.count({ where: { reservationId: { not: null } } }),
      prisma.bookingEmailEvent.count({ where: { sourceMessageId: { not: null } } }),
      prisma.bookingEmailEvent.count({ where: { rawText: { not: null } } }),
      prisma.bookingEmailEvent.count({ where: { status: 'PROCESSED', processedAt: null } }),
      prisma.bookingEmailEvent.count({ where: { status: 'PROCESSED', errorReason: { not: null } } }),
      prisma.bookingEmailEvent.count({ where: { status: 'ERROR', errorReason: null } }),
      prisma.bookingEmailEvent.count({ where: { status: 'NEEDS_REVIEW', reviewReason: null } }),
      prisma.bookingEmailEvent.count({ where: { eventType: 'UNKNOWN' } }),
      prisma.bookingEmailEvent.groupBy({
        by: ['sourceId', 'channelRef'],
        where: { channelRef: { not: null } },
        _count: { _all: true },
      }),
      prisma.bookingEmailEvent.groupBy({
        by: ['sourceId', 'channelRef', 'eventType'],
        where: { channelRef: { not: null } },
        _count: { _all: true },
      }),
      prisma.bookingEmailEvent.findMany({
        take: sampleLimit,
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          eventType: true,
          status: true,
          confidence: true,
          channelRef: true,
          guestName: true,
          checkIn: true,
          checkOut: true,
          roomType: true,
          amount: true,
          currency: true,
          paymentStatus: true,
          subject: true,
          sender: true,
          receivedAt: true,
          sourceMessageId: true,
          rawEmailUrl: true,
          rawText: true,
          parsedDetails: true,
        },
      }),
    ])

    const statusCounts = zeroCounts(STATUSES)
    for (const group of statusGroups) increment(statusCounts, group.status, group._count._all)

    const eventTypeCounts = zeroCounts(EVENT_TYPES)
    for (const group of typeGroups) increment(eventTypeCounts, group.eventType, group._count._all)

    const eventTypesByStatus = Object.fromEntries(STATUSES.map((status) => [status, zeroCounts(EVENT_TYPES)]))
    for (const group of statusTypeGroups) {
      if (!eventTypesByStatus[group.status]) eventTypesByStatus[group.status] = zeroCounts(EVENT_TYPES)
      increment(eventTypesByStatus[group.status], group.eventType, group._count._all)
    }

    const duplicateChannelGroups = channelGroups.filter((group) => group._count._all > 1)
    const channelTypeMap = new Map()
    for (const group of channelTypeGroups) {
      const key = `${group.sourceId || 'none'}::${group.channelRef}`
      if (!channelTypeMap.has(key)) channelTypeMap.set(key, [])
      channelTypeMap.get(key).push({ eventType: group.eventType, count: group._count._all })
    }
    const mixedReferenceGroups = duplicateChannelGroups.filter((group) => {
      const types = channelTypeMap.get(`${group.sourceId || 'none'}::${group.channelRef}`) || []
      return new Set(types.map((item) => item.eventType)).size > 1
    })
    const repeatedSameTypeReferenceGroups = channelTypeGroups.filter((group) => group._count._all > 1)

    const sampleAnomalies = eventAnomalyCounters(sampledEvents)
    const missingSourceMessageId = totalEvents - sourceMessageEvents
    const missingRawText = totalEvents - rawTextEvents

    const findings = []
    pushFinding(findings, 'processed-without-processed-at', 'high', processedWithoutProcessedAt, 'Events marked PROCESSED without a processedAt timestamp break audit sequencing.', 'Backfill processedAt where audit logs prove processing, and enforce timestamp mutation in every processing path.')
    pushFinding(findings, 'processed-with-error-reason', 'medium', processedWithErrorReason, 'Processed events still carry an errorReason.', 'Clear errorReason whenever an event transitions to PROCESSED.')
    pushFinding(findings, 'error-without-error-reason', 'high', errorWithoutErrorReason, 'Events marked ERROR without an errorReason are not actionable.', 'Require a persisted errorReason on all ERROR transitions.')
    pushFinding(findings, 'unknown-event-type', 'medium', unknownEvents, 'Events classified as UNKNOWN need manual or parser review.', 'Improve parser signals and add provider-specific fixtures for common OTA templates.')
    pushFinding(findings, 'missing-source-message-id', 'medium', missingSourceMessageId, 'Events without sourceMessageId cannot rely on provider-level idempotent upsert.', 'Populate sourceMessageId from Gmail id, Message-ID, or a stable content fingerprint before insert.')
    pushFinding(findings, 'missing-raw-text', 'medium', missingRawText, 'Events without rawText cannot be reprocessed with improved parser logic.', 'Persist sanitized text/plain or text/html extraction output for every scanned message.')
    pushFinding(findings, 'duplicate-channel-reference', 'medium', duplicateChannelGroups.length, 'Multiple email events share a source/channel reference.', 'Treat same-reference events as duplicates only when the event type and provider message fingerprint also match.')
    pushFinding(findings, 'mixed-type-same-reference', 'high', mixedReferenceGroups.length, 'Different email event types share the same channel reference; current channelRef-only duplicate checks can flag legitimate payment/cancellation/modification notices as duplicates.', 'Scope duplicate detection to sourceMessageId, provider Message-ID, and channelRef + eventType, not channelRef alone.')
    pushFinding(findings, 'same-type-same-reference', 'medium', repeatedSameTypeReferenceGroups.length, 'Same event type appears more than once for the same channel reference.', 'Review whether these are resend duplicates, multi-room reservations, or legitimate updates.')
    pushFinding(findings, 'sample-invalid-stay-range', 'high', sampleAnomalies.invalidStayRange, 'Sampled events contain check-out dates not after check-in.', 'Reject or quarantine invalid stay ranges before approval.')
    pushFinding(findings, 'sample-parser-type-drift', 'medium', sampleAnomalies.parserTypeDrift, 'Re-previewing sampled events produces a different event type than the stored value.', 'After parser upgrades, run reprocess on stale events and store parser version metadata.')
    pushFinding(findings, 'sample-new-booking-missing-stay-dates', 'high', sampleAnomalies.newBookingMissingStayDates, 'Sampled new booking events are missing stay dates.', 'Extend date label parsing to check-in/check-out, arrival/departure, and provider-specific labels.')
    pushFinding(findings, 'sample-payment-missing-amount', 'high', sampleAnomalies.paymentNoticeMissingAmount, 'Sampled payment notices are missing payment amount.', 'Parse amount/currency from provider-specific payment sections and require amount before payment approval.')

    const output = {
      generatedAt: new Date().toISOString(),
      purpose: 'booking email capture, parser, duplicate, and approval-readiness deep scan',
      options: { sampleLimit, strict },
      databaseTarget: databaseTargetSummary(process.env.DATABASE_URL),
      credential: {
        configured: bookingEmailGmailCredentialStatus().configured,
        mode: bookingEmailGmailCredentialStatus().mode,
      },
      sources: sources.map((source, index) => ({
        sourceKey: sourceKey(index),
        provider: source.provider,
        mailbox: maskEmail(source.mailbox),
        enabled: source.enabled,
        autoProcessSafeEvents: source.autoProcessSafeEvents,
        reviewThreshold: source.reviewThreshold,
        lastSyncAt: isoOrNull(source.lastSyncAt),
        lastError: redactError(source.lastError),
      })),
      aggregate: {
        totalEvents,
        linkedEvents,
        sourceMessageEvents,
        rawTextEvents,
        needsReviewWithoutReviewReason,
        processedWithoutProcessedAt,
        processedWithErrorReason,
        errorWithoutErrorReason,
        duplicateChannelReferenceGroups: duplicateChannelGroups.length,
        mixedTypeSameReferenceGroups: mixedReferenceGroups.length,
        repeatedSameTypeReferenceGroups: repeatedSameTypeReferenceGroups.length,
      },
      statusCounts,
      eventTypeCounts,
      eventTypesByStatus,
      sampledEventChecks: {
        scannedRows: sampledEvents.length,
        ...sampleAnomalies,
      },
      duplicateReferenceSamples: duplicateChannelGroups.slice(0, 10).map((group) => ({
        sourceFingerprint: fingerprint(group.sourceId || 'none'),
        channelRefFingerprint: fingerprint(group.channelRef),
        count: group._count._all,
        eventTypes: channelTypeMap.get(`${group.sourceId || 'none'}::${group.channelRef}`) || [],
      })),
      staticFindings: [
        {
          id: 'parser-date-label-coverage',
          severity: 'high',
          file: 'server/pms-service.mjs',
          summary: 'Date parsing should accept check-in/check-out, checkin/checkout, arrival/departure, and provider variants before event confidence is scored.',
        },
        {
          id: 'duplicate-detection-scope',
          severity: 'high',
          file: 'server/pms-service.mjs',
          summary: 'Duplicate detection should not use channelRef alone; payment, cancellation, and modification notices often share the original booking reference.',
        },
        {
          id: 'auto-process-async-catch',
          severity: 'high',
          file: 'server/pms-service.mjs',
          summary: 'Auto-processing should await approval helpers inside the try block so errors are persisted on the event rather than aborting sync.',
        },
      ],
      findings,
      redaction: {
        eventIds: 'omitted',
        messageIds: 'omitted',
        senders: 'omitted',
        recipients: 'omitted',
        subjects: 'omitted',
        rawEmailText: 'omitted',
        guestData: 'omitted',
        paymentData: 'omitted',
        channelReferences: 'fingerprinted',
      },
      nextActions: [
        'Run npm run booking-email:deep-scan -- --limit=500 in the target environment.',
        'Fix parser coverage and duplicate-scope defects in server/pms-service.mjs, then rerun with --strict.',
        'Run npm run booking-email:reprocess -- --confirm for NEEDS_REVIEW and ERROR events after parser changes; do not auto-approve historical events without staff review.',
      ],
    }

    console.log(JSON.stringify(output, null, 2))

    const highFindings = findings.filter((item) => item.severity === 'high').length
    if (strict && highFindings > 0) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
