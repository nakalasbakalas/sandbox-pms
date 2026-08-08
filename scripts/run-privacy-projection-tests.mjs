/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  projectBookingEmailSyncHttpResponse,
  projectGuestResponse,
  projectReservationResponse,
} from '../server/pms-response-projections.mjs'
import { listGuests, listReservations } from '../server/pms-service.mjs'

const property = { id: 'property-a', name: 'Sandbox Hotel', currency: 'THB' }
const actors = {
  admin: { id: 'admin-a', propertyId: property.id, role: 'ADMIN' },
  manager: { id: 'manager-a', propertyId: property.id, role: 'MANAGER' },
  frontDesk: { id: 'front-desk-a', propertyId: property.id, role: 'FRONT_DESK' },
  cashier: { id: 'cashier-a', propertyId: property.id, role: 'CASHIER' },
  housekeeping: { id: 'housekeeping-a', propertyId: property.id, role: 'HOUSEKEEPING' },
  cafe: { id: 'cafe-a', propertyId: property.id, role: 'CAFE_STAFF' },
}

const forbiddenBody = 'MUST_NOT_LEAK_RAW_EMAIL_BODY'
const forbiddenHeader = 'MUST_NOT_LEAK_RAW_EMAIL_HEADER'
const forbiddenFingerprint = 'MUST_NOT_LEAK_REFERENCE_FINGERPRINT'
const forbiddenPaymentReference = 'MUST_NOT_LEAK_PAYMENT_REFERENCE'
const forbiddenIdentity = 'MUST_NOT_LEAK_FULL_IDENTITY'

function reservationFixture() {
  const guest = {
    id: 'guest-a',
    propertyId: property.id,
    firstName: 'Ada',
    lastName: 'Guest',
    email: 'ada@example.test',
    phone: '+6612345678',
    nationality: 'TH',
    idType: 'PASSPORT',
    idNumber: forbiddenIdentity,
    vipStatus: true,
    notes: 'Front desk guest note',
    rawText: forbiddenBody,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  }
  return {
    id: 'reservation-a',
    confirmationCode: 'SBX-PRIVACY-1',
    propertyId: property.id,
    guestId: guest.id,
    roomTypeId: 'room-type-a',
    assignedRoomId: 'room-a',
    checkIn: new Date('2026-08-10T00:00:00.000Z'),
    checkOut: new Date('2026-08-12T00:00:00.000Z'),
    actualCheckIn: null,
    actualCheckOut: null,
    status: 'CONFIRMED',
    adults: 2,
    children: 0,
    childAges: [],
    source: 'EMAIL',
    channelRef: 'CHANNEL-123',
    sourceEmailEventId: 'email-event-a',
    notes: 'Reservation note',
    specialRequests: 'Late arrival',
    ratePerNight: 1_500,
    ratePerNightSatang: 150_000n,
    totalAmount: 3_000,
    totalAmountSatang: 300_000n,
    depositAmount: 900,
    depositAmountSatang: 90_000n,
    depositPaid: true,
    guest,
    roomType: { id: 'room-type-a', code: 'TWIN', name: 'Twin', standardOcc: 2, maxOccupancy: 2, internalNotes: forbiddenBody },
    assignedRoom: { id: 'room-a', number: '101', floor: 1, currentStatus: 'VACANT_CLEAN', operationalStatus: 'AVAILABLE', notes: forbiddenBody },
    sourceEmailEvent: { rawText: forbiddenBody, rawHeaders: { authorization: forbiddenHeader } },
    bookingEmailEvents: [{ rawText: forbiddenBody, rawHeaders: { authorization: forbiddenHeader } }],
    folio: {
      id: 'folio-a',
      reservationId: 'reservation-a',
      subtotal: 3_000,
      subtotalSatang: 300_000n,
      tax: 0,
      taxSatang: 0n,
      total: 3_000,
      totalSatang: 300_000n,
      paid: 900,
      paidSatang: 90_000n,
      balance: 2_100,
      balanceSatang: 210_000n,
      status: 'OPEN',
      charges: [{
        id: 'charge-a', folioId: 'folio-a', date: new Date('2026-08-10T00:00:00.000Z'), category: 'ROOM', description: 'Room',
        amount: 1_500, amountSatang: 150_000n, quantity: 2, total: 3_000, totalSatang: 300_000n, void: false,
        createdBy: 'user-a', createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        sourceEmailEvent: { rawText: forbiddenBody },
      }],
      payments: [{
        id: 'payment-a', folioId: 'folio-a', amount: 900, amountSatang: 90_000n, method: 'CARD',
        reference: forbiddenPaymentReference, referenceFingerprint: forbiddenFingerprint,
        receivedAt: new Date('2026-08-01T00:00:00.000Z'), processedBy: 'user-a',
        createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        sourceEmailEvent: { rawText: forbiddenBody, rawHeaders: { authorization: forbiddenHeader } },
      }],
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    },
    rawText: forbiddenBody,
    rawHeaders: { authorization: forbiddenHeader },
    referenceFingerprint: forbiddenFingerprint,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  }
}

function serialized(value) {
  return JSON.stringify(value, (_key, child) => typeof child === 'bigint' ? child.toString() : child)
}

function assertForbiddenValuesAbsent(value, label) {
  const json = serialized(value)
  for (const forbidden of [forbiddenBody, forbiddenHeader, forbiddenFingerprint, forbiddenPaymentReference, forbiddenIdentity]) {
    assert.equal(json.includes(forbidden), false, `${label} excludes ${forbidden}`)
  }
  for (const forbiddenKey of ['rawText', 'rawHeaders', 'referenceFingerprint', 'sourceEmailEvent', 'bookingEmailEvents', 'idNumber']) {
    assert.equal(json.includes(`"${forbiddenKey}"`), false, `${label} excludes key ${forbiddenKey}`)
  }
}

const adminReservation = projectReservationResponse(reservationFixture(), actors.admin)
assert.equal(adminReservation.guest.email, 'ada@example.test', 'administrators retain guest contact needed for front-office work')
assert.equal(adminReservation.guest.identityRecorded, true, 'generic DTO reports identity presence without returning the identity value')
assert.equal(adminReservation.notes, 'Reservation note', 'administrators retain operational reservation notes')
assert.equal(adminReservation.folio.payments[0].amountSatang, 90_000n, 'generic finance-capable DTO retains payment amount')
assert.equal('reference' in adminReservation.folio.payments[0], false, 'generic reservation DTO never returns a full payment reference')
assertForbiddenValuesAbsent(adminReservation, 'admin reservation')

const cashierReservation = projectReservationResponse(reservationFixture(), actors.cashier)
assert.equal(cashierReservation.folio.balanceSatang, 210_000n, 'cashiers retain financial balance data')
assert.equal(cashierReservation.guest.firstName, 'Ada', 'cashiers retain guest name for folio matching')
for (const field of ['email', 'phone', 'nationality', 'idType', 'identityRecorded', 'blacklisted', 'notes']) {
  assert.equal(field in cashierReservation.guest, false, `cashier guest DTO excludes ${field}`)
}
assert.equal('notes' in cashierReservation, false, 'cashier generic reservation excludes reservation notes')
assertForbiddenValuesAbsent(cashierReservation, 'cashier reservation')

const housekeepingReservation = projectReservationResponse(reservationFixture(), actors.housekeeping)
assert.equal(housekeepingReservation.assignedRoom.number, '101', 'housekeeping retains room assignment')
assert.equal(housekeepingReservation.guest.firstName, 'Ada', 'housekeeping retains the guest name needed for occupied-room context')
assert.equal('folio' in housekeepingReservation, false, 'housekeeping receives no finance graph')
assert.equal('specialRequests' in housekeepingReservation, false, 'housekeeping receives no broad reservation notes graph')
assert.equal('email' in housekeepingReservation.guest, false, 'housekeeping receives no guest contact')
assertForbiddenValuesAbsent(housekeepingReservation, 'housekeeping reservation')

const cafeReservation = projectReservationResponse(reservationFixture(), actors.cafe)
assert.equal(cafeReservation.folio.id, 'folio-a', 'cafe staff retain the folio identifiers needed by their cashier workflow')
assert.equal('email' in cafeReservation.guest, false, 'cafe staff receive no guest contact')
assert.equal('channelRef' in cafeReservation, false, 'cafe staff receive no channel reference')
assertForbiddenValuesAbsent(cafeReservation, 'cafe reservation')

for (const actor of [actors.admin, actors.manager, actors.frontDesk, actors.cashier, actors.housekeeping, actors.cafe]) {
  const guest = { ...reservationFixture().guest, reservations: [reservationFixture()] }
  const projection = projectGuestResponse(guest, actor, { includeReservations: true })
  if (['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(actor.role)) {
    assert.equal(projection.identityRecorded, true, `${actor.role} receives only the identity-presence flag`)
  } else {
    assert.equal('identityRecorded' in projection, false, `${actor.role} does not need guest identity status`)
  }
  assertForbiddenValuesAbsent(projection, `${actor.role} guest`)
}

const listPrisma = {
  property: {
    findUnique: async ({ where }) => {
      assert.deepEqual(where, { id: property.id }, 'list projections resolve only the actor property')
      return property
    },
  },
  reservation: {
    findMany: async ({ where }) => {
      assert.deepEqual(where, { propertyId: property.id }, 'reservation query remains property scoped')
      return [reservationFixture()]
    },
  },
  guest: {
    findMany: async ({ where }) => {
      assert.deepEqual(where, { propertyId: property.id }, 'guest query remains property scoped')
      return [{ ...reservationFixture().guest, reservations: [reservationFixture()] }]
    },
  },
}
assertForbiddenValuesAbsent(await listReservations(listPrisma, actors.admin), 'reservation service list')
assertForbiddenValuesAbsent(await listGuests(listPrisma, actors.admin), 'guest service list')

const syncProjection = projectBookingEmailSyncHttpResponse({
  status: {
    configured: true,
    credentialMode: 'refresh_token',
    credentialStatus: {
      gmailOauthClientConfigured: true,
      refreshTokenConfigured: true,
      targetMailboxConfigured: true,
      connectionTest: { checked: false, status: 'not_tested' },
      rawHeaders: { authorization: forbiddenHeader },
    },
    sources: [{ id: 'source-a', name: 'Primary', provider: 'gmail', enabled: true, rawText: forbiddenBody }],
    rawText: forbiddenBody,
  },
  events: [{
    id: 'event-a', source: 'Primary', sender: 'provider@example.test', receivedAt: '2026-08-01T00:00:00.000Z',
    eventType: 'NEW_BOOKING', status: 'NEEDS_REVIEW', parsedDetails: { guestName: 'Ada Guest', rawText: forbiddenBody },
    automationDecision: { stage: 'REVIEW_REQUIRED', blockers: ['Review required'], rawHeaders: { authorization: forbiddenHeader } },
    rawEmailUrl: 'https://mail.example.test/raw/provider-message-id', sourceEmailId: 'provider-message-id',
    rawText: forbiddenBody, body: forbiddenBody, rawHeaders: { authorization: forbiddenHeader },
  }],
  opsCommandEvents: [{ id: 'event-a', rawText: forbiddenBody, body: forbiddenBody, rawHeaders: { authorization: forbiddenHeader } }],
}, actors.admin)
assert.equal(syncProjection.events[0].parsedDetails.guestName, 'Ada Guest', 'sync HTTP DTO retains parsed operational fields')
assert.equal('opsCommandEvents' in syncProjection, false, 'sync HTTP DTO never returns internal Hotel Ops command input events')
assert.equal(serialized(syncProjection).includes(forbiddenBody), false, 'sync HTTP DTO excludes raw email bodies at every nesting level')
assert.equal(serialized(syncProjection).includes(forbiddenHeader), false, 'sync HTTP DTO excludes raw email headers at every nesting level')
for (const forbiddenKey of ['rawText', 'body', 'rawHeaders', 'rawEmailUrl', 'sourceEmailId', 'opsCommandEvents']) {
  assert.equal(serialized(syncProjection).includes(`"${forbiddenKey}"`), false, `sync HTTP DTO excludes key ${forbiddenKey}`)
}

const indexSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
assert.match(indexSource, /const httpResult = projectBookingEmailSyncHttpResponse\(result, user\)/, 'booking sync projects its HTTP response for the authenticated actor after internal command processing')
assert.match(indexSource, /data: httpResult\.status,[\s\S]{0,80}events: httpResult\.events/, 'booking sync serializes only the projected status and events')
assert.doesNotMatch(indexSource, /data: result\.status,[\s\S]{0,80}events: result\.events/, 'booking sync cannot accidentally serialize the internal raw result')

console.log('PMS privacy projection tests passed.')
