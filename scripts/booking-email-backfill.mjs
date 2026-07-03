/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { parseDatabaseUrl } from './db-safety.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import {
  bookingEmailGmailCredentialStatus,
  fetchGmailEventsForSource,
  listBookingEmailSources,
  previewBookingEmailEvent,
  syncBookingEmail,
} from '../server/pms-service.mjs'

loadEnvDefaults()

const HARD_MESSAGE_LIMIT = 1000

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function fail(message) {
  throw new Error(message)
}

function positiveInt(value, fallback) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) fail(`${value} is not a positive integer.`)
  return parsed
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

function queryFor(source) {
  const explicitQuery = argValue('--query')
  if (explicitQuery) return explicitQuery
  if (hasFlag('--all-past')) return `to:${source.mailbox} -in:spam -in:trash`
  return source.query || `to:${source.mailbox} -in:spam -in:trash newer_than:30d`
}

async function selectSource(prisma) {
  await listBookingEmailSources(prisma)
  const sourceId = argValue('--source-id')
  if (sourceId) {
    const source = await prisma.bookingEmailSource.findUnique({ where: { id: sourceId } })
    if (!source) fail(`Booking email source ${sourceId} was not found.`)
    return source
  }

  const source = await prisma.bookingEmailSource.findFirst({
    where: { provider: 'GMAIL', enabled: true },
    orderBy: [{ updatedAt: 'desc' }],
  })
  if (!source) fail('No enabled Gmail booking email source was found.')
  return source
}

async function existingMessageIds(prisma, sourceId, ids) {
  const existing = new Set()
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100).filter(Boolean)
    if (batch.length === 0) continue
    const rows = await prisma.bookingEmailEvent.findMany({
      where: {
        sourceId,
        sourceMessageId: { in: batch },
      },
      select: { sourceMessageId: true },
    })
    for (const row of rows) {
      if (row.sourceMessageId) existing.add(row.sourceMessageId)
    }
  }
  return existing
}

function blankEventTypeCounts() {
  return {
    NEW_BOOKING: 0,
    MODIFICATION: 0,
    CANCELLATION: 0,
    PAYMENT_NOTICE: 0,
    GUEST_MESSAGE: 0,
    UNKNOWN: 0,
  }
}

function buildPreviewSummary(events, existingIds) {
  const eventTypes = blankEventTypeCounts()
  const newEventTypes = blankEventTypeCounts()
  const fieldsPresent = {
    channelRef: 0,
    guestName: 0,
    stayDates: 0,
    roomType: 0,
    amount: 0,
    paymentStatus: 0,
  }
  const confidence = {
    high: 0,
    medium: 0,
    low: 0,
  }

  for (const event of events) {
    const preview = previewBookingEmailEvent(event)
    const type = eventTypes[preview.eventType] === undefined ? 'UNKNOWN' : preview.eventType
    eventTypes[type] += 1
    if (!existingIds.has(event.sourceMessageId)) newEventTypes[type] += 1
    if (preview.channelRefPresent) fieldsPresent.channelRef += 1
    if (preview.guestNamePresent) fieldsPresent.guestName += 1
    if (preview.stayDatesPresent) fieldsPresent.stayDates += 1
    if (preview.roomTypePresent) fieldsPresent.roomType += 1
    if (preview.amountPresent) fieldsPresent.amount += 1
    if (preview.paymentStatusPresent) fieldsPresent.paymentStatus += 1
    if (preview.confidence >= 0.75) confidence.high += 1
    else if (preview.confidence >= 0.5) confidence.medium += 1
    else confidence.low += 1
  }

  return {
    eventTypes,
    newCandidateEventTypes: newEventTypes,
    fieldsPresent,
    confidence,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for booking email backfill.')

  const confirm = hasFlag('--confirm')
  const limit = Math.min(positiveInt(argValue('--limit'), 50), HARD_MESSAGE_LIMIT)
  const pageSize = Math.min(positiveInt(argValue('--page-size'), 50), 50)
  const maxPages = positiveInt(argValue('--max-pages'), Math.ceil(limit / pageSize))
  const credentialStatus = bookingEmailGmailCredentialStatus()
  if (!credentialStatus.configured) {
    fail('Gmail API OAuth credentials are not configured for booking email sync.')
  }

  const prisma = createPrismaClient()
  try {
    const source = await selectSource(prisma)

    const query = queryFor(source)
    const fetchedEvents = await fetchGmailEventsForSource(source, {
      query,
      maxMessages: limit,
      pageSize,
      maxPages,
    })
    const existingIds = await existingMessageIds(
      prisma,
      source.id,
      fetchedEvents.map((event) => event.sourceMessageId),
    )
    const previewSummary = buildPreviewSummary(fetchedEvents, existingIds)
    let imported = []

    if (confirm) {
      const result = await syncBookingEmail(prisma, {
        sourceId: source.id,
        events: fetchedEvents,
        reviewOnly: true,
      }, {
        id: 'booking-email-backfill',
        username: 'booking-email-backfill',
        role: 'SYSTEM',
      })
      imported = result.events || []
    }

    const output = {
      generatedAt: new Date().toISOString(),
      purpose: confirm
        ? 'booking email historical backfill into review queue'
        : 'booking email historical capture dry-run',
      mode: confirm ? 'confirmed-import' : 'dry-run',
      databaseTarget: databaseTargetSummary(process.env.DATABASE_URL),
      source: {
        provider: source.provider,
        mailbox: source.mailbox,
        autoProcessSafeEvents: source.autoProcessSafeEvents,
        reviewThreshold: source.reviewThreshold,
      },
      credential: {
        configured: credentialStatus.configured,
        mode: credentialStatus.mode,
      },
      scan: {
        query,
        limit,
        pageSize,
        maxPages,
        reviewOnlyImport: confirm,
        scannedMessages: fetchedEvents.length,
        existingEvents: existingIds.size,
        newCandidateEvents: fetchedEvents.length - existingIds.size,
        importedEvents: imported.length,
      },
      parsedPreview: previewSummary,
      redaction: {
        messageIds: 'omitted',
        senders: 'omitted',
        recipients: 'omitted',
        subjects: 'omitted',
        rawEmailText: 'omitted',
        guestData: 'omitted',
        paymentData: 'omitted',
        credentials: 'omitted',
      },
      limitations: [
        'Confirmed import creates Booking Email Events for staff review; it does not approve, create, modify, cancel, or charge reservations by itself.',
        'Visual review happens in /booking-inbox after login with a role that can view reservations or messaging.',
        'Parser results are heuristic and must be reviewed before operational PMS mutations.',
        'The scan is bounded by --limit and --max-pages; rerun in batches if Gmail has more historical messages.',
      ],
      nextStep: confirm
        ? 'Open /booking-inbox and review Needs Review, Errors, Processed, and Ignored tabs before applying events.'
        : 'Rerun with --confirm to import these messages as review-only Booking Email Events.',
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
