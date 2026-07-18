/* global console */
import assert from 'node:assert/strict'
import { createOpenApiDocument } from '../server/openapi.mjs'
import { getFrontDeskBoard, resolveFrontDeskBoardRange } from '../server/pms-service.mjs'

const property = {
  id: 'property-board',
  code: 'SANDBOX',
  name: 'Sandbox Hotel',
  timezone: 'Asia/Bangkok',
  currency: 'THB',
  defaultCheckIn: '14:00',
  defaultCheckOut: '11:00',
  extraGuestFee: 300,
  extraGuestFeeSatang: 30_000n,
  childFee: 150,
  childFeeSatang: 15_000n,
  taxRate: 7,
  taxRateBasisPoints: 700,
}

const range = resolveFrontDeskBoardRange({ from: '2026-07-18', to: '2026-08-01' })
assert.deepEqual(
  {
    from: range.from,
    to: range.to,
    durationDays: range.durationDays,
  },
  {
    from: '2026-07-18',
    to: '2026-08-01',
    durationDays: 14,
  },
  'board range uses an inclusive start and exclusive end',
)
assert.equal(resolveFrontDeskBoardRange({}), null, 'omitting the range preserves the legacy unbounded board request')
assert.throws(
  () => resolveFrontDeskBoardRange({ from: '2026-07-18' }),
  /requires both from and to/i,
  'partial board ranges are rejected',
)
assert.throws(
  () => resolveFrontDeskBoardRange({ from: '2026-02-30', to: '2026-03-02' }),
  /valid calendar date/i,
  'impossible calendar dates are rejected',
)
assert.throws(
  () => resolveFrontDeskBoardRange({ from: '2026-07-18', to: '2026-07-18' }),
  /must be after/i,
  'empty board ranges are rejected',
)
assert.throws(
  () => resolveFrontDeskBoardRange({ from: '2026-01-01', to: '2026-04-05' }),
  /cannot exceed 93 days/i,
  'oversized board ranges are rejected',
)

const calls = {}
const reservations = [
  {
    id: 'segment-a',
    assignedRoomId: 'room-101',
    checkIn: new Date('2026-07-18T00:00:00.000Z'),
    checkOut: new Date('2026-07-20T00:00:00.000Z'),
  },
  {
    id: 'segment-b',
    assignedRoomId: 'room-101',
    checkIn: new Date('2026-07-20T00:00:00.000Z'),
    checkOut: new Date('2026-07-23T00:00:00.000Z'),
  },
]
const fixture = {
  property: {
    findUnique: async ({ where }) => {
      calls.property = where
      return where.id === property.id ? property : null
    },
  },
  roomType: {
    findMany: async (query) => {
      calls.roomTypes = query
      return [
        {
          id: 'type-family',
          propertyId: property.id,
          code: 'FAMILY',
          name: 'Family Suite',
          baseRate: 2_400,
          baseRateSatang: 240_000n,
          standardOcc: 2,
          maxOccupancy: 4,
        },
        {
          id: 'type-twin',
          propertyId: property.id,
          code: 'TWIN',
          name: 'Twin Room',
          baseRate: 1_500,
          baseRateSatang: 150_000n,
          standardOcc: 2,
          maxOccupancy: 2,
        },
      ]
    },
  },
  room: {
    findMany: async (query) => {
      calls.rooms = query
      return [{ id: 'room-101', propertyId: property.id, number: '101', roomType: { code: 'FAMILY' } }]
    },
  },
  reservation: {
    findMany: async (query) => {
      calls.reservations = query
      return reservations
    },
  },
  roomDateInventory: {
    findMany: async (query) => {
      calls.inventoryBlocks = query
      return [{
        id: 'block-101-2026-07-21',
        roomId: 'room-101',
        date: new Date('2026-07-21T00:00:00.000Z'),
        status: 'BLOCKED',
        notes: 'Maintenance',
        updatedAt: new Date('2026-07-17T00:00:00.000Z'),
      }]
    },
  },
}

const board = await getFrontDeskBoard(
  fixture,
  { id: 'manager-1', propertyId: property.id },
  { from: '2026-07-18', to: '2026-08-01' },
)

assert.deepEqual(calls.property, { id: property.id }, 'board resolves the property from authenticated context')
assert.deepEqual(calls.roomTypes.where, { propertyId: property.id }, 'dynamic room types are property scoped')
assert.deepEqual(calls.rooms.where, { propertyId: property.id }, 'rooms are property scoped')
assert.deepEqual(
  calls.reservations.where,
  {
    propertyId: property.id,
    status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD'] },
    checkIn: { lt: new Date('2026-08-01T00:00:00.000Z') },
    checkOut: { gt: new Date('2026-07-18T00:00:00.000Z') },
  },
  'reservations use overlap semantics without clipping stays at the range boundaries',
)
assert.deepEqual(
  calls.inventoryBlocks.where,
  {
    propertyId: property.id,
    date: {
      gte: new Date('2026-07-18T00:00:00.000Z'),
      lt: new Date('2026-08-01T00:00:00.000Z'),
    },
    status: { in: ['BLOCKED', 'OUT_OF_SERVICE'] },
  },
  'inventory blocks are property scoped and bounded to the requested range',
)
assert.deepEqual(board.reservations.map((reservation) => reservation.id), ['segment-a', 'segment-b'], 'all returned reservation segments remain distinct')
assert.deepEqual(board.roomTypes.map((roomType) => roomType.code), ['FAMILY', 'TWIN'], 'room types are returned from server configuration')
assert.deepEqual(
  board.roomTypes.map(({ code, baseRate, baseRateSatang, standardOcc, maxOccupancy }) => ({
    code,
    baseRate,
    baseRateSatang,
    standardOcc,
    maxOccupancy,
  })),
  [
    { code: 'FAMILY', baseRate: 2_400, baseRateSatang: 240_000n, standardOcc: 2, maxOccupancy: 4 },
    { code: 'TWIN', baseRate: 1_500, baseRateSatang: 150_000n, standardOcc: 2, maxOccupancy: 2 },
  ],
  'dynamic room types retain their rate and occupancy fields',
)
assert.equal(board.inventoryBlocks.length, 1, 'date-level inventory blocks are included')
assert.deepEqual(board.propertyDisplay, {
  id: property.id,
  code: property.code,
  name: property.name,
  timezone: property.timezone,
  currency: property.currency,
  defaultCheckIn: property.defaultCheckIn,
  defaultCheckOut: property.defaultCheckOut,
  extraGuestFee: property.extraGuestFee,
  extraGuestFeeSatang: '30000',
  childFee: property.childFee,
  childFeeSatang: '15000',
  taxRate: property.taxRate,
  taxRateBasisPoints: property.taxRateBasisPoints,
}, 'board returns only the property fields needed for display')
assert.deepEqual(board.range, {
  from: '2026-07-18',
  to: '2026-08-01',
  durationDays: 14,
  semantics: 'FROM_INCLUSIVE_TO_EXCLUSIVE',
}, 'board describes the applied range contract')

let legacyInventoryQueried = false
const legacyFixture = {
  ...fixture,
  roomDateInventory: {
    findMany: async () => {
      legacyInventoryQueried = true
      return []
    },
  },
}
const legacyBoard = await getFrontDeskBoard(legacyFixture, { propertyId: property.id })
assert.equal(legacyBoard.range, null, 'legacy board requests remain unbounded')
assert.equal(legacyBoard.inventoryBlocks.length, 0, 'legacy board responses add an empty compatible inventory block collection')
assert.equal(legacyInventoryQueried, false, 'legacy requests do not trigger an unbounded inventory scan')
assert.equal('checkIn' in calls.reservations.where, false, 'legacy reservation queries remain unbounded')

const openApi = createOpenApiDocument({ serverUrl: 'https://pms.example.test' })
const boardParameters = openApi.paths['/api/front-desk/board'].get.parameters
assert.deepEqual(boardParameters.map((parameter) => parameter.name), ['from', 'to'], 'OpenAPI publishes both board range parameters')
assert.equal(boardParameters[0].schema.format, 'date', 'OpenAPI declares the board range as ISO dates')

console.log('Front desk board range contract tests passed.')
