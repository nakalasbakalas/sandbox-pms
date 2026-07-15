import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { getLiteSettings } from '../server/lite-service.mjs'

test('Lite Settings uses a bounded configuration projection without operational rows', async () => {
  const calls = []
  const prisma = {
    property: {
      findUnique: async () => ({
        id: 'property-sandbox',
        code: 'SANDBOX',
        name: 'Sandbox Hotel',
        timezone: 'Asia/Bangkok',
        currency: 'THB',
        defaultCheckIn: '14:00',
        defaultCheckOut: '12:00',
      }),
    },
    reservation: {},
    roomType: {
      findMany: async () => [{
        id: 'type-double',
        code: 'DOUBLE',
        name: 'Double',
        baseRateSatang: 200_000,
        maxOccupancy: 2,
        standardOcc: 2,
        _count: { rooms: 1 },
      }],
    },
    room: {
      findMany: async () => [{
        id: 'room-201',
        roomTypeId: 'type-double',
        number: '201',
        floor: 2,
        operationalStatus: 'AVAILABLE',
        currentStatus: 'INSPECTED',
        blockedUntil: null,
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        roomType: { id: 'type-double', code: 'DOUBLE', name: 'Double', baseRateSatang: 200_000 },
      }],
    },
    bookingEmailSource: {
      findFirst: async () => ({
        enabled: true,
        watchExpiresAt: new Date('2026-07-16T00:00:00.000Z'),
        lastSyncAt: null,
        lastPushAt: null,
        lastReconciledAt: null,
        lastError: null,
        consecutiveFailures: 0,
      }),
    },
    manualChannelConnection: { findMany: async () => [] },
    bookingEmailPushDelivery: {
      count: async (input) => {
        calls.push(input)
        return input.where.status === 'FAILED' ? 1 : 2
      },
    },
    bookingEmailEvent: new Proxy({}, { get: () => { throw new Error('Settings must not query booking-email events.') } }),
    manualChannelTask: new Proxy({}, { get: () => { throw new Error('Settings must not query manual tasks.') } }),
    reservationLog: new Proxy({}, { get: () => { throw new Error('Settings must not query reservation audit rows.') } }),
  }

  const result = await getLiteSettings(prisma, {
    now: '2026-07-15T00:00:00.000Z',
    credentialStatus: { configured: true, missing: [] },
    pubsubConfig: { enabled: true, missing: [] },
  })

  assert.equal(result.property.id, 'property-sandbox')
  assert.equal(result.roomTypes[0].roomCount, 1)
  assert.equal(result.rooms[0].number, '201')
  assert.equal(result.syncHealth.pendingDeliveries, 2)
  assert.equal(result.syncHealth.failedDeliveries, 1)
  assert.equal(result.connections.length, 3)
  assert.equal(Object.hasOwn(result, 'reviewEvents'), false)
  assert.equal(Object.hasOwn(result, 'tasks'), false)
  assert.equal(Object.hasOwn(result, 'pendingReviewEmail'), false)
  assert.equal(calls.length, 2)
})

test('Lite Settings API contract is authenticated GET-only', () => {
  assert.deepEqual(resolveApiRouteContract('/api/lite/v1/settings'), { methods: ['GET'], allow: 'GET' })
})
