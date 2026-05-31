/* global console, process */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  databaseUrlContainsProductionMarker,
  redactDatabaseUrl,
} from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'

loadEnvDefaults()

const roomOpStatuses = new Set(['AVAILABLE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER', 'BLOCKED'])
const roomStatuses = new Set([
  'VACANT_CLEAN',
  'VACANT_DIRTY',
  'CLEANING',
  'INSPECTED',
  'OCCUPIED_CLEAN',
  'OCCUPIED',
  'OCCUPIED_DIRTY',
])

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

function normalizeRoomRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail(`rooms[${index}] must be an object.`)
  }

  const number = String(record.number || '').trim()
  const roomTypeCode = String(record.roomTypeCode || record.roomType || '').trim().toUpperCase()
  const floor = Number(record.floor)
  const operationalStatus = String(record.operationalStatus || 'AVAILABLE').trim().toUpperCase()
  const currentStatus = String(record.currentStatus || 'VACANT_CLEAN').trim().toUpperCase()
  const notes = record.notes === undefined || record.notes === null ? null : String(record.notes).trim() || null

  if (!number) fail(`rooms[${index}].number is required.`)
  if (!/^[A-Za-z0-9-]+$/.test(number)) fail(`rooms[${index}].number may only contain letters, numbers, and hyphens.`)
  if (!roomTypeCode) fail(`rooms[${index}].roomTypeCode is required.`)
  if (!Number.isInteger(floor) || floor < 0) fail(`rooms[${index}].floor must be a non-negative integer.`)
  if (!roomOpStatuses.has(operationalStatus)) fail(`rooms[${index}].operationalStatus is invalid.`)
  if (!roomStatuses.has(currentStatus)) fail(`rooms[${index}].currentStatus is invalid.`)

  return {
    number,
    roomTypeCode,
    floor,
    operationalStatus,
    currentStatus,
    notes,
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Room import file must contain a JSON object.')
  }

  const propertyCode = String(payload.propertyCode || '').trim()
  if (!propertyCode) fail('propertyCode is required.')
  if (!Array.isArray(payload.rooms) || payload.rooms.length === 0) {
    fail('rooms must be a non-empty array.')
  }

  const seenNumbers = new Set()
  const rooms = payload.rooms.map((record, index) => {
    const room = normalizeRoomRecord(record, index)
    if (seenNumbers.has(room.number)) fail(`Duplicate room number in import file: ${room.number}.`)
    seenNumbers.add(room.number)
    return room
  })

  return { propertyCode, rooms }
}

async function loadPayload(path) {
  const absolutePath = resolve(path)
  const raw = await readFile(absolutePath, 'utf8')
  try {
    return validatePayload(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) fail(`Invalid JSON in ${absolutePath}: ${error.message}`)
    throw error
  }
}

async function main() {
  const file = argValue('--file')
  if (!file) fail('Usage: npm run rooms:import -- --file ./ops/rooms.production.json --confirm')
  if (!hasFlag('--confirm')) fail('Room import requires explicit --confirm.')
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for room import.')

  const productionLike = process.env.NODE_ENV === 'production' ||
    Boolean(databaseUrlContainsProductionMarker(process.env.DATABASE_URL))
  if (productionLike && process.env.ALLOW_PROD_ROOM_ONBOARDING !== 'true') {
    fail('Production room onboarding requires ALLOW_PROD_ROOM_ONBOARDING=true.')
  }

  const payload = await loadPayload(file)
  console.log(`Importing ${payload.rooms.length} room records into ${redactDatabaseUrl(process.env.DATABASE_URL)}.`)

  const prisma = createPrismaClient()
  try {
    const property = await prisma.property.findUnique({ where: { code: payload.propertyCode } })
    if (!property) fail(`Property ${payload.propertyCode} does not exist. Run prod-safe seed first.`)

    const roomTypeCodes = [...new Set(payload.rooms.map((room) => room.roomTypeCode))]
    const roomTypes = await prisma.roomType.findMany({
      where: {
        propertyId: property.id,
        code: { in: roomTypeCodes },
      },
    })
    const roomTypeByCode = new Map(roomTypes.map((roomType) => [roomType.code, roomType]))
    const missingRoomTypes = roomTypeCodes.filter((code) => !roomTypeByCode.has(code))
    if (missingRoomTypes.length > 0) {
      fail(`Room type(s) missing for property ${payload.propertyCode}: ${missingRoomTypes.join(', ')}. Run prod-safe seed or configure room types first.`)
    }

    const existingRooms = await prisma.room.findMany({
      where: {
        propertyId: property.id,
        number: { in: payload.rooms.map((room) => room.number) },
      },
    })
    const existingByNumber = new Map(existingRooms.map((room) => [room.number, room]))

    for (const room of payload.rooms) {
      const existing = existingByNumber.get(room.number)
      if (!existing?.currentReservation) continue
      if (existing.operationalStatus !== room.operationalStatus || existing.currentStatus !== room.currentStatus) {
        fail(`Room ${room.number} has current reservation ${existing.currentReservation}; refusing to change live status fields.`)
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const room of payload.rooms) {
        const roomType = roomTypeByCode.get(room.roomTypeCode)
        await tx.room.upsert({
          where: {
            propertyId_number: {
              propertyId: property.id,
              number: room.number,
            },
          },
          update: {
            roomTypeId: roomType.id,
            floor: room.floor,
            operationalStatus: room.operationalStatus,
            notes: room.notes,
          },
          create: {
            propertyId: property.id,
            roomTypeId: roomType.id,
            number: room.number,
            floor: room.floor,
            operationalStatus: room.operationalStatus,
            currentStatus: room.currentStatus,
            notes: room.notes,
          },
        })
      }
    })

    console.log('Room import completed.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
