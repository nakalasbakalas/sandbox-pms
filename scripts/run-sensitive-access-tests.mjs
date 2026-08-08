/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  viewFullPaymentReference,
  viewRawBookingEmail,
  viewReservationSensitiveIdentity,
} from '../server/pms-service.mjs'
import {
  projectBookingEmailEventResponse,
  projectGuestResponse,
  projectReservationResponse,
} from '../server/pms-response-projections.mjs'
import { canPerformAction } from '../server/rbac.mjs'

const propertyA = { id: 'property-a', code: 'SANDBOX' }
const propertyB = { id: 'property-b', code: 'OTHER' }
const actors = {
  admin: { id: 'admin-a', propertyId: propertyA.id, role: 'ADMIN' },
  manager: { id: 'manager-a', propertyId: propertyA.id, role: 'MANAGER' },
  frontDesk: { id: 'front-desk-a', propertyId: propertyA.id, role: 'FRONT_DESK' },
  cashier: { id: 'cashier-a', propertyId: propertyA.id, role: 'CASHIER' },
  housekeeping: { id: 'housekeeping-a', propertyId: propertyA.id, role: 'HOUSEKEEPING' },
  cafe: { id: 'cafe-a', propertyId: propertyA.id, role: 'CAFE_STAFF' },
}

for (const [permission, allowedRoles] of Object.entries({
  'view:sensitive-identity': ['ADMIN', 'MANAGER', 'FRONT_DESK'],
  'view:raw-booking-email': ['ADMIN', 'MANAGER'],
  'view:full-payment-reference': ['ADMIN', 'MANAGER', 'CASHIER'],
})) {
  for (const actor of Object.values(actors)) {
    assert.equal(canPerformAction(actor, permission), allowedRoles.includes(actor.role), `${permission} follows the finish-packet role matrix for ${actor.role}`)
  }
}

function sensitiveFixture(options = {}) {
  const audits = []
  const records = {
    reservation: {
      id: 'reservation-a',
      propertyId: propertyA.id,
      status: options.reservationStatus || 'CONFIRMED',
      guest: {
        id: 'guest-a',
        nationality: 'TH',
        idType: 'PASSPORT',
        idNumber: 'TEST-ID-0001',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      },
    },
    event: {
      id: 'event-a',
      propertyId: propertyA.id,
      rawText: 'Synthetic booking email test body.',
      rawHeaders: {
        messageId: '<test-message@example.test>',
        date: 'Sat, 8 Aug 2026 10:00:00 +0700',
        authenticationResults: 'dkim=pass header.d=example.test',
        replyTo: 'reply@example.test',
        authorization: 'Bearer TEST-TOKEN-MUST-NOT-RETURN',
      },
    },
    payment: { id: 'payment-a', propertyId: propertyA.id, reference: 'TEST-PAYMENT-REF-0001' },
  }
  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where.id === propertyA.id) return propertyA
        if (where.id === propertyB.id) return propertyB
        return null
      },
    },
    reservation: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, {
          id: true,
          status: true,
          guest: { select: { id: true, nationality: true, idType: true, idNumber: true, dateOfBirth: true } },
        }, 'identity access selects only the requested sensitive fields and access context')
        return query.where.id === records.reservation.id && query.where.propertyId === records.reservation.propertyId ? records.reservation : null
      },
    },
    bookingEmailEvent: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, { id: true, rawText: true, rawHeaders: true }, 'raw email access selects only the requested evidence fields')
        return query.where.id === records.event.id && query.where.propertyId === records.event.propertyId ? records.event : null
      },
    },
    payment: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, { id: true, reference: true }, 'payment reference access selects only the requested reference field')
        return query.where.id === records.payment.id && query.where.propertyId === records.payment.propertyId ? records.payment : null
      },
    },
    auditLog: {
      create: async ({ data }) => {
        if (options.failAudit) throw new Error('Synthetic audit write failure')
        audits.push(data)
        return { id: `audit-${audits.length}`, ...data }
      },
    },
  }
  prisma.$transaction = async (callback) => callback(prisma)
  return { prisma, records, audits }
}

await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture().prisma, 'reservation-a', { reason: 'Check-in verification.' }, actors.cashier),
  { statusCode: 403 },
  'a role without identity permission is denied',
)
await assert.rejects(
  viewRawBookingEmail(sensitiveFixture().prisma, 'event-a', { reason: 'Provider dispute review.' }, actors.frontDesk),
  { statusCode: 403 },
  'front desk cannot read raw booking email evidence',
)
await assert.rejects(
  viewFullPaymentReference(sensitiveFixture().prisma, 'payment-a', { reason: 'Settlement reconciliation.' }, actors.cafe),
  { statusCode: 403 },
  'cafe staff cannot read full payment references',
)

for (const [read, id] of [
  [viewReservationSensitiveIdentity, 'reservation-a'],
  [viewRawBookingEmail, 'event-a'],
  [viewFullPaymentReference, 'payment-a'],
]) {
  await assert.rejects(read(sensitiveFixture().prisma, id, { reason: '   ' }, actors.admin), { statusCode: 400 }, 'sensitive access requires a non-empty JSON-body reason')
}

const foreignActor = { ...actors.admin, propertyId: propertyB.id }
for (const [read, id] of [
  [viewReservationSensitiveIdentity, 'reservation-a'],
  [viewRawBookingEmail, 'event-a'],
  [viewFullPaymentReference, 'payment-a'],
]) {
  await assert.rejects(read(sensitiveFixture().prisma, id, { reason: 'Cross-property denial probe.' }, foreignActor), { statusCode: 404 }, 'cross-property sensitive access returns not found')
}

await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture({ reservationStatus: 'CHECKED_OUT' }).prisma, 'reservation-a', { reason: 'Late profile review.' }, actors.frontDesk),
  { statusCode: 403 },
  'front desk identity access is limited to active check-in context',
)

const identityFixture = sensitiveFixture()
const identity = await viewReservationSensitiveIdentity(identityFixture.prisma, 'reservation-a', { reason: 'Check-in document verification.' }, actors.frontDesk)
assert.deepEqual(identity, {
  reservationId: 'reservation-a',
  guestId: 'guest-a',
  identity: {
    nationality: 'TH',
    idType: 'PASSPORT',
    idNumber: 'TEST-ID-0001',
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
  },
}, 'identity endpoint returns only the explicit identity field set')

const rawFixture = sensitiveFixture()
const raw = await viewRawBookingEmail(rawFixture.prisma, 'event-a', { reason: 'Provider dispute review.' }, actors.manager)
assert.deepEqual(Object.keys(raw).sort(), ['eventId', 'rawHeaders', 'rawText'])
assert.deepEqual(Object.keys(raw.rawHeaders).sort(), ['authenticationResults', 'date', 'messageId', 'replyTo'])
assert.equal(JSON.stringify(raw).includes('TEST-TOKEN-MUST-NOT-RETURN'), false, 'raw view excludes credential-shaped stored headers')
assert.equal('authorization' in raw.rawHeaders, false, 'raw view excludes unrelated authorization headers')

const paymentFixture = sensitiveFixture()
const payment = await viewFullPaymentReference(paymentFixture.prisma, 'payment-a', { reason: 'Settlement reconciliation.' }, actors.cashier)
assert.deepEqual(payment, { paymentId: 'payment-a', reference: 'TEST-PAYMENT-REF-0001' }, 'payment endpoint returns only id and full reference')

for (const [fixture, expected] of [
  [identityFixture, { action: 'SENSITIVE_IDENTITY_VIEWED', entityType: 'reservation', entityId: 'reservation-a', fields: ['nationality', 'idType', 'idNumber', 'dateOfBirth'] }],
  [rawFixture, { action: 'RAW_BOOKING_EMAIL_VIEWED', entityType: 'bookingEmailEvent', entityId: 'event-a', fields: ['rawText', 'rawHeaders.messageId', 'rawHeaders.date', 'rawHeaders.authenticationResults', 'rawHeaders.replyTo'] }],
  [paymentFixture, { action: 'FULL_PAYMENT_REFERENCE_VIEWED', entityType: 'payment', entityId: 'payment-a', fields: ['reference'] }],
]) {
  assert.equal(fixture.audits.length, 1, 'successful sensitive access creates one audit row')
  const audit = fixture.audits[0]
  assert.equal(audit.propertyId, propertyA.id)
  assert.ok(['admin-a', 'manager-a', 'front-desk-a', 'cashier-a'].includes(audit.userId), 'audit identifies the actor')
  assert.equal(audit.action, expected.action)
  assert.equal(audit.entityType, expected.entityType)
  assert.equal(audit.entityId, expected.entityId)
  assert.deepEqual(audit.changes.fields, expected.fields)
  assert.ok(audit.changes.reason.length > 0, 'audit records the operational reason')
  assert.equal(JSON.stringify(audit).includes('TEST-ID-0001'), false, 'audit contains no identity value')
  assert.equal(JSON.stringify(audit).includes('TEST-PAYMENT-REF-0001'), false, 'audit contains no payment reference value')
  assert.equal(JSON.stringify(audit).includes('Synthetic booking email test body.'), false, 'audit contains no raw email body')
}

await assert.rejects(
  viewFullPaymentReference(sensitiveFixture({ failAudit: true }).prisma, 'payment-a', { reason: 'Audit failure test.' }, actors.admin),
  /Synthetic audit write failure/,
  'sensitive data is not returned when its audit write fails',
)

const genericReservation = projectReservationResponse({
  ...identityFixture.records.reservation,
  confirmationCode: 'TEST-CONFIRMATION',
  guestId: identityFixture.records.reservation.guest.id,
  folio: { payments: [paymentFixture.records.payment] },
}, actors.admin)
const genericGuest = projectGuestResponse(identityFixture.records.reservation.guest, actors.admin)
assert.equal(JSON.stringify(genericReservation).includes('TEST-ID-0001'), false, 'generic reservation remains identity-redacted')
assert.equal(JSON.stringify(genericReservation).includes('TEST-PAYMENT-REF-0001'), false, 'generic reservation remains payment-reference-redacted')
assert.equal(JSON.stringify(genericGuest).includes('TEST-ID-0001'), false, 'generic guest remains identity-redacted')
const genericBookingEmail = projectBookingEmailEventResponse({
  id: 'event-a',
  rawEmailUrl: 'https://mail.example.test/raw/provider-message-id',
  sourceEmailId: 'provider-message-id',
  parsedDetails: { paymentReference: 'TEST-PAYMENT-REF-0001' },
})
assert.equal(JSON.stringify(genericBookingEmail).includes('TEST-PAYMENT-REF-0001'), false, 'generic booking-email summary masks the full payment reference')
assert.match(genericBookingEmail.parsedDetails.paymentReference, /•+0001$/, 'generic booking-email summary retains only a useful reference suffix')
assert.equal('rawEmailUrl' in genericBookingEmail, false, 'generic booking-email summary cannot bypass the audited raw-view endpoint')
assert.equal('sourceEmailId' in genericBookingEmail, false, 'generic booking-email summary excludes the legacy provider message identifier')

const indexSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
const authenticatedBoundary = indexSource.indexOf('const authenticatedUser = await requireUser(request)')
for (const [routeFragment, permission] of [
  ['identity-view', 'view:sensitive-identity'],
  ['raw-view', 'view:raw-booking-email'],
  ['reference-view', 'view:full-payment-reference'],
]) {
  const routePosition = indexSource.indexOf(routeFragment)
  assert.ok(authenticatedBoundary >= 0 && routePosition > authenticatedBoundary, `${routeFragment} is behind the shared 401 authentication boundary`)
  assert.match(indexSource.slice(routePosition, routePosition + 320), /request\.method === 'POST'/, `${routeFragment} is POST-only`)
  assert.match(indexSource.slice(routePosition, routePosition + 420), new RegExp(`requirePermission\\(user, '${permission.replaceAll(':', '\\:')}'\\)`), `${routeFragment} has its explicit route permission`)
  assert.match(indexSource.slice(routePosition, routePosition + 520), /await readJson\(request\)/, `${routeFragment} reads its reason from the JSON body`)
}

console.log('Sensitive access service and route-guard tests passed.')
