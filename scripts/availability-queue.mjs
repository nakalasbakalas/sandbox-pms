#!/usr/bin/env node
/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import {
  approveAvailabilityQueueItem,
  cancelAvailabilityQueueItem,
  createAvailabilityQueueItem,
  getChannelSyncV2Policy,
  listAvailabilityQueue,
  markAvailabilityQueueItemFailed,
  markAvailabilityQueueItemSent,
  resolveAvailabilityQueueActor,
} from '../server/availability-queue.mjs'

function parseArgs(argv) {
  const result = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const [rawKey, inlineValue] = value.slice(2).split('=', 2)
    const key = rawKey.trim()
    if (!key) continue
    if (inlineValue !== undefined) {
      result[key] = inlineValue
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next
      index += 1
    } else {
      result[key] = true
    }
  }
  return result
}

function helpText() {
  return `
Manual outbound availability queue

Usage:
  npm run availability:queue -- create --provider agoda --hotel-id HOTEL123 \
    --room-type DOUBLE --from 2026-07-11 --to 2026-07-15 --rooms 2 \
    --reason "Reservation received; reduce sellable inventory" \
    --actor admin@example.com

  npm run availability:queue -- list [--status PENDING_APPROVAL] [--limit 100]

  npm run availability:queue -- approve --id TASK_ID \
    --notes "Approved against PMS inventory" --actor manager

  npm run availability:queue -- mark-sent --id TASK_ID \
    --reference PROVIDER_CONFIRMATION --notes "Updated in partner portal" \
    --actor manager

  npm run availability:queue -- mark-failed --id TASK_ID \
    --reason "Partner portal unavailable" --actor manager

  npm run availability:queue -- cancel --id TASK_ID \
    --reason "Superseded by newer inventory" --actor manager

  npm run availability:queue -- policy

Providers:
  booking | agoda | trip | expedia | channex

Identity:
  --actor accepts an active PMS user ID, username, or email. The database role and
  display name are used for authorization and audit. --actor-id is a legacy alias;
  caller-supplied actor labels or roles are ignored.

Safety:
  Queue creation and approval never call an OTA. An item is only completed after a
  human records an external provider confirmation/reference.
`.trim()
}

function required(args, key, label = key) {
  const value = String(args[key] || '').trim()
  if (!value) throw new Error(`${label} is required (--${key}).`)
  return value
}

async function actorFromArgs(prisma, args) {
  const actorRef = String(args.actor || args['actor-id'] || '').trim()
  if (!actorRef) throw new Error('Active PMS actor is required (--actor).')
  return resolveAvailabilityQueueActor(prisma, actorRef)
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2))
}

async function runCommand(prisma, command, args) {
  if (command === 'policy') {
    return getChannelSyncV2Policy(process.env)
  }

  if (command === 'list') {
    return {
      items: await listAvailabilityQueue(prisma, {
        status: args.status,
        limit: args.limit,
      }),
    }
  }

  const actor = await actorFromArgs(prisma, args)
  if (command === 'create') {
    return createAvailabilityQueueItem(
      prisma,
      {
        provider: required(args, 'provider', 'Provider'),
        hotelId: required(args, 'hotel-id', 'Provider hotel/property ID'),
        roomType: required(args, 'room-type', 'Room type'),
        startDate: required(args, 'from', 'Start date'),
        endDate: required(args, 'to', 'End date'),
        availableRooms: args.rooms,
        availabilityStatus: args.status,
        reason: required(args, 'reason', 'Operational reason'),
        idempotencyKey: args['idempotency-key'],
      },
      actor,
    )
  }

  const id = required(args, 'id', 'Queue item ID')
  if (command === 'approve') {
    return approveAvailabilityQueueItem(prisma, id, { notes: args.notes || args.reason }, actor)
  }
  if (command === 'mark-sent') {
    return markAvailabilityQueueItemSent(
      prisma,
      id,
      {
        providerReference: required(args, 'reference', 'Provider confirmation/reference'),
        notes: args.notes,
      },
      actor,
    )
  }
  if (command === 'mark-failed') {
    return markAvailabilityQueueItemFailed(
      prisma,
      id,
      { errorMessage: required(args, 'reason', 'Failure reason') },
      actor,
    )
  }
  if (command === 'cancel') {
    return cancelAvailabilityQueueItem(
      prisma,
      id,
      { reason: required(args, 'reason', 'Cancellation reason') },
      actor,
    )
  }

  throw new Error(`Unknown command "${command}".`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = String(args._[0] || '').trim().toLowerCase()
  if (!command || command === 'help' || args.help) {
    console.log(helpText())
    return
  }

  loadEnvDefaults()
  const policy = getChannelSyncV2Policy(process.env)
  if (command === 'policy') {
    printJson(policy)
    return
  }

  if (policy.queueBackend !== 'hotel_ops_legacy') {
    throw new Error(
      'The Hotel Ops availability queue is disabled for this runtime. Use the Lite Channel Desk manual queue.',
    )
  }

  const prisma = createPrismaClient()
  try {
    printJson(await runCommand(prisma, command, args))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
