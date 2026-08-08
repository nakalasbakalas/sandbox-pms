/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { canReadOperationalEvent, requireOperationalEventPermission } from '../server/event-access.mjs'
import { listCashierFolios } from '../server/pms-service.mjs'
import { resolveRequestContext } from '../server/request-context.mjs'

const property = { id: 'property-cashier-a', code: 'SANDBOX', name: 'Sandbox Hotel', currency: 'THB' }
const otherProperty = { id: 'property-cashier-b', code: 'OTHER', name: 'Other Hotel', currency: 'USD' }
const actor = { id: 'cashier-a', propertyId: property.id, role: 'CASHIER' }

function cashierFolioFixture(overrides = {}) {
  return {
    id: 'folio-a',
    reservationId: 'reservation-a',
    status: 'OPEN',
    subtotalSatang: 12_345n,
    taxSatang: 0n,
    totalSatang: 12_345n,
    paidSatang: 4_500n,
    balanceSatang: 7_845n,
    createdAt: new Date('2026-07-19T01:02:03.000Z'),
    updatedAt: new Date('2026-07-19T02:03:04.000Z'),
    reservation: {
      checkIn: new Date('2026-07-20T00:00:00.000Z'),
      checkOut: new Date('2026-07-22T00:00:00.000Z'),
      guest: {
        firstName: 'Cashier',
        lastName: 'Guest',
        email: 'must-not-leak@example.test',
        phone: '+66999999999',
        idNumber: 'must-not-leak',
      },
      assignedRoom: { number: '101', notes: 'must-not-leak' },
    },
    charges: [{
      id: 'charge-a',
      createdAt: new Date('2026-07-19T01:00:00.000Z'),
      category: 'LAUNDRY',
      description: 'Laundry',
      quantity: 2,
      amountSatang: 1_000n,
      totalSatang: 2_000n,
      createdBy: 'Cashier A',
      amount: 10,
      total: 20,
      sourceEmailEvent: { rawText: 'must-not-leak', rawHeaders: { authorization: 'must-not-leak' } },
    }],
    payments: [{
      id: 'payment-a',
      createdAt: new Date('2026-07-19T01:30:00.000Z'),
      method: 'CARD',
      amountSatang: 4_500n,
      reference: 'CARD-123',
      processedBy: 'Cashier A',
      amount: 45,
      notes: 'must-not-leak',
      sourceEmailEvent: { rawText: 'must-not-leak' },
    }],
    ...overrides,
  }
}

function projectionPrisma(folios) {
  return {
    property: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { id: property.id }, 'the service resolves only the actor property')
        return property
      },
    },
    folio: {
      findMany: async (query) => {
        assert.deepEqual(query.where, { reservation: { propertyId: property.id } }, 'the folio query is property-scoped through its reservation')
        assert.equal(query.select.reservation.select.guest.select.email, undefined, 'cashier projection never requests guest email')
        assert.equal(query.select.reservation.select.assignedRoom.select.notes, undefined, 'cashier projection never requests room notes')
        assert.equal(query.select.charges.select.sourceEmailEvent, undefined, 'cashier projection never requests booking-email evidence')
        assert.equal(query.select.payments.select.sourceEmailEvent, undefined, 'cashier projection never requests payment source-email evidence')
        assert.deepEqual(query.select.charges.where, { void: false }, 'voided charges are excluded from current folio totals')
        return folios
      },
    },
  }
}

const projection = await listCashierFolios(projectionPrisma([cashierFolioFixture()]), actor)
assert.deepEqual(projection.property, { id: property.id, name: property.name, currency: property.currency })
assert.deepEqual(projection.folios, [{
  id: 'folio-a',
  reservationId: 'reservation-a',
  guestName: 'Cashier Guest',
  roomNumber: '101',
  checkIn: new Date('2026-07-20T00:00:00.000Z'),
  checkOut: new Date('2026-07-22T00:00:00.000Z'),
  status: 'OPEN',
  charges: [{
    id: 'charge-a',
    postedAt: new Date('2026-07-19T01:00:00.000Z'),
    category: 'LAUNDRY',
    description: 'Laundry',
    quantity: 2,
    unitPriceSatang: '1000',
    totalSatang: '2000',
    postedBy: 'Cashier A',
  }],
  payments: [{
    id: 'payment-a',
    postedAt: new Date('2026-07-19T01:30:00.000Z'),
    method: 'CARD',
    amountSatang: '4500',
    reference: '••••-123',
    receivedBy: 'Cashier A',
  }],
  subtotalSatang: '12345',
  taxSatang: '0',
  totalSatang: '12345',
  paidSatang: '4500',
  balanceSatang: '7845',
  createdAt: new Date('2026-07-19T01:02:03.000Z'),
  updatedAt: new Date('2026-07-19T02:03:04.000Z'),
}], 'cashier projection returns only its allowlisted exact-satang contract')

const serialized = JSON.stringify(projection)
for (const forbidden of ['must-not-leak', 'email', 'phone', 'idNumber', 'rawText', 'rawHeaders', 'amount"', 'total"', 'notes']) {
  assert.equal(serialized.includes(forbidden), false, `cashier projection excludes sensitive or legacy field: ${forbidden}`)
}

await assert.rejects(
  listCashierFolios(projectionPrisma([cashierFolioFixture({ balanceSatang: null })]), actor),
  { statusCode: 503 },
  'cashier projection fails closed when exact balance satang is missing',
)
await assert.rejects(
  listCashierFolios(projectionPrisma([cashierFolioFixture({ totalSatang: '12.34' })]), actor),
  { statusCode: 503 },
  'cashier projection fails closed when exact total satang is malformed',
)

const cashierRoute = resolveApiRouteContract('/api/cashier/folios')
assert.deepEqual(cashierRoute?.methods, ['GET'], 'cashier folio projection is an authenticated GET route')
assert.equal(cashierRoute?.tag, 'Finance')

const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
assert.match(source, /url\.pathname === '\/api\/cashier\/folios'[\s\S]{0,250}requirePermission\(user, 'view:cashier'\)/, 'cashier endpoint requires cashier view permission')
assert.match(source, /url\.pathname === '\/api\/events'[\s\S]{0,180}requireOperationalEventPermission\(user\)/, 'event stream permits the dedicated board-or-cashier guard')
assert.match(source, /if \(!canReadOperationalEvent\(liveContext\.actor, event\)\) continue/, 'event catch-up advances past but never emits identifiers outside the freshly revalidated actor permission filter')

assert.doesNotThrow(() => requireOperationalEventPermission({ role: 'CAFE_STAFF' }), 'cafe staff can subscribe to property-filtered operational events')
assert.throws(() => requireOperationalEventPermission({ role: 'UNKNOWN_ROLE' }), { statusCode: 403 }, 'staff without board or cashier permission cannot subscribe')
assert.equal(canReadOperationalEvent({ role: 'CAFE_STAFF' }, { aggregateType: 'folio' }), true, 'cashier-only staff receive folio invalidations')
assert.equal(canReadOperationalEvent({ role: 'CAFE_STAFF' }, { aggregateType: 'payment' }), true, 'cashier-only staff receive payment invalidations')
assert.equal(canReadOperationalEvent({ role: 'CAFE_STAFF' }, { aggregateType: 'message' }), false, 'cashier-only staff cannot observe message identifiers')
assert.equal(canReadOperationalEvent({ role: 'FRONT_DESK' }, { aggregateType: 'message' }), true, 'a role with messaging permission receives message invalidations')

function contextPrisma(membership) {
  return {
    property: { findUnique: async ({ where }) => where.code === property.code ? property : null },
    userPropertyMembership: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { userId_propertyId: { userId: 'cafe-user', propertyId: property.id } })
        return membership
      },
    },
  }
}

const cafeContext = await resolveRequestContext(
  contextPrisma({ id: 'membership-cafe', role: 'CAFE_STAFF', active: true }),
  { id: 'cafe-user', role: 'ADMIN' },
  { requestId: 'cashier-test-123', headers: {} },
)
assert.equal(cafeContext.actor.propertyId, property.id, 'event and cashier access retains the active property boundary')
assert.equal(cafeContext.actor.role, 'CAFE_STAFF', 'membership role overrides the global user role')
assert.doesNotThrow(() => requireOperationalEventPermission(cafeContext.actor))
await assert.rejects(
  resolveRequestContext(
    contextPrisma({ id: 'membership-disabled', role: 'CASHIER', active: false }),
    { id: 'cafe-user', role: 'CASHIER' },
    { requestId: 'cashier-test-123', headers: {} },
  ),
  { statusCode: 403 },
  'a missing or inactive property membership cannot gain cashier/event access',
)
await assert.rejects(
  resolveRequestContext(
    contextPrisma(null),
    { id: 'cafe-user', role: 'CASHIER' },
    { requestId: 'cashier-test-123', headers: {} },
  ),
  { statusCode: 403 },
  'a forged user without a property membership cannot gain cashier/event access',
)

assert.notEqual(property.id, otherProperty.id, 'the cross-property fixture is distinct')
console.log('Cashier projection service tests passed.')
