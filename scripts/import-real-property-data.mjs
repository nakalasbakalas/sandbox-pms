/* global console, process */
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  databaseUrlContainsProductionMarker,
  redactDatabaseUrl,
} from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'

loadEnvDefaults()

const defaultDataFile = './ops/sandbox-hotel.real-data.json'
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
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function fail(message) {
  throw new Error(message)
}

function requiredString(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) fail(`${label} is required.`)
  return normalized
}

function nullableString(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function requiredNumber(value, label, min = 0) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min) {
    fail(`${label} must be a number greater than or equal to ${min}.`)
  }
  return number
}

function optionalNumber(value, label) {
  if (value === undefined || value === null || value === '') return null
  return requiredNumber(value, label)
}

function requiredTime(value, label) {
  const normalized = requiredString(value, label)
  if (!/^\d{2}:\d{2}$/.test(normalized)) fail(`${label} must use HH:mm format.`)
  return normalized
}

function normalizeProperty(property) {
  return {
    code: requiredString(property?.code, 'property.code').toUpperCase(),
    name: requiredString(property?.name, 'property.name'),
    address: nullableString(property?.address),
    phone: nullableString(property?.phone),
    email: nullableString(property?.email)?.toLowerCase() || null,
    publicWebsite: nullableString(property?.publicWebsite),
    lineId: nullableString(property?.lineId),
    lineUrl: nullableString(property?.lineUrl),
    supportHours: nullableString(property?.supportHours),
    reservationAlertEmail: nullableString(property?.reservationAlertEmail)?.toLowerCase() || null,
    timezone: requiredString(property?.timezone, 'property.timezone'),
    defaultCheckIn: requiredTime(property?.defaultCheckIn, 'property.defaultCheckIn'),
    defaultCheckOut: requiredTime(property?.defaultCheckOut, 'property.defaultCheckOut'),
    currency: requiredString(property?.currency, 'property.currency').toUpperCase(),
    taxRate: 0,
    extraGuestFee: requiredNumber(property?.extraGuestFee ?? 0, 'property.extraGuestFee'),
    childFee: requiredNumber(property?.childFee ?? 0, 'property.childFee'),
    inventoryMinimumRate: optionalNumber(property?.inventoryMinimumRate, 'property.inventoryMinimumRate'),
  }
}

function normalizeRoomType(record, index) {
  return {
    code: requiredString(record?.code, `roomTypes[${index}].code`).toUpperCase(),
    sourceCode: nullableString(record?.sourceCode),
    name: requiredString(record?.name, `roomTypes[${index}].name`),
    description: nullableString(record?.description),
    baseOccupancy: requiredNumber(record?.baseOccupancy, `roomTypes[${index}].baseOccupancy`, 1),
    maxOccupancy: requiredNumber(record?.maxOccupancy, `roomTypes[${index}].maxOccupancy`, 1),
    baseRate: requiredNumber(record?.baseRate, `roomTypes[${index}].baseRate`, 1),
    minimumRate: optionalNumber(record?.minimumRate, `roomTypes[${index}].minimumRate`),
    extraAdultFee: optionalNumber(record?.extraAdultFee, `roomTypes[${index}].extraAdultFee`),
    childFee: optionalNumber(record?.childFee, `roomTypes[${index}].childFee`),
    ratePlan: nullableString(record?.ratePlan),
    rateSource: nullableString(record?.rateSource),
  }
}

function normalizeRoom(record, index, roomTypeCodes) {
  const number = requiredString(record?.number, `rooms[${index}].number`)
  if (!/^[A-Za-z0-9-]+$/.test(number)) {
    fail(`rooms[${index}].number may only contain letters, numbers, and hyphens.`)
  }

  const roomTypeCode = requiredString(record?.roomTypeCode, `rooms[${index}].roomTypeCode`).toUpperCase()
  if (!roomTypeCodes.has(roomTypeCode)) {
    fail(`rooms[${index}].roomTypeCode ${roomTypeCode} does not match a configured room type.`)
  }

  const floor = requiredNumber(record?.floor, `rooms[${index}].floor`, 0)
  if (!Number.isInteger(floor)) fail(`rooms[${index}].floor must be an integer.`)

  const operationalStatus = requiredString(record?.operationalStatus || 'AVAILABLE', `rooms[${index}].operationalStatus`).toUpperCase()
  if (!roomOpStatuses.has(operationalStatus)) {
    fail(`rooms[${index}].operationalStatus is invalid.`)
  }

  const currentStatus = requiredString(record?.currentStatus || 'VACANT_CLEAN', `rooms[${index}].currentStatus`).toUpperCase()
  if (!roomStatuses.has(currentStatus)) {
    fail(`rooms[${index}].currentStatus is invalid.`)
  }

  return {
    number,
    roomTypeCode,
    floor,
    operationalStatus,
    currentStatus,
    notes: nullableString(record?.notes),
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Real property data file must contain a JSON object.')
  }

  const property = normalizeProperty(payload.property)
  const roomTypes = Array.isArray(payload.roomTypes)
    ? payload.roomTypes.map(normalizeRoomType)
    : fail('roomTypes must be an array.')
  if (roomTypes.length === 0) fail('At least one room type is required.')

  const roomTypeCodes = new Set()
  for (const roomType of roomTypes) {
    if (roomTypeCodes.has(roomType.code)) fail(`Duplicate room type code: ${roomType.code}.`)
    roomTypeCodes.add(roomType.code)
    if (roomType.maxOccupancy < roomType.baseOccupancy) {
      fail(`${roomType.code} maxOccupancy must be at least baseOccupancy.`)
    }
  }

  const rooms = Array.isArray(payload.rooms)
    ? payload.rooms.map((record, index) => normalizeRoom(record, index, roomTypeCodes))
    : fail('rooms must be an array.')
  if (rooms.length === 0) fail('At least one confirmed room is required.')

  const roomNumbers = new Set()
  for (const room of rooms) {
    if (roomNumbers.has(room.number)) fail(`Duplicate room number: ${room.number}.`)
    roomNumbers.add(room.number)
  }

  return {
    raw: payload,
    property,
    roomTypes,
    rooms,
  }
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

async function assertSafeTarget(prisma, payload) {
  const productionLike = process.env.NODE_ENV === 'production' ||
    Boolean(databaseUrlContainsProductionMarker(process.env.DATABASE_URL))

  if (productionLike) {
    fail('Real property data import is staging/local only. Refusing production-like DATABASE_URL.')
  }

  if (payload.raw.currentOperationalState?.productionCutoverSafe === true) {
    fail('This importer is for staging/local configuration only; production cutover needs a dedicated migration runbook.')
  }

  const counts = {
    reservations: await prisma.reservation.count(),
    guests: await prisma.guest.count(),
    folios: await prisma.folio.count(),
    payments: await prisma.payment.count(),
    charges: await prisma.charge.count(),
  }

  const populated = Object.entries(counts).filter(([, count]) => count > 0)
  if (populated.length > 0) {
    const details = populated.map(([name, count]) => `${name}: ${count}`).join(', ')
    fail(`Refusing to replace setup data while operational records exist (${details}). Use a clean staging/local database.`)
  }
}

function propertyConfiguration(payload) {
  return {
    taxConfiguration: payload.raw.taxes || { enabled: false, pricesIncludeTax: false, taxes: [] },
    policies: payload.raw.policies || {},
    operationalSettings: {
      rates: payload.raw.rates || {},
      paymentMethods: payload.raw.paymentMethods || {},
      accounting: payload.raw.accounting || {},
      staff: payload.raw.staff || [],
      operations: payload.raw.operations || {},
      currentOperationalState: payload.raw.currentOperationalState || {},
      unavailableItems: payload.raw.unavailableItems || [],
    },
    sourceNotes: payload.raw.sourceNotes || {},
  }
}

async function importRealData(prisma, payload) {
  const configuration = propertyConfiguration(payload)

  return prisma.$transaction(async (tx) => {
    const property = await tx.property.upsert({
      where: { code: payload.property.code },
      update: {
        ...payload.property,
        ...configuration,
      },
      create: {
        ...payload.property,
        ...configuration,
      },
    })

    await tx.rateCalendar.deleteMany({ where: { propertyId: property.id } })
    await tx.rateRule.deleteMany({ where: { propertyId: property.id } })
    await tx.room.deleteMany({ where: { propertyId: property.id } })
    await tx.roomType.deleteMany({ where: { propertyId: property.id } })

    const createdRoomTypes = new Map()
    for (const roomType of payload.roomTypes) {
      const created = await tx.roomType.create({
        data: {
          propertyId: property.id,
          code: roomType.code,
          name: roomType.name,
          description: roomType.description,
          baseRate: roomType.baseRate,
          maxOccupancy: roomType.maxOccupancy,
          standardOcc: roomType.baseOccupancy,
        },
      })
      createdRoomTypes.set(roomType.code, created)
    }

    for (const room of payload.rooms) {
      const roomType = createdRoomTypes.get(room.roomTypeCode)
      await tx.room.create({
        data: {
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

    return {
      property,
      roomTypeCount: createdRoomTypes.size,
      roomCount: payload.rooms.length,
      staffCount: payload.raw.staff?.length || 0,
    }
  })
}

async function main() {
  const file = argValue('--file') || defaultDataFile
  const dryRun = hasFlag('--dry-run')
  if (!hasFlag('--confirm') && !dryRun) {
    fail(`Usage: npm run real-data:import -- --file ${defaultDataFile} --confirm`)
  }

  const payload = await loadPayload(file)
  if (dryRun) {
    console.log(`Validated real property data file: ${resolve(file)}`)
    console.log(`  Property: ${payload.property.name}`)
    console.log(`  Room types: ${payload.roomTypes.length}`)
    console.log(`  Confirmed rooms: ${payload.rooms.length}`)
    console.log(`  Staff roster labels: ${payload.raw.staff?.length || 0}`)
    console.log('  Database import skipped because --dry-run was supplied.')
    return
  }

  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required for real property data import.')

  console.log(`Importing real property data from ${resolve(file)} into ${redactDatabaseUrl(process.env.DATABASE_URL)}.`)
  console.log('Production cutover is intentionally blocked by this staging/local importer.')

  const prisma = new PrismaClient()
  try {
    await assertSafeTarget(prisma, payload)
    const result = await importRealData(prisma, payload)
    console.log('Real property data import completed.')
    console.log(`  Property: ${result.property.name}`)
    console.log(`  Room types: ${result.roomTypeCount}`)
    console.log(`  Confirmed rooms: ${result.roomCount}`)
    console.log(`  Staff roster labels: ${result.staffCount}`)
    console.log('  Staff users: unchanged; create login users only when emails and credential policy are supplied.')
    console.log('  Production blockers were stored in Property.operationalSettings.unavailableItems.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
