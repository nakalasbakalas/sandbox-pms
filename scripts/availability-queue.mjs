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
  npm run availability:queue -- create --provider agoda --hotel-id HOTEL123 \\
    --room-type DOUBLE --from 2026-07-11 --to 2026-07-15 --rooms 2 \\
    --reason "Reservation received; reduce sellable inventory" \\
    --actor-id USER_ID --actor-label "Hotel owner" --actor-role ADMIN

  npm run availability:queue -- list [--status PENDING_APPROVAL] [--limit 100]

  npm run availability:queue -- approve --id TASK_ID \\
    --notes "Approved against PMS inventory" \\
    --actor-id USER_ID --actor-label "Hotel manager" --actor-role MANAGER

  npm run availability:queue -- mark-sent --id TASK_ID \\
    --reference PROVIDER_CONFIRMATION --notes "Updated in partner portal" \\
    --actor-id USER_ID --actor-label "Hotel manager" --actor-role MANAGER

  npm run availability:queue -- mark-failed --id TASK_ID \\
    --reason "Partner portal unavailable" \\
    --actor-id USER_ID --actor-label "Hotel manager" --actor-role MANAGER

  npm run availability:queue -- cancel --id TASK_ID --reason "Superseded by newer inventory" \\
    --actor-id USER_ID --actor-label "Hotel manager" --actor-role MANAGER

  npm run availability:queue -- policy

Providers:
  booking | agoda | trip | expedia | channex

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

function actorFromArgs(args) {
  return {
    id: required(args, 'actor-id', 'Actor ID'),
    name: required(args, 'actor-label', 'Actor label'),
    role: required(args, 'actor-role', 'Actor role'),
  }
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

  const actor = actorFromArgs(args)
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
  if (command === 'policy') {
    printJson(await runCommand(null, command, args))
    return
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
