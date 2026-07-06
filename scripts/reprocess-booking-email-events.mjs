/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { parseDatabaseUrl } from './db-safety.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import { reprocessBookingEmailEvent } from '../server/pms-service.mjs'

loadEnvDefaults()

const VALID_STATUSES = ['NEEDS_REVIEW', 'ERROR']

function fail(message) {
  throw new Error(message)
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function argValue(name) {
  const equalsPrefix = `${name}=`
  const equalsArg = process.argv.find((arg) => arg.startsWith(equalsPrefix))
  if (equalsArg) return equalsArg.slice(equalsPrefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
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

function parseStatuses(raw) {
  const values = String(raw || VALID_STATUSES.join(','))
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  if (values.length === 0) fail('At least one booking email status is required.')
  for (const value of values) {
    if (!VALID_STATUSES.includes(value)) {
      fail(`Unsupported booking email status ${value}. Allowed values: ${VALID_STATUSES.join(', ')}.`)
    }
  }
  return [...new Set(values)]
}

function countBy(items, key) {
  return items.reduce((accumulator, item) => {
    const value = item[key]
    accumulator[value] = (accumulator[value] || 0) + 1
    return accumulator
  }, {})
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for booking email reprocessing.')

  const confirm = hasFlag('--confirm')
  const limit = Math.min(positiveInt(argValue('--limit'), 1000), 5000)
  const statuses = parseStatuses(argValue('--status') || argValue('--statuses'))
  const prisma = createPrismaClient()

  try {
    const selectedEvents = await prisma.bookingEmailEvent.findMany({
      where: {
        status: { in: statuses },
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        status: true,
        eventType: true,
      },
    })

    let reprocessed = 0
    let failed = 0
    if (confirm) {
      for (const event of selectedEvents) {
        try {
          await reprocessBookingEmailEvent(prisma, event.id, {
            id: 'booking-email-reprocess',
            username: 'booking-email-reprocess',
            role: 'SYSTEM',
          })
          reprocessed += 1
        } catch {
          failed += 1
        }
      }
    }

    const output = {
      generatedAt: new Date().toISOString(),
      purpose: confirm ? 'booking email review/error reprocess' : 'booking email review/error reprocess dry-run',
      mode: confirm ? 'confirmed-reprocess' : 'dry-run',
      databaseTarget: databaseTargetSummary(process.env.DATABASE_URL),
      selection: {
        statuses,
        limit,
        selectedCount: selectedEvents.length,
        selectedByStatus: countBy(selectedEvents, 'status'),
        selectedByEventType: countBy(selectedEvents, 'eventType'),
      },
      result: {
        reprocessed,
        failed,
      },
      redaction: {
        eventIds: 'omitted',
        guestData: 'omitted',
        paymentData: 'omitted',
        credentials: 'omitted',
      },
      nextStep: confirm
        ? 'Rerun booking-email:deep-scan with --strict, then review the refreshed queue in /booking-inbox before approving any events.'
        : 'Rerun with --confirm to reset only the selected NEEDS_REVIEW and ERROR events through the patched parser.',
    }

    console.log(JSON.stringify(output, null, 2))
    if (confirm && failed > 0) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
