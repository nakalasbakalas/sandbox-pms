const EXPECTED_STAGING_DATABASE_NAME = 'sandbox_pms_lite_staging'

export const LITE_ROOM_TYPE_BASELINE = Object.freeze([
  Object.freeze({
    code: 'TWIN',
    name: 'Standard Twin',
    description: '2 single beds, 28 m2, mountain view, non-smoking. Amenities include TV, Wi-Fi, air-conditioning, and bathroom.',
    baseRate: 2000,
    baseRateSatang: 200_000,
    maxOccupancy: 2,
    standardOcc: 2,
  }),
  Object.freeze({
    code: 'DOUBLE',
    name: 'Superior Double',
    description: '1 double bed, 28 m2, non-smoking. Amenities include TV, Wi-Fi, air-conditioning, and bathroom.',
    baseRate: 2000,
    baseRateSatang: 200_000,
    maxOccupancy: 4,
    standardOcc: 2,
  }),
])

function room(number, roomTypeCode, notes) {
  return Object.freeze({
    number: String(number),
    floor: Number(String(number).charAt(0)),
    roomTypeCode,
    notes,
  })
}

const doubleRoomNumbers = [
  ...Array.from({ length: 11 }, (_, index) => 201 + index),
  ...Array.from({ length: 4 }, (_, index) => 301 + index),
]
const twinRoomNumbers = [
  ...Array.from({ length: 8 }, (_, index) => 212 + index),
  ...Array.from({ length: 7 }, (_, index) => 312 + index),
]

export const LITE_ROOM_BASELINE = Object.freeze([
  ...doubleRoomNumbers.map((number) => room(
    number,
    'DOUBLE',
    'Lite baseline Superior Double inventory; live occupancy state is not inferred.',
  )),
  ...twinRoomNumbers.map((number) => room(
    number,
    'TWIN',
    'Lite baseline Standard Twin inventory; live occupancy state is not inferred.',
  )),
])

function fail(message) {
  throw new Error(`Lite inventory baseline refused: ${message}`)
}

export function liteInventorySummary(rooms = LITE_ROOM_BASELINE) {
  const byRoomType = Object.fromEntries(LITE_ROOM_TYPE_BASELINE.map(({ code }) => [code, 0]))
  for (const roomSeed of rooms) {
    byRoomType[roomSeed.roomTypeCode] = (byRoomType[roomSeed.roomTypeCode] || 0) + 1
  }
  return {
    rooms: rooms.length,
    roomTypes: LITE_ROOM_TYPE_BASELINE.length,
    byRoomType,
  }
}

export function assertLiteStagingInventoryBoundary(env = process.env) {
  if (env.PMS_DEPLOYMENT_TIER !== 'staging') fail('PMS_DEPLOYMENT_TIER must be staging.')
  if (env.PMS_UI_VARIANT !== 'lite') fail('PMS_UI_VARIANT must be lite.')
  if (env.SEED_MODE !== 'prod-safe') fail('SEED_MODE must be prod-safe.')

  let databaseUrl
  try {
    databaseUrl = new URL(String(env.DATABASE_URL || ''))
  } catch {
    fail('DATABASE_URL is missing or invalid.')
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    fail('DATABASE_URL must use PostgreSQL.')
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''))
  if (databaseName !== EXPECTED_STAGING_DATABASE_NAME) {
    fail(`database name must be ${EXPECTED_STAGING_DATABASE_NAME}; received a different target.`)
  }
}

function validateBaselineDefinition() {
  const summary = liteInventorySummary()
  const roomNumbers = new Set(LITE_ROOM_BASELINE.map(({ number }) => number))
  if (summary.rooms !== 30 || summary.byRoomType.DOUBLE !== 15 || summary.byRoomType.TWIN !== 15) {
    fail('definition must contain exactly 30 rooms split into 15 DOUBLE and 15 TWIN rooms.')
  }
  if (roomNumbers.size !== summary.rooms) fail('definition contains duplicate room numbers.')
}

export async function applyLiteInventoryBaseline(prisma, { propertyCode = 'SANDBOX' } = {}) {
  validateBaselineDefinition()

  return prisma.$transaction(async (tx) => {
    const property = await tx.property.findUnique({
      where: { code: propertyCode },
      select: { id: true, code: true },
    })
    if (!property) fail(`property ${propertyCode} does not exist; seed property configuration first.`)

    const existingRooms = await tx.room.findMany({
      where: { propertyId: property.id },
      select: {
        id: true,
        number: true,
        floor: true,
        roomType: { select: { code: true } },
      },
    })
    const baselineByNumber = new Map(LITE_ROOM_BASELINE.map((roomSeed) => [roomSeed.number, roomSeed]))
    const unexpected = existingRooms.filter(({ number }) => !baselineByNumber.has(number))
    if (unexpected.length > 0) {
      fail(`property contains ${unexpected.length} room(s) outside the 30-room Lite baseline; no rooms were deleted.`)
    }

    const drifted = existingRooms.filter((existing) => {
      const expected = baselineByNumber.get(existing.number)
      return existing.floor !== expected.floor || existing.roomType.code !== expected.roomTypeCode
    })
    if (drifted.length > 0) {
      fail(`property contains ${drifted.length} baseline room(s) with different floor or room-type assignments; no assignments were changed.`)
    }

    const roomTypesByCode = new Map()
    for (const roomTypeSeed of LITE_ROOM_TYPE_BASELINE) {
      const roomType = await tx.roomType.upsert({
        where: {
          propertyId_code: {
            propertyId: property.id,
            code: roomTypeSeed.code,
          },
        },
        update: roomTypeSeed,
        create: {
          propertyId: property.id,
          ...roomTypeSeed,
        },
      })
      roomTypesByCode.set(roomType.code, roomType)
    }

    const existingNumbers = new Set(existingRooms.map(({ number }) => number))
    let createdRooms = 0
    for (const roomSeed of LITE_ROOM_BASELINE) {
      if (existingNumbers.has(roomSeed.number)) continue
      const roomType = roomTypesByCode.get(roomSeed.roomTypeCode)
      if (!roomType) fail(`room type ${roomSeed.roomTypeCode} was not created.`)
      await tx.room.create({
        data: {
          propertyId: property.id,
          roomTypeId: roomType.id,
          number: roomSeed.number,
          floor: roomSeed.floor,
          operationalStatus: 'AVAILABLE',
          currentStatus: 'VACANT_CLEAN',
          notes: roomSeed.notes,
        },
      })
      createdRooms += 1
    }

    const finalRooms = await tx.room.findMany({
      where: { propertyId: property.id },
      select: { number: true, roomType: { select: { code: true } } },
    })
    const finalSummary = liteInventorySummary(finalRooms.map(({ number, roomType }) => ({
      number,
      roomTypeCode: roomType.code,
    })))
    if (finalSummary.rooms !== 30 || finalSummary.byRoomType.DOUBLE !== 15 || finalSummary.byRoomType.TWIN !== 15) {
      fail('post-write verification did not find exactly 15 DOUBLE and 15 TWIN rooms.')
    }

    return {
      propertyCode: property.code,
      createdRooms,
      existingRooms: existingRooms.length,
      ...finalSummary,
    }
  })
}
