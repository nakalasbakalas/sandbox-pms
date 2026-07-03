/* global console, process */
import { loadEnvDefaults } from './env-utils.mjs'
import { parseDatabaseUrl } from './db-safety.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'

loadEnvDefaults()

const roomOpStatuses = ['AVAILABLE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER', 'BLOCKED']
const roomStatuses = [
  'VACANT_CLEAN',
  'VACANT_DIRTY',
  'CLEANING',
  'INSPECTED',
  'OCCUPIED_CLEAN',
  'OCCUPIED',
  'OCCUPIED_DIRTY',
]

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

function zeroCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]))
}

function incrementCount(target, key, count) {
  target[key] = (target[key] || 0) + count
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

function roomTypeKey(index, roomType, includeLabels) {
  if (includeLabels) return roomType.code
  return `ROOM_TYPE_${String(index + 1).padStart(2, '0')}`
}

async function buildPropertyProof(prisma, property, options) {
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId: property.id },
    select: { id: true, code: true, name: true },
    orderBy: [{ code: 'asc' }],
  })

  const [
    totalRooms,
    roomTypeStatusGroups,
    operationalStatusGroups,
    currentStatusGroups,
  ] = await Promise.all([
    prisma.room.count({ where: { propertyId: property.id } }),
    prisma.room.groupBy({
      by: ['roomTypeId', 'operationalStatus'],
      where: { propertyId: property.id },
      _count: { _all: true },
    }),
    prisma.room.groupBy({
      by: ['operationalStatus'],
      where: { propertyId: property.id },
      _count: { _all: true },
    }),
    prisma.room.groupBy({
      by: ['currentStatus'],
      where: { propertyId: property.id },
      _count: { _all: true },
    }),
  ])

  const countsByRoomType = new Map()
  for (const group of roomTypeStatusGroups) {
    const statusCounts = countsByRoomType.get(group.roomTypeId) || zeroCounts(roomOpStatuses)
    incrementCount(statusCounts, group.operationalStatus, group._count._all)
    countsByRoomType.set(group.roomTypeId, statusCounts)
  }

  const operationalStatusCounts = zeroCounts(roomOpStatuses)
  for (const group of operationalStatusGroups) {
    incrementCount(operationalStatusCounts, group.operationalStatus, group._count._all)
  }

  const currentStatusCounts = zeroCounts(roomStatuses)
  for (const group of currentStatusGroups) {
    incrementCount(currentStatusCounts, group.currentStatus, group._count._all)
  }

  const roomTypeRows = roomTypes.map((roomType, index) => {
    const operationalCounts = countsByRoomType.get(roomType.id) || zeroCounts(roomOpStatuses)
    const total = Object.values(operationalCounts).reduce((sum, count) => sum + count, 0)
    const row = {
      roomTypeKey: roomTypeKey(index, roomType, options.includeRoomTypeLabels),
      roomCount: total,
      operationalStatusCounts: operationalCounts,
    }
    if (options.includeRoomTypeLabels) row.roomTypeName = roomType.name
    return row
  })

  const propertyProof = {
    propertyCode: property.code,
    roomTypeCount: roomTypes.length,
    totalRoomCount: totalRooms,
    activeRoomCount: operationalStatusCounts.AVAILABLE,
    inactiveRoomCount: totalRooms - operationalStatusCounts.AVAILABLE,
    operationalStatusCounts,
    currentStatusCounts,
    roomTypes: roomTypeRows,
  }

  if (options.includePropertyName) propertyProof.propertyName = property.name
  return propertyProof
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for room inventory proof.')

  const propertyCode = argValue('--property-code')
  const includeRoomTypeLabels = hasFlag('--include-room-type-labels')
  const includePropertyName = hasFlag('--include-property-name')

  const prisma = createPrismaClient()
  try {
    const properties = await prisma.property.findMany({
      where: propertyCode ? { code: propertyCode } : undefined,
      select: { id: true, code: true, name: true },
      orderBy: [{ code: 'asc' }],
    })

    if (properties.length === 0) {
      fail(propertyCode ? `Property ${propertyCode} was not found.` : 'No properties were found.')
    }

    const propertyProofs = []
    for (const property of properties) {
      propertyProofs.push(await buildPropertyProof(prisma, property, {
        includePropertyName,
        includeRoomTypeLabels,
      }))
    }

    const output = {
      generatedAt: new Date().toISOString(),
      purpose: 'read-only aggregate room inventory proof',
      databaseTarget: databaseTargetSummary(process.env.DATABASE_URL),
      redaction: {
        roomNumbers: 'omitted',
        guestData: 'omitted',
        reservationData: 'omitted',
        userData: 'omitted',
        paymentData: 'omitted',
        databaseUrl: 'omitted',
        roomTypeLabels: includeRoomTypeLabels
          ? 'included because --include-room-type-labels was set'
          : 'redacted; use --include-room-type-labels only with owner approval',
      },
      limitations: [
        'This is aggregate read-only database evidence only.',
        'It does not prove the source of truth was owner-approved.',
        'It does not prove the inventory is not seed/demo data without matching import or owner evidence.',
      ],
      properties: propertyProofs,
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
